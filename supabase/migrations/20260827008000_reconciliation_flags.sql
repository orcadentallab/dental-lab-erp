-- Migration: 20260827008000_reconciliation_flags.sql
-- Description: Table for tracking financial reconciliation flags and orphaned obligation issues

BEGIN;

CREATE TABLE IF NOT EXISTS public.reconciliation_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_type TEXT NOT NULL,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    obligation_id UUID REFERENCES public.financial_obligations(id) ON DELETE SET NULL,
    -- Mirrors BILLING_ENTITY_TYPES in src/constants/billingSettings.ts. A supplier
    -- is 'external_lab' here, as everywhere else in the financial schema.
    entity_type TEXT CHECK (entity_type IS NULL OR entity_type IN ('doctor', 'external_lab', 'designer')),
    entity_id UUID,
    severity TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('warning', 'error')),
    message TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    resolution_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_flags_open
    ON public.reconciliation_flags(created_at DESC)
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_reconciliation_flags_order_id
    ON public.reconciliation_flags(order_id);

CREATE INDEX IF NOT EXISTS idx_reconciliation_flags_entity
    ON public.reconciliation_flags(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_reconciliation_flags_status
    ON public.reconciliation_flags(status);

COMMENT ON TABLE public.reconciliation_flags IS
    'Captures financial reconciliation exceptions, orphaned obligations, and sync errors for accountant review.';

ALTER TABLE public.reconciliation_flags ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reconciliation_flags TO authenticated;

-- Only the roles that can actually trigger the flagged operations may write here.
-- Order deletion — the sole writer today — is admin-only in the UI, and this
-- table is an audit queue an accountant is expected to trust: leaving INSERT open
-- to every authenticated role would let a doctor-portal account fabricate rows.
-- flagReconciliationIssue() swallows insert errors and still logs to the console,
-- so a rejected insert degrades to the old behaviour rather than breaking a flow.
DROP POLICY IF EXISTS "Authenticated users can insert reconciliation flags" ON public.reconciliation_flags;
DROP POLICY IF EXISTS "Accountants and admins insert reconciliation flags" ON public.reconciliation_flags;
CREATE POLICY "Accountants and admins insert reconciliation flags"
    ON public.reconciliation_flags
    FOR INSERT
    TO authenticated
    WITH CHECK (public.get_my_role() IN ('admin', 'accountant'));

-- Accountants and admins can view reconciliation flags. External labs ('lab')
-- are deliberately excluded: these rows expose doctor receivable details.
DROP POLICY IF EXISTS "Accountants and admins view reconciliation flags" ON public.reconciliation_flags;
CREATE POLICY "Accountants and admins view reconciliation flags"
    ON public.reconciliation_flags
    FOR SELECT
    TO authenticated
    USING (public.get_my_role() IN ('admin', 'accountant'));

-- Accountants and admins can resolve/update flags
DROP POLICY IF EXISTS "Accountants and admins update reconciliation flags" ON public.reconciliation_flags;
CREATE POLICY "Accountants and admins update reconciliation flags"
    ON public.reconciliation_flags
    FOR UPDATE
    TO authenticated
    USING (public.get_my_role() IN ('admin', 'accountant'))
    WITH CHECK (public.get_my_role() IN ('admin', 'accountant'));

-- Admins can delete flags if needed
DROP POLICY IF EXISTS "Admins delete reconciliation flags" ON public.reconciliation_flags;
CREATE POLICY "Admins delete reconciliation flags"
    ON public.reconciliation_flags
    FOR DELETE
    TO authenticated
    USING (public.get_my_role() = 'admin');

COMMIT;
