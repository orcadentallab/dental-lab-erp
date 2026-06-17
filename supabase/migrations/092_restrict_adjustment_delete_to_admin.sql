-- Drop existing policies
DROP POLICY IF EXISTS "Admins and Accountants can manage adjustments" ON adjustments;
DROP POLICY IF EXISTS "Entities view own adjustments" ON adjustments;

-- Allow Admins and Accountants to INSERT adjustments
CREATE POLICY "Admins and Accountants can insert adjustments" ON adjustments
  FOR INSERT
  WITH CHECK (get_my_role() IN ('admin', 'accountant'));

-- Allow Admins and Accountants to UPDATE adjustments
CREATE POLICY "Admins and Accountants can update adjustments" ON adjustments
  FOR UPDATE
  USING (get_my_role() IN ('admin', 'accountant'))
  WITH CHECK (get_my_role() IN ('admin', 'accountant'));

-- Allow ONLY Admins to DELETE adjustments
CREATE POLICY "Admins can delete adjustments" ON adjustments
  FOR DELETE
  USING (get_my_role() = 'admin');

-- Recreate view policy with the correct designer check
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
     (entity_id = auth.uid()
      OR
      entity_id IN (SELECT id FROM users WHERE auth.uid() = id)
     )
    )
  );
