-- Migration 082: Financial Obligations
-- Purpose:
--   Add order-based receivable/payable obligation records.
--   This does not create allocations, credits, backfill, reports, or automatic status wiring.

CREATE TABLE IF NOT EXISTS financial_obligations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

    entity_type TEXT NOT NULL
        CHECK (entity_type IN ('doctor', 'external_lab', 'designer')),
    entity_id UUID NOT NULL,

    direction TEXT NOT NULL
        CHECK (direction IN ('receivable', 'payable')),

    trigger_type TEXT NOT NULL
        CHECK (trigger_type IN (
            'doctor_delivered',
            'external_lab_ready',
            'designer_approved',
            'manual_adjustment'
        )),

    trigger_status TEXT,
    trigger_date DATE NOT NULL,
    due_date DATE NOT NULL,

    gross_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    adjustment_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    net_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    allocated_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    remaining_amount NUMERIC(12, 2)
        GENERATED ALWAYS AS (net_amount - allocated_amount) STORED,

    status TEXT NOT NULL DEFAULT 'unpaid'
        CHECK (status IN ('unpaid', 'partially_paid', 'paid', 'void', 'written_off')),

    source TEXT NOT NULL DEFAULT 'order'
        CHECK (source IN ('order', 'remake', 'adjustment', 'backfill')),

    notes TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),

    CONSTRAINT financial_obligations_amounts_valid CHECK (
        gross_amount >= 0
        AND allocated_amount >= 0
        AND net_amount >= 0
        AND allocated_amount <= net_amount
    )
);

CREATE INDEX IF NOT EXISTS idx_financial_obligations_order_id
    ON financial_obligations(order_id);

CREATE INDEX IF NOT EXISTS idx_financial_obligations_entity
    ON financial_obligations(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_financial_obligations_due_date
    ON financial_obligations(due_date);

CREATE INDEX IF NOT EXISTS idx_financial_obligations_status
    ON financial_obligations(status);

CREATE INDEX IF NOT EXISTS idx_financial_obligations_direction
    ON financial_obligations(direction);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_obligation_source_trigger
    ON financial_obligations(order_id, entity_type, entity_id, direction, trigger_type, source)
    WHERE status <> 'void';

CREATE OR REPLACE FUNCTION set_financial_obligations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_financial_obligations_updated_at
ON financial_obligations;

CREATE TRIGGER trigger_financial_obligations_updated_at
BEFORE UPDATE ON financial_obligations
FOR EACH ROW
EXECUTE FUNCTION set_financial_obligations_updated_at();

ALTER TABLE financial_obligations ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON financial_obligations TO authenticated;

DROP POLICY IF EXISTS "Admins manage financial obligations" ON financial_obligations;
CREATE POLICY "Admins manage financial obligations"
ON financial_obligations
FOR ALL
TO authenticated
USING (get_my_role() = 'admin')
WITH CHECK (get_my_role() = 'admin');

DROP POLICY IF EXISTS "Accountants view financial obligations" ON financial_obligations;
CREATE POLICY "Accountants view financial obligations"
ON financial_obligations
FOR SELECT
TO authenticated
USING (get_my_role() = 'accountant');

DROP POLICY IF EXISTS "Representatives view doctor receivable obligations" ON financial_obligations;
CREATE POLICY "Representatives view doctor receivable obligations"
ON financial_obligations
FOR SELECT
TO authenticated
USING (
    get_my_role() = 'representative'
    AND entity_type = 'doctor'
    AND direction = 'receivable'
);

COMMENT ON TABLE financial_obligations IS
    'Order-based receivable/payable source-of-truth records. No allocations, credits, backfill, or automatic lifecycle wiring in Phase 3B-1.';
