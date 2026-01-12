-- Migration 013: Allow Admins to Delete Orders
-- Description: Adds a DELETE policy for admins on the orders table.

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Drop prior DELETE policies if any (there shouldn't be any usually)
DROP POLICY IF EXISTS "Admins delete orders" ON orders;

-- Policy: Admin can DELETE orders
CREATE POLICY "Admins delete orders" ON orders
FOR DELETE
TO authenticated
USING (
  (SELECT role FROM users WHERE auth_id = auth.uid()) = 'admin'
);
