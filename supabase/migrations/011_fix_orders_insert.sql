-- Migration 011: Fix Orders INSERT Permission
-- Description: Allows Admin, Accountant, Representative to create orders.

-- Ensure RLS is enabled
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Drop potentially conflicting policies
DROP POLICY IF EXISTS "Anyone can insert orders" ON orders;
DROP POLICY IF EXISTS "Authenticated users insert orders" ON orders;

-- Policy: Admin, Accountant, Representative can INSERT orders
CREATE POLICY "Staff can insert orders" ON orders
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT role FROM users WHERE auth_id = auth.uid()) IN ('admin', 'accountant', 'representative')
);

-- Ensure SELECT policy exists for reading back inserted data
DROP POLICY IF EXISTS "Staff can view orders" ON orders;
CREATE POLICY "Staff can view orders" ON orders
FOR SELECT
TO authenticated
USING (
  (SELECT role FROM users WHERE auth_id = auth.uid()) IN ('admin', 'accountant', 'representative', 'lab')
  OR representative_id = (SELECT id FROM users WHERE auth_id = auth.uid())
);

-- Ensure UPDATE policy for staff
DROP POLICY IF EXISTS "Staff can update orders" ON orders;
CREATE POLICY "Staff can update orders" ON orders
FOR UPDATE
TO authenticated
USING (
  (SELECT role FROM users WHERE auth_id = auth.uid()) IN ('admin', 'accountant', 'representative', 'lab')
);
