-- Migration: adopt order_issues RLS policies into the migration chain
--
-- These four policies were applied to production manually from
-- supabase/temp_migrations/087_add_redo_and_order_issues.sql and were never
-- part of the chain. A database built from migrations alone ended up with
-- admin-only access to order_issues, so lab / accountant / designer /
-- representative users could not read order issues at all.
--
-- Idempotent: safe to re-run on a database that already has them.

DROP POLICY IF EXISTS "order_issues_admin_lab_read" ON order_issues;
CREATE POLICY "order_issues_admin_lab_read" ON order_issues
    FOR SELECT TO authenticated
    USING (get_my_role() IN ('admin','lab','accountant'));

DROP POLICY IF EXISTS "order_issues_admin_lab_write" ON order_issues;
CREATE POLICY "order_issues_admin_lab_write" ON order_issues
    FOR ALL TO authenticated
    USING (get_my_role() IN ('admin','lab'))
    WITH CHECK (get_my_role() IN ('admin','lab'));

-- Designer: read only
DROP POLICY IF EXISTS "order_issues_designer_read" ON order_issues;
CREATE POLICY "order_issues_designer_read" ON order_issues
    FOR SELECT TO authenticated
    USING (get_my_role() = 'designer');

-- Representative: read issues of their own orders only
DROP POLICY IF EXISTS "order_issues_rep_read_own" ON order_issues;
CREATE POLICY "order_issues_rep_read_own" ON order_issues
    FOR SELECT TO authenticated
    USING (
        get_my_role() = 'representative'
        AND order_id IN (
            SELECT id FROM orders
            WHERE representative_id = (
                SELECT id FROM users WHERE auth_id = auth.uid()
            )
        )
    );
