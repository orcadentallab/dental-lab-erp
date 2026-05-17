-- Migration 081: Generic Entity Billing Settings
-- Purpose:
--   Store due-date settings for receivable/payable entities.
--   This does not create financial obligations, allocations, credits, or reports.

CREATE TABLE IF NOT EXISTS entity_billing_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    entity_type TEXT NOT NULL
        CHECK (entity_type IN ('doctor', 'external_lab', 'designer')),
    entity_id UUID NOT NULL,

    billing_mode TEXT NOT NULL DEFAULT 'per_order'
        CHECK (billing_mode IN ('per_order', 'monthly_cycle')),
    billing_day INTEGER
        CHECK (billing_day IS NULL OR (billing_day >= 1 AND billing_day <= 31)),
    per_order_due_days INTEGER NOT NULL DEFAULT 7
        CHECK (per_order_due_days >= 0 AND per_order_due_days <= 365),

    payment_terms_notes TEXT,
    auto_apply_credit BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),

    CONSTRAINT entity_billing_settings_entity_unique UNIQUE (entity_type, entity_id),
    CONSTRAINT entity_billing_settings_monthly_day_required CHECK (
        billing_mode <> 'monthly_cycle'
        OR billing_day IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_entity_billing_settings_entity
    ON entity_billing_settings(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_entity_billing_settings_mode
    ON entity_billing_settings(billing_mode);

CREATE OR REPLACE FUNCTION set_entity_billing_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_entity_billing_settings_updated_at
ON entity_billing_settings;

CREATE TRIGGER trigger_entity_billing_settings_updated_at
BEFORE UPDATE ON entity_billing_settings
FOR EACH ROW
EXECUTE FUNCTION set_entity_billing_settings_updated_at();

ALTER TABLE entity_billing_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON entity_billing_settings TO authenticated;

DROP POLICY IF EXISTS "Admins manage entity billing settings" ON entity_billing_settings;
CREATE POLICY "Admins manage entity billing settings"
ON entity_billing_settings
FOR ALL
TO authenticated
USING (get_my_role() = 'admin')
WITH CHECK (get_my_role() = 'admin');

DROP POLICY IF EXISTS "Accountants view entity billing settings" ON entity_billing_settings;
CREATE POLICY "Accountants view entity billing settings"
ON entity_billing_settings
FOR SELECT
TO authenticated
USING (get_my_role() = 'accountant');

DROP POLICY IF EXISTS "Representatives view doctor billing settings" ON entity_billing_settings;
CREATE POLICY "Representatives view doctor billing settings"
ON entity_billing_settings
FOR SELECT
TO authenticated
USING (
    get_my_role() = 'representative'
    AND entity_type = 'doctor'
);

COMMENT ON TABLE entity_billing_settings IS
    'Generic billing settings for doctors, external labs, and designers. Does not store obligations, allocations, credits, or balances.';
