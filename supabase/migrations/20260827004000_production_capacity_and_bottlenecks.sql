-- Phase 6: Capacity, Bottlenecks, Empirical Lead Times & Delivery Date Prediction
-- Migration: 20260827004000_production_capacity_and_bottlenecks.sql

BEGIN;

--------------------------------------------------------------------------------
-- 0. add_working_minutes() -- the forward twin of working_minutes_between()
--------------------------------------------------------------------------------
-- Every duration in this file is measured in WORKING minutes. Turning one back
-- into a date by dividing by 480 and adding calendar days throws that away: an
-- estimate made on a Thursday lands on the weekend, and the promise given to the
-- doctor is wrong by exactly the days the lab is shut. This walks the same
-- calendar forward instead, so a promise is only ever built out of time the lab
-- is actually open.
CREATE OR REPLACE FUNCTION public.add_working_minutes(
    p_from        TIMESTAMPTZ,
    p_minutes     NUMERIC,
    p_calendar_id UUID DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cal       UUID;
    v_remaining NUMERIC := p_minutes;
    v_cursor    TIMESTAMPTZ := p_from;
    v_chunk_end TIMESTAMPTZ;
    v_guard     INT := 0;
    v_len       NUMERIC;
    r           tstzrange;
BEGIN
    IF p_from IS NULL OR p_minutes IS NULL OR p_minutes <= 0 THEN
        RETURN p_from;
    END IF;

    v_cal := COALESCE(
        p_calendar_id,
        (SELECT wc.id FROM public.work_calendars wc
          WHERE wc.is_default AND wc.is_active LIMIT 1));

    -- Same contract as working_minutes_between: no calendar means "not
    -- measurable", never a wall-clock guess.
    IF v_cal IS NULL THEN
        RETURN NULL;
    END IF;

    -- One week per pass. 520 passes is ten years -- a bound only reachable by a
    -- calendar with no open days at all, and returning NULL then is honest
    -- where returning "today" would not be.
    WHILE v_remaining > 0 AND v_guard < 520 LOOP
        v_guard     := v_guard + 1;
        v_chunk_end := v_cursor + INTERVAL '7 days';

        FOR r IN SELECT unnest(public.work_windows(v_cal, v_cursor, v_chunk_end)) LOOP
            v_len := EXTRACT(EPOCH FROM (upper(r) - lower(r))) / 60.0;
            IF v_len >= v_remaining THEN
                RETURN lower(r) + make_interval(secs => (v_remaining * 60)::double precision);
            END IF;
            v_remaining := v_remaining - v_len;
        END LOOP;

        v_cursor := v_chunk_end;
    END LOOP;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.add_working_minutes(TIMESTAMPTZ, NUMERIC, UUID) IS
'Advances an instant by N working minutes on a work calendar. Returns NULL when no calendar is configured, or when the horizon holds no working time -- callers must show that as unmeasurable, never as today.';

REVOKE ALL ON FUNCTION public.add_working_minutes(TIMESTAMPTZ, NUMERIC, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_working_minutes(TIMESTAMPTZ, NUMERIC, UUID) TO authenticated;

--------------------------------------------------------------------------------
-- 1. Atomic RPC: Production Capacity & Bottleneck Analytics
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_production_capacity_and_bottlenecks(
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
    v_stages_json JSONB;
    v_top_bottleneck TEXT := NULL;
    v_total_wip INTEGER := 0;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'lab', 'technician', 'accountant') THEN
        RAISE EXCEPTION 'Forbidden: insufficient privileges' USING ERRCODE = '42501';
    END IF;

    v_start := COALESCE(p_start_date, (CURRENT_DATE - INTERVAL '30 days')::date);
    v_end   := COALESCE(p_end_date, CURRENT_DATE);

    WITH stage_wip AS (
        -- Real-time active queue and WIP
        SELECT 
            psr.stage_id,
            COUNT(DISTINCT psr.id) AS active_runs_count,
            SUM(GREATEST(COALESCE(psr.units_in, 1), 1)) AS active_wip_units
        FROM public.production_stage_runs psr
        JOIN public.production_jobs pj ON pj.id = psr.job_id
        WHERE psr.status IN ('ready', 'in_progress')
          AND pj.status NOT IN ('completed', 'cancelled')
        GROUP BY psr.stage_id
    ),
    stage_downtime AS (
        -- Downtime hours on machines linked to stages in this date range
        SELECT 
            m.stage_id,
            ROUND(SUM(
                EXTRACT(EPOCH FROM (
                    COALESCE(md.ended_at, now()) - md.started_at
                )) / 3600.0
            )::numeric, 1) AS downtime_hours
        FROM public.machine_downtime md
        JOIN public.machines m ON m.id = md.machine_id
        WHERE m.stage_id IS NOT NULL
          AND md.started_at::date >= v_start
          AND md.started_at::date <= v_end
        GROUP BY m.stage_id
    ),
    stage_durations AS (
        -- Completed stage runs measured in working minutes
        SELECT 
            psr.stage_id,
            COUNT(psr.id) AS completed_runs_count,
            SUM(GREATEST(psr.units_passed, 1)) AS total_units_passed,
            SUM(COALESCE(psr.units_failed, 0)) AS total_units_failed,
            SUM(CASE WHEN psr.rework_of IS NOT NULL THEN 1 ELSE 0 END) AS rework_runs_count,
            -- Working minutes: wait, touch, stage
            AVG(
                CASE 
                    WHEN psr.queued_at IS NOT NULL AND psr.started_at IS NOT NULL 
                         AND psr.started_at > psr.queued_at THEN
                        GREATEST(0, public.working_minutes_between(psr.queued_at, psr.started_at))
                    ELSE 0
                END
            ) AS avg_wait_minutes,
            AVG(
                CASE 
                    WHEN psr.started_at IS NOT NULL AND psr.completed_at IS NOT NULL 
                         AND psr.completed_at > psr.started_at THEN
                        GREATEST(1, public.working_minutes_between(psr.started_at, psr.completed_at))
                    ELSE 15
                END
            ) AS avg_touch_minutes,
            AVG(
                CASE 
                    WHEN psr.queued_at IS NOT NULL AND psr.completed_at IS NOT NULL 
                         AND psr.completed_at > psr.queued_at THEN
                        GREATEST(1, public.working_minutes_between(psr.queued_at, psr.completed_at))
                    ELSE 20
                END
            ) AS avg_stage_minutes
        FROM public.production_stage_runs psr
        WHERE psr.execution = 'internal'
          AND psr.status = 'done'
          AND psr.completed_at::date >= v_start
          AND psr.completed_at::date <= v_end
        GROUP BY psr.stage_id
    ),
    combined AS (
        SELECT 
            st.id AS stage_id,
            st.code AS stage_code,
            st.name_ar AS stage_name,
            st.sequence,
            COALESCE(w.active_wip_units, 0) AS active_wip_units,
            COALESCE(w.active_runs_count, 0) AS active_runs_count,
            COALESCE(d.completed_runs_count, 0) AS completed_runs_count,
            ROUND(COALESCE(d.avg_wait_minutes, 0)::numeric, 1) AS avg_wait_minutes,
            ROUND(COALESCE(d.avg_touch_minutes, 15)::numeric, 1) AS avg_touch_minutes,
            ROUND(COALESCE(d.avg_stage_minutes, 20)::numeric, 1) AS avg_stage_minutes,
            ROUND(
                (COALESCE(d.total_units_passed, 1)::numeric / 
                 GREATEST(COALESCE(d.total_units_passed, 1) + COALESCE(d.total_units_failed, 0), 1)) * 100,
                1
            ) AS first_pass_rate_pct,
            ROUND(
                (COALESCE(d.rework_runs_count, 0)::numeric / GREATEST(COALESCE(d.completed_runs_count, 1), 1)) * 100,
                1
            ) AS rework_rate_pct,
            COALESCE(dt.downtime_hours, 0) AS machine_downtime_hours,
            -- Bottleneck score combines queue wait with active WIP
            ROUND(
                (COALESCE(d.avg_wait_minutes, 0) * (COALESCE(w.active_wip_units, 0) + 1))::numeric,
                0
            ) AS bottleneck_score
        FROM public.production_stages st
        LEFT JOIN stage_wip w ON w.stage_id = st.id
        LEFT JOIN stage_durations d ON d.stage_id = st.id
        LEFT JOIN stage_downtime dt ON dt.stage_id = st.id
        WHERE st.is_active = true
        ORDER BY st.sequence ASC
    )
    SELECT 
        COALESCE(jsonb_agg(row_to_json(combined)), '[]'::jsonb),
        COALESCE(SUM(active_wip_units), 0),
        (
            SELECT stage_name 
            FROM combined 
            ORDER BY bottleneck_score DESC 
            LIMIT 1
        )
    INTO v_stages_json, v_total_wip, v_top_bottleneck
    FROM combined;

    RETURN jsonb_build_object(
        'period', jsonb_build_object('start_date', v_start, 'end_date', v_end),
        'total_active_wip', v_total_wip,
        'top_bottleneck_stage', COALESCE(v_top_bottleneck, '—'),
        'stages', v_stages_json
    );
END;
$$;


--------------------------------------------------------------------------------
-- 2. Atomic RPC: External Supplier Lead Time Analytics (p50 / p80 / Raw Days)
--------------------------------------------------------------------------------
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

    WITH raw_lead_times AS (
        -- Raw wall-clock days for external stages (rule: section 6.2)
        SELECT 
            s.id AS supplier_id,
            s.name AS supplier_name,
            GREATEST(
                0.5,
                ROUND(EXTRACT(EPOCH FROM (
                    COALESCE(ewo.returned_at, psr.completed_at, now()) - 
                    COALESCE(ewo.sent_at, psr.started_at, psr.created_at)
                )) / 86400.0, 1)
            ) AS lead_days,
            CASE 
                WHEN ewo.expected_return_at IS NOT NULL AND 
                     COALESCE(ewo.returned_at, psr.completed_at) <= ewo.expected_return_at THEN 1
                ELSE 0
            END AS is_on_time
        FROM public.external_work_orders ewo
        JOIN public.suppliers s ON s.id = ewo.supplier_id
        JOIN public.production_stage_runs psr ON psr.id = ewo.stage_run_id
        WHERE psr.execution = 'external'
          AND (ewo.status = 'received' OR psr.status = 'done')
          AND COALESCE(ewo.sent_at, psr.started_at, psr.created_at)::date >= v_start
          AND COALESCE(ewo.sent_at, psr.started_at, psr.created_at)::date <= v_end
    ),
    supplier_aggregates AS (
        SELECT 
            supplier_id,
            supplier_name,
            COUNT(*) AS total_sample_count,
            COUNT(*) < 20 AS is_low_sample,
            ROUND(AVG(lead_days)::numeric, 1) AS avg_lead_days,
            ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY lead_days)::numeric, 1) AS p50_lead_days,
            ROUND(percentile_cont(0.80) WITHIN GROUP (ORDER BY lead_days)::numeric, 1) AS p80_lead_days,
            ROUND(AVG(lead_days)::numeric, 1) > ROUND(percentile_cont(0.80) WITHIN GROUP (ORDER BY lead_days)::numeric, 1) AS has_anomaly_warning,
            ROUND((SUM(is_on_time)::numeric / GREATEST(COUNT(*), 1)) * 100, 1) AS on_time_rate_pct
        FROM raw_lead_times
        GROUP BY supplier_id, supplier_name
    )
    SELECT COALESCE(jsonb_agg(row_to_json(supplier_aggregates)), '[]'::jsonb)
    INTO v_suppliers_json
    FROM supplier_aggregates;

    RETURN jsonb_build_object(
        'period', jsonb_build_object('start_date', v_start, 'end_date', v_end),
        'suppliers', v_suppliers_json
    );
END;
$$;


--------------------------------------------------------------------------------
-- 3. Atomic RPC: Empirical Delivery Date & Time Estimator ("كام هتاخد؟")
--------------------------------------------------------------------------------
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
    v_total_work_minutes NUMERIC := 0;
    v_stage_records JSONB := '[]'::jsonb;
    v_sample_size INTEGER := 0;
    v_stages_without_history INTEGER := 0;
    v_confidence TEXT := 'default_estimate';
    v_estimated_completion TIMESTAMPTZ;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'lab', 'technician', 'accountant', 'representative', 'designer', 'doctor') THEN
        RAISE EXCEPTION 'Forbidden: insufficient privileges' USING ERRCODE = '42501';
    END IF;

    -- 1. Find the route linked to the service, or fallback route
    SELECT route_id INTO v_route_id FROM public.services WHERE id = p_service_id;
    IF v_route_id IS NULL THEN
        SELECT id INTO v_route_id FROM public.production_routes WHERE is_active = true ORDER BY is_fallback DESC, created_at ASC LIMIT 1;
    END IF;

    -- 2. Build stages duration from empirical p80 history (or fallback default standard)
    --
    -- Two things this must not get wrong:
    --   * The measured p80 is the duration of a whole RUN, which already covers
    --     every unit in it. Multiplying that by the unit count again would
    --     charge a 3-unit bridge three times its own history, so the sample is
    --     divided by its own units first and only then scaled.
    --   * History is scoped to THIS route. The same milling stage on a zirconia
    --     route and an emax route are different jobs with different durations,
    --     and averaging them together makes both promises wrong.
    WITH route_stage_list AS (
        SELECT
            prs.stage_id,
            st.name_ar AS stage_name,
            st.code AS stage_code,
            COALESCE(prs.execution_override, 'internal') AS execution,
            COALESCE(prs.standard_minutes_per_unit, st.standard_minutes_per_unit, 30) AS fallback_minutes
        FROM public.production_route_stages prs
        JOIN public.production_stages st ON st.id = prs.stage_id
        WHERE prs.route_id = v_route_id
          AND prs.mode != 'excluded'
    ),
    empirical_durations AS (
        SELECT
            rsl.stage_id,
            rsl.stage_name,
            rsl.stage_code,
            rsl.execution,
            rsl.fallback_minutes,
            COUNT(psr.id) AS samples,
            COALESCE(
                percentile_cont(0.80) WITHIN GROUP (
                    ORDER BY GREATEST(1, public.working_minutes_between(psr.queued_at, psr.completed_at))
                            / GREATEST(COALESCE(psr.units_in, 1), 1)
                ),
                rsl.fallback_minutes
            ) AS p80_minutes_per_unit
        FROM route_stage_list rsl
        LEFT JOIN public.production_stage_runs psr
          ON psr.stage_id = rsl.stage_id
         AND psr.status = 'done'
         AND psr.completed_at > (now() - INTERVAL '90 days')
         AND EXISTS (
                SELECT 1 FROM public.production_jobs pj
                 WHERE pj.id = psr.job_id AND pj.route_id = v_route_id)
        GROUP BY rsl.stage_id, rsl.stage_name, rsl.stage_code, rsl.execution, rsl.fallback_minutes
    )
    SELECT
        COALESCE(SUM(p80_minutes_per_unit * v_units), 60),
        -- The confidence of a chain is the confidence of its weakest link, not
        -- the sum of its links. Summing turned six stages with nine cases each
        -- into "54 samples, high confidence" -- a promise built on nine cases
        -- wearing the badge of fifty.
        COALESCE(MIN(samples), 0),
        COUNT(*) FILTER (WHERE samples = 0),
        COALESCE(jsonb_agg(
            jsonb_build_object(
                'stage_name', stage_name,
                'stage_code', stage_code,
                'execution', execution,
                'p80_minutes_per_unit', ROUND(p80_minutes_per_unit::numeric, 0),
                'p80_minutes', ROUND((p80_minutes_per_unit * v_units)::numeric, 0),
                'samples_count', samples,
                'is_estimated', (samples = 0)
            )
        ), '[]'::jsonb)
    INTO v_total_work_minutes, v_sample_size, v_stages_without_history, v_stage_records
    FROM empirical_durations;

    -- Determine confidence. A single stage with no history at all drops the
    -- whole answer to "default_estimate" -- the plan forbids handing out a
    -- number without saying what it was built on.
    IF v_stages_without_history > 0 OR v_sample_size < 15 THEN
        v_confidence := 'default_estimate';
    ELSIF v_sample_size >= 50 THEN
        v_confidence := 'high';
    ELSE
        v_confidence := 'moderate';
    END IF;

    -- 3. Project the promise forward across the WORK calendar, not the wall
    -- calendar. Dividing by 480 and adding days would put a Thursday estimate
    -- on a closed weekend and undo every working-minute measurement above.
    v_estimated_completion := public.add_working_minutes(now(), v_total_work_minutes);

    RETURN jsonb_build_object(
        'service_id', p_service_id,
        'units', v_units,
        'total_working_minutes', ROUND(v_total_work_minutes, 0),
        'total_working_hours', ROUND(v_total_work_minutes / 60.0, 1),
        -- NULL when no work calendar is configured: unmeasurable, not "today".
        'estimated_delivery_date', v_estimated_completion::date,
        'estimated_delivery_at', v_estimated_completion,
        'estimated_calendar_days', CASE
            WHEN v_estimated_completion IS NULL THEN NULL
            ELSE GREATEST(1, (v_estimated_completion::date - CURRENT_DATE))
        END,
        'confidence_level', v_confidence,
        'sample_size', v_sample_size,
        'stages_without_history', v_stages_without_history,
        'stages_breakdown', v_stage_records
    );
END;
$$;


--------------------------------------------------------------------------------
-- 4. Atomic RPC: Team Throughput & Productivity (Technicians & Designers)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_team_throughput_and_productivity(
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
    v_team_json JSONB;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'lab', 'accountant') THEN
        RAISE EXCEPTION 'Forbidden: insufficient privileges' USING ERRCODE = '42501';
    END IF;

    v_start := COALESCE(p_start_date, (CURRENT_DATE - INTERVAL '30 days')::date);
    v_end   := COALESCE(p_end_date, CURRENT_DATE);

    WITH technician_runs AS (
        SELECT 
            u.id AS user_id,
            u.name AS user_name,
            u.role AS user_role,
            st.name_ar AS stage_name,
            GREATEST(COALESCE(psr.units_passed, 1), 1) AS units_passed,
            COALESCE(psr.units_failed, 0) AS units_failed,
            CASE WHEN psr.rework_of IS NOT NULL THEN 1 ELSE 0 END AS is_rework,
            GREATEST(
                1,
                public.working_minutes_between(
                    COALESCE(psr.started_at, psr.queued_at, now() - interval '15 min'), 
                    COALESCE(psr.completed_at, now())
                )
            ) AS touch_minutes
        FROM public.production_stage_runs psr
        JOIN public.users u ON u.id = psr.assignee_id
        JOIN public.production_stages st ON st.id = psr.stage_id
        WHERE psr.status = 'done'
          AND psr.completed_at::date >= v_start
          AND psr.completed_at::date <= v_end
    ),
    aggregated AS (
        SELECT 
            user_id,
            user_name,
            user_role,
            COUNT(*) AS total_runs_completed,
            SUM(units_passed) AS total_units_passed,
            SUM(units_failed) AS total_units_failed,
            SUM(is_rework) AS total_reworks_done,
            ROUND(SUM(touch_minutes)::numeric / 60.0, 1) AS total_touch_hours,
            ROUND(
                SUM(units_passed)::numeric / GREATEST(SUM(touch_minutes)::numeric / 60.0, 1),
                1
            ) AS units_per_hour,
            ROUND(
                (SUM(units_failed)::numeric / GREATEST(SUM(units_passed) + SUM(units_failed), 1)) * 100,
                1
            ) AS error_rate_pct,
            array_to_json(array_agg(DISTINCT stage_name)) AS stages_operated
        FROM technician_runs
        GROUP BY user_id, user_name, user_role
    )
    SELECT COALESCE(jsonb_agg(row_to_json(aggregated)), '[]'::jsonb)
    INTO v_team_json
    FROM aggregated;

    RETURN jsonb_build_object(
        'period', jsonb_build_object('start_date', v_start, 'end_date', v_end),
        'team_productivity', v_team_json
    );
END;
$$;


--------------------------------------------------------------------------------
-- 5. Permissions & RPC Grants Hardening
--------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_production_capacity_and_bottlenecks(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_production_capacity_and_bottlenecks(DATE, DATE) TO authenticated;

REVOKE ALL ON FUNCTION public.get_supplier_lead_time_analytics(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_supplier_lead_time_analytics(DATE, DATE) TO authenticated;

REVOKE ALL ON FUNCTION public.estimate_order_delivery_time(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estimate_order_delivery_time(UUID, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.get_team_throughput_and_productivity(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_team_throughput_and_productivity(DATE, DATE) TO authenticated;

COMMIT;
