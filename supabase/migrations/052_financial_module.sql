-- Financial Module Tables

-- 1. Capital Entries (Initial Capital)
CREATE TABLE capital_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Fixed Assets
CREATE TABLE fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  value NUMERIC(12, 2) NOT NULL,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Adjustments (Journal Entries for Entities)
-- Type: 'credit' (Increasing their balance / We owe them / Income for us theoretically if it was cash but here it's just balance), 
--       'debit' (Decreasing their balance / They owe us)
-- Actually, let's stick to simple "amount": 
-- If amount > 0: Increases Entity's Balance (Credit to them).
-- If amount < 0: Decreases Entity's Balance (Debit to them).
-- But for clarity in UI, we might use "Credit/Debit" or "Add/Deduct".
-- Let's use `amount` where positive adds to their account (they have more money with us/we owe them more) and negative subtracts.
-- Wait, for Doctors (Customers): 
--   Positive Balance usually means THEY OWE US (Receivable). 
--   So "Adding" to their balance (Debt) -> Positive Amount?
--   Or "Payment" (Credit) -> Negates Debt?
-- Let's follow the standard used in App:
--   Doctor Balance = Work Done (Positive) - Paid (Positive).
--   So Net > 0 means DEBT (He owes us).
--   Adjustment to INCREASE Debt (e.g. Fine/Extra Charge): Positive Amount.
--   Adjustment to DECREASE Debt (e.g. Discount/Correction): Negative Amount.
CREATE TABLE adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('doctor', 'supplier', 'designer')),
  entity_id UUID NOT NULL,
  amount NUMERIC(12, 2) NOT NULL, -- Positive = Charge (Increase Debt for Doctor), Negative = Credit (Decrease Debt)
  type TEXT NOT NULL CHECK (type IN ('charge', 'credit')), -- Explicit type for clarity: 'charge' (Adds to debt/cost), 'credit' (Reduces debt/cost)
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Indexes
CREATE INDEX idx_capital_date ON capital_entries(date);
CREATE INDEX idx_assets_date ON fixed_assets(purchase_date);
CREATE INDEX idx_adjustments_entity ON adjustments(entity_type, entity_id);
CREATE INDEX idx_adjustments_date ON adjustments(date);

-- RLS Policies
ALTER TABLE capital_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE adjustments ENABLE ROW LEVEL SECURITY;

-- Admins only for Capital & Assets
CREATE POLICY "Admins can manage capital" ON capital_entries
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

CREATE POLICY "Admins can manage assets" ON fixed_assets
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

-- Adjustments: Admin can manage, Entity can View own?
CREATE POLICY "Admins can manage adjustments" ON adjustments
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

-- Entities view their own adjustments
CREATE POLICY "Docs view own adjustments" ON adjustments
  FOR SELECT USING (
    entity_type = 'doctor' AND 
    (entity_id IN (SELECT entity_id FROM users WHERE auth.uid() = id) -- If user is linked to doctor
     OR 
     entity_id = (SELECT entity_id FROM users WHERE id = auth.uid())
    )
  );

-- Helper to update timestamps
CREATE TRIGGER update_capital_updated_at BEFORE UPDATE ON capital_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_assets_updated_at BEFORE UPDATE ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
