-- Migration 080: Structured Order Business Events
-- Purpose:
--   Add an append-only business timeline table for important order events.
--   This does not replace order_history, which remains the raw field-change audit.

CREATE TABLE IF NOT EXISTS order_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

    event_type TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,

    changed_by UUID REFERENCES users(id),
    actor_role TEXT,
    changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),

    reason TEXT,
    notes TEXT,
    severity TEXT NOT NULL DEFAULT 'info'
        CHECK (severity IN ('info', 'warning', 'critical')),
    responsibility_party TEXT,

    approval_status TEXT NOT NULL DEFAULT 'none'
        CHECK (approval_status IN ('none', 'pending', 'approved', 'rejected')),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,

    financial_impact NUMERIC(12, 2),

    related_transaction_id UUID REFERENCES transactions(id),
    related_adjustment_id UUID,
    related_allocation_id UUID,
    related_issue_id UUID,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_order_events_order_id_changed_at
    ON order_events(order_id, changed_at ASC);

CREATE INDEX IF NOT EXISTS idx_order_events_event_type
    ON order_events(event_type);

CREATE INDEX IF NOT EXISTS idx_order_events_changed_by
    ON order_events(changed_by);

CREATE INDEX IF NOT EXISTS idx_order_events_approval_status
    ON order_events(approval_status);

CREATE INDEX IF NOT EXISTS idx_order_events_related_transaction_id
    ON order_events(related_transaction_id);

ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON order_events TO authenticated;

DROP POLICY IF EXISTS "Internal staff can view order events" ON order_events;
CREATE POLICY "Internal staff can view order events"
ON order_events
FOR SELECT
TO authenticated
USING (
    get_my_role() IN ('admin', 'accountant', 'representative')
);

DROP POLICY IF EXISTS "Internal staff can insert order events" ON order_events;
CREATE POLICY "Internal staff can insert order events"
ON order_events
FOR INSERT
TO authenticated
WITH CHECK (
    get_my_role() = 'admin'
    OR (
        get_my_role() IN ('accountant', 'representative')
        AND event_type NOT IN (
            'financial_adjustment_approved',
            'payment_allocated',
            'manual_allocation_override',
            'order_reopened'
        )
    )
);

COMMENT ON TABLE order_events IS
    'Structured business timeline for orders. order_history remains the raw technical audit.';
