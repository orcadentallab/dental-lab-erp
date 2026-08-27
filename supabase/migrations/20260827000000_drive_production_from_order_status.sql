-- The stage chain follows the order's own status. No new buttons.
--
-- WHAT THIS IS FOR
--   The internal lab does not exist yet, so every case still goes out whole to
--   a vendor. The one number worth collecting between now and opening day is
--   THE VENDOR'S TURNAROUND, measured the same way we will later measure our
--   own bench -- otherwise "internal is faster" will be a comparison between
--   two differently-built numbers.
--
--   Phase 1 collected that number by asking somebody to press "ابدأ الإنتاج"
--   and then work an external work order screen. Nobody is going to do that:
--   there is no lab, no technician, and no reason for a rep to double-enter
--   what they already record on the order. Measured on production today:
--   1174 orders, ZERO live production jobs. The instrument was built and never
--   switched on.
--
--   So the instrument reads the existing dial instead. orders.production_status
--   is already maintained on every case, by people who have a reason to
--   maintain it, and it already says exactly what we need:
--
--     designing       our designer has it          (split cases only)
--     in_production   the outside lab has it       <- vendor window opens
--     try_in_ready    it is with the doctor        <- vendor window closes
--     finalization    back at the outside lab      <- second vendor window
--     final_ready     the outside lab has finished
--     final_delivered the doctor has it
--
-- WHY A RECONCILER AND NOT A TRANSITION HANDLER
--   Mapping each status CHANGE to a stage action breaks on everything real: an
--   order corrected backwards, a status set twice, a case that existed before
--   this migration, a step skipped entirely. So the trigger computes WHERE THE
--   CASE SHOULD BE from the current status and moves the chain to that
--   position, whatever it was doing before. Running it twice changes nothing
--   the second time.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   * It never writes orders.production_status. The arrow points one way:
--     status -> stages. The reverse arrow is apply_production_status_from_
--     stages, still gated behind production_v1, still off. Both directions
--     live at once would be a loop.
--   * It never touches financial_obligations. Vendor cost keeps flowing
--     through orders.cost exactly as it does today.
--   * It creates nothing for cancelled or lab-rejected cases. Those were never
--     worked; a vendor window measured on them is not a vendor window.
--   * It fabricates no history. A case already past in_production when this
--     ships gets no job at all, because its real timestamps are gone and a
--     chain stamped NOW() would put invented durations underneath the very
--     report meant to judge the new lab.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. A fourth thing that can drive a stage
-- ─────────────────────────────────────────────────────────────────────────
-- The rule from plan 4 does not change -- every step has exactly ONE thing
-- that advances it, so it can never be counted twice. This adds a fourth
-- possible driver: the order's own status, for the era in which the work
-- happens somewhere we cannot see.

ALTER TABLE public.production_stages
    DROP CONSTRAINT IF EXISTS production_stages_driven_by_check;

ALTER TABLE public.production_stages
    ADD CONSTRAINT production_stages_driven_by_check
    CHECK (driven_by IN ('my_tasks', 'designer_dashboard', 'external_wo', 'order_status'));

-- Whether a step is worked by a person or merely observed is a property of the
-- ROUTE, not of the stage. Shipping on the outsourced route is something we
-- watch happen; shipping on the in-house route will be something a person
-- does. Same stage, two answers, so the answer belongs on the step.
ALTER TABLE public.production_route_stages
    ADD COLUMN IF NOT EXISTS driven_by TEXT
        CHECK (driven_by IN ('my_tasks', 'designer_dashboard', 'external_wo', 'order_status'));

COMMENT ON COLUMN public.production_route_stages.driven_by IS
'Which screen (or the order status) advances this step on this route. NULL falls back to the stage catalogue.';

-- Frozen onto the run for the same reason execution and allowed_roles are: the
-- run is what the route said at materialisation, and a route edited this
-- afternoon must not re-point a case that started this morning.
ALTER TABLE public.production_stage_runs
    ADD COLUMN IF NOT EXISTS driven_by TEXT NOT NULL DEFAULT 'my_tasks'
        CHECK (driven_by IN ('my_tasks', 'designer_dashboard', 'external_wo', 'order_status'));

-- The two stages that only ever describe something happening outside this
-- building. Nobody here presses anything for them.
UPDATE public.production_stages
   SET driven_by = 'order_status'
 WHERE code IN ('external_full', 'doctor_review');

-- ─────────────────────────────────────────────────────────────────────────
-- 2. The chain reports the driver
-- ─────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_effective_route_stages(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.get_effective_route_stages(
    p_route_id UUID,
    p_context  JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    seq                       INTEGER,
    stage_id                  UUID,
    stage_code                TEXT,
    name_ar                   TEXT,
    name_override             TEXT,
    variant_label             TEXT,
    allowed_roles             TEXT[],
    driven_by                 TEXT,
    execution                 TEXT,
    supplier_id               UUID,
    is_qc_gate                BOOLEAN,
    is_batch_stage            BOOLEAN,
    parallel_group            INTEGER,
    advance_mode              TEXT,
    on_fail_goto_stage_id     UUID,
    standard_minutes_per_unit NUMERIC,
    standard_cost_per_unit    NUMERIC,
    required_fields           JSONB,
    applies_when              JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH inc AS (
        SELECT rs.stage_id, rs.step_no, rs.seq_override, rs.variant_label,
               rs.name_override, rs.allowed_roles, rs.driven_by, rs.parallel_group,
               rs.condition, rs.execution_override, rs.supplier_override,
               rs.standard_minutes_per_unit, rs.standard_cost_per_unit,
               rs.advance_mode, rs.on_fail_goto_stage_id
          FROM public.production_route_stages rs
          JOIN public.production_stages s ON s.id = rs.stage_id
          JOIN public.production_routes r ON r.id = rs.route_id
         WHERE rs.route_id = p_route_id AND r.is_active
           AND s.is_active AND rs.mode = 'included'
    ),
    ovr AS (
        SELECT rs.stage_id, rs.variant_label, rs.name_override, rs.allowed_roles,
               rs.driven_by, rs.parallel_group, rs.condition, rs.execution_override,
               rs.supplier_override, rs.standard_minutes_per_unit,
               rs.standard_cost_per_unit, rs.advance_mode, rs.on_fail_goto_stage_id
          FROM public.production_route_stages rs
         WHERE rs.route_id = p_route_id AND rs.mode = 'override'
    ),
    exc AS (
        SELECT rs.stage_id FROM public.production_route_stages rs
         WHERE rs.route_id = p_route_id AND rs.mode = 'excluded'
    ),
    fallback AS (
        SELECT s.id AS stage_id, s.sequence AS step_no, NULL::integer AS seq_override,
               NULL::text AS variant_label, NULL::text AS name_override,
               '{}'::text[] AS allowed_roles, NULL::text AS driven_by,
               NULL::integer AS parallel_group,
               s.default_condition AS condition, NULL::text AS execution_override,
               NULL::uuid AS supplier_override,
               NULL::numeric AS standard_minutes_per_unit,
               NULL::numeric AS standard_cost_per_unit,
               NULL::text AS advance_mode, NULL::uuid AS on_fail_goto_stage_id
          FROM public.production_stages s
         WHERE s.is_active AND s.scope = 'global'
           AND NOT EXISTS (SELECT 1 FROM inc)
    ),
    base AS (
        SELECT * FROM inc
        UNION ALL
        SELECT * FROM fallback
    )
    SELECT
        COALESCE(b.step_no, b.seq_override, s.sequence)          AS seq,
        b.stage_id,
        s.code                                                   AS stage_code,
        COALESCE(b.name_override, o.name_override, s.name_ar)    AS name_ar,
        COALESCE(b.name_override, o.name_override)               AS name_override,
        COALESCE(b.variant_label, o.variant_label)               AS variant_label,
        CASE WHEN COALESCE(array_length(b.allowed_roles, 1), 0) > 0
             THEN b.allowed_roles
             ELSE COALESCE(o.allowed_roles, '{}'::text[]) END    AS allowed_roles,
        COALESCE(b.driven_by, o.driven_by, s.driven_by)          AS driven_by,
        COALESCE(b.execution_override, o.execution_override, s.default_execution) AS execution,
        COALESCE(b.supplier_override, o.supplier_override, s.default_supplier_id) AS supplier_id,
        s.is_qc_gate,
        s.is_batch_stage,
        COALESCE(b.parallel_group, o.parallel_group)             AS parallel_group,
        COALESCE(b.advance_mode, o.advance_mode,
                 CASE WHEN s.is_qc_gate THEN 'qc_gate' ELSE 'auto' END) AS advance_mode,
        COALESCE(b.on_fail_goto_stage_id, o.on_fail_goto_stage_id) AS on_fail_goto_stage_id,
        COALESCE(b.standard_minutes_per_unit, o.standard_minutes_per_unit),
        COALESCE(b.standard_cost_per_unit, o.standard_cost_per_unit),
        s.required_fields,
        COALESCE(b.condition, o.condition)                       AS applies_when
    FROM base b
    JOIN public.production_stages s ON s.id = b.stage_id
    LEFT JOIN ovr o ON o.stage_id = b.stage_id
    WHERE b.stage_id NOT IN (SELECT stage_id FROM exc)
      AND (COALESCE(b.condition, o.condition) IS NULL
           OR COALESCE(p_context, '{}'::jsonb) @> COALESCE(b.condition, o.condition))
    ORDER BY 1, s.code;
$$;

COMMENT ON FUNCTION public.get_effective_route_stages(UUID, JSONB) IS
'The ordered chain a case on this route walks. A stage may appear more than once (the try-in loop). Routes with no steps fall back to the global chain so a new route is never empty.';

REVOKE ALL ON FUNCTION public.get_effective_route_stages(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_effective_route_stages(UUID, JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Materialisation freezes the driver too
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.materialize_job_from_route(
    p_order_id   UUID,
    p_route_id   UUID DEFAULT NULL,
    p_unit_count INTEGER DEFAULT NULL,
    p_round_no   INTEGER DEFAULT 1,
    p_context    JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_route  UUID;
    v_order  public.orders;
    v_units  INTEGER;
    v_ctx    JSONB;
    v_job_id UUID;
    v_first  INTEGER;
    v_stages INTEGER := 0;
    r        RECORD;
BEGIN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'order % not found', p_order_id USING ERRCODE = '22023';
    END IF;

    v_route := COALESCE(p_route_id, public.resolve_route_for_order(p_order_id));
    IF v_route IS NULL THEN
        RAISE EXCEPTION 'no route resolved for order % and no fallback route exists', p_order_id
            USING ERRCODE = '22023';
    END IF;

    v_ctx := COALESCE(p_context, jsonb_strip_nulls(jsonb_build_object(
                 'delivery_type', v_order.delivery_type,
                 'workflow_type', v_order.workflow_type,
                 'is_redo',       v_order.is_redo,
                 'priority',      v_order.priority)));

    v_units := COALESCE(p_unit_count,
                        NULLIF((SELECT SUM(COALESCE(oi.count, 1))::int
                                  FROM public.order_items oi
                                 WHERE oi.order_id = p_order_id), 0),
                        1);

    INSERT INTO public.production_jobs
        (order_id, route_id, round_no, unit_count, status, priority, due_at)
    VALUES
        (p_order_id, v_route, p_round_no, v_units, 'queued',
         COALESCE(v_order.priority, 'Normal'),
         v_order.delivery_date::timestamp AT TIME ZONE 'Africa/Cairo')
    RETURNING id INTO v_job_id;

    INSERT INTO public.production_job_items (job_id, order_item_id, units)
    SELECT v_job_id, oi.id, GREATEST(COALESCE(oi.count, 1), 1)
      FROM public.order_items oi
     WHERE oi.order_id = p_order_id;

    FOR r IN SELECT * FROM public.get_effective_route_stages(v_route, v_ctx) ORDER BY seq
    LOOP
        IF v_first IS NULL THEN
            v_first := r.seq;
        END IF;

        INSERT INTO public.production_stage_runs (
            job_id, stage_id, seq, parallel_group, execution, advance_mode,
            on_fail_goto_stage_id, supplier_id, status, queued_at, units_in,
            variant_label, name_override, allowed_roles, driven_by)
        VALUES (
            v_job_id, r.stage_id, r.seq, r.parallel_group, r.execution,
            r.advance_mode, r.on_fail_goto_stage_id,
            CASE WHEN r.execution = 'external' THEN r.supplier_id END,
            CASE WHEN r.seq = v_first THEN 'ready' ELSE 'pending' END,
            CASE WHEN r.seq = v_first THEN NOW() END,
            v_units,
            r.variant_label, r.name_override, COALESCE(r.allowed_roles, '{}'::text[]),
            COALESCE(r.driven_by, 'my_tasks'));

        v_stages := v_stages + 1;
    END LOOP;

    IF v_stages = 0 THEN
        RAISE EXCEPTION 'route % resolved to an empty stage chain', v_route
            USING ERRCODE = '22023';
    END IF;

    RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_job_from_route(UUID, UUID, INTEGER, INTEGER, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.materialize_job_from_route(UUID, UUID, INTEGER, INTEGER, JSONB) TO authenticated;

-- The editor writes the driver along with everything else about a step.
CREATE OR REPLACE FUNCTION public.save_route_steps(
    p_route_id UUID,
    p_steps    JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    e        JSONB;
    n        INTEGER := 0;
    v_stage  UUID;
    v_roles  TEXT[];
    v_count  INTEGER;
BEGIN
    IF public.get_my_role() <> 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.production_routes
                    WHERE id = p_route_id AND is_active) THEN
        RAISE EXCEPTION 'route % not found or inactive', p_route_id USING ERRCODE = '22023';
    END IF;

    IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' THEN
        RAISE EXCEPTION 'steps must be a JSON array' USING ERRCODE = '22023';
    END IF;

    IF jsonb_array_length(p_steps) = 0 THEN
        RAISE EXCEPTION 'a route must keep at least one step' USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.production_route_stages WHERE route_id = p_route_id;

    FOR e IN SELECT * FROM jsonb_array_elements(p_steps)
    LOOP
        n := n + 10;
        v_stage := NULLIF(e ->> 'stage_id', '')::uuid;

        IF v_stage IS NULL OR NOT EXISTS (
               SELECT 1 FROM public.production_stages
                WHERE id = v_stage AND is_active) THEN
            RAISE EXCEPTION 'step % refers to an unknown or inactive stage', n / 10
                USING ERRCODE = '22023';
        END IF;

        IF e ? 'condition' AND e -> 'condition' <> 'null'::jsonb
           AND jsonb_typeof(e -> 'condition') <> 'object' THEN
            RAISE EXCEPTION 'step % condition must be a JSON object', n / 10
                USING ERRCODE = '22023';
        END IF;

        v_roles := COALESCE(
            (SELECT array_agg(x) FROM jsonb_array_elements_text(
                 CASE WHEN jsonb_typeof(e -> 'allowed_roles') = 'array'
                      THEN e -> 'allowed_roles' ELSE '[]'::jsonb END) x),
            '{}'::text[]);

        INSERT INTO public.production_route_stages
            (route_id, stage_id, mode, step_no, variant_label, name_override,
             allowed_roles, driven_by, condition, execution_override, supplier_override,
             advance_mode, on_fail_goto_stage_id, parallel_group,
             standard_minutes_per_unit, standard_cost_per_unit)
        VALUES
            (p_route_id, v_stage, 'included', n,
             NULLIF(e ->> 'variant_label', ''),
             NULLIF(e ->> 'name_override', ''),
             v_roles,
             NULLIF(e ->> 'driven_by', ''),
             CASE WHEN e -> 'condition' IS NOT NULL
                   AND e -> 'condition' <> 'null'::jsonb
                  THEN e -> 'condition' END,
             NULLIF(e ->> 'execution', ''),
             NULLIF(e ->> 'supplier_id', '')::uuid,
             NULLIF(e ->> 'advance_mode', ''),
             NULLIF(e ->> 'on_fail_goto_stage_id', '')::uuid,
             NULLIF(e ->> 'parallel_group', '')::integer,
             NULLIF(e ->> 'standard_minutes_per_unit', '')::numeric,
             NULLIF(e ->> 'standard_cost_per_unit', '')::numeric);
    END LOOP;

    SELECT COUNT(*)::int INTO v_count
      FROM public.production_route_stages WHERE route_id = p_route_id;

    UPDATE public.production_routes
       SET version = version + 1
     WHERE id = p_route_id;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.save_route_steps(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_route_steps(UUID, JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. The default route, as today's reality actually looks
-- ─────────────────────────────────────────────────────────────────────────
-- Five steps, every one of them observable from the order:
--
--   design         split cases only        the designer's own dashboard
--   external_full  the vendor's window     <- the number this is all for
--   doctor_review  try-ins only            the doctor has the try-in
--   external_full  try-ins only            the vendor finishes it
--   shipping       out to the doctor
--
-- Two vendor passes rather than one is what lets doctor time be cut out of the
-- vendor's turnaround instead of blamed on them -- the same separation the
-- historical backfill went to such lengths to preserve for old cases.

DO $$
DECLARE
    v_fallback UUID;
BEGIN
    SELECT id INTO v_fallback FROM public.production_routes
     WHERE is_fallback AND is_active LIMIT 1;

    IF v_fallback IS NULL THEN
        RETURN;
    END IF;

    UPDATE public.production_routes
       SET notes = 'المسار الافتراضي لأي خدمة لسه متحددلهاش خريطة. كل خطواته '
                   || 'بتتحرك من حالة الأوردر نفسها — محدش بيدوس أي زرار زيادة.'
     WHERE id = v_fallback;

    DELETE FROM public.production_route_stages WHERE route_id = v_fallback;

    INSERT INTO public.production_route_stages
        (route_id, stage_id, mode, step_no, variant_label, condition,
         allowed_roles, driven_by)
    SELECT v_fallback, s.id, 'included', v.step_no, v.variant, v.cond,
           v.roles, v.driver
      FROM (VALUES
        ('design',        10, NULL::text,
         '{"workflow_type":"split"}'::jsonb, ARRAY['designer','admin'], 'designer_dashboard'),
        ('external_full', 20, 'الشغل عند المعمل الخارجي',
         NULL::jsonb, '{}'::text[], 'order_status'),
        ('doctor_review', 30, NULL,
         '{"delivery_type":"TryIn"}'::jsonb, '{}'::text[], 'order_status'),
        ('external_full', 40, 'الفاينال بعد التراي إن',
         '{"delivery_type":"TryIn"}'::jsonb, '{}'::text[], 'order_status'),
        ('shipping',      50, NULL,
         NULL::jsonb, '{}'::text[], 'order_status')
      ) AS v(code, step_no, variant, cond, roles, driver)
      JOIN public.production_stages s ON s.code = v.code;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Reading the chain back into a status
-- ─────────────────────────────────────────────────────────────────────────
-- The inverse of section 6. If the two disagree, the shadow report reports a
-- difference that is really a translation error, and the cutover decision gets
-- made on noise.
--
-- Two refinements over the previous version, both forced by the outsourced
-- route having no QC or packaging step to lean on:
--   * doctor_review on a try-in reads as try_in_ready. That IS what the lab
--     calls "with the doctor"; waiting_doctor exists in the enum but has never
--     been used on a single order.
--   * an external pass that comes AFTER the doctor has already had it is
--     finalisation, not production. Same stage, different meaning, and only
--     its position can tell them apart.

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
    v_total     INTEGER;
    v_code      TEXT;
    v_seq       INTEGER;
    v_delivery  TEXT;
    v_doc_done  BOOLEAN;
BEGIN
    SELECT COUNT(*) FILTER (WHERE r.status <> 'skipped')
      INTO v_total
      FROM public.production_stage_runs r
      JOIN public.production_jobs j ON j.id = r.job_id
     WHERE j.order_id = p_order_id AND NOT j.is_backfilled;

    IF COALESCE(v_total, 0) = 0 THEN
        RETURN NULL;
    END IF;

    SELECT o.delivery_type INTO v_delivery FROM public.orders o WHERE o.id = p_order_id;

    -- The earliest stage still open decides where the case is. Looking across
    -- ALL of the order's jobs keeps a two-route order only as far along as its
    -- slowest half.
    SELECT s.code, r.seq INTO v_code, v_seq
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

    -- Has the doctor already had it? Only then is an outside pass a finalisation.
    SELECT EXISTS (
        SELECT 1
          FROM public.production_stage_runs r
          JOIN public.production_jobs j ON j.id = r.job_id
          JOIN public.production_stages s ON s.id = r.stage_id
         WHERE j.order_id = p_order_id AND NOT j.is_backfilled
           AND s.code = 'doctor_review' AND r.status = 'done'
           AND r.seq < v_seq)
      INTO v_doc_done;

    RETURN CASE v_code
        WHEN 'design'        THEN 'designing'
        WHEN 'doctor_review' THEN CASE WHEN v_delivery = 'TryIn' THEN 'try_in_ready'
                                       ELSE 'waiting_doctor' END
        WHEN 'external_full' THEN CASE WHEN v_doc_done THEN 'finalization'
                                       ELSE 'in_production' END
        WHEN 'qc'            THEN CASE WHEN v_delivery = 'TryIn' AND NOT v_doc_done
                                       THEN 'try_in_ready' ELSE 'finalization' END
        WHEN 'packaging'     THEN 'final_ready'
        WHEN 'shipping'      THEN 'final_ready'
        ELSE 'in_production'
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_production_status_from_stages(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_production_status_from_stages(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. The reconciler
-- ─────────────────────────────────────────────────────────────────────────

-- Only cases created from the moment this ships are measured. Everything older
-- has already spent part of its life at a vendor with nothing recording when,
-- and a chain stamped NOW() would read as a case that took no time at all.
INSERT INTO public.app_settings (key, value)
VALUES ('production_autostart_since', NOW()::text)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_production_from_order(p_order_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    o        public.orders;
    v_job    UUID;
    v_since  TIMESTAMPTZ;
    v_status TEXT;
    v_target INTEGER;
    v_now    TIMESTAMPTZ := NOW();
    v_design INTEGER;
    v_ext1   INTEGER;
    v_ext2   INTEGER;
    v_doctor INTEGER;
    v_ship   INTEGER;
    v_last   INTEGER;
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

    -- Cancelled and lab-rejected cases were never worked. Counting their window
    -- as a vendor turnaround would drag the baseline the new lab is judged
    -- against, so the chain is closed out rather than measured.
    IF COALESCE(o.issue_state, 'none') IN ('cancelled', 'lab_rejected') THEN
        IF v_job IS NOT NULL THEN
            UPDATE public.production_stage_runs
               SET status = 'skipped'
             WHERE job_id = v_job
               AND status IN ('pending', 'ready', 'in_progress', 'waiting_external');

            UPDATE public.production_jobs
               SET status = 'cancelled', completed_at = COALESCE(completed_at, v_now)
             WHERE id = v_job AND status <> 'done';
        END IF;
        RETURN v_job;
    END IF;

    v_status := COALESCE(o.production_status, 'not_started');

    IF v_job IS NULL THEN
        SELECT value::timestamptz INTO v_since
          FROM public.app_settings WHERE key = 'production_autostart_since';

        -- Nothing is invented for a case whose vendor window is already partly
        -- spent, or already over.
        IF v_since IS NULL
           OR o.created_at < v_since
           -- not_started IS eligible, and is the common case: a full-lab order
           -- is at the vendor from the moment it is registered, which is the
           -- moment its status is still not_started. Leaving it out would mean
           -- no new case is ever measured.
           OR v_status NOT IN ('not_started', 'designing', 'in_production') THEN
            RETURN NULL;
        END IF;

        v_job := public.materialize_job_from_route(p_order_id, NULL, NULL, 1);
    END IF;

    -- Where each landmark sits on THIS case's chain. A final-delivery case has
    -- no doctor_review and only one outside pass, so the coalescing below is
    -- what keeps the mapping honest instead of pointing at a step that is not
    -- there.
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

    -- final_delivered: the whole chain is behind us.
    IF v_target IS NULL THEN
        UPDATE public.production_stage_runs
           SET status       = 'done',
               queued_at    = COALESCE(queued_at, o.created_at),
               started_at   = COALESCE(started_at, queued_at, o.created_at),
               completed_at = COALESCE(completed_at, v_now),
               units_passed = CASE WHEN units_passed = 0 THEN units_in ELSE units_passed END
         WHERE job_id = v_job AND status NOT IN ('done', 'skipped');

        UPDATE public.production_jobs
           SET status = 'done', completed_at = COALESCE(completed_at, v_now)
         WHERE id = v_job AND status <> 'done';

        RETURN v_job;
    END IF;

    -- Everything before the case's current position is finished. This closes
    -- the vendor's window at the exact moment the status moved past it, which
    -- is the whole measurement.
    UPDATE public.production_stage_runs
       SET status       = 'done',
           queued_at    = COALESCE(queued_at, o.created_at),
           started_at   = COALESCE(started_at, queued_at, o.created_at),
           completed_at = COALESCE(completed_at, v_now),
           units_passed = CASE WHEN units_passed = 0 THEN units_in ELSE units_passed END
     WHERE job_id = v_job AND seq < v_target AND status NOT IN ('done', 'skipped');

    -- The current step is open. An external step becomes 'waiting_external' and
    -- its clock starts immediately: the vendor has the case from the moment the
    -- status says so, and there is no separate "they picked it up" signal.
    -- A step somebody actually works is left at 'ready' for its own screen to
    -- start -- otherwise this would be the second thing driving it.
    UPDATE public.production_stage_runs r
       SET status = CASE
               WHEN r.driven_by <> 'order_status' AND r.status = 'pending' THEN 'ready'
               WHEN r.driven_by <> 'order_status' THEN r.status
               WHEN r.execution = 'external' THEN 'waiting_external'
               ELSE 'in_progress' END,
           queued_at = COALESCE(r.queued_at, v_now),
           started_at = CASE
               WHEN r.driven_by <> 'order_status' THEN r.started_at
               ELSE COALESCE(r.started_at, r.queued_at, v_now) END,
           completed_at = NULL
     WHERE r.job_id = v_job AND r.seq = v_target AND r.status <> 'skipped';

    -- Anything after it has not happened. A case corrected backwards must not
    -- keep the completion stamps it picked up on the way forward.
    UPDATE public.production_stage_runs
       SET status = 'pending', queued_at = NULL, started_at = NULL,
           completed_at = NULL, units_passed = 0
     WHERE job_id = v_job AND seq > v_target AND status <> 'skipped';

    UPDATE public.production_jobs
       SET status = 'active',
           started_at = COALESCE(started_at, o.created_at),
           completed_at = NULL
     WHERE id = v_job AND status <> 'cancelled';

    RETURN v_job;
END;
$$;

COMMENT ON FUNCTION public.sync_production_from_order(UUID) IS
'Moves the order''s stage chain to the position its production_status implies. Idempotent, and never writes production_status back.';

REVOKE ALL ON FUNCTION public.sync_production_from_order(UUID) FROM PUBLIC, anon;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. The trigger
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_sync_production_from_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    -- apply_production_status_from_stages writes production_status once the
    -- cutover flag is on, which would re-enter this trigger. One level of
    -- nesting is the real edit; anything deeper is the echo.
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL;
    END IF;

    -- DELIBERATE SWALLOW. This is a measurement subsystem behind a flag that is
    -- off: nothing any user sees depends on it. An exception here would abort
    -- the enclosing statement, which is somebody saving an order -- so a bug in
    -- the reconciler would stop the lab taking cases. The warning goes to the
    -- Postgres log, and a case that failed to sync shows up as a gap in the
    -- shadow report rather than as a broken save.
    BEGIN
        PERFORM public.sync_production_from_order(NEW.id);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'sync_production_from_order(%) failed: %', NEW.id, SQLERRM;
    END;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_drives_production ON public.orders;
CREATE TRIGGER trg_order_drives_production
    AFTER INSERT OR UPDATE OF production_status, issue_state, design_submitted_at,
                              delivery_type, workflow_type, is_deleted
    ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.trg_sync_production_from_order();

REVOKE ALL ON FUNCTION public.trg_sync_production_from_order() FROM PUBLIC, anon;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. The cases already in the building
-- ─────────────────────────────────────────────────────────────────────────
-- Only the ones sitting at not_started: nothing has happened to them yet, so
-- starting their clock now loses nothing. A case already at designing or
-- in_production has an unknown amount of its window already spent, and is left
-- alone rather than recorded as having taken less time than it did.

DO $$
DECLARE
    o public.orders;
    n INTEGER := 0;
BEGIN
    FOR o IN
        SELECT ord.* FROM public.orders ord
         WHERE COALESCE(ord.is_deleted, FALSE) = FALSE
           AND COALESCE(ord.issue_state, 'none') NOT IN ('cancelled', 'lab_rejected')
           AND ord.production_status = 'not_started'
           AND NOT EXISTS (SELECT 1 FROM public.production_jobs j
                            WHERE j.order_id = ord.id AND NOT j.is_backfilled)
    LOOP
        BEGIN
            PERFORM public.materialize_job_from_route(o.id, NULL, NULL, 1);
            PERFORM public.sync_production_from_order(o.id);
            n := n + 1;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'could not start measuring order %: %', o.id, SQLERRM;
        END;
    END LOOP;

    RAISE NOTICE 'Started measuring % order(s) that were still at not_started.', n;
END;
$$;

COMMIT;
