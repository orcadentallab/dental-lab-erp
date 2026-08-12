-- Migration: tighten RLS on contact_inquiries and marketing_events
--
-- Both tables were readable -- and contact_inquiries also WRITABLE -- by any
-- authenticated user, because their policies were USING (true). Doctor-portal
-- users authenticate, so a doctor could read and modify every marketing lead
-- (doctor_name, clinic_name, phone, message) belonging to other prospects.
-- Found while folding these tables into the migration chain (20260812090000).
--
-- ROOT CAUSE of the USING (true), worth recording so it is not reintroduced:
--   supabase/manual/marketing_events.sql declared the intended admin check as
--       EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
--   but public.users has SEPARATE `id` and `auth_id` columns: `id` is the
--   application's user id, `auth_id` is the Supabase auth uid. `u.id = auth.uid()`
--   therefore matches no row, so that policy denied EVERYONE including admins,
--   and the marketing page showed nothing. It appears to have been "fixed" in
--   production by replacing the broken predicate with USING (true) -- trading a
--   closed door for an open one.
--
--   The correct house pattern, used by ~40 existing policies, is the
--   SECURITY DEFINER helper public.get_my_role(), which resolves
--   `SELECT role FROM users WHERE auth_id = auth.uid()`. This migration uses
--   that helper rather than reinstating the repo's declared-but-broken
--   predicate. No policy in production still uses the `u.id = auth.uid()` form.
--
-- get_my_role() returns NULL for an unauthenticated caller, so anon is denied
-- by these predicates regardless of grants. The anon INSERT path used by the
-- public landing page is deliberately left untouched.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. contact_inquiries -- restrict reads and writes to admin/representative
--
--    Unchanged on purpose:
--      anon_insert / auth_insert -- the public landing page must be able to
--      submit an inquiry without logging in (contactService.submitInquiry).
--      Creating a lead is not sensitive; reading or editing other people's is.
-- ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_select" ON public.contact_inquiries;
CREATE POLICY "auth_select" ON public.contact_inquiries
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'representative'));

-- WITH CHECK mirrors USING so a permitted role cannot update a row into a
-- state it would not be allowed to see.
DROP POLICY IF EXISTS "auth_update" ON public.contact_inquiries;
CREATE POLICY "auth_update" ON public.contact_inquiries
    FOR UPDATE TO authenticated
    USING (public.get_my_role() IN ('admin', 'representative'))
    WITH CHECK (public.get_my_role() IN ('admin', 'representative'));

-- ─────────────────────────────────────────────────────────────────────────
-- 2. marketing_events -- make the "Admin read" policy actually check admin
-- ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin read marketing_events" ON public.marketing_events;
CREATE POLICY "Admin read marketing_events" ON public.marketing_events
    FOR SELECT TO authenticated
    USING (public.get_my_role() = 'admin');

COMMIT;
