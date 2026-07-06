-- Migration: Add employee_type and create tables for advances, custody, and manual commissions.

-- 1. Add employee_type to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_type TEXT DEFAULT 'other'
    CHECK (employee_type IN ('sales_rep', 'accountant', 'admin', 'other'));

-- Backfill based on existing roles
UPDATE users SET employee_type = 'admin' WHERE role = 'admin' AND employee_type = 'other';
UPDATE users SET employee_type = 'accountant' WHERE role = 'accountant' AND employee_type = 'other';
UPDATE users SET employee_type = 'sales_rep' WHERE role = 'representative' AND employee_type = 'other';

-- 2. Create employee_advances table
CREATE TABLE IF NOT EXISTS employee_advances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    reason TEXT NOT NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'settled')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create employee_custody table
CREATE TABLE IF NOT EXISTS employee_custody (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount NUMERIC(10,2) CHECK (amount >= 0),
    item TEXT,
    date_given DATE NOT NULL DEFAULT CURRENT_DATE,
    date_returned DATE,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Constraint: amount or item must be provided
    CONSTRAINT chk_custody_content CHECK (amount IS NOT NULL OR item IS NOT NULL)
);

-- 4. Create employee_commissions table
CREATE TABLE IF NOT EXISTS employee_commissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    period VARCHAR(7) NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'), -- Format YYYY-MM
    note TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Indexes for optimization
CREATE INDEX IF NOT EXISTS idx_employee_advances_emp ON employee_advances(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_custody_emp ON employee_custody(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_commissions_emp ON employee_commissions(employee_id);

-- 6. Enable Row-Level Security
ALTER TABLE employee_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_custody ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_commissions ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies
-- Allow Admins and Accountants to manage all records
CREATE POLICY "manage_all_advances" ON employee_advances FOR ALL TO authenticated
    USING (get_my_role() IN ('admin', 'accountant'))
    WITH CHECK (get_my_role() IN ('admin', 'accountant'));

CREATE POLICY "manage_all_custody" ON employee_custody FOR ALL TO authenticated
    USING (get_my_role() IN ('admin', 'accountant'))
    WITH CHECK (get_my_role() IN ('admin', 'accountant'));

CREATE POLICY "manage_all_commissions" ON employee_commissions FOR ALL TO authenticated
    USING (get_my_role() IN ('admin', 'accountant'))
    WITH CHECK (get_my_role() IN ('admin', 'accountant'));

-- Allow individual employees to read their own records
CREATE POLICY "select_own_advances" ON employee_advances FOR SELECT TO authenticated
    USING (employee_id = (SELECT id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "select_own_custody" ON employee_custody FOR SELECT TO authenticated
    USING (employee_id = (SELECT id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "select_own_commissions" ON employee_commissions FOR SELECT TO authenticated
    USING (employee_id = (SELECT id FROM users WHERE auth_id = auth.uid()));
