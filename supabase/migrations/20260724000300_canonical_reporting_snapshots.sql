-- Canonical reporting snapshots and monthly financial review.
-- This migration does not backfill, update orders, or replace existing reports.

CREATE TABLE IF NOT EXISTS public.financial_report_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'approved', 'corrective')),
    formula_version TEXT NOT NULL DEFAULT 'canonical-v1',
    report_payload JSONB NOT NULL,
    issue_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    critical_issue_count INTEGER NOT NULL DEFAULT 0
        CHECK (critical_issue_count >= 0),
    warning_count INTEGER NOT NULL DEFAULT 0
        CHECK (warning_count >= 0),
    payload_checksum TEXT NOT NULL,
    parent_snapshot_id UUID REFERENCES public.financial_report_snapshots(id),
    approval_reason TEXT,
    created_by UUID NOT NULL REFERENCES public.users(id),
    approved_by UUID REFERENCES public.users(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT financial_report_snapshot_period_valid
        CHECK (period_start <= period_end),
    CONSTRAINT financial_report_snapshot_approval_valid CHECK (
        (status = 'draft' AND approved_by IS NULL AND approved_at IS NULL)
        OR
        (status IN ('approved', 'corrective') AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    ),
    CONSTRAINT financial_report_snapshot_parent_valid CHECK (
        (status <> 'corrective' AND parent_snapshot_id IS NULL)
        OR
        (status = 'corrective' AND parent_snapshot_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_financial_report_snapshots_period
ON public.financial_report_snapshots(period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_financial_report_snapshots_status
ON public.financial_report_snapshots(status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_report_approved_period
ON public.financial_report_snapshots(period_start, period_end)
WHERE status = 'approved';

CREATE TABLE IF NOT EXISTS public.financial_report_snapshot_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL
        REFERENCES public.financial_report_snapshots(id) ON DELETE CASCADE,
    note TEXT NOT NULL CHECK (length(btrim(note)) > 0),
    created_by UUID NOT NULL REFERENCES public.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_financial_report_snapshot_notes_snapshot
ON public.financial_report_snapshot_notes(snapshot_id, created_at);

CREATE OR REPLACE FUNCTION public.guard_approved_financial_report_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.status IN ('approved', 'corrective') THEN
        RAISE EXCEPTION 'Approved financial snapshots are immutable and cannot be deleted';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status IN ('approved', 'corrective') THEN
        RAISE EXCEPTION 'Approved financial snapshots are immutable';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        NEW.updated_at := timezone('utc'::text, now());
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_guard_approved_financial_report_snapshot
ON public.financial_report_snapshots;

CREATE TRIGGER trigger_guard_approved_financial_report_snapshot
BEFORE UPDATE OR DELETE ON public.financial_report_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.guard_approved_financial_report_snapshot();

ALTER TABLE public.financial_report_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_report_snapshot_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance reviewers view snapshots"
ON public.financial_report_snapshots;
CREATE POLICY "Finance reviewers view snapshots"
ON public.financial_report_snapshots
FOR SELECT TO authenticated
USING (public.get_my_role() IN ('admin', 'accountant'));

DROP POLICY IF EXISTS "Finance reviewers view snapshot notes"
ON public.financial_report_snapshot_notes;
CREATE POLICY "Finance reviewers view snapshot notes"
ON public.financial_report_snapshot_notes
FOR SELECT TO authenticated
USING (public.get_my_role() IN ('admin', 'accountant'));

REVOKE INSERT, UPDATE, DELETE ON public.financial_report_snapshots
FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.financial_report_snapshot_notes
FROM authenticated;
GRANT SELECT ON public.financial_report_snapshots TO authenticated;
GRANT SELECT ON public.financial_report_snapshot_notes TO authenticated;

CREATE OR REPLACE FUNCTION public.create_financial_report_snapshot(
    p_period_start DATE,
    p_period_end DATE,
    p_label TEXT,
    p_report_payload JSONB,
    p_issue_summary JSONB,
    p_critical_issue_count INTEGER,
    p_warning_count INTEGER
)
RETURNS public.financial_report_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id UUID;
    v_snapshot public.financial_report_snapshots%ROWTYPE;
    v_critical_issue_count INTEGER;
    v_warning_count INTEGER;
BEGIN
    IF public.get_my_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only admin can create a financial snapshot';
    END IF;

    IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_start > p_period_end THEN
        RAISE EXCEPTION 'Invalid snapshot period';
    END IF;

    IF NULLIF(btrim(p_label), '') IS NULL THEN
        RAISE EXCEPTION 'Snapshot label is required';
    END IF;

    IF p_report_payload IS NULL OR jsonb_typeof(p_report_payload) <> 'object' THEN
        RAISE EXCEPTION 'Snapshot report payload must be a JSON object';
    END IF;

    IF p_report_payload->>'formulaVersion' <> 'canonical-v1'
       OR jsonb_typeof(p_report_payload->'closing') <> 'object'
       OR jsonb_typeof(p_report_payload->'periodActivity') <> 'object' THEN
        RAISE EXCEPTION 'Invalid canonical-v1 report payload structure';
    END IF;

    IF jsonb_typeof(p_issue_summary->'critical') <> 'array'
       OR jsonb_typeof(p_issue_summary->'warnings') <> 'array' THEN
        RAISE EXCEPTION 'Invalid snapshot issue summary structure';
    END IF;

    v_critical_issue_count := COALESCE(jsonb_array_length(p_issue_summary->'critical'), 0);
    v_warning_count := COALESCE(jsonb_array_length(p_issue_summary->'warnings'), 0);

    IF COALESCE(p_critical_issue_count, 0) < 0 OR COALESCE(p_warning_count, 0) < 0 THEN
        RAISE EXCEPTION 'Snapshot issue counts cannot be negative';
    END IF;

    IF COALESCE(p_critical_issue_count, 0) <> v_critical_issue_count
       OR COALESCE(p_warning_count, 0) <> v_warning_count THEN
        RAISE EXCEPTION 'Snapshot issue counts do not match the issue details';
    END IF;

    SELECT id INTO v_user_id
    FROM public.users
    WHERE auth_id = auth.uid()
    LIMIT 1;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authenticated profile not found';
    END IF;

    INSERT INTO public.financial_report_snapshots (
        period_start,
        period_end,
        label,
        status,
        formula_version,
        report_payload,
        issue_summary,
        critical_issue_count,
        warning_count,
        payload_checksum,
        created_by
    )
    VALUES (
        p_period_start,
        p_period_end,
        btrim(p_label),
        'draft',
        'canonical-v1',
        p_report_payload,
        COALESCE(p_issue_summary, '{}'::jsonb),
        COALESCE(p_critical_issue_count, 0),
        COALESCE(p_warning_count, 0),
        md5(p_report_payload::TEXT),
        v_user_id
    )
    RETURNING * INTO v_snapshot;

    RETURN v_snapshot;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_financial_report_snapshot(
    p_snapshot_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS public.financial_report_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id UUID;
    v_snapshot public.financial_report_snapshots%ROWTYPE;
BEGIN
    IF public.get_my_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only admin can approve a financial snapshot';
    END IF;

    SELECT * INTO v_snapshot
    FROM public.financial_report_snapshots
    WHERE id = p_snapshot_id
      AND status = 'draft'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Draft snapshot not found';
    END IF;

    IF v_snapshot.critical_issue_count > 0 THEN
        RAISE EXCEPTION
            'Snapshot has % critical reconciliation issues and cannot be approved',
            v_snapshot.critical_issue_count;
    END IF;

    IF v_snapshot.warning_count > 0 AND NULLIF(btrim(p_reason), '') IS NULL THEN
        RAISE EXCEPTION 'Approval reason is required when warnings remain';
    END IF;

    SELECT id INTO v_user_id
    FROM public.users
    WHERE auth_id = auth.uid()
    LIMIT 1;

    UPDATE public.financial_report_snapshots
    SET status = 'approved',
        approval_reason = NULLIF(btrim(p_reason), ''),
        approved_by = v_user_id,
        approved_at = timezone('utc'::text, now())
    WHERE id = p_snapshot_id
    RETURNING * INTO v_snapshot;

    RETURN v_snapshot;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_corrective_financial_report_snapshot(
    p_parent_snapshot_id UUID,
    p_label TEXT,
    p_report_payload JSONB,
    p_issue_summary JSONB,
    p_reason TEXT
)
RETURNS public.financial_report_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id UUID;
    v_parent public.financial_report_snapshots%ROWTYPE;
    v_snapshot public.financial_report_snapshots%ROWTYPE;
    v_critical_issue_count INTEGER;
    v_warning_count INTEGER;
BEGIN
    IF public.get_my_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only admin can create a corrective snapshot';
    END IF;

    IF NULLIF(btrim(p_reason), '') IS NULL THEN
        RAISE EXCEPTION 'Correction reason is required';
    END IF;

    IF p_report_payload IS NULL
       OR p_report_payload->>'formulaVersion' <> 'canonical-v1'
       OR jsonb_typeof(p_report_payload->'closing') <> 'object'
       OR jsonb_typeof(p_report_payload->'periodActivity') <> 'object' THEN
        RAISE EXCEPTION 'Invalid canonical-v1 report payload structure';
    END IF;

    IF jsonb_typeof(p_issue_summary->'critical') <> 'array'
       OR jsonb_typeof(p_issue_summary->'warnings') <> 'array' THEN
        RAISE EXCEPTION 'Invalid snapshot issue summary structure';
    END IF;

    v_critical_issue_count := COALESCE(jsonb_array_length(p_issue_summary->'critical'), 0);
    v_warning_count := COALESCE(jsonb_array_length(p_issue_summary->'warnings'), 0);

    IF v_critical_issue_count > 0 THEN
        RAISE EXCEPTION 'Corrective snapshot has critical reconciliation issues';
    END IF;

    SELECT * INTO v_parent
    FROM public.financial_report_snapshots
    WHERE id = p_parent_snapshot_id
      AND status IN ('approved', 'corrective');

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Approved parent snapshot not found';
    END IF;

    SELECT id INTO v_user_id
    FROM public.users
    WHERE auth_id = auth.uid()
    LIMIT 1;

    INSERT INTO public.financial_report_snapshots (
        period_start,
        period_end,
        label,
        status,
        formula_version,
        report_payload,
        issue_summary,
        critical_issue_count,
        warning_count,
        payload_checksum,
        parent_snapshot_id,
        approval_reason,
        created_by,
        approved_by,
        approved_at
    )
    VALUES (
        v_parent.period_start,
        v_parent.period_end,
        btrim(p_label),
        'corrective',
        'canonical-v1',
        p_report_payload,
        COALESCE(p_issue_summary, '{}'::jsonb),
        v_critical_issue_count,
        v_warning_count,
        md5(p_report_payload::TEXT),
        v_parent.id,
        btrim(p_reason),
        v_user_id,
        v_user_id,
        timezone('utc'::text, now())
    )
    RETURNING * INTO v_snapshot;

    RETURN v_snapshot;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_financial_snapshot_note(
    p_snapshot_id UUID,
    p_note TEXT
)
RETURNS public.financial_report_snapshot_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id UUID;
    v_note public.financial_report_snapshot_notes%ROWTYPE;
BEGIN
    IF public.get_my_role() NOT IN ('admin', 'accountant') THEN
        RAISE EXCEPTION 'Only finance reviewers can add snapshot notes';
    END IF;

    IF NULLIF(btrim(p_note), '') IS NULL THEN
        RAISE EXCEPTION 'Snapshot note is required';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.financial_report_snapshots WHERE id = p_snapshot_id
    ) THEN
        RAISE EXCEPTION 'Snapshot not found';
    END IF;

    SELECT id INTO v_user_id
    FROM public.users
    WHERE auth_id = auth.uid()
    LIMIT 1;

    INSERT INTO public.financial_report_snapshot_notes (
        snapshot_id,
        note,
        created_by
    )
    VALUES (p_snapshot_id, btrim(p_note), v_user_id)
    RETURNING * INTO v_note;

    RETURN v_note;
END;
$$;

REVOKE ALL ON FUNCTION public.create_financial_report_snapshot(
    DATE, DATE, TEXT, JSONB, JSONB, INTEGER, INTEGER
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_financial_report_snapshot(UUID, TEXT)
FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_corrective_financial_report_snapshot(
    UUID, TEXT, JSONB, JSONB, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_financial_snapshot_note(UUID, TEXT)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_financial_report_snapshot(
    DATE, DATE, TEXT, JSONB, JSONB, INTEGER, INTEGER
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_financial_report_snapshot(UUID, TEXT)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_corrective_financial_report_snapshot(
    UUID, TEXT, JSONB, JSONB, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_financial_snapshot_note(UUID, TEXT)
TO authenticated;

COMMENT ON TABLE public.financial_report_snapshots IS
    'Immutable approved monthly financial snapshots. Drafts are captured from canonical-v1 comparison reports.';
