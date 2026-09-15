-- Migration 20260914004000: Production Stage Order Events, Multi-route Split, and Machine RLS
-- Internal lab plan: Phase W Layer 0 (Z7, Z8, Z4).
--
-- 1. Z7: Order events on stage movements (start, complete, fail, block)
-- 2. Z8: Group multi-service orders into one job per route in sync_production_from_order
-- 3. Z4: Allow production_manager to manage machines and technician to report downtime

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Update append_order_event_v2 to include production_manager & technician
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.append_order_event_v2(p_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := public.get_my_user_id();
    v_order public.orders%ROWTYPE;
    v_event public.order_events%ROWTYPE;
BEGIN
    IF v_role NOT IN ('admin', 'accountant', 'coordinator', 'representative', 'lab', 'designer', 'production_manager', 'technician') OR v_user_id IS NULL THEN
        RAISE EXCEPTION 'Role cannot append order events';
    END IF;

    SELECT * INTO v_order FROM public.orders WHERE id = (p_event->>'order_id')::UUID;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

    IF v_role = 'designer' AND v_order.designer_id IS DISTINCT FROM v_user_id THEN RAISE EXCEPTION 'Order access denied'; END IF;
    IF v_role = 'lab' AND v_order.supplier_id IS DISTINCT FROM public.get_my_entity_id() THEN RAISE EXCEPTION 'Order access denied'; END IF;

    IF COALESCE(p_event->>'approval_status', 'none') <> 'none' THEN
        RAISE EXCEPTION 'Approval workflow events require their dedicated RPC';
    END IF;

    IF p_event->>'event_type' IN (
        'financial_adjustment_approved', 'payment_allocated',
        'manual_allocation_override', 'order_reopened'
    ) AND v_role <> 'admin' THEN
        RAISE EXCEPTION 'Sensitive order event requires admin role';
    END IF;

    INSERT INTO public.order_events(
        order_id, event_type, old_value, new_value, changed_by, actor_role,
        changed_at, reason, notes, severity, responsibility_party,
        approval_status, financial_impact, related_transaction_id,
        related_adjustment_id, related_allocation_id, related_issue_id, metadata
    ) VALUES (
        v_order.id, p_event->>'event_type', p_event->>'old_value', p_event->>'new_value',
        v_user_id, v_role, COALESCE((p_event->>'changed_at')::TIMESTAMPTZ, timezone('utc', now())),
        p_event->>'reason', p_event->>'notes', COALESCE(p_event->>'severity', 'info'),
        p_event->>'responsibility_party', 'none', (p_event->>'financial_impact')::NUMERIC,
        NULLIF(p_event->>'related_transaction_id', '')::UUID,
        NULLIF(p_event->>'related_adjustment_id', '')::UUID,
        NULLIF(p_event->>'related_allocation_id', '')::UUID,
        NULLIF(p_event->>'related_issue_id', '')::UUID,
        COALESCE(p_event->'metadata', '{}'::jsonb)
    ) RETURNING * INTO v_event;

    RETURN to_jsonb(v_event);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Z7: start_stage_run with order_events audit
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
    v_run        public.production_stage_runs;
    v_user       UUID := public.get_my_user_id();
    v_order_id   UUID;
    v_stage_name TEXT;
    v_stage_code TEXT;
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
           assignee_id = CASE WHEN execution = 'internal' THEN COALESCE(assignee_id, v_user) END,
           machine_id  = COALESCE(p_machine_id, machine_id),
           blocked_reason = NULL
     WHERE id = p_run_id;

    UPDATE public.production_jobs
       SET status = 'active', started_at = COALESCE(started_at, NOW())
     WHERE id = v_run.job_id AND status IN ('queued', 'blocked');

    -- Log business event in order_events (Phase W Layer 0 Z7)
    SELECT j.order_id, s.name_ar, s.code
      INTO v_order_id, v_stage_name, v_stage_code
      FROM public.production_jobs j
      JOIN public.production_stages s ON s.id = v_run.stage_id
     WHERE j.id = v_run.job_id;

    IF v_order_id IS NOT NULL THEN
        INSERT INTO public.order_events (
            order_id, event_type, new_value, changed_by, actor_role,
            notes, severity, metadata
        ) VALUES (
            v_order_id, 'stage_started', COALESCE(v_run.name_override, v_stage_name),
            v_user, public.get_my_role(),
            'بدء مرحلة: ' || COALESCE(v_run.name_override, v_stage_name),
            'info',
            jsonb_build_object(
                'stage_id', v_run.stage_id,
                'stage_name', COALESCE(v_run.name_override, v_stage_name),
                'stage_code', v_stage_code,
                'run_id', p_run_id,
                'units_in', v_run.units_in,
                'machine_id', COALESCE(p_machine_id, v_run.machine_id)
            )
        );
    END IF;

    RETURN jsonb_build_object('runId', p_run_id, 'status', 'in_progress');
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Z7: complete_stage_run with order_events audit
-- ─────────────────────────────────────────────────────────────────────────

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
    v_run        public.production_stage_runs;
    v_passed     INTEGER;
    v_failed     INTEGER := GREATEST(COALESCE(p_units_failed, 0), 0);
    v_rework     UUID;
    v_goto       UUID;
    v_seq        INTEGER;
    v_user       UUID := public.get_my_user_id();
    v_order_id   UUID;
    v_stage_name TEXT;
    v_stage_code TEXT;
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

    -- Rework loop if any units failed
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

    -- Log business events into order_events (Phase W Layer 0 Z7)
    SELECT j.order_id, s.name_ar, s.code
      INTO v_order_id, v_stage_name, v_stage_code
      FROM public.production_jobs j
      JOIN public.production_stages s ON s.id = v_run.stage_id
     WHERE j.id = v_run.job_id;

    IF v_order_id IS NOT NULL THEN
        IF v_passed > 0 THEN
            INSERT INTO public.order_events (
                order_id, event_type, new_value, changed_by, actor_role,
                notes, severity, metadata
            ) VALUES (
                v_order_id, 'stage_completed', COALESCE(v_run.name_override, v_stage_name),
                v_user, public.get_my_role(),
                'اكتمال مرحلة: ' || COALESCE(v_run.name_override, v_stage_name) || ' (وحدات ناجحة: ' || v_passed || ')',
                'info',
                jsonb_build_object(
                    'stage_id', v_run.stage_id,
                    'stage_name', COALESCE(v_run.name_override, v_stage_name),
                    'stage_code', v_stage_code,
                    'run_id', p_run_id,
                    'units_passed', v_passed,
                    'units_failed', v_failed,
                    'notes', p_notes
                )
            );
        END IF;

        IF v_failed > 0 THEN
            INSERT INTO public.order_events (
                order_id, event_type, new_value, changed_by, actor_role,
                reason, notes, severity, metadata
            ) VALUES (
                v_order_id, 'stage_failed', COALESCE(v_run.name_override, v_stage_name),
                v_user, public.get_my_role(),
                p_cause_code,
                'رسوب في مرحلة: ' || COALESCE(v_run.name_override, v_stage_name) || ' (وحدات راسبة: ' || v_failed || ') - سبب الرسوب: ' || COALESCE(p_cause_code, ''),
                'warning',
                jsonb_build_object(
                    'stage_id', v_run.stage_id,
                    'stage_name', COALESCE(v_run.name_override, v_stage_name),
                    'stage_code', v_stage_code,
                    'run_id', p_run_id,
                    'units_failed', v_failed,
                    'cause_code', p_cause_code,
                    'rework_run_id', v_rework
                )
            );
        END IF;
    END IF;

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
-- 4. Z7: block_stage_run with order_events audit
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
DECLARE
    v_run        public.production_stage_runs;
    v_user       UUID := public.get_my_user_id();
    v_order_id   UUID;
    v_stage_name TEXT;
    v_stage_code TEXT;
BEGIN
    IF NOT public.can_work_production() THEN
        RAISE EXCEPTION 'forbidden: production role required' USING ERRCODE = '42501';
    END IF;

    IF p_reason NOT IN ('machine_down', 'material_out', 'waiting_doctor', 'other') THEN
        RAISE EXCEPTION 'invalid block reason: %', p_reason USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_run FROM public.production_stage_runs WHERE id = p_run_id FOR UPDATE;
    IF v_run.id IS NULL THEN
        RAISE EXCEPTION 'stage run % not found', p_run_id USING ERRCODE = '22023';
    END IF;

    UPDATE public.production_stage_runs
       SET blocked_reason = p_reason,
           notes          = COALESCE(p_notes, notes)
     WHERE id = p_run_id;

    UPDATE public.production_jobs j
       SET status = 'blocked'
      FROM public.production_stage_runs r
     WHERE r.id = p_run_id AND j.id = r.job_id AND j.status = 'active';

    -- Log in order_events (Phase W Layer 0 Z7)
    SELECT j.order_id, s.name_ar, s.code
      INTO v_order_id, v_stage_name, v_stage_code
      FROM public.production_jobs j
      JOIN public.production_stages s ON s.id = v_run.stage_id
     WHERE j.id = v_run.job_id;

    IF v_order_id IS NOT NULL THEN
        INSERT INTO public.order_events (
            order_id, event_type, new_value, changed_by, actor_role,
            reason, notes, severity, metadata
        ) VALUES (
            v_order_id, 'stage_blocked', COALESCE(v_run.name_override, v_stage_name),
            v_user, public.get_my_role(),
            p_reason,
            'تعطّل في مرحلة: ' || COALESCE(v_run.name_override, v_stage_name) || ' - السبب: ' || p_reason || COALESCE(' - ' || p_notes, ''),
            'warning',
            jsonb_build_object(
                'stage_id', v_run.stage_id,
                'stage_name', COALESCE(v_run.name_override, v_stage_name),
                'stage_code', v_stage_code,
                'run_id', p_run_id,
                'blocked_reason', p_reason,
                'notes', p_notes
            )
        );
    END IF;

    RETURN jsonb_build_object('runId', p_run_id, 'blockedReason', p_reason);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Z8: sync_production_from_order with multi-route grouping
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_production_from_order(p_order_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    o          public.orders;
    v_job      UUID;
    v_since    TIMESTAMPTZ;
    v_status   TEXT;
    v_target   INTEGER;
    v_now      TIMESTAMPTZ := NOW();
    v_design   INTEGER;
    v_ext1     INTEGER;
    v_ext2     INTEGER;
    v_doctor   INTEGER;
    v_ship     INTEGER;
    v_last     INTEGER;
    v_fallback UUID;
    v_jobs     UUID[] := ARRAY[]::UUID[];
    v_job_new  UUID;
    v_units    INTEGER;
    r          RECORD;
BEGIN
    SELECT * INTO o FROM public.orders WHERE id = p_order_id;
    IF o.id IS NULL OR COALESCE(o.is_deleted, FALSE) THEN
        RETURN NULL;
    END IF;

    SELECT id INTO v_job
      FROM public.production_jobs
     WHERE order_id = p_order_id AND NOT is_backfilled
     ORDER BY round_no
     LIMIT 1;

    -- Cancelled and lab-rejected cases were never worked.
    IF COALESCE(o.issue_state, 'none') IN ('cancelled', 'lab_rejected') THEN
        IF v_job IS NOT NULL THEN
            UPDATE public.production_stage_runs
               SET status = 'skipped'
             WHERE job_id IN (SELECT id FROM public.production_jobs WHERE order_id = p_order_id AND NOT is_backfilled)
               AND status IN ('pending', 'ready', 'in_progress', 'waiting_external');

            UPDATE public.production_jobs
               SET status = 'cancelled', completed_at = COALESCE(completed_at, v_now)
             WHERE order_id = p_order_id AND NOT is_backfilled AND status <> 'done';
        END IF;
        RETURN v_job;
    END IF;

    v_status := COALESCE(o.production_status, 'not_started');

    IF v_job IS NULL THEN
        SELECT value::timestamptz INTO v_since
          FROM public.app_settings WHERE key = 'production_autostart_since';

        IF v_since IS NULL
           OR o.created_at < v_since
           OR v_status NOT IN ('not_started', 'designing', 'in_production') THEN
            RETURN NULL;
        END IF;

        -- Phase W Layer 0 Z8: Group items by service route
        SELECT id INTO v_fallback FROM public.production_routes
         WHERE is_fallback AND is_active LIMIT 1;

        FOR r IN
            SELECT COALESCE(sv.route_id, v_fallback) AS route_id,
                   SUM(COALESCE(oi.count, 1))::int   AS units,
                   array_agg(oi.id)                  AS item_ids
              FROM public.order_items oi
              LEFT JOIN public.services sv ON sv.name = oi.product_type
             WHERE oi.order_id = p_order_id
             GROUP BY COALESCE(sv.route_id, v_fallback)
        LOOP
            IF r.route_id IS NOT NULL THEN
                v_units := GREATEST(r.units, 1);
                v_job_new := public.materialize_job_from_route(
                    p_order_id, r.route_id, v_units,
                    1 + COALESCE(array_length(v_jobs, 1), 0));

                DELETE FROM public.production_job_items
                 WHERE job_id = v_job_new AND NOT (order_item_id = ANY (r.item_ids));

                v_jobs := v_jobs || v_job_new;
            END IF;
        END LOOP;

        IF COALESCE(array_length(v_jobs, 1), 0) = 0 THEN
            v_job := public.materialize_job_from_route(p_order_id, NULL, NULL, 1);
        ELSE
            v_job := v_jobs[1];
        END IF;
    END IF;

    -- Where each landmark sits on this case's chain
    SELECT MIN(r.seq) FILTER (WHERE s.code = 'design'),
           MIN(r.seq) FILTER (WHERE s.code = 'external_full'),
           MAX(r.seq) FILTER (WHERE s.code = 'external_full'),
           MIN(r.seq) FILTER (WHERE s.code = 'doctor_review'),
           MIN(r.seq) FILTER (WHERE s.code = 'shipping'),
           MAX(r.seq)
      INTO v_design, v_ext1, v_ext2, v_doctor, v_ship, v_last
      FROM public.production_stage_runs r
      JOIN public.production_stages s ON s.id = r.stage_id
     WHERE r.job_id = v_job;

    v_target := CASE v_status
        WHEN 'not_started'     THEN COALESCE(v_design, v_ext1)
        WHEN 'designing'       THEN COALESCE(v_design, v_ext1)
        WHEN 'in_production'   THEN COALESCE(v_ext1, v_design)
        WHEN 'try_in_ready'    THEN COALESCE(v_doctor, v_ext1)
        WHEN 'waiting_doctor'  THEN COALESCE(v_doctor, v_ext1)
        WHEN 'finalization'    THEN COALESCE(v_ext2, v_ext1)
        WHEN 'final_ready'     THEN COALESCE(v_ship, v_last)
        WHEN 'final_delivered' THEN NULL
        ELSE COALESCE(v_ext1, v_design)
    END;

    IF v_status = 'final_delivered' THEN
        UPDATE public.production_stage_runs
           SET status = 'done', completed_at = COALESCE(completed_at, v_now)
         WHERE job_id IN (SELECT id FROM public.production_jobs WHERE order_id = p_order_id AND NOT is_backfilled)
           AND status IN ('pending', 'ready', 'in_progress', 'waiting_external');

        UPDATE public.production_jobs
           SET status = 'done', completed_at = COALESCE(completed_at, v_now)
         WHERE order_id = p_order_id AND NOT is_backfilled AND status <> 'done';
    ELSIF v_target IS NOT NULL THEN
        UPDATE public.production_stage_runs
           SET status = 'done', completed_at = COALESCE(completed_at, v_now)
         WHERE job_id = v_job AND seq < v_target
           AND status IN ('pending', 'ready');

        UPDATE public.production_stage_runs
           SET status = CASE WHEN execution = 'external' THEN 'waiting_external' ELSE 'ready' END
         WHERE job_id = v_job AND seq = v_target
           AND status = 'pending';
    END IF;

    RETURN v_job;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Z4: Machines and Downtime RLS for production_manager and technician
-- ─────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS admin_manage_machines ON public.machines;
CREATE POLICY admin_manage_machines ON public.machines
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('admin', 'production_manager'))
    WITH CHECK (public.get_my_role() IN ('admin', 'production_manager'));

DROP POLICY IF EXISTS lab_manage_machine_downtime ON public.machine_downtime;
CREATE POLICY lab_manage_machine_downtime ON public.machine_downtime
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('admin', 'production_manager', 'technician'))
    WITH CHECK (public.get_my_role() IN ('admin', 'production_manager', 'technician'));

COMMIT;
