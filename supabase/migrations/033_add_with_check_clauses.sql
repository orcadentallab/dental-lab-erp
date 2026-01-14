-- Migration 033: Add WITH CHECK Clauses
-- Description: Prevent users from reassigning orders to others

-- Rep cannot reassign orders to other reps
DROP POLICY IF EXISTS "Reps update assigned orders" ON orders;
CREATE POLICY "Reps update assigned orders" ON orders
FOR UPDATE TO authenticated
USING (
  (SELECT role FROM users WHERE auth_id = auth.uid()) = 'representative'
  AND representative_id = (SELECT id FROM users WHERE auth_id = auth.uid())
)
WITH CHECK (
  -- Ensure rep can't remove themselves or assign to another rep
  representative_id = (SELECT id FROM users WHERE auth_id = auth.uid())
);

-- Lab cannot reassign orders to other suppliers
DROP POLICY IF EXISTS "Labs update assigned orders" ON orders;
CREATE POLICY "Labs update assigned orders" ON orders
FOR UPDATE TO authenticated
USING (
  (SELECT role FROM users WHERE auth_id = auth.uid()) = 'lab'
  AND supplier_id = (SELECT entity_id FROM users WHERE auth_id = auth.uid())
)
WITH CHECK (
  -- Ensure lab can't reassign to another supplier
  supplier_id = (SELECT entity_id FROM users WHERE auth_id = auth.uid())
);

-- Designer cannot reassign orders
DROP POLICY IF EXISTS "Designers update assigned orders" ON orders;
CREATE POLICY "Designers update assigned orders" ON orders
FOR UPDATE TO authenticated
USING (
  (SELECT role FROM users WHERE auth_id = auth.uid()) = 'designer'
  AND designer_id = (SELECT id FROM users WHERE auth_id = auth.uid())
)
WITH CHECK (
  designer_id = (SELECT id FROM users WHERE auth_id = auth.uid())
);
