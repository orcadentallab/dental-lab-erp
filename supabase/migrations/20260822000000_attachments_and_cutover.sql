-- Phase 2: case attachments on Storage, entering production, and the cutover
-- mechanism. See docs/INTERNAL_LAB_PLAN_AR.md.
--
-- THREE THINGS, AND ONE OF THEM IS DELIBERATELY INERT
--   1. Real file storage. Until now every image and design was a pasted link;
--      a technician had to leave the screen to see what a case needed. Now the
--      instructions carry photos, and QC can attach evidence.
--   2. A way INTO the new pipeline. materialize_job_from_route existed but
--      nothing called it, so the shadow report had nothing to compare and the
--      cutover could never be evaluated.
--   3. The cutover itself -- guarded by the production_v1 flag, which stays
--      OFF. The code ships; the decision does not.
--
-- WHY THE BUCKET IS PRIVATE
--   These are photographs of patients' work. A public bucket means anyone who
--   ever sees a URL keeps access forever, with no way to revoke it. Reads go
--   through short-lived signed URLs instead.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Storage
-- ─────────────────────────────────────────────────────────────────────────
-- 10 MB and an image/PDF allowlist enforced by the bucket, not by the UI: a
-- limit that only exists in the browser is not a limit.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'case-files', 'case-files', FALSE, 10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
    SET public             = FALSE,
        file_size_limit    = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Any signed-in staff member may read; anyone who can work production (or a
-- rep registering a case) may upload. Deleting is admin-only: an attachment is
-- evidence, and evidence people can quietly remove is not evidence.
DROP POLICY IF EXISTS case_files_read ON storage.objects;
CREATE POLICY case_files_read ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'case-files' AND public.get_my_role() IS NOT NULL);

DROP POLICY IF EXISTS case_files_write ON storage.objects;
CREATE POLICY case_files_write ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'case-files'
        AND public.get_my_role() IN ('admin', 'lab', 'technician', 'designer', 'representative')
    );

DROP POLICY IF EXISTS case_files_delete ON storage.objects;
CREATE POLICY case_files_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'case-files' AND public.get_my_role() = 'admin');

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Attachments
-- ─────────────────────────────────────────────────────────────────────────
-- The pasted-link columns (orders.images_url, stl_url, design_url) are left
-- exactly as they are. Old cases keep working; nothing is migrated.

CREATE TABLE IF NOT EXISTS public.order_attachments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id     UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    -- Set when the file belongs to one step (QC evidence, a packaging photo)
    -- rather than to the case as a whole.
    stage_run_id UUID REFERENCES public.production_stage_runs(id) ON DELETE SET NULL,
    storage_path TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'instruction'
                 CHECK (kind IN ('instruction', 'design', 'qc', 'packaging', 'issue')),
    caption      TEXT,
    mime_type    TEXT,
    size_bytes   INTEGER,
    uploaded_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_order_attachments_path UNIQUE (storage_path)
);

CREATE INDEX IF NOT EXISTS idx_order_attachments_order
    ON public.order_attachments (order_id, kind);
CREATE INDEX IF NOT EXISTS idx_order_attachments_run
    ON public.order_attachments (stage_run_id) WHERE stage_run_id IS NOT NULL;

ALTER TABLE public.order_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_order_attachments ON public.order_attachments;
CREATE POLICY read_order_attachments ON public.order_attachments
    FOR SELECT TO authenticated USING (public.get_my_role() IS NOT NULL);

DROP POLICY IF EXISTS write_order_attachments ON public.order_attachments;
CREATE POLICY write_order_attachments ON public.order_attachments
    FOR INSERT TO authenticated
    WITH CHECK (public.get_my_role() IN ('admin', 'lab', 'technician', 'designer', 'representative'));

DROP POLICY IF EXISTS admin_manage_order_attachments ON public.order_attachments;
CREATE POLICY admin_manage_order_attachments ON public.order_attachments
    FOR ALL TO authenticated
    USING (public.get_my_role() = 'admin')
    WITH CHECK (public.get_my_role() = 'admin');

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Entering production — one job per (order x route)
-- ─────────────────────────────────────────────────────────────────────────
-- materialize_job_from_route builds ONE job. An order with three zirconia
-- crowns and two temporary PMMA units is two different chains with two
-- different durations, and averaging them would make every cycle-time figure
-- meaningless. So the order is split by route first.

CREATE OR REPLACE FUNCTION public.start_production_for_order(
    p_order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_fallback UUID;
    v_jobs     UUID[] := ARRAY[]::UUID[];
    v_job      UUID;
    v_units    INTEGER;
    r          RECORD;
BEGIN
    IF public.get_my_role() NOT IN ('admin', 'lab') THEN
        RAISE EXCEPTION 'forbidden: admin or lab role required' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id) THEN
        RAISE EXCEPTION 'order % not found', p_order_id USING ERRCODE = '22023';
    END IF;

    -- Idempotent: a second press returns what already exists rather than
    -- building the case twice.
    SELECT array_agg(id) INTO v_jobs
      FROM public.production_jobs
     WHERE order_id = p_order_id AND NOT is_backfilled;

    IF COALESCE(array_length(v_jobs, 1), 0) > 0 THEN
        RETURN jsonb_build_object('orderId', p_order_id, 'jobIds', v_jobs,
                                  'alreadyStarted', TRUE);
    END IF;

    v_jobs := ARRAY[]::UUID[];

    SELECT id INTO v_fallback FROM public.production_routes
     WHERE is_fallback AND is_active LIMIT 1;

    -- Group the order's lines by the route their service points at. Lines with
    -- no mapped service fall to the fallback, which is today's fully outsourced
    -- behaviour -- so a half-mapped order still produces a complete case.
    FOR r IN
        SELECT COALESCE(sv.route_id, v_fallback) AS route_id,
               SUM(COALESCE(oi.count, 1))::int   AS units,
               array_agg(oi.id)                  AS item_ids
          FROM public.order_items oi
          LEFT JOIN public.services sv ON sv.name = oi.product_type
         WHERE oi.order_id = p_order_id
         GROUP BY COALESCE(sv.route_id, v_fallback)
    LOOP
        IF r.route_id IS NULL THEN
            RAISE EXCEPTION 'no route for part of order % and no fallback route exists', p_order_id
                USING ERRCODE = '22023';
        END IF;

        v_units := GREATEST(r.units, 1);
        v_job := public.materialize_job_from_route(
            p_order_id, r.route_id, v_units,
            1 + COALESCE(array_length(v_jobs, 1), 0));

        -- materialize_job_from_route attaches every line on the order; keep
        -- only the ones that belong to this route's group.
        DELETE FROM public.production_job_items
         WHERE job_id = v_job AND NOT (order_item_id = ANY (r.item_ids));

        v_jobs := v_jobs || v_job;
    END LOOP;

    -- An order with no lines at all still needs a chain, or it can never be
    -- worked on and would silently disappear from the floor.
    IF COALESCE(array_length(v_jobs, 1), 0) = 0 THEN
        v_job := public.materialize_job_from_route(p_order_id, NULL, NULL, 1);
        v_jobs := ARRAY[v_job];
    END IF;

    RETURN jsonb_build_object('orderId', p_order_id, 'jobIds', v_jobs,
                              'jobCount', array_length(v_jobs, 1));
END;
$$;

COMMENT ON FUNCTION public.start_production_for_order(UUID) IS
'Splits an order into one production job per route and builds each chain. Idempotent. Deliberately manual: a case enters the new pipeline by decision, not by side effect.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. The cutover, behind the flag
-- ─────────────────────────────────────────────────────────────────────────
-- orders.production_status is the contract with finance: receivables,
-- payables, invoices and aging all key off it. This writes it -- but only when
-- production_v1 is on, which it is not. Turning the flag off restores today's
-- behaviour instantly, with no migration and no data to undo.

CREATE OR REPLACE FUNCTION public.apply_production_status_from_stages(
    p_order_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_computed TEXT;
BEGIN
    IF NOT public.workflow_flag_enabled('production_v1') THEN
        RETURN NULL;   -- shadow mode: compute elsewhere, write nothing here
    END IF;

    v_computed := public.compute_production_status_from_stages(p_order_id);

    -- NULL means the new pipeline has never seen this order. Writing anything
    -- would be inventing a status for a case it knows nothing about.
    IF v_computed IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE public.orders
       SET production_status = v_computed
     WHERE id = p_order_id
       AND production_status IS DISTINCT FROM v_computed;

    RETURN v_computed;
END;
$$;

COMMENT ON FUNCTION public.apply_production_status_from_stages(UUID) IS
'Writes the coarse production status from the stage chain -- ONLY when production_v1 is enabled. The cutover switch. Off by default.';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Standard cost, and the cutover call, folded into completion
-- ─────────────────────────────────────────────────────────────────────────
-- Rebuilt from 20260821006000 with two additions at the end. Everything else
-- is unchanged.
--
-- COST RULE THAT MUST NOT BE BROKEN: the number written here is ANALYTICAL.
-- It never reaches financial_obligations. Internal work is already an expense
-- through payroll and materials; booking it as a per-order liability as well
-- would double-count it straight into the P&L.

CREATE OR REPLACE FUNCTION public.complete_stage_run(
    p_run_id       UUID,
    p_units_passed INTEGER DEFAULT NULL,
    p_units_failed INTEGER DEFAULT 0,
    p_cause_code   TEXT DEFAULT NULL,
    p_notes        TEXT DEFAULT NULL,
    p_batch_group  UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_run      public.production_stage_runs;
    v_passed   INTEGER;
    v_failed   INTEGER := GREATEST(COALESCE(p_units_failed, 0), 0);
    v_rework   UUID;
    v_goto     UUID;
    v_seq      INTEGER;
    v_order    UUID;
    v_cost     NUMERIC;
    v_source   TEXT;
    v_standard NUMERIC;
BEGIN
    IF NOT public.can_work_production() THEN
        RAISE EXCEPTION 'forbidden: production role required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_run FROM public.production_stage_runs WHERE id = p_run_id FOR UPDATE;
    IF v_run.id IS NULL THEN
        RAISE EXCEPTION 'stage run % not found', p_run_id USING ERRCODE = '22023';
    END IF;

    IF v_run.status IN ('done', 'failed') THEN
        RETURN jsonb_build_object('runId', v_run.id, 'status', v_run.status,
                                  'alreadyCompleted', TRUE);
    END IF;

    IF v_run.status NOT IN ('ready', 'in_progress', 'waiting_external') THEN
        RAISE EXCEPTION 'stage run % is % and cannot be completed', p_run_id, v_run.status
            USING ERRCODE = '22023';
    END IF;

    v_passed := COALESCE(p_units_passed, GREATEST(v_run.units_in - v_failed, 0));

    IF v_passed + v_failed > v_run.units_in THEN
        RAISE EXCEPTION 'passed (%) plus failed (%) exceeds units in (%)',
            v_passed, v_failed, v_run.units_in USING ERRCODE = '22023';
    END IF;

    IF v_failed > 0 AND p_cause_code IS NULL THEN
        RAISE EXCEPTION 'a cause code is required when units fail' USING ERRCODE = '22023';
    END IF;

    -- Cost. External work is what the vendor actually charged; internal work is
    -- the standard rate until real per-unit costing lands in phase 5.
    IF v_run.execution = 'external' THEN
        SELECT agreed_cost INTO v_cost
          FROM public.external_work_orders WHERE stage_run_id = p_run_id;
        v_source := CASE WHEN v_cost IS NULL THEN NULL ELSE 'external_invoice' END;
    ELSE
        SELECT COALESCE(rs.standard_cost_per_unit, s.standard_cost_per_unit)
          INTO v_standard
          FROM public.production_stages s
          LEFT JOIN public.production_jobs j ON j.id = v_run.job_id
          LEFT JOIN public.production_route_stages rs
                 ON rs.route_id = j.route_id AND rs.stage_id = s.id
         WHERE s.id = v_run.stage_id;

        -- No standard set yet: leave the cost NULL rather than writing a zero.
        -- A zero reads as "this stage is free", which is a lie that would
        -- travel straight into the unit cost.
        v_cost   := CASE WHEN v_standard IS NULL THEN NULL
                         ELSE v_standard * GREATEST(v_run.units_in, 0) END;
        v_source := CASE WHEN v_standard IS NULL THEN NULL ELSE 'standard' END;
    END IF;

    UPDATE public.production_stage_runs
       SET status             = 'done',
           started_at         = COALESCE(started_at, queued_at, NOW()),
           completed_at       = COALESCE(completed_at, NOW()),
           units_passed       = v_passed,
           units_failed       = v_failed,
           failure_cause_code = COALESCE(p_cause_code, failure_cause_code),
           batch_group_id     = COALESCE(p_batch_group, batch_group_id),
           notes              = COALESCE(p_notes, notes),
           cost_amount        = COALESCE(v_cost, cost_amount),
           cost_source        = COALESCE(v_source, cost_source)
     WHERE id = p_run_id;

    IF v_failed > 0 AND v_run.on_fail_goto_stage_id IS NOT NULL THEN
        v_goto := v_run.on_fail_goto_stage_id;

        SELECT MIN(r.seq) INTO v_seq
          FROM public.production_stage_runs r
         WHERE r.job_id = v_run.job_id AND r.stage_id = v_goto;

        INSERT INTO public.production_stage_runs (
            job_id, stage_id, seq, execution, advance_mode,
            on_fail_goto_stage_id, supplier_id, status, queued_at,
            units_in, rework_of, failure_cause_code, notes)
        SELECT v_run.job_id, v_goto, COALESCE(v_seq, v_run.seq), r.execution,
               r.advance_mode, r.on_fail_goto_stage_id, r.supplier_id,
               'ready', NOW(), v_failed, p_run_id, p_cause_code,
               'rework after failure at seq ' || v_run.seq
          FROM public.production_stage_runs r
         WHERE r.job_id = v_run.job_id AND r.stage_id = v_goto
         ORDER BY r.seq
         LIMIT 1
        RETURNING id INTO v_rework;
    END IF;

    SELECT order_id INTO v_order FROM public.production_jobs WHERE id = v_run.job_id;

    IF v_passed = 0 AND v_rework IS NULL THEN
        UPDATE public.production_jobs SET status = 'blocked' WHERE id = v_run.job_id;
        PERFORM public.apply_production_status_from_stages(v_order);
        RETURN jsonb_build_object('runId', p_run_id, 'status', 'done',
                                  'unitsPassed', 0, 'jobBlocked', TRUE);
    END IF;

    PERFORM public.advance_production_job(v_run.job_id);

    -- The cutover call. Inert while production_v1 is off.
    PERFORM public.apply_production_status_from_stages(v_order);

    RETURN jsonb_build_object('runId', p_run_id, 'status', 'done',
                              'unitsPassed', v_passed, 'unitsFailed', v_failed,
                              'reworkRunId', v_rework);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Shadow readiness, aggregated
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_production_shadow_summary()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_total INTEGER;
    v_agree INTEGER;
BEGIN
    IF public.get_my_role() NOT IN ('admin', 'lab') THEN
        RAISE EXCEPTION 'forbidden: admin or lab role required' USING ERRCODE = '42501';
    END IF;

    SELECT COUNT(*), COUNT(*) FILTER (WHERE agrees)
      INTO v_total, v_agree
      FROM public.get_production_shadow_report();

    RETURN jsonb_build_object(
        'total',       v_total,
        'agreeing',    v_agree,
        'disagreeing', v_total - v_agree,
        -- NULL, not 100%, when there is nothing to compare. An empty sample
        -- that reports perfect agreement is how a bad cutover gets approved.
        'agreementPct', CASE WHEN v_total = 0 THEN NULL
                             ELSE ROUND((v_agree::numeric / v_total) * 100, 1) END,
        'flagEnabled', public.workflow_flag_enabled('production_v1'));
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Grants
-- ─────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.start_production_for_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_production_for_order(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.apply_production_status_from_stages(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_production_status_from_stages(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_production_shadow_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_production_shadow_summary() TO authenticated;

REVOKE ALL ON FUNCTION public.complete_stage_run(UUID, INTEGER, INTEGER, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_stage_run(UUID, INTEGER, INTEGER, TEXT, TEXT, UUID) TO authenticated;

COMMIT;
