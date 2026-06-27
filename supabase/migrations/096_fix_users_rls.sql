-- =====================================================================
-- Migration 096: Fix Users Table RLS Policy for Doctor Role
-- Date: 2026-06-27
-- Purpose:
--   Restrict SELECT access on the "users" table so that:
--   - Staff (admin, accountant, representative, lab, designer) can view all users.
--   - Doctors can only view their own user record.
-- =====================================================================

DROP POLICY IF EXISTS "users_select" ON users;

CREATE POLICY "users_select" ON users FOR SELECT TO authenticated
USING (
    get_my_role() IN ('admin', 'accountant', 'representative', 'lab', 'designer')
    OR (get_my_role() = 'doctor' AND id = get_my_user_id())
);
