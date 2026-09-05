-- Deactivating a user actually deactivates them.
--
-- NOT part of the roles plan. This is a standing hole found while surveying
-- docs/PRODUCTION_ROLES_PLAN_AR.md section 3.a, and it is fixed on its own
-- because it is older, wider and more serious than anything that plan touches.
--
-- WHAT WAS BROKEN
--   The Users screen has an "active" switch. Turning it off wrote
--   users.is_active = false and users.deactivated_at, and that is ALL it did.
--   Nothing read the column on the way in: AuthContext accepted any session
--   whose profile row merely EXISTED, and users_select carried no is_active
--   term. Five accounts sat switched off and able to sign in; two of them had
--   signed in after being switched off, one an admin, one of those the day
--   before this migration was written. The switch had never worked.
--
--   Second, and independent of the switch: users_update permits
--       USING      (get_my_role() = 'admin') OR (auth_id = auth.uid())
--       WITH CHECK ... OR (auth_id = auth.uid() AND role = <the caller's role>)
--   with no trigger anywhere on the table. The WITH CHECK freezes exactly one
--   column: role. Self-promotion to 'admin' was therefore already refused --
--   but every other column on the caller's own row was writable. Verified
--   against this schema with the trigger disabled, a signed-in
--   representative could run, in one REST call each:
--       UPDATE users SET base_salary = 999999          -- succeeded
--       UPDATE users SET is_active = false             -- succeeded
--       UPDATE users SET custom_permissions = '{...}'  -- succeeded
--       UPDATE users SET role = 'admin'                -- refused by WITH CHECK
--   custom_permissions is the escalation that matters: hasPermission() in
--   AuthContext checks it BEFORE the role table and lets it override, so
--   granting yourself a key is granting yourself the screen. Freezing role
--   while leaving that column open froze the front door and not the window.
--
--   The two are one problem. Enforcing is_active without closing the
--   self-write would be theatre: is_active is itself one of the columns a
--   locked-out account could rewrite, so it would switch itself back on.
--
--   None of these columns has a legitimate self-service caller. The app
--   self-updates nothing on public.users: Settings.tsx changes the auth
--   password via supabase.auth.updateUser, and updateUser() in
--   services/supabase/users.ts is reached only from the admin Users screen.
--
-- HOW IT IS FIXED
--   1. The three identity functions return NULL for a deactivated user. They
--      sit under essentially every RLS policy in the schema, so one line
--      revokes everything at once -- no policy-by-policy sweep to get wrong,
--      and no new concept for the next person to learn.
--   2. A trigger refuses self-edits to role, activation and pay columns.
--
--   Deliberately NOT done: adding is_active to users_select. Admins must keep
--   seeing deactivated people -- that is how they are reactivated, and the
--   Users screen renders a badge for them. Hiding the rows would make the
--   switch a one-way door.
--
-- BLAST RADIUS
--   Sign-in breaks for exactly those accounts already flagged inactive:
--   Belal (admin), Yomna (representative), Cairo (lab), EZ_Lab (lab),
--   Hayam (representative). No row is written by this migration. Anyone locked
--   out in error is restored by flipping the switch back on in the Users
--   screen -- which is now the only way in or out.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. A deactivated user has no identity
-- ─────────────────────────────────────────────────────────────────────────
-- Returning NULL rather than raising: RLS predicates compare against these,
-- and NULL = 'admin' is NULL, which is not true, which denies. An exception
-- would instead surface as a 500 on every read and hide the reason.
--
-- Bodies are otherwise untouched from their previous definitions.

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role FROM users WHERE auth_id = auth.uid() AND is_active LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.get_my_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id FROM users WHERE auth_id = auth.uid() AND is_active LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.get_my_entity_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT entity_id FROM users WHERE auth_id = auth.uid() AND is_active LIMIT 1
$$;

COMMENT ON FUNCTION public.get_my_role() IS
    'Caller''s role, or NULL when the account is deactivated. The is_active '
    'term is the system-wide lockout: RLS predicates comparing against NULL '
    'deny. Added 20260905.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Nobody promotes themselves
-- ─────────────────────────────────────────────────────────────────────────
-- Guards the users_update branch that permits auth_id = auth.uid(). The
-- branch is kept rather than dropped so that a self-service profile edit
-- (name, email, username) stays possible; only the columns that confer
-- privilege or money are frozen.
--
-- role is in the list even though users_update's WITH CHECK already refuses
-- it. Duplication is cheap here and the alternative is a guard that reads as
-- if self-promotion were permitted, which is how the next person removes the
-- WITH CHECK while tidying.

CREATE OR REPLACE FUNCTION public.users_guard_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    caller_role text;
BEGIN
    -- Migrations, seeds, service_role and triggers run without an end-user
    -- JWT. They are not what this guards, and must not be slowed or blocked.
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    -- Somebody else's row. users_update already restricts that to admins.
    IF OLD.auth_id IS DISTINCT FROM auth.uid() THEN
        RETURN NEW;
    END IF;

    -- Read directly rather than through get_my_role(): an explicit read keeps
    -- this legible next to the policy it guards, and does not depend on that
    -- function keeping its current shape.
    SELECT role INTO caller_role
    FROM public.users
    WHERE auth_id = auth.uid() AND is_active
    LIMIT 1;

    -- An active admin editing their own row is ordinary administration --
    -- including stepping themselves down or switching themselves off.
    IF caller_role = 'admin' THEN
        RETURN NEW;
    END IF;

    IF NEW.role              IS DISTINCT FROM OLD.role
    OR NEW.is_active         IS DISTINCT FROM OLD.is_active
    OR NEW.deactivated_at    IS DISTINCT FROM OLD.deactivated_at
    OR NEW.custom_permissions IS DISTINCT FROM OLD.custom_permissions
    OR NEW.entity_id         IS DISTINCT FROM OLD.entity_id
    OR NEW.base_salary       IS DISTINCT FROM OLD.base_salary
    OR NEW.unit_rate         IS DISTINCT FROM OLD.unit_rate
    OR NEW.designer_service_prices IS DISTINCT FROM OLD.designer_service_prices
    OR NEW.employee_type     IS DISTINCT FROM OLD.employee_type
    THEN
        RAISE EXCEPTION
            'A user may not change their own role, activation, entity or pay fields'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_guard_self_update ON public.users;
CREATE TRIGGER users_guard_self_update
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.users_guard_self_update();

COMMENT ON FUNCTION public.users_guard_self_update() IS
    'Closes privilege escalation through the users_update self branch: a '
    'non-admin editing their own row may not touch role, is_active, '
    'deactivated_at, custom_permissions, entity_id or pay. Added 20260905.';

COMMIT;
