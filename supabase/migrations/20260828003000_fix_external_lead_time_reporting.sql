-- The three lead-time RPCs said 79 days where the real number is 7.7.
--
-- ROOT CAUSE, CONFIRMED WITH THE OWNER 2026-08-28: not organic slow cases.
-- 364 of the 779 historical `whole_case_only` jobs share ONE IDENTICAL
-- completion instant (2026-07-30 18:33:28.161247+00) despite being created on
-- four different dates spread across January and February. That is a single
-- bulk status-history cleanup, not 364 cases finishing at once. The owner
-- confirmed: "كان تسجيل متأخر بس" -- delayed DATA ENTRY, not a delayed
-- delivery. Any duration computed from these timestamps is fabricated.
--
-- SEPARATELY, AND JUST AS REAL: `external_measurable` and `whole_case_only`
-- measure two DIFFERENT things and must never be averaged together --
-- documented in 20260821003000 itself ("TWO AVERAGES, NEVER ONE") but never
-- implemented by the phase-6 RPCs that shipped in 20260827004000:
--
--   split_handoff (external_measurable): our designer handed off first, so
--     the clock is the vendor's OWN production time.
--   full_lab (whole_case_only): no design step of ours exists on the job, so
--     the clock runs from registration -- which the owner confirmed IS the
--     handoff moment ("مجرد ما تترفع عالسيستم يبقى احنا كنا بلغناهم بيها"),
--     because we register the case, not the doctor, at the same moment we
--     transfer it to the vendor. This measures a bigger, legitimate thing:
--     the vendor's own design-plus-production time.
--
-- These generalise cleanly to LIVE data with no history_class needed at all:
-- a job either has a design stage_run (split) or it does not (full-lab) --
-- exactly what 20260827000000's sync_production_from_order already builds.
--
-- WHAT THIS MIGRATION TOUCHES AND WHY IT STOPS THERE
--   get_production_capacity_and_bottlenecks: UNCHANGED. Its stage_durations
--     CTE already filters execution='internal' only, so external timing (the
--     one thing broken here) never reaches it.
--   get_team_throughput_and_productivity: UNCHANGED. Default 30-day window
--     never reaches back to the January/February contamination; not part of
--     what the owner asked fixed.
--   get_supplier_lead_time_analytics: REWRITTEN. It sourced from
--     external_work_orders, which has ZERO rows in production -- the
--     send/receive screen was never used once whole-case outsourcing started
--     flowing through order status instead. It always returned an empty
--     list. Now sources from stage_runs directly, split into the two
--     buckets above. Output shape changes (two buckets, not one flat set of
--     fields) -- DesignerStats.tsx and capacityService.ts are updated in the
--     same change.
--   estimate_order_delivery_time: REWRITTEN, but its call signature and JSON
--     shape are UNCHANGED -- it is already wired into DesignerStats.tsx's
--     estimator, so changing its contract would be a second bug on top of
--     the first. Two internal fixes: (1) it now walks get_effective_route_
--     stages() instead of raw production_route_stages, so a stage whose
--     condition does not match (e.g. doctor_review on a non-try-in) is
--     correctly excluded instead of always being charged; (2) external
--     stages are now measured wall-clock and, for external_full
--     specifically, sourced from the full_lab bucket with the contamination
--     excluded, instead of working_minutes_between over unfiltered history.
--   Projecting the promise forward also had a latent bug this surfaces:
--     the old code summed every stage's minutes into one number and ran the
--     WHOLE thing through add_working_minutes() (skips nights/weekends).
--     That is correct for internal stages and wrong for external ones -- a
--     7-day wall-clock vendor wait would stretch into many more calendar
--     days once forced through our shift calendar. The estimate now walks
--     the chain stage by stage, advancing the clock through working minutes
--     for internal stages and through plain elapsed time for external ones.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Reliable external_full samples, in one place
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_reliable_external_lead_time_samples(
    p_since TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    job_id              UUID,
    order_id            UUID,
    supplier_id         UUID,
    bucket              TEXT,
    wall_clock_minutes  NUMERIC,
    units_in            INTEGER,
    completed_at        TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH ext AS (
        SELECT
            r.job_id, j.order_id, r.supplier_id, r.units_in, r.completed_at,
            EXTRACT(EPOCH FROM (r.completed_at - r.queued_at)) / 60.0 AS wall_clock_minutes,
            -- The bucket a job falls into is structural, not a label someone
            -- typed: does it have a design run at all? Historical
            -- external_measurable jobs always got one inserted (20260821003000);
            -- historical whole_case_only jobs never did; a live split order's
            -- job has one (even mid-flight), a live full order's job never
            -- does, because the route excludes it by condition.
            EXISTS (
                SELECT 1 FROM public.production_stage_runs dr
                  JOIN public.production_stages ds ON ds.id = dr.stage_id
                 WHERE dr.job_id = r.job_id AND ds.code = 'design'
            ) AS has_design,
            j.history_class, j.data_quality
        FROM public.production_stage_runs r
        JOIN public.production_jobs j ON j.id = r.job_id
        JOIN public.production_stages s ON s.id = r.stage_id
        JOIN public.orders o ON o.id = j.order_id
        WHERE s.code = 'external_full'
          AND r.status = 'done'
          AND r.queued_at IS NOT NULL AND r.completed_at IS NOT NULL
          AND r.completed_at > r.queued_at
          AND (p_since IS NULL OR r.completed_at >= p_since)
          -- A historical try-in whose doctor window could not be reconstructed
          -- (20260821003000's 'partial' class) has the doctor's wait baked
          -- into the vendor number with no way to subtract it back out.
          AND j.data_quality IS DISTINCT FROM 'partial'
          -- Same problem, unlabelled: the backfill only ever split the
          -- doctor's window out of the external_measurable branch. A
          -- whole_case_only try-in's single span still contains it.
          -- COALESCE guards live rows, where history_class is NULL.
          AND NOT (COALESCE(j.history_class, '') = 'whole_case_only'
                   AND o.delivery_type = 'TryIn')
    ),
    contamination AS (
        -- One instant standing in for dozens of otherwise-unrelated orders is
        -- a single UPDATE statement, not that many cases closing at once.
        -- Confirmed 2026-08-28: a bulk status cleanup on 2026-07-30 stamped
        -- 364 stale legacy orders with one shared delivery timestamp. The
        -- threshold sits between the largest known-honest same-instant
        -- cluster (13, an `actual_delivery_date` date-cast to midnight) and
        -- the contamination event (364), and needs no hardcoded date -- any
        -- future bulk cleanup lands the same way.
        SELECT completed_at FROM ext GROUP BY completed_at HAVING COUNT(*) > 20
    )
    SELECT e.job_id, e.order_id, e.supplier_id,
           CASE WHEN e.has_design THEN 'split_handoff' ELSE 'full_lab' END,
           e.wall_clock_minutes, e.units_in, e.completed_at
      FROM ext e
     WHERE e.completed_at NOT IN (SELECT completed_at FROM contamination);
$$;

COMMENT ON FUNCTION public.get_reliable_external_lead_time_samples(TIMESTAMPTZ) IS
'Wall-clock external_full durations, bucketed into split_handoff (design ours first) vs full_lab (registration is the handoff). Excludes partial try-in samples and any bulk-cleanup timestamp cluster. Never average the two buckets together.';

REVOKE ALL ON FUNCTION public.get_reliable_external_lead_time_samples(TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reliable_external_lead_time_samples(TIMESTAMPTZ) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Supplier lead time -- two numbers, sourced from real stage runs
-- ─────────────────────────────────────────────────────────────────────────
-- external_work_orders has zero rows in production: the send/receive screen
-- was never used once whole-case outsourcing started flowing through order
-- status (20260827000000). This used to always return "suppliers": [].
CREATE OR REPLACE FUNCTION public.get_supplier_lead_time_analytics(
    p_start_date DATE DEFAULT NULL,
    p_end_date   DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT;
    v_start DATE;
    v_end DATE;
    v_suppliers_json JSONB;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'lab', 'accountant') THEN
        RAISE EXCEPTION 'Forbidden: insufficient privileges' USING ERRCODE = '42501';
    END IF;

    v_start := COALESCE(p_start_date, (CURRENT_DATE - INTERVAL '90 days')::date);
    v_end   := COALESCE(p_end_date, CURRENT_DATE);

    WITH samples AS (
        SELECT * FROM public.get_reliable_external_lead_time_samples(v_start::timestamptz)
         WHERE completed_at::date <= v_end
    ),
    per_bucket AS (
        SELECT
            supplier_id, bucket,
            COUNT(*)::int AS sample_size,
            ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY wall_clock_minutes) / 1440.0)::numeric, 1) AS p50_days,
            ROUND((percentile_cont(0.8) WITHIN GROUP (ORDER BY wall_clock_minutes) / 1440.0)::numeric, 1) AS p80_days,
            ROUND((AVG(wall_clock_minutes) / 1440.0)::numeric, 1) AS avg_days
        FROM samples
        WHERE supplier_id IS NOT NULL
        GROUP BY supplier_id, bucket
    ),
    supplier_rollup AS (
        SELECT
            s.id AS supplier_id,
            s.name AS supplier_name,
            jsonb_build_object(
                'sample_size', COALESCE(hs.sample_size, 0),
                'is_low_sample', COALESCE(hs.sample_size, 0) < 20,
                'p50_days', hs.p50_days, 'p80_days', hs.p80_days, 'avg_days', hs.avg_days
            ) AS split_handoff,
            jsonb_build_object(
                'sample_size', COALESCE(fl.sample_size, 0),
                'is_low_sample', COALESCE(fl.sample_size, 0) < 20,
                'p50_days', fl.p50_days, 'p80_days', fl.p80_days, 'avg_days', fl.avg_days
            ) AS full_lab
        FROM public.suppliers s
        LEFT JOIN per_bucket hs ON hs.supplier_id = s.id AND hs.bucket = 'split_handoff'
        LEFT JOIN per_bucket fl ON fl.supplier_id = s.id AND fl.bucket = 'full_lab'
        WHERE hs.supplier_id IS NOT NULL OR fl.supplier_id IS NOT NULL
    )
    SELECT COALESCE(jsonb_agg(row_to_json(supplier_rollup)), '[]'::jsonb)
      INTO v_suppliers_json
      FROM supplier_rollup;

    RETURN jsonb_build_object(
        'period', jsonb_build_object('start_date', v_start, 'end_date', v_end),
        'note', 'split_handoff = pure vendor time after our own design; full_lab = registration to delivery, includes design the vendor did themselves. Never average the two.',
        'suppliers', v_suppliers_json
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_supplier_lead_time_analytics(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_supplier_lead_time_analytics(DATE, DATE) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Delivery estimate -- same call signature and JSON shape, correct clock
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.estimate_order_delivery_time(
    p_service_id UUID,
    p_units      INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT;
    v_route_id UUID;
    v_units INTEGER := GREATEST(COALESCE(p_units, 1), 1);
    v_cursor TIMESTAMPTZ := now();
    v_sample_size INTEGER;
    v_stages_without_history INTEGER := 0;
    v_confidence TEXT;
    v_stage_records JSONB := '[]'::jsonb;
    v_stage_minutes NUMERIC;
    r RECORD;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'lab', 'technician', 'accountant', 'representative', 'designer', 'doctor') THEN
        RAISE EXCEPTION 'Forbidden: insufficient privileges' USING ERRCODE = '42501';
    END IF;

    SELECT route_id INTO v_route_id FROM public.services WHERE id = p_service_id;
    IF v_route_id IS NULL THEN
        SELECT id INTO v_route_id FROM public.production_routes
         WHERE is_active = true ORDER BY is_fallback DESC, created_at ASC LIMIT 1;
    END IF;

    -- Full-lab, final delivery: no service on record distinguishes split vs
    -- full or try-in vs final, so this is the plain majority case (431 of
    -- 718 classified historical orders) rather than a guess. get_effective_
    -- route_stages -- not a raw production_route_stages scan -- so a
    -- condition that does not match (design on a full-lab context,
    -- doctor_review on a final delivery) is excluded exactly as production
    -- would build it, instead of always being charged to every quote.
    FOR r IN
        WITH chain AS (
            SELECT * FROM public.get_effective_route_stages(
                v_route_id,
                jsonb_build_object('workflow_type', 'full', 'delivery_type', 'Final'))
        ),
        ext_full_samples AS (
            SELECT wall_clock_minutes, units_in
              FROM public.get_reliable_external_lead_time_samples(now() - INTERVAL '180 days')
             WHERE bucket = 'full_lab'
        )
        SELECT
            c.seq, c.stage_id, c.name_ar AS stage_name, c.stage_code, c.execution,
            CASE
                WHEN c.execution = 'external' AND c.stage_code = 'external_full' THEN
                    (SELECT COUNT(*)::int FROM ext_full_samples)
                ELSE
                    (SELECT COUNT(*)::int FROM public.production_stage_runs psr
                      WHERE psr.stage_id = c.stage_id AND psr.status = 'done'
                        AND psr.completed_at > now() - INTERVAL '90 days'
                        AND EXISTS (SELECT 1 FROM public.production_jobs pj
                                     WHERE pj.id = psr.job_id AND pj.route_id = v_route_id))
            END AS samples,
            -- p80 minutes per unit. Internal stages: working minutes, on our
            -- calendar (unchanged, and correct). External stages: WALL CLOCK
            -- (plan rule 3, "المراحل الخارجية مالهاش تقويم") -- a vendor's
            -- weekend is real turnaround time, not time to strip out.
            -- external_full alone also needs the bucket split, because it is
            -- the one stage with a historical split_handoff/full_lab past;
            -- every other external stage (shipping, doctor_review) has no
            -- such history to confuse.
            CASE
                WHEN c.execution = 'external' AND c.stage_code = 'external_full' THEN
                    COALESCE(
                        (SELECT percentile_cont(0.80) WITHIN GROUP (
                             ORDER BY wall_clock_minutes / GREATEST(units_in, 1))
                           FROM ext_full_samples),
                        c.standard_minutes_per_unit, 30)
                WHEN c.execution = 'external' THEN
                    COALESCE(
                        (SELECT percentile_cont(0.80) WITHIN GROUP (
                             ORDER BY EXTRACT(EPOCH FROM (psr.completed_at - psr.queued_at)) / 60.0
                                      / GREATEST(psr.units_in, 1))
                           FROM public.production_stage_runs psr
                          WHERE psr.stage_id = c.stage_id AND psr.status = 'done'
                            AND psr.completed_at > now() - INTERVAL '90 days'
                            AND EXISTS (SELECT 1 FROM public.production_jobs pj
                                         WHERE pj.id = psr.job_id AND pj.route_id = v_route_id)),
                        c.standard_minutes_per_unit, 30)
                ELSE
                    COALESCE(
                        (SELECT percentile_cont(0.80) WITHIN GROUP (
                             ORDER BY GREATEST(1, public.working_minutes_between(psr.queued_at, psr.completed_at))
                                      / GREATEST(psr.units_in, 1))
                           FROM public.production_stage_runs psr
                          WHERE psr.stage_id = c.stage_id AND psr.status = 'done'
                            AND psr.completed_at > now() - INTERVAL '90 days'
                            AND EXISTS (SELECT 1 FROM public.production_jobs pj
                                         WHERE pj.id = psr.job_id AND pj.route_id = v_route_id)),
                        c.standard_minutes_per_unit, 30)
            END AS p80_minutes_per_unit
        FROM chain c
        ORDER BY c.seq
    LOOP
        v_stage_minutes := r.p80_minutes_per_unit * v_units;

        v_sample_size := CASE WHEN v_sample_size IS NULL THEN r.samples
                               ELSE LEAST(v_sample_size, r.samples) END;
        IF r.samples = 0 THEN
            v_stages_without_history := v_stages_without_history + 1;
        END IF;

        v_stage_records := v_stage_records || jsonb_build_array(jsonb_build_object(
            'stage_name', r.stage_name, 'stage_code', r.stage_code, 'execution', r.execution,
            'p80_minutes_per_unit', ROUND(r.p80_minutes_per_unit::numeric, 0),
            'p80_minutes', ROUND(v_stage_minutes::numeric, 0),
            'samples_count', r.samples, 'is_estimated', (r.samples = 0)
        ));

        -- Two different clocks, walked in order rather than blended: internal
        -- work only advances while the lab is open; a vendor's clock runs
        -- through the night and the weekend regardless. Summing both into one
        -- number and running the total through the work calendar would
        -- stretch a 7-day wall-clock vendor wait into many more calendar days.
        IF r.execution = 'internal' THEN
            v_cursor := public.add_working_minutes(v_cursor, v_stage_minutes);
        ELSE
            -- make_interval's mins parameter is integer; seconds is the only
            -- fractional slot, same convention as add_working_minutes above.
            v_cursor := v_cursor + make_interval(secs => (v_stage_minutes * 60)::double precision);
        END IF;

        EXIT WHEN v_cursor IS NULL;  -- no work calendar configured; unmeasurable past this point
    END LOOP;

    v_sample_size := COALESCE(v_sample_size, 0);

    IF v_stages_without_history > 0 OR v_sample_size < 15 THEN
        v_confidence := 'default_estimate';
    ELSIF v_sample_size >= 50 THEN
        v_confidence := 'high';
    ELSE
        v_confidence := 'moderate';
    END IF;

    RETURN jsonb_build_object(
        'service_id', p_service_id,
        'units', v_units,
        -- Elapsed minutes to the promise, not "working minutes": a full-lab
        -- chain here is entirely external, so calling this figure "work" was
        -- never honest for the common case.
        'total_working_minutes', CASE WHEN v_cursor IS NULL THEN NULL
                                       ELSE ROUND(EXTRACT(EPOCH FROM (v_cursor - now())) / 60.0, 0) END,
        'total_working_hours', CASE WHEN v_cursor IS NULL THEN NULL
                                     ELSE ROUND(EXTRACT(EPOCH FROM (v_cursor - now())) / 3600.0, 1) END,
        'estimated_delivery_date', v_cursor::date,
        'estimated_delivery_at', v_cursor,
        'estimated_calendar_days', CASE WHEN v_cursor IS NULL THEN NULL
                                         ELSE GREATEST(1, (v_cursor::date - CURRENT_DATE)) END,
        'confidence_level', v_confidence,
        'sample_size', v_sample_size,
        'stages_without_history', v_stages_without_history,
        'stages_breakdown', v_stage_records
    );
END;
$$;

REVOKE ALL ON FUNCTION public.estimate_order_delivery_time(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estimate_order_delivery_time(UUID, INTEGER) TO authenticated;

COMMIT;
