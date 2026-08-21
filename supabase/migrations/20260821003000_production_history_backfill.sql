-- Historical production backfill, and the "at the doctor" stage.
-- Internal lab plan, phase 0, final item.
--
-- WHY THIS IS NOT "GENERATE SYNTHETIC STAGE RUNS"
--   The plan originally said to synthesise jobs and stage runs for old orders.
--   That was wrong and this migration does not do it. There were no internal
--   stages before the lab existed: no finishing, no glaze, no QC. Inventing
--   durations for them would put fabricated numbers underneath the very
--   reports meant to judge the new lab -- and the project's own rule is that
--   a missing number is shown as missing, never filled in.
--
--   What DID happen is recorded and is worth keeping: our designers really did
--   design, and the outside labs really did take however long they took.
--
-- MEASURED COVERAGE, from production on 2026-08-21 (1152 live orders):
--   external_measurable  277   designer + design_submitted_at, from 2026-04-19
--   whole_case_only      763   no designer of ours; the case sat as "New Case"
--                              while the outside lab already had it
--   no_timeline           96   nothing usable
--   partial               16
--
-- TWO AVERAGES, NEVER ONE
--   A whole_case_only duration contains our intake time, the vendor's unknown
--   start, their work and the return. Averaging it together with a genuinely
--   measured vendor window would blame the vendor for our own delays -- and
--   then the "internal vs external" comparison would flatter the new lab for
--   the wrong reason. So the two classes are labelled and must be averaged
--   separately:
--     supplier turnaround  <- external_measurable ONLY   (277 cases)
--     service lead time    <- both classes               (1040 cases)
--   The second is what a doctor is actually asking when they ask how long it
--   takes, so the quoting feature has a real baseline from day one.
--
-- TRY-IN: TIME AT THE DOCTOR IS NOBODY'S WORK
--   38 of the 277 measurable cases are try-ins (14%). While a try-in sits with
--   the doctor, neither we nor the milling house are working on it. Leaving
--   that inside the vendor window would inflate the supplier p80 on a seventh
--   of the sample. Where the events exist, the window is cut out and recorded
--   as its own doctor_review stage; where they do not, the case is downgraded
--   to 'partial' and dropped from the supplier average rather than counted
--   wrong. Losing 38 honest cases beats poisoning the other 239.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. The missing stage: the case is at the doctor
-- ─────────────────────────────────────────────────────────────────────────
-- The phase-0 catalogue had no stage for this, so a week spent at a doctor's
-- clinic would have landed on whichever stage came next and shown up as a
-- phantom bottleneck in finishing.
--
-- execution='external' is the load-bearing part: it means our shift calendar
-- is never applied to it (plan 6.2). A dentist's opening hours are no more
-- ours than a milling house's.
INSERT INTO public.production_stages
    (code, name_ar, sequence, scope, default_execution, is_qc_gate, is_batch_stage, required_fields)
VALUES
    ('doctor_review', 'عند الطبيب (تراي إن)', 110, 'optional', 'external', FALSE, FALSE, '[]'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Provenance columns — every historical row says how good it is
-- ─────────────────────────────────────────────────────────────────────────
-- measured    every boundary came from a recorded event
-- derived     the total is real but the internal split is inferred
-- partial     a needed boundary is missing; excluded from averages
-- no_timeline no usable timestamps at all; timings are NULL, not guessed

ALTER TABLE public.production_jobs
    ADD COLUMN IF NOT EXISTS data_quality TEXT
        CHECK (data_quality IN ('measured', 'derived', 'partial', 'no_timeline')),
    ADD COLUMN IF NOT EXISTS is_backfilled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS history_class TEXT
        CHECK (history_class IN ('external_measurable', 'whole_case_only', 'no_timeline'));

CREATE INDEX IF NOT EXISTS idx_production_jobs_backfilled
    ON public.production_jobs (history_class) WHERE is_backfilled;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. backfill_production_history()
-- ─────────────────────────────────────────────────────────────────────────
-- Idempotent: an order that already has a backfilled job is skipped, so this
-- can be re-run after a fix without duplicating anything.

CREATE OR REPLACE FUNCTION public.backfill_production_history(
    p_limit INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    o              RECORD;
    v_route        UUID;
    v_stage_design UUID;
    v_stage_ext    UUID;
    v_stage_doc    UUID;
    v_job          UUID;
    v_units        INTEGER;
    v_ready        TIMESTAMPTZ;
    v_ready_src    TEXT;
    v_end          TIMESTAMPTZ;
    v_hold_start   TIMESTAMPTZ;
    v_hold_end     TIMESTAMPTZ;
    v_ext_start    TIMESTAMPTZ;
    v_ext_end      TIMESTAMPTZ;
    v_class        TEXT;
    v_quality      TEXT;
    v_counts       JSONB;
    v_n            INTEGER := 0;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;

    SELECT id INTO v_route FROM public.production_routes
     WHERE is_fallback AND is_active LIMIT 1;
    IF v_route IS NULL THEN
        RAISE EXCEPTION 'no fallback route configured' USING ERRCODE = '22023';
    END IF;

    SELECT id INTO v_stage_design FROM public.production_stages WHERE code = 'design';
    SELECT id INTO v_stage_ext    FROM public.production_stages WHERE code = 'external_full';
    SELECT id INTO v_stage_doc    FROM public.production_stages WHERE code = 'doctor_review';

    FOR o IN
        SELECT ord.*
          FROM public.orders ord
         WHERE COALESCE(ord.is_deleted, FALSE) = FALSE
           AND NOT EXISTS (SELECT 1 FROM public.production_jobs j
                            WHERE j.order_id = ord.id AND j.is_backfilled)
         ORDER BY ord.created_at
         LIMIT p_limit
    LOOP
        -- "Ready" is when the lab finished, which is what we want to judge a
        -- vendor on. Delivery is later by however long our own dispatch took,
        -- so falling back to it is recorded as derived rather than measured.
        SELECT MIN(e.changed_at) INTO v_ready
          FROM public.order_events e
         WHERE e.order_id = o.id AND e.event_type = 'order_ready';

        IF v_ready IS NOT NULL THEN
            v_ready_src := 'measured';
        ELSE
            v_ready     := COALESCE(o.first_delivered_at, o.actual_delivery_date::timestamptz);
            v_ready_src := 'derived';
        END IF;

        v_end := COALESCE(v_ready, o.first_delivered_at, o.actual_delivery_date::timestamptz);

        v_units := GREATEST(COALESCE((SELECT SUM(COALESCE(oi.count, 1))::int
                                        FROM public.order_items oi
                                       WHERE oi.order_id = o.id), 1), 1);

        -- The window the case spent at the doctor, if the events recorded it.
        v_hold_start := NULL;
        v_hold_end   := NULL;
        IF o.delivery_type = 'TryIn' THEN
            SELECT MIN(e.changed_at) INTO v_hold_start
              FROM public.order_events e
             WHERE e.order_id = o.id
               AND e.event_type IN ('try_in_sent', 'waiting_on_doctor_started');

            SELECT MAX(e.changed_at) INTO v_hold_end
              FROM public.order_events e
             WHERE e.order_id = o.id
               AND e.event_type IN ('try_in_approved', 'try_in_adjustment_requested',
                                    'waiting_on_doctor_ended');
        END IF;

        -- ── Classify ────────────────────────────────────────────────────
        IF v_end IS NULL THEN
            v_class   := 'no_timeline';
            v_quality := 'no_timeline';
        ELSIF o.designer_id IS NOT NULL AND o.design_submitted_at IS NOT NULL THEN
            v_class   := 'external_measurable';
            v_quality := v_ready_src;
            -- A try-in whose doctor window cannot be reconstructed keeps the
            -- doctor's waiting time inside the vendor's number. That case is
            -- marked partial and stays out of the supplier average.
            IF o.delivery_type = 'TryIn'
               AND (v_hold_start IS NULL OR v_hold_end IS NULL OR v_hold_end <= v_hold_start) THEN
                v_quality := 'partial';
            END IF;
        ELSE
            -- No designer: the case sat as "New Case" while the outside lab
            -- already had it. The total is real; the split inside it is not
            -- knowable, and pretending otherwise is what this file exists to
            -- avoid.
            v_class   := 'whole_case_only';
            v_quality := 'derived';
        END IF;

        INSERT INTO public.production_jobs
            (order_id, route_id, round_no, unit_count, status, priority,
             due_at, started_at, completed_at,
             is_backfilled, history_class, data_quality)
        VALUES
            (o.id, v_route, 1, v_units,
             CASE WHEN v_end IS NULL THEN 'cancelled' ELSE 'done' END,
             COALESCE(o.priority, 'Normal'),
             o.delivery_date::timestamp AT TIME ZONE 'Africa/Cairo',
             o.created_at, v_end,
             TRUE, v_class, v_quality)
        RETURNING id INTO v_job;

        INSERT INTO public.production_job_items (job_id, order_item_id, units)
        SELECT v_job, oi.id, GREATEST(COALESCE(oi.count, 1), 1)
          FROM public.order_items oi WHERE oi.order_id = o.id;

        IF v_class = 'external_measurable' THEN
            -- Design really was ours, and both ends of it are recorded.
            INSERT INTO public.production_stage_runs
                (job_id, stage_id, seq, execution, status,
                 assignee_id, queued_at, started_at, completed_at,
                 units_in, units_passed, notes)
            VALUES
                (v_job, v_stage_design, 10, 'internal', 'done',
                 o.designer_id, o.created_at, o.created_at, o.design_submitted_at,
                 v_units, v_units, 'backfilled from design_submitted_at');

            v_ext_start := o.design_submitted_at;
            v_ext_end   := v_end;

            -- Cut the doctor's window out of the vendor's, and record it as
            -- its own stage so the time is visible rather than deleted.
            IF v_hold_start IS NOT NULL AND v_hold_end IS NOT NULL
               AND v_hold_end > v_hold_start THEN
                INSERT INTO public.production_stage_runs
                    (job_id, stage_id, seq, execution, status,
                     queued_at, started_at, completed_at,
                     units_in, units_passed, blocked_reason, notes)
                VALUES
                    (v_job, v_stage_doc, 210, 'external', 'done',
                     v_hold_start, v_hold_start, v_hold_end,
                     v_units, v_units, 'waiting_doctor',
                     'backfilled try-in window at the doctor');

                -- The vendor's stretch ends when the case went to the doctor.
                v_ext_end := LEAST(v_ext_end, v_hold_start);
            END IF;

            IF v_ext_start IS NOT NULL AND v_ext_end > v_ext_start THEN
                INSERT INTO public.production_stage_runs
                    (job_id, stage_id, seq, execution, status, supplier_id,
                     queued_at, started_at, completed_at,
                     units_in, units_passed, notes)
                VALUES
                    (v_job, v_stage_ext, 200, 'external', 'done', o.supplier_id,
                     v_ext_start, v_ext_start, v_ext_end,
                     v_units, v_units, 'backfilled outside-lab window');
            END IF;

        ELSIF v_class = 'whole_case_only' THEN
            -- One span, honestly labelled: intake + vendor + return, mixed.
            INSERT INTO public.production_stage_runs
                (job_id, stage_id, seq, execution, status, supplier_id,
                 queued_at, started_at, completed_at,
                 units_in, units_passed, notes)
            VALUES
                (v_job, v_stage_ext, 200, 'external', 'done', o.supplier_id,
                 o.created_at, o.created_at, v_end,
                 v_units, v_units,
                 'backfilled whole-case span: intake, vendor and return are not separable');

        ELSE
            -- Nothing usable. A run with NULL timings, so the case is present
            -- and countable but contributes no duration to anything.
            INSERT INTO public.production_stage_runs
                (job_id, stage_id, seq, execution, status, supplier_id,
                 units_in, notes)
            VALUES
                (v_job, v_stage_ext, 200, 'external', 'skipped', o.supplier_id,
                 v_units, 'no usable timestamps; timings deliberately left NULL');
        END IF;

        v_n := v_n + 1;
    END LOOP;

    SELECT jsonb_object_agg(x.k, x.v) INTO v_counts
      FROM (SELECT history_class || '/' || data_quality AS k, COUNT(*) AS v
              FROM public.production_jobs
             WHERE is_backfilled
             GROUP BY 1) x;

    RETURN jsonb_build_object('backfilled_now', v_n, 'totals', COALESCE(v_counts, '{}'::jsonb));
END;
$$;

COMMENT ON FUNCTION public.backfill_production_history(INTEGER) IS
'Rebuilds historical jobs from real timestamps only. Never invents internal stage durations -- those stages did not exist before the in-house lab. Idempotent.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. What the backfill actually produced — for the UI to show, not hide
-- ─────────────────────────────────────────────────────────────────────────
-- Any report reading the pre-lab period has to state how much of it was
-- measured. This view is the source for that sentence.

CREATE OR REPLACE VIEW public.production_history_quality AS
SELECT
    j.history_class,
    j.data_quality,
    COUNT(*)                                   AS jobs,
    MIN(o.created_at)::date                    AS oldest_order,
    MAX(o.created_at)::date                    AS newest_order,
    -- Only external_measurable + measured/derived may feed a supplier
    -- turnaround average. Everything else is a lead-time datapoint at best.
    BOOL_OR(j.history_class = 'external_measurable'
            AND j.data_quality IN ('measured', 'derived')) AS usable_for_supplier_turnaround
FROM public.production_jobs j
JOIN public.orders o ON o.id = j.order_id
WHERE j.is_backfilled
GROUP BY j.history_class, j.data_quality;

COMMENT ON VIEW public.production_history_quality IS
'Coverage of the historical backfill. Reports covering the pre-lab period must state these counts; only external_measurable rows may be averaged as supplier turnaround.';

REVOKE ALL ON FUNCTION public.backfill_production_history(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backfill_production_history(INTEGER) TO authenticated;
GRANT SELECT ON public.production_history_quality TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Run it once during deployment
-- ─────────────────────────────────────────────────────────────────────────
-- get_my_role() reads a JWT claim, which a migration does not have. The claim
-- is set to an existing admin for the duration of this transaction only. If no
-- admin user exists (a fresh test database), the backfill is skipped with a
-- notice rather than failing the migration -- there is nothing to backfill in
-- that case anyway.

DO $$
DECLARE
    v_admin  TEXT;
    v_result JSONB;
BEGIN
    SELECT auth_id::text INTO v_admin
      FROM public.users
     WHERE role = 'admin' AND auth_id IS NOT NULL
     LIMIT 1;

    IF v_admin IS NULL THEN
        RAISE NOTICE 'production history backfill SKIPPED: no admin user. Call public.backfill_production_history() from the app while signed in as an admin.';
        RETURN;
    END IF;

    PERFORM set_config('request.jwt.claim.sub', v_admin, TRUE);
    v_result := public.backfill_production_history();
    RAISE NOTICE 'production history backfill: %', v_result;
END;
$$;

COMMIT;
