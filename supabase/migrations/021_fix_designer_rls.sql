-- Migration 021: Fix Designer RLS
-- Description: Enable Designers to VIEW and UPDATE orders assigned to them.

-- 1. VIEW Policies (SELECT)
CREATE POLICY "Designers view assigned orders" ON orders
FOR SELECT
TO authenticated
USING (
  (SELECT role FROM users WHERE auth_id = auth.uid()) = 'designer'
  AND designer_id = (SELECT id FROM users WHERE auth_id = auth.uid())
);

-- 2. UPDATE Policies
-- Designers need to update status (design_status)
CREATE POLICY "Designers update assigned orders" ON orders
FOR UPDATE
TO authenticated
USING (
  (SELECT role FROM users WHERE auth_id = auth.uid()) = 'designer'
  AND designer_id = (SELECT id FROM users WHERE auth_id = auth.uid())
);
