-- Ensure Designers can UPDATE their assigned orders
-- We drop the policy if it exists to be safe and recreate it
DROP POLICY IF EXISTS "Designers can update their assigned orders" ON orders;

CREATE POLICY "Designers can update their assigned orders"
ON orders FOR UPDATE
TO authenticated
USING (
  auth.uid() = designer_id
  OR
  EXISTS (
    SELECT 1 FROM public.users 
    WHERE id = auth.uid() AND role IN ('admin', 'representative')
  )
)
WITH CHECK (
  auth.uid() = designer_id
  OR
  EXISTS (
    SELECT 1 FROM public.users 
    WHERE id = auth.uid() AND role IN ('admin', 'representative')
  )
);

-- Ensure Designers can SELECT their assigned orders (if not already covered)
DROP POLICY IF EXISTS "Designers can view their assigned orders" ON orders;
CREATE POLICY "Designers can view their assigned orders"
ON orders FOR SELECT
TO authenticated
USING (
  auth.uid() = designer_id
  OR
  role IN ('admin', 'lab', 'representative', 'accountant')
);
