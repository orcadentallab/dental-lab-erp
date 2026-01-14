-- FORCE FIX: Grant widely to ensure no permission blocks
GRANT ALL ON order_history TO authenticated;
GRANT ALL ON orders TO authenticated; -- RLS will still restrict rows, but this ensures no table-level block

-- Ensure SEQUENCE permissions (common pitfall)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Ensure Users table is visible (needed for joins/FKs in triggers)
GRANT SELECT ON users TO authenticated;

-- Re-apply the Designer Update Policy with simplified logic
DROP POLICY IF EXISTS "Designers can update their assigned orders" ON orders;
CREATE POLICY "Designers can update their assigned orders"
ON orders FOR UPDATE
TO authenticated
USING (
  (designer_id = auth.uid()) OR (role IN ('admin', 'representative'))
)
WITH CHECK (
  (designer_id = auth.uid()) OR (role IN ('admin', 'representative'))
);

-- Re-apply Select Policy
DROP POLICY IF EXISTS "Designers can view their assigned orders" ON orders;
CREATE POLICY "Designers can view their assigned orders"
ON orders FOR SELECT
TO authenticated
USING (
  (designer_id = auth.uid()) OR (role IN ('admin', 'representative', 'lab', 'accountant'))
);

-- Fix order_history permissions specifically
DROP POLICY IF EXISTS "Users can insert history" ON order_history;
CREATE POLICY "Users can insert history"
ON order_history FOR INSERT
TO authenticated
WITH CHECK (true); -- Allow insertion of history logs by anyone (triggers handle content)

DROP POLICY IF EXISTS "Users can view history" ON order_history;
CREATE POLICY "Users can view history"
ON order_history FOR SELECT
TO authenticated
USING (true); -- Allow viewing history
