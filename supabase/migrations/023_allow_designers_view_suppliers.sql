-- Migration 023: Allow Designers to View Suppliers
-- Description: Designers need to see suppliers list to display Lab Name in dashboard when design is assigned to a lab.

DROP POLICY IF EXISTS "Designers view suppliers" ON suppliers;

CREATE POLICY "Designers view suppliers" ON suppliers
FOR SELECT
TO authenticated
USING (
  (SELECT role FROM users WHERE auth_id = auth.uid()) = 'designer'
);

-- Update the main shared policy if preferred, but adding a specific one is safer/easier here.
-- Alternatively, we can update the list in "Admin/Accountant/Rep view all suppliers" but that requires dropping and recreating it.
-- Let's keep it separate for clarity or append to the existing list logic if we were editing the original file. 
-- Since we are making a NEW migration, a separate policy is cleanest.
