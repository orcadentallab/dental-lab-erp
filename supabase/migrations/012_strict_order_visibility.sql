-- Migration 012: Strict Order Visibility
-- Description: Enforces strict visibility rules.
--   - Admin / Accountant: View/Edit ALL orders.
--   - Representative: View/Edit ONLY orders assigned to them.
--   - Lab: View/Edit ONLY orders assigned to them (as Supplier).

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 1. DROP broad policies from Migration 011 AND previous ones
DROP POLICY IF EXISTS "Staff can view orders" ON orders;
DROP POLICY IF EXISTS "Staff can update orders" ON orders;
DROP POLICY IF EXISTS "Admins/Accountants view all orders" ON orders;
DROP POLICY IF EXISTS "Reps view assigned orders" ON orders;
DROP POLICY IF EXISTS "Reps view active orders" ON orders;
DROP POLICY IF EXISTS "Labs view assigned orders" ON orders;
DROP POLICY IF EXISTS "Admins/Accountants update all orders" ON orders;
DROP POLICY IF EXISTS "Reps update assigned orders" ON orders;
DROP POLICY IF EXISTS "Labs update assigned orders" ON orders;

-- Keep INSERT as is (Reps need to insert)
-- DROP POLICY IF EXISTS "Staff can insert orders" ON orders; -- Keep this

-- 2. VIEW Policies (SELECT)

-- Admin & Accountant: View ALL
CREATE POLICY "Admins/Accountants view all orders" ON orders
FOR SELECT
TO authenticated
USING (
  (SELECT role FROM users WHERE auth_id = auth.uid()) IN ('admin', 'accountant')
);

-- Representative: View ALL Active (Non-Delivered) Orders
CREATE POLICY "Reps view active orders" ON orders
FOR SELECT
TO authenticated
USING (
  (SELECT role FROM users WHERE auth_id = auth.uid()) = 'representative'
  AND status != 'Delivered'
);

-- Lab: View OWN ONLY
CREATE POLICY "Labs view assigned orders" ON orders
FOR SELECT
TO authenticated
USING (
  (SELECT role FROM users WHERE auth_id = auth.uid()) = 'lab'
  AND supplier_id = (SELECT entity_id FROM users WHERE auth_id = auth.uid())
);


-- 3. UPDATE Policies

-- Admin & Accountant: Update ALL
CREATE POLICY "Admins/Accountants update all orders" ON orders
FOR UPDATE
TO authenticated
USING (
  (SELECT role FROM users WHERE auth_id = auth.uid()) IN ('admin', 'accountant')
);

-- Representative: Update OWN ONLY
CREATE POLICY "Reps update assigned orders" ON orders
FOR UPDATE
TO authenticated
USING (
  (SELECT role FROM users WHERE auth_id = auth.uid()) = 'representative'
  AND representative_id = (SELECT id FROM users WHERE auth_id = auth.uid())
);

-- Lab: Update OWN ONLY (Column restrictions handled by Trigger in 002)
CREATE POLICY "Labs update assigned orders" ON orders
FOR UPDATE
TO authenticated
USING (
  (SELECT role FROM users WHERE auth_id = auth.uid()) = 'lab'
  AND supplier_id = (SELECT entity_id FROM users WHERE auth_id = auth.uid())
);
