-- Add is_approved column to transactions table for two-stage expense approval
-- Stage 1: is_approved = false (Pending Approval)
-- Stage 2: is_approved = true (Approved, awaiting settlement)
-- Stage 3: is_registered = true (Settled, moved to General Accounts)

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT FALSE;

-- Grant admins DELETE permission on transactions
DROP POLICY IF EXISTS "Admins can delete transactions" ON transactions;
CREATE POLICY "Admins can delete transactions" ON transactions
  FOR DELETE
  TO authenticated
  USING (
    get_my_role() = 'admin'
  );

-- Grant admins UPDATE permission on transactions (for editing and approval)
DROP POLICY IF EXISTS "Admins can update all transactions" ON transactions;
CREATE POLICY "Admins can update all transactions" ON transactions
  FOR UPDATE
  TO authenticated
  USING (
    get_my_role() = 'admin'
  )
  WITH CHECK (
    get_my_role() = 'admin'
  );
