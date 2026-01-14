-- Migration 036: Fix Performance Warnings
-- Description: 
-- 1. Wrap auth.uid() in subqueries for RLS policies
-- 2. Consolidate multiple permissive policies
-- 3. Remove duplicate indexes

-- =============================================
-- PART 1: Remove Duplicate Indexes
-- =============================================
DROP INDEX IF EXISTS idx_doctors_representative;
DROP INDEX IF EXISTS idx_orders_doctor;
DROP INDEX IF EXISTS idx_transactions_entity;

-- =============================================
-- PART 2: Consolidate Orders RLS Policies
-- =============================================

-- Drop all existing orders policies
DROP POLICY IF EXISTS "Admins full access orders" ON orders;
DROP POLICY IF EXISTS "Accountants can view all orders" ON orders;
DROP POLICY IF EXISTS "Admins/Accountants view all orders" ON orders;
DROP POLICY IF EXISTS "Designers view assigned orders" ON orders;
DROP POLICY IF EXISTS "Doctors view own orders" ON orders;
DROP POLICY IF EXISTS "Labs view assigned orders" ON orders;
DROP POLICY IF EXISTS "Reps view active orders" ON orders;
DROP POLICY IF EXISTS "Reps view own orders" ON orders;
DROP POLICY IF EXISTS "Users can view orders" ON orders;
DROP POLICY IF EXISTS "Admins/Accountants update all orders" ON orders;
DROP POLICY IF EXISTS "Designers update assigned orders" ON orders;
DROP POLICY IF EXISTS "Labs update assigned orders" ON orders;
DROP POLICY IF EXISTS "Reps update assigned orders" ON orders;
DROP POLICY IF EXISTS "Users can update orders" ON orders;
DROP POLICY IF EXISTS "Staff can insert orders" ON orders;
DROP POLICY IF EXISTS "Admins delete orders" ON orders;

-- Single SELECT policy for orders (optimized with subquery)
CREATE POLICY "orders_select" ON orders FOR SELECT TO authenticated
USING (
    (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) IN ('admin', 'accountant')
    OR (
        (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) = 'representative'
        AND (status != 'Delivered' OR representative_id = (SELECT id FROM public.users WHERE auth_id = (SELECT auth.uid())))
    )
    OR (
        (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) = 'lab'
        AND supplier_id = (SELECT entity_id FROM public.users WHERE auth_id = (SELECT auth.uid()))
    )
    OR (
        (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) = 'designer'
        AND designer_id = (SELECT id FROM public.users WHERE auth_id = (SELECT auth.uid()))
    )
);

-- Single INSERT policy for orders
CREATE POLICY "orders_insert" ON orders FOR INSERT TO authenticated
WITH CHECK (
    (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) IN ('admin', 'accountant', 'representative')
);

-- Single UPDATE policy for orders
CREATE POLICY "orders_update" ON orders FOR UPDATE TO authenticated
USING (
    (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) IN ('admin', 'accountant')
    OR (
        (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) = 'representative'
        AND representative_id = (SELECT id FROM public.users WHERE auth_id = (SELECT auth.uid()))
    )
    OR (
        (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) = 'lab'
        AND supplier_id = (SELECT entity_id FROM public.users WHERE auth_id = (SELECT auth.uid()))
    )
    OR (
        (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) = 'designer'
        AND designer_id = (SELECT id FROM public.users WHERE auth_id = (SELECT auth.uid()))
    )
);

-- Single DELETE policy for orders
CREATE POLICY "orders_delete" ON orders FOR DELETE TO authenticated
USING (
    (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) = 'admin'
);

-- =============================================
-- PART 3: Consolidate Users RLS Policies
-- =============================================
DROP POLICY IF EXISTS "Admins can manage users" ON users;
DROP POLICY IF EXISTS "Admins can view all users" ON users;
DROP POLICY IF EXISTS "Users can view own profile" ON users;
DROP POLICY IF EXISTS "Accountants can view all users" ON users;

-- Single SELECT policy for users
CREATE POLICY "users_select" ON users FOR SELECT TO authenticated
USING (
    auth_id = (SELECT auth.uid())
    OR (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) IN ('admin', 'accountant')
);

-- Admin-only modify
CREATE POLICY "users_modify" ON users FOR ALL TO authenticated
USING (
    (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) = 'admin'
);

-- =============================================
-- PART 4: Consolidate Suppliers RLS Policies
-- =============================================
DROP POLICY IF EXISTS "Admin/Accountant/Rep view all suppliers" ON suppliers;
DROP POLICY IF EXISTS "Admins manage suppliers" ON suppliers;
DROP POLICY IF EXISTS "Lab view own supplier" ON suppliers;
DROP POLICY IF EXISTS "Admins view all suppliers" ON suppliers;
DROP POLICY IF EXISTS "Labs view own supplier info" ON suppliers;
DROP POLICY IF EXISTS "Designers view suppliers" ON suppliers;

-- Single SELECT policy for suppliers
CREATE POLICY "suppliers_select" ON suppliers FOR SELECT TO authenticated
USING (
    (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) IN ('admin', 'accountant', 'representative', 'designer')
    OR (
        (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) = 'lab'
        AND id = (SELECT entity_id FROM public.users WHERE auth_id = (SELECT auth.uid()))
    )
);

-- Admin-only modify
CREATE POLICY "suppliers_modify" ON suppliers FOR ALL TO authenticated
USING (
    (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) = 'admin'
);

-- =============================================
-- PART 5: Consolidate Doctors RLS Policies
-- =============================================
DROP POLICY IF EXISTS "Accountants can view all doctors" ON doctors;
DROP POLICY IF EXISTS "Anyone can view doctors" ON doctors;
DROP POLICY IF EXISTS "Admins view all doctors" ON doctors;
DROP POLICY IF EXISTS "Admins and Reps can insert doctors" ON doctors;
DROP POLICY IF EXISTS "Admins and Reps can update doctors" ON doctors;

-- Single SELECT policy for doctors
CREATE POLICY "doctors_select" ON doctors FOR SELECT TO authenticated
USING (true); -- All authenticated users can view doctors

-- INSERT/UPDATE for admins and reps
CREATE POLICY "doctors_modify" ON doctors FOR ALL TO authenticated
USING (
    (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) IN ('admin', 'representative')
);

-- =============================================
-- PART 6: Consolidate Transactions RLS Policies
-- =============================================
DROP POLICY IF EXISTS "Accountants can view all transactions" ON transactions;
DROP POLICY IF EXISTS "Admins view all transactions" ON transactions;
DROP POLICY IF EXISTS "Reps can view own expenses" ON transactions;
DROP POLICY IF EXISTS "Accountants can insert transactions" ON transactions;
DROP POLICY IF EXISTS "Reps can insert expenses" ON transactions;
DROP POLICY IF EXISTS "Accountants can update transactions" ON transactions;

-- Single SELECT policy for transactions
CREATE POLICY "transactions_select" ON transactions FOR SELECT TO authenticated
USING (
    (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) IN ('admin', 'accountant')
    OR (
        (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) = 'representative'
        AND entity_id = (SELECT id FROM public.users WHERE auth_id = (SELECT auth.uid()))
    )
);

-- INSERT for admins, accountants, and reps
CREATE POLICY "transactions_insert" ON transactions FOR INSERT TO authenticated
WITH CHECK (
    (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) IN ('admin', 'accountant')
    OR (
        (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) = 'representative'
        AND type = 'expense'
    )
);

-- UPDATE for admins and accountants
CREATE POLICY "transactions_update" ON transactions FOR UPDATE TO authenticated
USING (
    (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) IN ('admin', 'accountant')
);

-- =============================================
-- PART 7: Consolidate Order History RLS Policies
-- =============================================
DROP POLICY IF EXISTS "Users can view history" ON order_history;
DROP POLICY IF EXISTS "Users view history" ON order_history;
DROP POLICY IF EXISTS "Users view history of visible orders" ON order_history;

-- Single SELECT policy for order_history
CREATE POLICY "order_history_select" ON order_history FOR SELECT TO authenticated
USING (
    order_id IN (SELECT id FROM orders)
);

-- Fix INSERT policy for order_history
DROP POLICY IF EXISTS "Only system can insert history" ON order_history;
CREATE POLICY "order_history_insert" ON order_history FOR INSERT TO authenticated
WITH CHECK (
    (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) = 'admin'
);

-- =============================================
-- PART 8: Fix Services RLS Policy
-- =============================================
DROP POLICY IF EXISTS "Allow all for authenticated" ON services;

CREATE POLICY "services_select" ON services FOR SELECT TO authenticated
USING (true);

CREATE POLICY "services_modify" ON services FOR ALL TO authenticated
USING (
    (SELECT role FROM public.users WHERE auth_id = (SELECT auth.uid())) = 'admin'
);
