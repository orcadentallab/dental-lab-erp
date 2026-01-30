-- Migration 046: Allow Representatives to view ALL orders (including Delivered)
-- Date: 2026-01-30

-- Disable RLS temporarily
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;

-- Drop existing restricted policies
DROP POLICY IF EXISTS "orders_select" ON orders;
DROP POLICY IF EXISTS "orders_update" ON orders;

-- Create new OPEN policies for Representatives

-- SELECT Policy
CREATE POLICY "orders_select" ON orders FOR SELECT TO authenticated
USING (
    get_my_role() IN ('admin', 'accountant')
    OR (get_my_role() = 'designer' AND designer_id = get_my_user_id())
    -- Removed "AND status != 'Delivered'" condition for representatives
    OR (get_my_role() = 'representative') 
    OR (get_my_role() = 'lab' AND supplier_id = get_my_entity_id())
);

-- UPDATE Policy
CREATE POLICY "orders_update" ON orders FOR UPDATE TO authenticated
USING (
    get_my_role() IN ('admin', 'accountant')
    OR (get_my_role() = 'designer' AND designer_id = get_my_user_id())
    -- Removed "AND status != 'Delivered'" condition for representatives
    OR (get_my_role() = 'representative')
    OR (get_my_role() = 'lab' AND supplier_id = get_my_entity_id())
)
WITH CHECK (
    get_my_role() IN ('admin', 'accountant')
    OR (get_my_role() = 'designer' AND designer_id = get_my_user_id())
    -- Removed "AND status != 'Delivered'" condition for representatives
    OR (get_my_role() = 'representative')
    OR (get_my_role() = 'lab' AND supplier_id = get_my_entity_id())
);

-- Re-enable RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
