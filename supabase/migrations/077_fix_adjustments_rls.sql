-- Drop existing policies
DROP POLICY IF EXISTS "Admins can manage adjustments" ON adjustments;
DROP POLICY IF EXISTS "Docs view own adjustments" ON adjustments;

-- Allow Admins and Accountants to manage (CRUD) adjustments
CREATE POLICY "Admins and Accountants can manage adjustments" ON adjustments
  USING (get_my_role() IN ('admin', 'accountant'))
  WITH CHECK (get_my_role() IN ('admin', 'accountant'));

-- Allow Internal Staff (Representatives, Lab) to view adjustments for reporting
CREATE POLICY "Staff can view adjustments" ON adjustments
  FOR SELECT
  USING (get_my_role() IN ('admin', 'accountant', 'representative', 'lab'));

-- Allow Docs, Suppliers, Designers to view only their own adjustments
CREATE POLICY "Entities view own adjustments" ON adjustments
  FOR SELECT USING (
    (entity_type = 'doctor' AND 
     (entity_id IN (SELECT entity_id FROM users WHERE auth.uid() = id) 
      OR 
      entity_id = (SELECT entity_id FROM users WHERE id = auth.uid())
     )
    )
    OR
    (entity_type = 'supplier' AND 
     (entity_id IN (SELECT entity_id FROM users WHERE auth.uid() = id) 
      OR 
      entity_id = (SELECT entity_id FROM users WHERE id = auth.uid())
     )
    )
    OR
    (entity_type = 'designer' AND 
     (entity_id IN (SELECT entity_id FROM users WHERE auth.uid() = id) 
      OR 
      entity_id = (SELECT entity_id FROM users WHERE id = auth.uid())
     )
    )
  );
