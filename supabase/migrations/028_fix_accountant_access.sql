-- Migration 028: Fix Accountant Permissions
-- Accountants need read access to core tables to perform Staff/Finance duties.

-- 1. Users (for Staff list and Salaries)
DROP POLICY IF EXISTS "Accountants can view all users" ON users;
CREATE POLICY "Accountants can view all users" ON users
  FOR SELECT
  TO authenticated
  USING (get_my_role() = 'accountant');

-- 2. Transactions (for Expenses and Payouts)
DROP POLICY IF EXISTS "Accountants can view all transactions" ON transactions;
CREATE POLICY "Accountants can view all transactions" ON transactions
  FOR SELECT
  TO authenticated
  USING (get_my_role() = 'accountant');

-- 3. Orders (for Commission calculations based on Sales)
-- Note: Read-only access
DROP POLICY IF EXISTS "Accountants can view all orders" ON orders;
CREATE POLICY "Accountants can view all orders" ON orders
  FOR SELECT
  TO authenticated
  USING (get_my_role() = 'accountant');

-- 4. Doctors (Context for orders/transactions)
DROP POLICY IF EXISTS "Accountants can view all doctors" ON doctors;
CREATE POLICY "Accountants can view all doctors" ON doctors
  FOR SELECT
  TO authenticated
  USING (get_my_role() = 'accountant');
