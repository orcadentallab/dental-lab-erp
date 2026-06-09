-- Migration 090: Fix Row Level Security policies for financial obligations
-- Purpose:
--   Allow representatives, accountants, labs, designers, and doctors to SELECT/INSERT/UPDATE
--   obligation records so that client-side status updates can succeed without 403.

-- 1. Drop existing restrictive policies
DROP POLICY IF EXISTS "Representatives view doctor receivable obligations" ON financial_obligations;
DROP POLICY IF EXISTS "Accountants view financial obligations" ON financial_obligations;

-- 2. Allow Representatives to manage (SELECT, INSERT, UPDATE) financial obligations
CREATE POLICY "Representatives manage financial obligations"
ON financial_obligations
FOR ALL
TO authenticated
USING (get_my_role() = 'representative')
WITH CHECK (get_my_role() = 'representative');

-- 3. Allow Accountants to manage (SELECT, INSERT, UPDATE) financial obligations
CREATE POLICY "Accountants manage financial obligations"
ON financial_obligations
FOR ALL
TO authenticated
USING (get_my_role() = 'accountant')
WITH CHECK (get_my_role() = 'accountant');

-- 4. Allow Labs (Suppliers) to manage (SELECT, INSERT, UPDATE) their own payable obligations
CREATE POLICY "Labs manage own payable obligations"
ON financial_obligations
FOR ALL
TO authenticated
USING (
    get_my_role() = 'lab'
    AND entity_type = 'external_lab'
    AND entity_id = get_my_entity_id()
)
WITH CHECK (
    get_my_role() = 'lab'
    AND entity_type = 'external_lab'
    AND entity_id = get_my_entity_id()
);

-- 5. Allow Designers to manage (SELECT, INSERT, UPDATE) their own payable obligations
CREATE POLICY "Designers manage own payable obligations"
ON financial_obligations
FOR ALL
TO authenticated
USING (
    get_my_role() = 'designer'
    AND entity_type = 'designer'
    AND entity_id = get_my_user_id()
)
WITH CHECK (
    get_my_role() = 'designer'
    AND entity_type = 'designer'
    AND entity_id = get_my_user_id()
);

-- 6. Allow Doctors to view (SELECT) their own receivable obligations
CREATE POLICY "Doctors view own receivable obligations"
ON financial_obligations
FOR SELECT
TO authenticated
USING (
    get_my_role() = 'doctor'
    AND entity_type = 'doctor'
    AND entity_id = get_my_entity_id()
);
