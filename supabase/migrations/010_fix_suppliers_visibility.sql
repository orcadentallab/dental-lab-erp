-- Migration 010: Fix Suppliers Visibility (Role-Based)
-- Description: 
--   - Admin, Accountant, Representative: See ALL suppliers
--   - Lab: See only their OWN supplier (via entity_id)
--   - Designer: See NOTHING

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies on suppliers
DROP POLICY IF EXISTS "Labs view own supplier info" ON suppliers;
DROP POLICY IF EXISTS "Admins view all suppliers" ON suppliers;
DROP POLICY IF EXISTS "Anyone can view suppliers" ON suppliers;
DROP POLICY IF EXISTS "Admins manage suppliers" ON suppliers;
DROP POLICY IF EXISTS "Role based suppliers access" ON suppliers;

-- Policy: Admin, Accountant, Representative can view ALL suppliers
CREATE POLICY "Admin/Accountant/Rep view all suppliers" ON suppliers
FOR SELECT
TO authenticated
USING (
  (SELECT role FROM users WHERE auth_id = auth.uid()) IN ('admin', 'accountant', 'representative')
);

-- Policy: Lab can view only THEIR OWN supplier
CREATE POLICY "Lab view own supplier" ON suppliers
FOR SELECT
TO authenticated
USING (
  (SELECT role FROM users WHERE auth_id = auth.uid()) = 'lab'
  AND id = (SELECT entity_id FROM users WHERE auth_id = auth.uid())
);

-- Policy: Admin full management (insert/update/delete)
CREATE POLICY "Admins manage suppliers" ON suppliers
FOR ALL
TO authenticated
USING (
  (SELECT role FROM users WHERE auth_id = auth.uid()) = 'admin'
);
