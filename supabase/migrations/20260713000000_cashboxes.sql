-- Cashboxes / treasury support
-- Adds money-holding accounts, internal transfers, reconciliation snapshots,
-- and optional per-cashbox transfer fee settings.

CREATE TABLE IF NOT EXISTS cashboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cash', 'bank', 'vodafone_cash', 'instapay', 'other')),
  opening_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  opening_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  fee_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  fee_percentage NUMERIC(7, 4) NOT NULL DEFAULT 0 CHECK (fee_percentage >= 0),
  fee_min_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (fee_min_amount >= 0),
  fee_max_amount NUMERIC(12, 2) CHECK (fee_max_amount IS NULL OR fee_max_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS cashbox_id UUID REFERENCES cashboxes(id),
  ADD COLUMN IF NOT EXISTS linked_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_system_generated_fee BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS cashbox_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_cashbox_id UUID NOT NULL REFERENCES cashboxes(id),
  to_cashbox_id UUID NOT NULL REFERENCES cashboxes(id),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cashbox_transfers_distinct_boxes CHECK (from_cashbox_id <> to_cashbox_id)
);

CREATE TABLE IF NOT EXISTS cashbox_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cashbox_id UUID NOT NULL REFERENCES cashboxes(id),
  expected_balance NUMERIC(12, 2) NOT NULL,
  actual_balance NUMERIC(12, 2) NOT NULL,
  difference NUMERIC(12, 2) NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cashboxes_type_active ON cashboxes(type, is_active);
CREATE INDEX IF NOT EXISTS idx_transactions_cashbox ON transactions(cashbox_id);
CREATE INDEX IF NOT EXISTS idx_transactions_linked_transaction ON transactions(linked_transaction_id);
CREATE INDEX IF NOT EXISTS idx_cashbox_transfers_from ON cashbox_transfers(from_cashbox_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_cashbox_transfers_to ON cashbox_transfers(to_cashbox_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_cashbox_reconciliations_box_date ON cashbox_reconciliations(cashbox_id, date DESC, created_at DESC);

ALTER TABLE cashboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashbox_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashbox_reconciliations ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON cashboxes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON cashbox_transfers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON cashbox_reconciliations TO authenticated;

DROP POLICY IF EXISTS "cashboxes_select" ON cashboxes;
CREATE POLICY "cashboxes_select" ON cashboxes FOR SELECT TO authenticated
USING (get_my_role() IN ('admin', 'accountant'));

DROP POLICY IF EXISTS "cashboxes_insert" ON cashboxes;
CREATE POLICY "cashboxes_insert" ON cashboxes FOR INSERT TO authenticated
WITH CHECK (get_my_role() = 'admin');

DROP POLICY IF EXISTS "cashboxes_update" ON cashboxes;
CREATE POLICY "cashboxes_update" ON cashboxes FOR UPDATE TO authenticated
USING (get_my_role() = 'admin')
WITH CHECK (get_my_role() = 'admin');

DROP POLICY IF EXISTS "cashboxes_delete" ON cashboxes;
CREATE POLICY "cashboxes_delete" ON cashboxes FOR DELETE TO authenticated
USING (get_my_role() = 'admin');

DROP POLICY IF EXISTS "cashbox_transfers_select" ON cashbox_transfers;
CREATE POLICY "cashbox_transfers_select" ON cashbox_transfers FOR SELECT TO authenticated
USING (get_my_role() IN ('admin', 'accountant'));

DROP POLICY IF EXISTS "cashbox_transfers_insert" ON cashbox_transfers;
CREATE POLICY "cashbox_transfers_insert" ON cashbox_transfers FOR INSERT TO authenticated
WITH CHECK (get_my_role() IN ('admin', 'accountant'));

DROP POLICY IF EXISTS "cashbox_transfers_update" ON cashbox_transfers;
CREATE POLICY "cashbox_transfers_update" ON cashbox_transfers FOR UPDATE TO authenticated
USING (get_my_role() = 'admin')
WITH CHECK (get_my_role() = 'admin');

DROP POLICY IF EXISTS "cashbox_transfers_delete" ON cashbox_transfers;
CREATE POLICY "cashbox_transfers_delete" ON cashbox_transfers FOR DELETE TO authenticated
USING (get_my_role() = 'admin');

DROP POLICY IF EXISTS "cashbox_reconciliations_select" ON cashbox_reconciliations;
CREATE POLICY "cashbox_reconciliations_select" ON cashbox_reconciliations FOR SELECT TO authenticated
USING (get_my_role() IN ('admin', 'accountant'));

DROP POLICY IF EXISTS "cashbox_reconciliations_insert" ON cashbox_reconciliations;
CREATE POLICY "cashbox_reconciliations_insert" ON cashbox_reconciliations FOR INSERT TO authenticated
WITH CHECK (get_my_role() IN ('admin', 'accountant'));

DROP POLICY IF EXISTS "cashbox_reconciliations_update" ON cashbox_reconciliations;
CREATE POLICY "cashbox_reconciliations_update" ON cashbox_reconciliations FOR UPDATE TO authenticated
USING (get_my_role() = 'admin')
WITH CHECK (get_my_role() = 'admin');

DROP POLICY IF EXISTS "cashbox_reconciliations_delete" ON cashbox_reconciliations;
CREATE POLICY "cashbox_reconciliations_delete" ON cashbox_reconciliations FOR DELETE TO authenticated
USING (get_my_role() = 'admin');

DROP TRIGGER IF EXISTS update_cashboxes_updated_at ON cashboxes;
CREATE TRIGGER update_cashboxes_updated_at BEFORE UPDATE ON cashboxes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
