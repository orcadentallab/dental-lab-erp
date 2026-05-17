-- Migration 083: Allocation Engine Foundation
-- Purpose:
--   Add empty schema foundations for future payment allocation, credits,
--   allocation audit, and financial exception review.
--
-- Important:
--   This migration intentionally does not backfill historical data, link
--   existing transactions, create allocation rows, create credit rows, or
--   change official financial reporting behavior.

CREATE TABLE IF NOT EXISTS payment_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    payment_transaction_id UUID NOT NULL REFERENCES transactions(id),
    obligation_id UUID NOT NULL REFERENCES financial_obligations(id),

    entity_type TEXT NOT NULL
        CHECK (entity_type IN ('doctor', 'external_lab', 'designer')),
    entity_id UUID NOT NULL,

    direction TEXT NOT NULL
        CHECK (direction IN ('receivable', 'payable')),

    allocated_amount NUMERIC(12, 2) NOT NULL
        CHECK (allocated_amount > 0),

    allocation_method TEXT NOT NULL
        CHECK (allocation_method IN (
            'fifo',
            'manual',
            'credit_auto_apply',
            'correction_transfer'
        )),

    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'reversed', 'void')),

    allocated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    allocated_by UUID REFERENCES users(id),

    reversed_by UUID REFERENCES users(id),
    reversed_at TIMESTAMP WITH TIME ZONE,
    reversal_reason TEXT,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_transaction
    ON payment_allocations(payment_transaction_id);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_obligation
    ON payment_allocations(obligation_id);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_entity
    ON payment_allocations(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_status_allocated_at
    ON payment_allocations(status, allocated_at);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_method
    ON payment_allocations(allocation_method);

CREATE OR REPLACE FUNCTION prevent_active_allocation_to_void_obligation()
RETURNS TRIGGER AS $$
DECLARE
    obligation_status TEXT;
BEGIN
    IF NEW.status = 'active' THEN
        SELECT status
        INTO obligation_status
        FROM financial_obligations
        WHERE id = NEW.obligation_id;

        IF obligation_status = 'void' THEN
            RAISE EXCEPTION 'Cannot create active allocation for a void financial obligation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_active_allocation_to_void_obligation
ON payment_allocations;

CREATE TRIGGER trigger_prevent_active_allocation_to_void_obligation
BEFORE INSERT OR UPDATE ON payment_allocations
FOR EACH ROW
EXECUTE FUNCTION prevent_active_allocation_to_void_obligation();

CREATE TABLE IF NOT EXISTS account_credits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    entity_type TEXT NOT NULL
        CHECK (entity_type IN ('doctor', 'external_lab', 'designer')),
    entity_id UUID NOT NULL,

    amount NUMERIC(12, 2) NOT NULL
        CHECK (amount > 0),
    remaining_amount NUMERIC(12, 2) NOT NULL
        CHECK (remaining_amount >= 0),

    source TEXT NOT NULL
        CHECK (source IN (
            'overpayment',
            'correction_excess',
            'manual_credit',
            'refund_cancelled',
            'supplier_credit',
            'supplier_review'
        )),

    source_transaction_id UUID REFERENCES transactions(id),
    source_allocation_id UUID REFERENCES payment_allocations(id),
    source_obligation_id UUID REFERENCES financial_obligations(id),

    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'used', 'refunded', 'void', 'review')),

    created_by UUID REFERENCES users(id),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),

    CONSTRAINT account_credits_remaining_valid CHECK (remaining_amount <= amount)
);

CREATE INDEX IF NOT EXISTS idx_account_credits_entity
    ON account_credits(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_account_credits_status
    ON account_credits(status);

CREATE INDEX IF NOT EXISTS idx_account_credits_source_transaction
    ON account_credits(source_transaction_id);

CREATE INDEX IF NOT EXISTS idx_account_credits_source_obligation
    ON account_credits(source_obligation_id);

CREATE TABLE IF NOT EXISTS allocation_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    event_type TEXT NOT NULL
        CHECK (event_type IN (
            'allocation_created',
            'allocation_reversed',
            'allocation_transferred',
            'credit_created',
            'credit_applied',
            'manual_override_applied',
            'supplier_payment_review_required'
        )),

    allocation_id UUID REFERENCES payment_allocations(id),
    transaction_id UUID REFERENCES transactions(id),
    obligation_id UUID REFERENCES financial_obligations(id),
    credit_id UUID REFERENCES account_credits(id),

    entity_type TEXT
        CHECK (entity_type IS NULL OR entity_type IN ('doctor', 'external_lab', 'designer')),
    entity_id UUID,

    amount NUMERIC(12, 2),
    old_value TEXT,
    new_value TEXT,
    reason TEXT,
    changed_by UUID REFERENCES users(id),

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_allocation_events_type
    ON allocation_events(event_type);

CREATE INDEX IF NOT EXISTS idx_allocation_events_allocation
    ON allocation_events(allocation_id);

CREATE INDEX IF NOT EXISTS idx_allocation_events_transaction
    ON allocation_events(transaction_id);

CREATE INDEX IF NOT EXISTS idx_allocation_events_obligation
    ON allocation_events(obligation_id);

CREATE INDEX IF NOT EXISTS idx_allocation_events_credit
    ON allocation_events(credit_id);

CREATE INDEX IF NOT EXISTS idx_allocation_events_entity
    ON allocation_events(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_allocation_events_created_at
    ON allocation_events(created_at);

CREATE TABLE IF NOT EXISTS financial_exception_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    review_type TEXT NOT NULL
        CHECK (review_type IN (
            'supplier_corrected_after_payment',
            'supplier_cost_decreased_after_payment',
            'supplier_overpayment',
            'voided_obligation_has_payment',
            'overallocated_obligation'
        )),

    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed')),

    order_id UUID REFERENCES orders(id),
    obligation_id UUID REFERENCES financial_obligations(id),
    transaction_id UUID REFERENCES transactions(id),

    entity_type TEXT
        CHECK (entity_type IS NULL OR entity_type IN ('doctor', 'external_lab', 'designer')),
    entity_id UUID,

    amount NUMERIC(12, 2),
    reason TEXT,

    assigned_to UUID REFERENCES users(id),
    resolved_by UUID REFERENCES users(id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_financial_exception_reviews_type
    ON financial_exception_reviews(review_type);

CREATE INDEX IF NOT EXISTS idx_financial_exception_reviews_status
    ON financial_exception_reviews(status);

CREATE INDEX IF NOT EXISTS idx_financial_exception_reviews_order
    ON financial_exception_reviews(order_id);

CREATE INDEX IF NOT EXISTS idx_financial_exception_reviews_obligation
    ON financial_exception_reviews(obligation_id);

CREATE INDEX IF NOT EXISTS idx_financial_exception_reviews_transaction
    ON financial_exception_reviews(transaction_id);

CREATE INDEX IF NOT EXISTS idx_financial_exception_reviews_entity
    ON financial_exception_reviews(entity_type, entity_id);

CREATE OR REPLACE FUNCTION set_account_credits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_account_credits_updated_at
ON account_credits;

CREATE TRIGGER trigger_account_credits_updated_at
BEFORE UPDATE ON account_credits
FOR EACH ROW
EXECUTE FUNCTION set_account_credits_updated_at();

CREATE OR REPLACE FUNCTION set_financial_exception_reviews_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_financial_exception_reviews_updated_at
ON financial_exception_reviews;

CREATE TRIGGER trigger_financial_exception_reviews_updated_at
BEFORE UPDATE ON financial_exception_reviews
FOR EACH ROW
EXECUTE FUNCTION set_financial_exception_reviews_updated_at();

ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_exception_reviews ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON payment_allocations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON account_credits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON allocation_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON financial_exception_reviews TO authenticated;

DROP POLICY IF EXISTS "Admins manage payment allocations" ON payment_allocations;
CREATE POLICY "Admins manage payment allocations"
ON payment_allocations
FOR ALL
TO authenticated
USING (get_my_role() = 'admin')
WITH CHECK (get_my_role() = 'admin');

DROP POLICY IF EXISTS "Accountants view payment allocations" ON payment_allocations;
CREATE POLICY "Accountants view payment allocations"
ON payment_allocations
FOR SELECT
TO authenticated
USING (get_my_role() = 'accountant');

DROP POLICY IF EXISTS "Admins manage account credits" ON account_credits;
CREATE POLICY "Admins manage account credits"
ON account_credits
FOR ALL
TO authenticated
USING (get_my_role() = 'admin')
WITH CHECK (get_my_role() = 'admin');

DROP POLICY IF EXISTS "Accountants view account credits" ON account_credits;
CREATE POLICY "Accountants view account credits"
ON account_credits
FOR SELECT
TO authenticated
USING (get_my_role() = 'accountant');

DROP POLICY IF EXISTS "Admins manage allocation events" ON allocation_events;
CREATE POLICY "Admins manage allocation events"
ON allocation_events
FOR ALL
TO authenticated
USING (get_my_role() = 'admin')
WITH CHECK (get_my_role() = 'admin');

DROP POLICY IF EXISTS "Accountants view allocation events" ON allocation_events;
CREATE POLICY "Accountants view allocation events"
ON allocation_events
FOR SELECT
TO authenticated
USING (get_my_role() = 'accountant');

DROP POLICY IF EXISTS "Admins manage financial exception reviews" ON financial_exception_reviews;
CREATE POLICY "Admins manage financial exception reviews"
ON financial_exception_reviews
FOR ALL
TO authenticated
USING (get_my_role() = 'admin')
WITH CHECK (get_my_role() = 'admin');

DROP POLICY IF EXISTS "Accountants view financial exception reviews" ON financial_exception_reviews;
CREATE POLICY "Accountants view financial exception reviews"
ON financial_exception_reviews
FOR SELECT
TO authenticated
USING (get_my_role() = 'accountant');

COMMENT ON TABLE payment_allocations IS
    'Empty Phase 3C-1 foundation for future links between transactions and financial obligations. No historical allocations are inserted by this migration.';

COMMENT ON TABLE account_credits IS
    'Empty Phase 3C-1 foundation for future credits/prepayments. No historical credits are inserted by this migration.';

COMMENT ON TABLE allocation_events IS
    'Empty Phase 3C-1 finance-level audit trail foundation. No allocation events are inserted by this migration.';

COMMENT ON TABLE financial_exception_reviews IS
    'Empty Phase 3C-1 foundation for future financial exception reviews. No historical reviews are inserted by this migration.';
