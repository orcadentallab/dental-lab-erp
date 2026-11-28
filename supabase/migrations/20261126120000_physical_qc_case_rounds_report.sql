BEGIN;

CREATE OR REPLACE FUNCTION public.get_physical_qc_case_rounds(p_start_date date, p_end_date date)
RETURNS TABLE(phase text, inspected_rounds bigint, first_pass_rounds bigint, bypassed_rounds bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    actor_role text := public.get_my_role();
    range_start timestamptz := p_start_date::timestamp AT TIME ZONE 'Africa/Cairo';
    range_end timestamptz := (p_end_date + 1)::timestamp AT TIME ZONE 'Africa/Cairo';
BEGIN
    IF actor_role IS NULL OR actor_role NOT IN ('admin', 'accountant', 'coordinator', 'production_manager') THEN
        RAISE EXCEPTION 'Physical QC reporting requires a reporting role' USING ERRCODE = '42501';
    END IF;
    IF range_start IS NULL OR range_end IS NULL OR p_start_date > p_end_date THEN
        RAISE EXCEPTION 'Invalid reporting date range' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH RECURSIVE doctor_review AS (
        SELECT r.job_id, min(r.seq) AS seq
        FROM public.production_stage_runs r
        JOIN public.production_stages s ON s.id = r.stage_id AND s.code = 'doctor_review'
        WHERE r.status <> 'skipped'
        GROUP BY r.job_id
    ), qc_runs AS (
        SELECT j.id AS job_id, r.seq, r.id, r.rework_of, r.completed_at, r.created_at,
            r.physical_qc_bypassed_at, r.status, r.units_in, r.units_passed, r.units_failed,
            r.units_passed = r.units_in AND r.units_failed = 0 AS passed,
            CASE WHEN r.seq < d.seq THEN 'trial'
                 WHEN r.seq > d.seq OR o.delivery_type = 'Final' THEN 'final'
                 ELSE 'unclassified' END AS qc_phase
        FROM public.production_stage_runs r
        JOIN public.production_stages s ON s.id = r.stage_id AND s.code = 'qc'
        JOIN public.production_jobs j ON j.id = r.job_id AND NOT j.is_backfilled
        JOIN public.orders o ON o.id = j.order_id AND NOT coalesce(o.is_deleted, false)
        LEFT JOIN doctor_review d ON d.job_id = j.id
        WHERE r.execution = 'internal'
    ), round_lineage AS (
        -- A doctor-requested repeat points to doctor_review and starts a new
        -- trial. A retry points to an earlier QC run at the same checkpoint.
        SELECT r.id, r.job_id, r.seq, r.id AS round_id
        FROM qc_runs r
        WHERE NOT EXISTS (
            SELECT 1 FROM qc_runs parent
            WHERE parent.id = r.rework_of AND parent.job_id = r.job_id AND parent.seq = r.seq
        )
        UNION ALL
        SELECT r.id, r.job_id, r.seq, l.round_id
        FROM round_lineage l
        JOIN qc_runs r ON r.rework_of = l.id AND r.job_id = l.job_id AND r.seq = l.seq
    ), observations AS (
        SELECT r.*, l.round_id
        FROM qc_runs r
        JOIN round_lineage l ON l.id = r.id
        WHERE r.status IN ('done', 'failed') AND r.completed_at IS NOT NULL
          AND (r.physical_qc_bypassed_at IS NOT NULL OR
               (r.units_in > 0 AND r.units_passed + r.units_failed > 0))
    ), inspected AS (
        SELECT DISTINCT ON (round_id) round_id, qc_phase, completed_at,
            passed AND id = round_id AS passed_first_time
        FROM observations
        WHERE physical_qc_bypassed_at IS NULL
        ORDER BY round_id, (id <> round_id), completed_at, created_at, id
    ), bypassed AS (
        SELECT qc_phase, count(DISTINCT round_id) AS total
        FROM observations
        WHERE physical_qc_bypassed_at >= range_start AND physical_qc_bypassed_at < range_end
        GROUP BY qc_phase
    )
    SELECT labels.phase_name,
        count(i.round_id),
        count(i.round_id) FILTER (WHERE i.passed_first_time),
        coalesce(b.total, 0::bigint)
    FROM (VALUES ('trial'), ('final'), ('unclassified')) AS labels(phase_name)
    LEFT JOIN inspected i ON i.qc_phase = labels.phase_name
        AND i.completed_at >= range_start AND i.completed_at < range_end
    LEFT JOIN bypassed b ON b.qc_phase = labels.phase_name
    GROUP BY labels.phase_name, b.total;
END;
$$;

REVOKE ALL ON FUNCTION public.get_physical_qc_case_rounds(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_physical_qc_case_rounds(date, date) TO authenticated;

COMMIT;
