-- Migration 029: Fix Transaction Write Access
-- Enable Representatives to submit expenses and Accountants to pay salaries.

-- 1. Representatives: Insert Expenses
DROP POLICY IF EXISTS "Reps can insert expenses" ON transactions;
CREATE POLICY "Reps can insert expenses" ON transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    get_my_role() = 'representative' AND
    type = 'expense'
    -- data validation can be added here if needed
  );

-- 2. Representatives: View Own Expenses
DROP POLICY IF EXISTS "Reps can view own expenses" ON transactions;
CREATE POLICY "Reps can view own expenses" ON transactions
  FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'representative' AND
    entity_id = get_my_user_id()
  );

-- 3. Accountants: Insert Transactions (Salaries, Payouts)
DROP POLICY IF EXISTS "Accountants can insert transactions" ON transactions;
CREATE POLICY "Accountants can insert transactions" ON transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    get_my_role() = 'accountant'
  );

-- 4. Accountants: Update Transactions (Mark as Registered/Settled)
DROP POLICY IF EXISTS "Accountants can update transactions" ON transactions;
CREATE POLICY "Accountants can update transactions" ON transactions
  FOR UPDATE
  TO authenticated
  USING (
    get_my_role() = 'accountant'
  )
  WITH CHECK (
    get_my_role() = 'accountant'
  );
