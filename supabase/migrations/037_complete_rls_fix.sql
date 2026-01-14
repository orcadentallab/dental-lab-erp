-- Migration 037: COMPLETE FIX - Working RLS with Performance Optimization
-- This replaces all previous broken attempts

-- =============================================
-- STEP 1: DISABLE ALL RLS
-- =============================================
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers DISABLE ROW LEVEL SECURITY;
ALTER TABLE doctors DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE services DISABLE ROW LEVEL SECURITY;
ALTER TABLE order_history DISABLE ROW LEVEL SECURITY;

-- =============================================
-- STEP 2: DROP ALL EXISTING POLICIES
-- =============================================
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public') LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
    END LOOP;
END $$;

-- =============================================
-- STEP 3: CREATE OPTIMIZED POLICIES
-- Using get_my_role(), get_my_entity_id(), get_my_user_id()
-- These functions are SECURITY DEFINER with proper search_path
-- =============================================

-- ========== USERS ==========
-- Everyone can read users (needed for lookups, dropdowns etc)
CREATE POLICY "users_read" ON users FOR SELECT TO authenticated USING (true);

-- Only admins can modify users
CREATE POLICY "users_insert" ON users FOR INSERT TO authenticated WITH CHECK (get_my_role() = 'admin');
CREATE POLICY "users_update" ON users FOR UPDATE TO authenticated USING (get_my_role() = 'admin');
CREATE POLICY "users_delete" ON users FOR DELETE TO authenticated USING (get_my_role() = 'admin');

-- ========== ORDERS ==========
CREATE POLICY "orders_read" ON orders FOR SELECT TO authenticated
USING (
    get_my_role() IN ('admin', 'accountant')
    OR (get_my_role() = 'representative')
    OR (get_my_role() = 'lab' AND supplier_id = get_my_entity_id())
    OR (get_my_role() = 'designer' AND designer_id = get_my_user_id())
);

CREATE POLICY "orders_insert" ON orders FOR INSERT TO authenticated
WITH CHECK (get_my_role() IN ('admin', 'accountant', 'representative'));

CREATE POLICY "orders_update" ON orders FOR UPDATE TO authenticated
USING (
    get_my_role() IN ('admin', 'accountant')
    OR (get_my_role() = 'representative')
    OR (get_my_role() = 'lab' AND supplier_id = get_my_entity_id())
    OR (get_my_role() = 'designer' AND designer_id = get_my_user_id())
);

CREATE POLICY "orders_delete" ON orders FOR DELETE TO authenticated
USING (get_my_role() = 'admin');

-- ========== SUPPLIERS ==========
CREATE POLICY "suppliers_read" ON suppliers FOR SELECT TO authenticated
USING (
    get_my_role() IN ('admin', 'accountant', 'representative', 'designer')
    OR (get_my_role() = 'lab' AND id = get_my_entity_id())
);

CREATE POLICY "suppliers_insert" ON suppliers FOR INSERT TO authenticated WITH CHECK (get_my_role() = 'admin');
CREATE POLICY "suppliers_update" ON suppliers FOR UPDATE TO authenticated USING (get_my_role() = 'admin');
CREATE POLICY "suppliers_delete" ON suppliers FOR DELETE TO authenticated USING (get_my_role() = 'admin');

-- ========== DOCTORS ==========
CREATE POLICY "doctors_read" ON doctors FOR SELECT TO authenticated USING (true);
CREATE POLICY "doctors_insert" ON doctors FOR INSERT TO authenticated WITH CHECK (get_my_role() IN ('admin', 'representative'));
CREATE POLICY "doctors_update" ON doctors FOR UPDATE TO authenticated USING (get_my_role() IN ('admin', 'representative'));
CREATE POLICY "doctors_delete" ON doctors FOR DELETE TO authenticated USING (get_my_role() = 'admin');

-- ========== TRANSACTIONS ==========
CREATE POLICY "transactions_read" ON transactions FOR SELECT TO authenticated
USING (
    get_my_role() IN ('admin', 'accountant')
    OR (get_my_role() = 'representative' AND entity_id = get_my_user_id())
);

CREATE POLICY "transactions_insert" ON transactions FOR INSERT TO authenticated
WITH CHECK (
    get_my_role() IN ('admin', 'accountant')
    OR (get_my_role() = 'representative' AND type = 'expense')
);

CREATE POLICY "transactions_update" ON transactions FOR UPDATE TO authenticated
USING (get_my_role() IN ('admin', 'accountant'));

CREATE POLICY "transactions_delete" ON transactions FOR DELETE TO authenticated
USING (get_my_role() = 'admin');

-- ========== SERVICES ==========
CREATE POLICY "services_read" ON services FOR SELECT TO authenticated USING (true);
CREATE POLICY "services_insert" ON services FOR INSERT TO authenticated WITH CHECK (get_my_role() = 'admin');
CREATE POLICY "services_update" ON services FOR UPDATE TO authenticated USING (get_my_role() = 'admin');
CREATE POLICY "services_delete" ON services FOR DELETE TO authenticated USING (get_my_role() = 'admin');

-- ========== ORDER HISTORY ==========
CREATE POLICY "order_history_read" ON order_history FOR SELECT TO authenticated
USING (order_id IN (SELECT id FROM orders));

-- Trigger handles insert, but allow admin manual insert
CREATE POLICY "order_history_insert" ON order_history FOR INSERT TO authenticated
WITH CHECK (get_my_role() = 'admin');

-- =============================================
-- STEP 4: RE-ENABLE RLS
-- =============================================
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_history ENABLE ROW LEVEL SECURITY;
