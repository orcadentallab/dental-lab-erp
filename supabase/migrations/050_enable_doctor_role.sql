-- Migration: Enable Doctor Role and Permissions
-- Description: Updates checks for users and orders tables, adds RLS for doctor role.

-- 1. Update Users Role Check
-- First, drop the existing constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
-- Re-add with 'doctor'
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'lab', 'representative', 'accountant', 'designer', 'doctor'));

-- 2. Update Orders Status Check (Adding 'Pending Review')
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('Pending', 'In Progress', 'Completed', 'Delivered', 'New Case', 'Under Design', 'Waiting Dr Approval', 'Under Production', 'Try In', 'Try In Approved', 'Ready', 'Returned for Adjustments', 'Rejected', 'Pending Review', 'Cancelled'));

-- 3. Update RLS Policies

-- Helper function to ensure we can get role (if not exists)
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_my_entity_id()
RETURNS UUID AS $$
  SELECT entity_id FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- Orders: Doctors View Own Orders
DROP POLICY IF EXISTS "Doctors view own orders" ON orders;
CREATE POLICY "Doctors view own orders" ON orders
  FOR SELECT USING (
    get_my_role() = 'doctor' AND 
    doctor_id = get_my_entity_id()
  );

-- Orders: Doctors Create Order Requests
DROP POLICY IF EXISTS "Doctors create order requests" ON orders;
CREATE POLICY "Doctors create order requests" ON orders
  FOR INSERT WITH CHECK (
    get_my_role() = 'doctor' AND 
    doctor_id = get_my_entity_id() AND
    status = 'Pending Review'
  );

-- Orders: Doctors Rate Orders (Update Feedback)
DROP POLICY IF EXISTS "Doctors rate orders" ON orders;
CREATE POLICY "Doctors rate orders" ON orders
  FOR UPDATE USING (
    get_my_role() = 'doctor' AND 
    doctor_id = get_my_entity_id()
  ) WITH CHECK (
    get_my_role() = 'doctor' AND 
    doctor_id = get_my_entity_id()
  );

-- Transactions: Doctors View Own Transactions
DROP POLICY IF EXISTS "Doctors view own transactions" ON transactions;
CREATE POLICY "Doctors view own transactions" ON transactions
  FOR SELECT USING (
    get_my_role() = 'doctor' AND 
    entity_id = get_my_entity_id() AND
    entity_type = 'doctor'
  );

-- Doctors Table: View Own Profile
DROP POLICY IF EXISTS "Doctors view own profile" ON doctors;
CREATE POLICY "Doctors view own profile" ON doctors
  FOR SELECT USING (
    id = get_my_entity_id()
  );
