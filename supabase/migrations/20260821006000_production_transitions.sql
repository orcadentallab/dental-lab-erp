-- Production transitions: the two taps a technician actually makes.
-- Internal lab plan, phase 1. See docs/INTERNAL_LAB_PLAN_AR.md section 7.
--
-- THE WHOLE DESIGN GOAL IS TWO TAPS
--   Start, then finish. Nothing else is required of a technician to move a
--   case. units_passed defaults to units_in, the timestamps come from the
--   clock, the assignee is whoever is signed in, and the next stage opens by
--   itself. The single mandatory input in the entire flow is a cause code on a
--   QC failure -- and that is a picker, not a form.
--
--   Every RPC here is idempotent. A double tap on a lab tablet with a shaky
--   connection must not create two runs or two rework loops. Pressing "start"
--   on a running stage returns it; pressing "finish" on a finished one returns
--   it. A button that errors reads as broken and trains people to stop using
--   the system, which is how the data dies.
--
-- PULL, NOT PUSH
--   Nobody assigns work. Finishing a stage marks the next one 'ready', and it
--   appears in whoever's queue is qualified for it. advance_mode='manual'
--   holds it for a deliberate hand-off; 'qc_gate' requires a pass/fail.
--
-- INTERNAL REWORK IS NOT AN ORDER ISSUE
--   A QC failure caught before the case leaves the building creates a rework
--   stage run and NOTHING in order_issues. Mixing the two would corrupt every
--   doctor and supplier issue report that already exists (plan 5.1).
--
-- SHADOW MODE
--   compute_production_status_from_stages() returns what orders.production_status
--   WOULD be, and writes nothing. The flag production_v1 stays off; the cutover
--   is phase 2, after two weeks of the shadow report agreeing.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. The technician role
-- ─────────────────────────────────────────────────────────────────────────
-- One new role, not four. get_my_role() appears in dozens of RLS policies, so
-- every extra role is a full security review. QC and packaging are controlled
-- by which stage a person may act on, not by inventing a role each.

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'lab', 'representative', 'accountant', 'designer',
                    'doctor', 'technician'));

-- Who may act on production. 'lab' is the production manager.
CREATE OR REPLACE FUNCTION public.can_work_production()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
    SELECT public.get_my_role() IN ('admin', 'lab', 'technician', 'designer');
$$;

-- Technicians read and write their own stage runs; the board is readable by
-- anyone signed in.
DROP POLICY IF EXISTS manage_production_stage_runs ON public.production_stage_runs;
CREATE POLICY manage_production_stage_runs ON public.production_stage_runs
    FOR ALL TO authenticated
    USING (public.can_work_production())
    WITH CHECK (public.can_work_production());

DROP POLICY IF EXISTS manage_production_jobs ON public.production_jobs;
CREATE POLICY manage_production_jobs ON public.production_jobs
    FOR ALL TO authenticated
    USING (public.can_work_production())
    WITH CHECK (public.can_work_production());

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Opening the next step
-- ─────────────────────────────────────────────────────────────────────────
-- Called after a stage finishes. Marks the next sequence group 'ready' and
-- stamps queued_at, which is where the wait clock starts.

CREATE OR REPLACE FUNCTION public.advance_production_job(p_job_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_next INTEGER;
    v_open INTEGER;
    v_n    INTEGER := 0;
BEGIN
    -- Anything still open blocks the next group: parallel stages share a seq
    -- group and must all finish before the case moves on.
    SELECT MIN(seq) INTO v_open
      FROM public.production_stage_runs
     WHERE job_id = p_job_id
       AND status IN ('ready', 'in_progress', 'waiting_external');

    IF v_open IS NOT NULL THEN
        RETURN 0;
    END IF;

    SELECT MIN(seq) INTO v_next
      FROM public.production_stage_runs
     WHERE job_id = p_job_id AND status = 'pending';

    IF v_next IS NULL THEN
        UPDATE public.production_jobs
           SET status = 'done', completed_at = COALESCE(completed_at, NOW())
         WHERE id = p_job_id AND status <> 'done';
        RETURN 0;
    END IF;

    UPDATE public.production_stage_runs
       SET status = 'ready', queued_at = COALESCE(queued_at, NOW())
     WHERE job_id = p_job_id AND seq = v_next AND status = 'pending';

    GET DIAGNOSTICS v_n = ROW_COUNT;

    UPDATE public.production_jobs
       SET status = 'active', started_at = COALESCE(started_at, NOW())
     WHERE id = p_job_id AND status = 'queued';

    RETURN v_n;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Tap one: start
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.start_stage_run(
    p_run_id     UUID,
    p_machine_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_run  public.production_stage_runs;
    v_user UUID := public.get_my_user_id();
BEGIN
    IF NOT public.can_work_production() THEN
        RAISE EXCEPTION 'forbidden: production role required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_run FROM public.production_stage_runs WHERE id = p_run_id FOR UPDATE;
    IF v_run.id IS NULL THEN
        RAISE EXCEPTION 'stage run % not found', p_run_id USING ERRCODE = '22023';
    END IF;

    -- Idempotent: already running or finished, just report back.
    IF v_run.status IN ('in_progress', 'done') THEN
        RETURN jsonb_build_object('runId', v_run.id, 'status', v_run.status,
                                  'alreadyStarted', TRUE);
    END IF;

    IF v_run.status <> 'ready' THEN
        RAISE EXCEPTION 'stage run % is % and cannot be started', p_run_id, v_run.status
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.production_stage_runs
       SET status      = 'in_progress',
           started_at  = COALESCE(started_at, NOW()),
           -- An external run has no technician; the constraint enforces it.
           assignee_id = CASE WHEN execution = 'internal' THEN COALESCE(assignee_id, v_user) END,
           machine_id  = COALESCE(p_machine_id, machine_id),
           blocked_reason = NULL
     WHERE id = p_run_id;

    UPDATE public.production_jobs
       SET status = 'active', started_at = COALESCE(started_at, NOW())
     WHERE id = v_run.job_id AND status IN ('queued', 'blocked');

    RETURN jsonb_build_object('runId', p_run_id, 'status', 'in_progress');
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Tap two: finish
-- ─────────────────────────────────────────────────────────────────────────
-- p_units_passed defaults to everything that came in. A technician only
-- touches it when something actually broke.

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
    v_run     public.production_stage_runs;
    v_passed  INTEGER;
    v_failed  INTEGER := GREATEST(COALESCE(p_units_failed, 0), 0);
    v_rework  UUID;
    v_goto    UUID;
    v_seq     INTEGER;
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

    -- A QC gate that rejects units must say why. This is the only mandatory
    -- input anywhere in the technician flow.
    IF v_failed > 0 AND p_cause_code IS NULL THEN
        RAISE EXCEPTION 'a cause code is required when units fail' USING ERRCODE = '22023';
    END IF;

    UPDATE public.production_stage_runs
       SET status             = 'done',
           started_at         = COALESCE(started_at, queued_at, NOW()),
           completed_at       = COALESCE(completed_at, NOW()),
           units_passed       = v_passed,
           units_failed       = v_failed,
           failure_cause_code = COALESCE(p_cause_code, failure_cause_code),
           batch_group_id     = COALESCE(p_batch_group, batch_group_id),
           notes              = COALESCE(p_notes, notes)
     WHERE id = p_run_id;

    -- Rework: send the failed units back to wherever this route says, as a NEW
    -- run pointing at the one that failed. No order_issues row -- the case
    -- never left the building (plan 5.1).
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

    -- Nothing usable came out and there is no rework path: the job is stuck
    -- and a human has to look at it, rather than the case silently vanishing.
    IF v_passed = 0 AND v_rework IS NULL THEN
        UPDATE public.production_jobs SET status = 'blocked' WHERE id = v_run.job_id;
        RETURN jsonb_build_object('runId', p_run_id, 'status', 'done',
                                  'unitsPassed', 0, 'jobBlocked', TRUE);
    END IF;

    PERFORM public.advance_production_job(v_run.job_id);

    RETURN jsonb_build_object('runId', p_run_id, 'status', 'done',
                              'unitsPassed', v_passed, 'unitsFailed', v_failed,
                              'reworkRunId', v_rework);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. "The machine is dead" / "the material ran out" — one tap, no form
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.block_stage_run(
    p_run_id UUID,
    p_reason TEXT,
    p_notes  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NOT public.can_work_production() THEN
        RAISE EXCEPTION 'forbidden: production role required' USING ERRCODE = '42501';
    END IF;

    IF p_reason NOT IN ('machine_down', 'material_out', 'waiting_doctor', 'other') THEN
        RAISE EXCEPTION 'invalid block reason: %', p_reason USING ERRCODE = '22023';
    END IF;

    UPDATE public.production_stage_runs
       SET blocked_reason = p_reason,
           notes          = COALESCE(p_notes, notes)
     WHERE id = p_run_id;

    UPDATE public.production_jobs j
       SET status = 'blocked'
      FROM public.production_stage_runs r
     WHERE r.id = p_run_id AND j.id = r.job_id AND j.status = 'active';

    RETURN jsonb_build_object('runId', p_run_id, 'blockedReason', p_reason);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. External work orders — send and receive
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.send_external_work_order(
    p_run_id      UUID,
    p_supplier_id UUID DEFAULT NULL,
    p_expected    TIMESTAMPTZ DEFAULT NULL,
    p_agreed_cost NUMERIC DEFAULT NULL,
    p_notes       TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_run      public.production_stage_runs;
    v_supplier UUID;
    v_id       UUID;
BEGIN
    IF NOT public.can_work_production() THEN
        RAISE EXCEPTION 'forbidden: production role required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_run FROM public.production_stage_runs WHERE id = p_run_id FOR UPDATE;
    IF v_run.id IS NULL THEN
        RAISE EXCEPTION 'stage run % not found', p_run_id USING ERRCODE = '22023';
    END IF;

    IF v_run.execution <> 'external' THEN
        RAISE EXCEPTION 'stage run % is internal and cannot be sent out', p_run_id
            USING ERRCODE = '22023';
    END IF;

    -- Idempotent: already sent, hand back the existing work order.
    SELECT id INTO v_id FROM public.external_work_orders WHERE stage_run_id = p_run_id;
    IF v_id IS NOT NULL THEN
        RETURN v_id;
    END IF;

    v_supplier := COALESCE(p_supplier_id, v_run.supplier_id);
    IF v_supplier IS NULL THEN
        RAISE EXCEPTION 'no supplier for external stage run %', p_run_id USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.external_work_orders
        (stage_run_id, supplier_id, sent_at, expected_return_at, units,
         agreed_cost, status, notes)
    VALUES
        (p_run_id, v_supplier, NOW(), p_expected, GREATEST(v_run.units_in, 1),
         p_agreed_cost, 'sent', p_notes)
    RETURNING id INTO v_id;

    UPDATE public.production_stage_runs
       SET status      = 'waiting_external',
           supplier_id = v_supplier,
           started_at  = COALESCE(started_at, NOW())
     WHERE id = p_run_id;

    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_external_work_order(
    p_wo_id       UUID,
    p_returned_at TIMESTAMPTZ DEFAULT NULL,
    p_agreed_cost NUMERIC DEFAULT NULL,
    p_invoice_ref TEXT DEFAULT NULL,
    p_units_ok    INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_wo public.external_work_orders;
BEGIN
    IF NOT public.can_work_production() THEN
        RAISE EXCEPTION 'forbidden: production role required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_wo FROM public.external_work_orders WHERE id = p_wo_id FOR UPDATE;
    IF v_wo.id IS NULL THEN
        RAISE EXCEPTION 'external work order % not found', p_wo_id USING ERRCODE = '22023';
    END IF;

    IF v_wo.status = 'returned' THEN
        RETURN jsonb_build_object('workOrderId', p_wo_id, 'alreadyReceived', TRUE);
    END IF;

    UPDATE public.external_work_orders
       SET returned_at = COALESCE(p_returned_at, NOW()),
           agreed_cost = COALESCE(p_agreed_cost, agreed_cost),
           invoice_ref = COALESCE(p_invoice_ref, invoice_ref),
           status      = 'returned'
     WHERE id = p_wo_id;

    -- Completing the run stamps the vendor turnaround and opens the next stage.
    RETURN public.complete_stage_run(
        v_wo.stage_run_id,
        COALESCE(p_units_ok, v_wo.units),
        0, NULL, NULL, NULL);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Shadow mode — compute the coarse status, write nothing
-- ─────────────────────────────────────────────────────────────────────────
-- production_status is the contract with finance. Phase 2 flips it over only
-- after this has agreed with reality for two weeks on live orders.

CREATE OR REPLACE FUNCTION public.compute_production_status_from_stages(
    p_order_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total    INTEGER;
    v_code     TEXT;
    v_delivery TEXT;
BEGIN
    SELECT COUNT(*) FILTER (WHERE r.status <> 'skipped')
      INTO v_total
      FROM public.production_stage_runs r
      JOIN public.production_jobs j ON j.id = r.job_id
     WHERE j.order_id = p_order_id AND NOT j.is_backfilled;

    -- No live job: nothing to say, and NULL says exactly that rather than
    -- inventing a status for an order the new pipeline has never seen.
    IF COALESCE(v_total, 0) = 0 THEN
        RETURN NULL;
    END IF;

    SELECT o.delivery_type INTO v_delivery FROM public.orders o WHERE o.id = p_order_id;

    -- The earliest stage still open decides where the case is. Because this
    -- looks across ALL of the order's jobs, an order with two routes is only
    -- as far along as its slowest one -- which is what stops an invoice going
    -- out while half the case is still on the bench.
    SELECT s.code INTO v_code
      FROM public.production_stage_runs r
      JOIN public.production_jobs j ON j.id = r.job_id
      JOIN public.production_stages s ON s.id = r.stage_id
     WHERE j.order_id = p_order_id AND NOT j.is_backfilled
       AND r.status IN ('pending', 'ready', 'in_progress', 'waiting_external')
     ORDER BY r.seq, s.code
     LIMIT 1;

    IF v_code IS NULL THEN
        RETURN 'final_delivered';
    END IF;

    RETURN CASE v_code
        WHEN 'design'        THEN 'designing'
        WHEN 'doctor_review' THEN 'waiting_doctor'
        WHEN 'qc'            THEN CASE WHEN v_delivery = 'TryIn' THEN 'try_in_ready'
                                       ELSE 'finalization' END
        WHEN 'packaging'     THEN 'final_ready'
        WHEN 'shipping'      THEN 'final_ready'
        ELSE 'in_production'
    END;
END;
$$;

-- The readiness report for the cutover decision: computed vs actual, per order.
CREATE OR REPLACE FUNCTION public.get_production_shadow_report()
RETURNS TABLE (
    order_id        UUID,
    case_id         TEXT,
    actual_status   TEXT,
    computed_status TEXT,
    agrees          BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
    SELECT o.id, o.case_id, o.production_status,
           public.compute_production_status_from_stages(o.id),
           o.production_status IS NOT DISTINCT FROM
               public.compute_production_status_from_stages(o.id)
      FROM public.orders o
     WHERE public.get_my_role() IN ('admin', 'lab')
       AND COALESCE(o.is_deleted, FALSE) = FALSE
       AND EXISTS (SELECT 1 FROM public.production_jobs j
                    WHERE j.order_id = o.id AND NOT j.is_backfilled)
     ORDER BY (o.production_status IS NOT DISTINCT FROM
               public.compute_production_status_from_stages(o.id)), o.created_at DESC;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Grants
-- ─────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.can_work_production() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_work_production() TO authenticated;

REVOKE ALL ON FUNCTION public.advance_production_job(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_production_job(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.start_stage_run(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_stage_run(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_stage_run(UUID, INTEGER, INTEGER, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_stage_run(UUID, INTEGER, INTEGER, TEXT, TEXT, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.block_stage_run(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.block_stage_run(UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.send_external_work_order(UUID, UUID, TIMESTAMPTZ, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_external_work_order(UUID, UUID, TIMESTAMPTZ, NUMERIC, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.receive_external_work_order(UUID, TIMESTAMPTZ, NUMERIC, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_external_work_order(UUID, TIMESTAMPTZ, NUMERIC, TEXT, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.compute_production_status_from_stages(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_production_status_from_stages(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_production_shadow_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_production_shadow_report() TO authenticated;

COMMIT;
