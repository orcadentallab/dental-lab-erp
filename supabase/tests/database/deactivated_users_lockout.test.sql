-- The active switch, and the escalation it used to leave open.
--
-- Guards 20260905020000_deactivated_users_cannot_sign_in.sql.
--
-- Two holes, fixed together because either one alone leaves the other
-- pointless:
--
--   1. THE SWITCH DID NOTHING. users.is_active was written by the Users
--      screen and read by nobody on the way in. Five accounts sat switched
--      off and able to sign in; an admin among them signed in two months
--      after being switched off. The fix is the is_active term inside
--      get_my_role() / get_my_user_id() / get_my_entity_id(), which sit under
--      essentially every RLS policy -- so the assertions below check the
--      identity functions, not a sample of tables, because that is where the
--      property actually lives.
--   2. THE SELF ROW WAS WRITABLE. users_update permits auth_id = auth.uid()
--      and the table had no trigger. Its WITH CHECK froze exactly one column,
--      role -- so self-promotion to 'admin' was already refused, but salary,
--      is_active and custom_permissions were not. custom_permissions is the
--      one that escalates: hasPermission() consults it before the role table
--      and lets it win, so granting yourself a key grants you the screen.
--      is_active is the one that made hole 1's fix theatre -- a locked-out
--      account could simply switch itself back on.
--
-- The two assertions most worth keeping honest are the ones that say what
-- must STILL work: an active admin has to keep seeing deactivated rows (that
-- is the only way anyone is ever let back in), and an ordinary user has to
-- keep being able to edit their own name. A guard that blocks those is a
-- worse bug than the one it fixes.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(13);

-- ─── Fixtures ────────────────────────────────────────────────────────────
-- Two pairs: active and deactivated, admin and representative. The
-- deactivated admin mirrors the real account that prompted this migration.

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('d1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'deact-admin-on@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('d1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'deact-rep-on@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('d1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'deact-admin-off@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('d1000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'deact-rep-off@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name, is_active, base_salary) VALUES
    ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001',
     'deact-admin-on', 'admin', 'Active Admin', true, 1000),
    ('d2000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000002',
     'deact-rep-on', 'representative', 'Active Rep', true, 1000),
    ('d2000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000003',
     'deact-admin-off', 'admin', 'Switched Off Admin', false, 1000),
    ('d2000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000004',
     'deact-rep-off', 'representative', 'Switched Off Rep', false, 1000);

-- ─── A deactivated account has no identity ───────────────────────────────

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

SELECT is(public.get_my_role(), 'admin',
    'an active admin still resolves to their role');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000003', TRUE);
SET LOCAL ROLE authenticated;

SELECT is(public.get_my_role(), NULL::text,
    'a deactivated admin resolves to no role -- every RLS predicate now denies');

SELECT is(public.get_my_user_id(), NULL::uuid,
    'a deactivated admin resolves to no user id');

SELECT is((SELECT count(*)::integer FROM public.users), 0,
    'a deactivated admin reads nothing, despite the admin role on the row');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000004', TRUE);
SET LOCAL ROLE authenticated;

SELECT is(public.get_my_role(), NULL::text,
    'a deactivated representative resolves to no role');

-- The lockout must not be escapable from inside. No WHERE clause on purpose:
-- users_update's USING already narrows this to the caller's own row, and a
-- WHERE would be filtered by users_select first -- which for a deactivated
-- caller matches nothing, so the statement would report zero rows and never
-- reach the trigger. Zero rows is a safe outcome but it is not the one being
-- asserted here; this has to exercise the guard itself, because the guard is
-- what stands between a locked-out account and switching itself back on.
SELECT throws_ok(
    $$UPDATE public.users SET is_active = true$$,
    '42501',
    NULL,
    'a deactivated user cannot switch themselves back on');

-- ─── Nobody promotes themselves ──────────────────────────────────────────

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000002', TRUE);
SET LOCAL ROLE authenticated;

SELECT is(public.get_my_user_id(), 'd2000000-0000-0000-0000-000000000002'::uuid,
    'an active representative still resolves to their user id');

SELECT throws_ok(
    $$UPDATE public.users SET role = 'admin'
      WHERE auth_id = 'd1000000-0000-0000-0000-000000000002'$$,
    '42501',
    NULL,
    'a representative cannot promote themselves to admin');

SELECT throws_ok(
    $$UPDATE public.users SET base_salary = 999999
      WHERE auth_id = 'd1000000-0000-0000-0000-000000000002'$$,
    '42501',
    NULL,
    'a representative cannot raise their own salary');

SELECT throws_ok(
    $$UPDATE public.users SET custom_permissions = '{"showAsEmployee": true}'::jsonb
      WHERE auth_id = 'd1000000-0000-0000-0000-000000000002'$$,
    '42501',
    NULL,
    'a representative cannot grant themselves custom permissions');

-- What must still work: an ordinary self-service profile edit.
SELECT lives_ok(
    $$UPDATE public.users SET name = 'Active Rep Renamed'
      WHERE auth_id = 'd1000000-0000-0000-0000-000000000002'$$,
    'a representative can still edit their own name');

-- ─── Administration is untouched ─────────────────────────────────────────

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

-- Without this, deactivation is a one-way door: the Users screen could not
-- list the people it needs to switch back on.
SELECT is(
    (SELECT count(*)::integer FROM public.users WHERE is_active = false),
    2,
    'an active admin still sees deactivated users, so they can be reactivated');

SELECT lives_ok(
    $$UPDATE public.users SET role = 'designer'
      WHERE id = 'd2000000-0000-0000-0000-000000000002'$$,
    'an active admin can still change somebody else''s role');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
