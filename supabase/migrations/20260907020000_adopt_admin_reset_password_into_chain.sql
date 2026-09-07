-- Adopt admin_reset_password() into the migration chain, and revoke anon.
--
-- Found by the same production-drift audit as 20260907010000. Unlike
-- get_orders_paginated, this one is LIVE: src/services/supabase/users.ts
-- (resetUserPassword) calls it via supabase.rpc('admin_reset_password', ...),
-- and that is what backs the "reset password" action on the Users screen. It
-- was created directly in production, outside supabase/migrations/ -- the
-- exact situation get_doctor_receivables_breakdown and get_marketing_summary
-- were in before 20260812080000 adopted them. Same fix, same reason: a chain
-- rebuild must not lose a button people click.
--
-- Body is copied verbatim from production (including its comments) so this
-- migration changes nothing about what the function does -- only that it now
-- exists in the chain.
--
-- WHY THE REVOKE
--   Verified in production before this migration: EXECUTE was still granted
--   to PUBLIC (Postgres's default for a new function), so the anon key that
--   ships inside the frontend bundle could call this RPC directly. The
--   function's own admin check makes that safe today -- get_my_role() reads
--   NULL for an anonymous caller, so the RAISE EXCEPTION fires before
--   anything happens -- but supabase/tests/database/security_definer_rpc_grants
--   .test.sql exists precisely because "the internal check happens to save
--   us" is how get_doctor_receivables_breakdown leaked 49 doctors' balances
--   before anyone noticed the missing REVOKE. This function is added to that
--   test's expectations table as kind='wrapper' in the same commit, so the
--   catalog-driven guard (test 2) now covers it going forward.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_reset_password(target_user_id uuid, new_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
    found_user_role TEXT; -- Renamed to avoid keyword conflict
    target_auth_id UUID;
BEGIN
    -- 1. Check if the executing user is an 'admin'
    SELECT role INTO found_user_role
    FROM public.users
    WHERE auth_id = auth.uid();
    -- Debugging info includes the correct variable now
    IF found_user_role IS NULL OR found_user_role != 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can reset passwords. My AuthID: %, Role Found: %', auth.uid(), found_user_role;
    END IF;
    -- 2. Get the auth_id
    SELECT auth_id INTO target_auth_id
    FROM public.users
    WHERE id = target_user_id;
    IF target_auth_id IS NULL THEN
        RAISE EXCEPTION 'User not found or has no linked auth account.';
    END IF;
    -- 3. Update the password
    UPDATE auth.users
    SET encrypted_password = crypt(new_password, gen_salt('bf'))
    WHERE id = target_auth_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reset_password(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_password(uuid, text) TO authenticated;

COMMIT;
