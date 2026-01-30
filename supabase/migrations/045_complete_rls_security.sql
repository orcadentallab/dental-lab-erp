-- =====================================================================
-- Migration 045: Complete RLS Security Fix
-- Date: 2026-01-30
-- =====================================================================
-- All policies in one file for easy deployment
-- =====================================================================

-- =====================================================================
-- STEP 1: DISABLE RLS FOR CLEAN SLATE
-- =====================================================================
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE doctors DISABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers DISABLE ROW LEVEL SECURITY;
ALTER TABLE services DISABLE ROW LEVEL SECURITY;
ALTER TABLE order_history DISABLE ROW LEVEL SECURITY;

-- =====================================================================
-- STEP 2: DROP ALL EXISTING POLICIES
-- =====================================================================
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public') LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
    END LOOP;
END $$;

-- =====================================================================
-- TABLE: users
-- =====================================================================
-- All roles can read (for dropdowns)
-- Only admin can write
-- Users can update self (except role)

CREATE POLICY "users_select" ON users FOR SELECT TO authenticated
USING (get_my_role() IS NOT NULL);

CREATE POLICY "users_insert" ON users FOR INSERT TO authenticated
WITH CHECK (get_my_role() = 'admin');

CREATE POLICY "users_update" ON users FOR UPDATE TO authenticated
USING (get_my_role() = 'admin' OR auth_id = auth.uid())
WITH CHECK (
    get_my_role() = 'admin'
    OR (auth_id = auth.uid() AND role = (SELECT role FROM users WHERE auth_id = auth.uid()))
);

CREATE POLICY "users_delete" ON users FOR DELETE TO authenticated
USING (get_my_role() = 'admin');

-- =====================================================================
-- TABLE: orders
-- =====================================================================
-- Admin/Accountant: all
-- Designer: own assigned only
-- Representative: non-delivered only
-- Lab: own supplier only

CREATE POLICY "orders_select" ON orders FOR SELECT TO authenticated
USING (
    get_my_role() IN ('admin', 'accountant')
    OR (get_my_role() = 'designer' AND designer_id = get_my_user_id())
    OR (get_my_role() = 'representative' AND status != 'Delivered')
    OR (get_my_role() = 'lab' AND supplier_id = get_my_entity_id())
);

CREATE POLICY "orders_insert" ON orders FOR INSERT TO authenticated
WITH CHECK (get_my_role() IN ('admin', 'accountant', 'representative'));

CREATE POLICY "orders_update" ON orders FOR UPDATE TO authenticated
USING (
    get_my_role() IN ('admin', 'accountant')
    OR (get_my_role() = 'designer' AND designer_id = get_my_user_id())
    OR (get_my_role() = 'representative' AND status != 'Delivered')
    OR (get_my_role() = 'lab' AND supplier_id = get_my_entity_id())
)
WITH CHECK (
    get_my_role() IN ('admin', 'accountant')
    OR (get_my_role() = 'designer' AND designer_id = get_my_user_id())
    OR (get_my_role() = 'representative' AND status != 'Delivered')
    OR (get_my_role() = 'lab' AND supplier_id = get_my_entity_id())
);

CREATE POLICY "orders_delete" ON orders FOR DELETE TO authenticated
USING (get_my_role() = 'admin');

-- =====================================================================
-- TABLE: transactions
-- =====================================================================
-- Admin/Accountant: all
-- Representative: own + doctors only (NO designer/supplier)
-- Designer: own only
-- Lab: own supplier only

CREATE POLICY "transactions_select" ON transactions FOR SELECT TO authenticated
USING (
    get_my_role() IN ('admin', 'accountant')
    -- Representative: own transactions + doctor transactions only
    OR (get_my_role() = 'representative' AND (
        entity_id = get_my_user_id()
        OR entity_type = 'doctor'
    ))
    -- Designer: own transactions only
    OR (get_my_role() = 'designer' AND entity_id = get_my_user_id())
    -- Lab: their supplier transactions only
    OR (get_my_role() = 'lab' AND entity_id = get_my_entity_id())
);

CREATE POLICY "transactions_insert" ON transactions FOR INSERT TO authenticated
WITH CHECK (
    get_my_role() IN ('admin', 'accountant')
    OR (get_my_role() = 'representative' AND type = 'expense')
);

CREATE POLICY "transactions_update" ON transactions FOR UPDATE TO authenticated
USING (get_my_role() IN ('admin', 'accountant'))
WITH CHECK (get_my_role() IN ('admin', 'accountant'));

CREATE POLICY "transactions_delete" ON transactions FOR DELETE TO authenticated
USING (get_my_role() = 'admin');

-- =====================================================================
-- TABLE: doctors
-- =====================================================================
-- Admin/Accountant/Representative/Designer: all
-- Lab: only doctors from their orders

CREATE POLICY "doctors_select" ON doctors FOR SELECT TO authenticated
USING (
    get_my_role() IN ('admin', 'accountant', 'representative', 'designer')
    OR (get_my_role() = 'lab' AND EXISTS (
        SELECT 1 FROM orders WHERE orders.doctor_id = doctors.id AND orders.supplier_id = get_my_entity_id()
    ))
);

CREATE POLICY "doctors_insert" ON doctors FOR INSERT TO authenticated
WITH CHECK (get_my_role() IN ('admin', 'representative'));

CREATE POLICY "doctors_update" ON doctors FOR UPDATE TO authenticated
USING (get_my_role() IN ('admin', 'representative'));

CREATE POLICY "doctors_delete" ON doctors FOR DELETE TO authenticated
USING (get_my_role() = 'admin');

-- =====================================================================
-- TABLE: suppliers
-- =====================================================================
-- Admin/Accountant/Representative/Designer: all
-- Lab: own supplier only

CREATE POLICY "suppliers_select" ON suppliers FOR SELECT TO authenticated
USING (
    get_my_role() IN ('admin', 'accountant', 'representative', 'designer')
    OR (get_my_role() = 'lab' AND id = get_my_entity_id())
);

CREATE POLICY "suppliers_insert" ON suppliers FOR INSERT TO authenticated
WITH CHECK (get_my_role() = 'admin');

CREATE POLICY "suppliers_update" ON suppliers FOR UPDATE TO authenticated
USING (get_my_role() = 'admin');

CREATE POLICY "suppliers_delete" ON suppliers FOR DELETE TO authenticated
USING (get_my_role() = 'admin');

-- =====================================================================
-- TABLE: services (Price List)
-- =====================================================================
-- Admin/Accountant: all
-- Representative: NO ACCESS (can't see prices)
-- Designer/Lab: read only (for calculations)

CREATE POLICY "services_select" ON services FOR SELECT TO authenticated
USING (get_my_role() IN ('admin', 'accountant', 'designer', 'lab'));

CREATE POLICY "services_insert" ON services FOR INSERT TO authenticated
WITH CHECK (get_my_role() = 'admin');

CREATE POLICY "services_update" ON services FOR UPDATE TO authenticated
USING (get_my_role() = 'admin');

CREATE POLICY "services_delete" ON services FOR DELETE TO authenticated
USING (get_my_role() = 'admin');

-- =====================================================================
-- TABLE: order_history
-- =====================================================================
-- Follows orders access pattern

CREATE POLICY "order_history_select" ON order_history FOR SELECT TO authenticated
USING (
    get_my_role() IN ('admin', 'accountant')
    OR order_id IN (SELECT id FROM orders)
);

CREATE POLICY "order_history_insert" ON order_history FOR INSERT TO authenticated
WITH CHECK (get_my_role() = 'admin');

-- =====================================================================
-- STEP 3: RE-ENABLE RLS
-- =====================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_history ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- STEP 4: AUTO-SET REPRESENTATIVE_ID TRIGGER
-- =====================================================================
CREATE OR REPLACE FUNCTION auto_set_representative_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    current_role TEXT;
    current_user_id UUID;
BEGIN
    SELECT role, id INTO current_role, current_user_id 
    FROM users WHERE auth_id = auth.uid();
    
    IF current_role = 'representative' AND NEW.representative_id IS NULL THEN
        NEW.representative_id := current_user_id;
    END IF;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_set_representative ON orders;
CREATE TRIGGER trigger_auto_set_representative
    BEFORE INSERT ON orders
    FOR EACH ROW
    EXECUTE FUNCTION auto_set_representative_id();

-- =====================================================================
-- SUMMARY
-- =====================================================================
-- users:        All read | Admin write | Self update (no role change)
-- orders:       Role-based | Rep sees non-delivered | Designer/Lab own only
-- transactions: Admin/Accountant all | Rep sees doctors only | Designer/Lab own
-- doctors:      Most roles read | Lab only from their orders
-- suppliers:    Most roles read | Lab own only
-- services:     NO REP ACCESS | Admin/Accountant/Designer/Lab read
-- order_history: Follows orders
-- =====================================================================
