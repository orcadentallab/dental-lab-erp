-- The external lead-time p80 fix.
--
-- Guards 20260828003000_fix_external_lead_time_reporting.sql.
--
-- Root cause confirmed with the owner 2026-08-28: 364 of 779 historical
-- whole_case_only jobs shared one identical completion instant (a bulk
-- status-history cleanup, not 364 cases finishing at once -- "كان تسجيل
-- متأخر بس"), and split_handoff/full_lab were never reported as the two
-- separate numbers 20260821003000 always intended ("TWO AVERAGES, NEVER
-- ONE"). Four things are protected here:
--
--   1. BUCKETING IS STRUCTURAL. A job with a design run is split_handoff
--      (pure vendor production time); a job without one is full_lab
--      (registration is the handoff, so it includes design the vendor did
--      themselves). No history_class needed -- this must hold for live data
--      exactly as for backfilled data.
--   2. A SHARED-TIMESTAMP CLUSTER IS EXCLUDED, GENERICALLY. Detection is not
--      a hardcoded date: any implausible number of otherwise-unrelated jobs
--      completing at the identical instant is administrative, not physical.
--   3. EXTERNAL DURATION IS WALL-CLOCK, NEVER OUR SHIFT CALENDAR.
--   4. estimate_order_delivery_time RESPECTS ROUTE CONDITIONS. It used to
--      scan production_route_stages directly and charge every quote for
--      doctor_review and a second external_full pass regardless of context;
--      it now walks get_effective_route_stages() so a full/Final quote does
--      not silently include steps that only apply to a try-in.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(11);

-- ─── Fixtures ────────────────────────────────────────────────────────────

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
    'd9000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'leadtime-admin@example.test', '',
    '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name) VALUES
    ('d8000000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-000000000001',
     'leadtime_admin', 'admin', 'Lead Time Admin');

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name)
VALUES ('d2000000-0000-0000-0000-000000000001', 'Lead time test doctor',
        '01000000000', 'Test address', 'DBLEAD', 'Test representative');

INSERT INTO public.suppliers (id, name, phone)
VALUES ('d4000000-0000-0000-0000-000000000001', 'Lead time test supplier', '01000000001');

INSERT INTO public.production_routes (id, name_ar, is_fallback, ignores_global_stages)
VALUES ('d1000000-0000-0000-0000-000000000001', 'Lead time test route', FALSE, FALSE);

-- One job per iteration, each with its own order (production_jobs has no
-- direct doctor_id -- it hangs off the order).
CREATE OR REPLACE FUNCTION pg_temp.make_external_run(
    p_case_id TEXT, p_workflow TEXT, p_delivery TEXT,
    p_queued TIMESTAMPTZ, p_completed TIMESTAMPTZ,
    p_route UUID DEFAULT 'd1000000-0000-0000-0000-000000000001',
    p_supplier UUID DEFAULT 'd4000000-0000-0000-0000-000000000001',
    p_with_design BOOLEAN DEFAULT FALSE,
    p_data_quality TEXT DEFAULT NULL,
    p_history_class TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql AS $fn$
DECLARE
    v_order UUID := gen_random_uuid();
    v_job UUID := gen_random_uuid();
    v_ext_stage UUID;
    v_design_stage UUID;
BEGIN
    SELECT id INTO v_ext_stage FROM public.production_stages WHERE code = 'external_full';
    SELECT id INTO v_design_stage FROM public.production_stages WHERE code = 'design';

    INSERT INTO public.orders (
        id, case_id, doctor_id, patient_name, items, total_price, shade, status,
        delivery_date, cost, production_status, issue_state, priority,
        workflow_type, delivery_type, created_at
    ) VALUES (
        v_order, p_case_id, 'd2000000-0000-0000-0000-000000000001', 'p', '[]',
        100, 'A1', 'New Case', CURRENT_DATE, 0, 'final_delivered', 'none', 'Normal',
        p_workflow, p_delivery, p_queued);

    INSERT INTO public.production_jobs
        (id, order_id, route_id, round_no, unit_count, status,
         is_backfilled, history_class, data_quality)
    VALUES (v_job, v_order, p_route, 1, 1, 'done',
            (p_history_class IS NOT NULL), p_history_class, p_data_quality);

    IF p_with_design THEN
        INSERT INTO public.production_stage_runs
            (job_id, stage_id, seq, execution, status, units_in, units_passed,
             queued_at, started_at, completed_at)
        VALUES (v_job, v_design_stage, 10, 'internal', 'done', 1, 1,
                p_queued, p_queued, p_queued);
    END IF;

    INSERT INTO public.production_stage_runs
        (job_id, stage_id, seq, execution, status, supplier_id, units_in, units_passed,
         queued_at, started_at, completed_at)
    VALUES (v_job, v_ext_stage, 20, 'external', 'done', p_supplier, 1, 1,
            p_queued, p_queued, p_completed);
END;
$fn$;

-- 5 full_lab samples: no design, exactly 5 days each.
SELECT pg_temp.make_external_run('LEAD-FL-'||g, 'full', 'Final',
    now() - (5+g) * interval '1 day', now() - g * interval '1 day')
  FROM generate_series(1, 5) g;

-- 3 split_handoff samples: design present, ~2 days each.
SELECT pg_temp.make_external_run('LEAD-SH-'||g, 'split', 'Final',
    now() - (12+g) * interval '1 day', now() - (10+g) * interval '1 day',
    p_with_design => TRUE)
  FROM generate_series(1, 3) g;

-- A historical 'partial' sample: must be excluded even though it is
-- otherwise a clean split_handoff row.
SELECT pg_temp.make_external_run('LEAD-PARTIAL-1', 'split', 'TryIn',
    now() - 40 * interval '1 day', now() - 20 * interval '1 day',
    p_with_design => TRUE, p_data_quality => 'partial', p_history_class => 'external_measurable');

-- A historical whole_case_only try-in: the doctor's wait is baked into the
-- one span with no way to subtract it -- must be excluded.
SELECT pg_temp.make_external_run('LEAD-WCOTRYIN-1', 'full', 'TryIn',
    now() - 50 * interval '1 day', now() - 10 * interval '1 day',
    p_history_class => 'whole_case_only');

-- 30 rows sharing ONE completion instant: the confirmed bulk-cleanup shape.
SELECT pg_temp.make_external_run('LEAD-CONTAM-'||g, 'full', 'Final',
    now() - (100+g) * interval '1 day', now() - 90 * interval '1 day')
  FROM generate_series(1, 30) g;

-- ─── 1-2. Bucketing is structural, not a label ────────────────────────────

SELECT is(
    (SELECT bucket FROM public.get_reliable_external_lead_time_samples()
       JOIN public.orders o ON o.id = order_id
      WHERE o.case_id = 'LEAD-FL-1'),
    'full_lab',
    'a job with no design run buckets as full_lab');

SELECT is(
    (SELECT bucket FROM public.get_reliable_external_lead_time_samples()
       JOIN public.orders o ON o.id = order_id
      WHERE o.case_id = 'LEAD-SH-1'),
    'split_handoff',
    'a job with a design run buckets as split_handoff');

-- ─── 3-4. Known-tainted historical subtypes are excluded ─────────────────

SELECT is(
    (SELECT COUNT(*)::int FROM public.get_reliable_external_lead_time_samples()
       JOIN public.orders o ON o.id = order_id
      WHERE o.case_id = 'LEAD-PARTIAL-1'),
    0,
    'a historical partial-quality sample (unseparated doctor wait) is excluded');

SELECT is(
    (SELECT COUNT(*)::int FROM public.get_reliable_external_lead_time_samples()
       JOIN public.orders o ON o.id = order_id
      WHERE o.case_id = 'LEAD-WCOTRYIN-1'),
    0,
    'a historical whole_case_only try-in (unseparated doctor wait) is excluded');

-- ─── 5-6. The confirmed bulk-cleanup shape is excluded, without a hardcoded date ─

SELECT is(
    (SELECT COUNT(*)::int FROM public.get_reliable_external_lead_time_samples()
       JOIN public.orders o ON o.id = order_id
      WHERE o.case_id LIKE 'LEAD-CONTAM-%'),
    0,
    'a cluster of jobs sharing one completion instant is excluded entirely');

SELECT is(
    (SELECT COUNT(*)::int FROM public.get_reliable_external_lead_time_samples()),
    8,
    'exactly the 5 full_lab + 3 split_handoff clean samples survive');

-- ─── 7-8. The two averages, never blended ─────────────────────────────────

SELECT is(
    (SELECT ROUND(AVG(wall_clock_minutes)::numeric / 1440.0, 1)
       FROM public.get_reliable_external_lead_time_samples() WHERE bucket = 'full_lab'),
    5.0,
    'full_lab average is the clean full-lab samples alone -- not 79 days');

SELECT is(
    (SELECT ROUND(AVG(wall_clock_minutes)::numeric / 1440.0, 1)
       FROM public.get_reliable_external_lead_time_samples() WHERE bucket = 'split_handoff'),
    2.0,
    'split_handoff average is unaffected by the full_lab contamination');

-- ─── 9-10. The supplier report exposes both buckets separately ───────────

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd9000000-0000-0000-0000-000000000001', TRUE);

SELECT is(
    (SELECT (public.get_supplier_lead_time_analytics(
                (CURRENT_DATE - INTERVAL '200 days')::date, CURRENT_DATE)
             -> 'suppliers' -> 0 -> 'full_lab' ->> 'sample_size')::int),
    5,
    'the supplier report counts full_lab samples separately from split_handoff');

SELECT is(
    (SELECT (public.get_supplier_lead_time_analytics(
                (CURRENT_DATE - INTERVAL '200 days')::date, CURRENT_DATE)
             -> 'suppliers' -> 0 -> 'split_handoff' ->> 'sample_size')::int),
    3,
    'and split_handoff samples separately from full_lab');

-- ─── 11. estimate_order_delivery_time: conditions respected, wall-clock ──
-- A fresh route with ONLY external_full as a step (get_effective_route_
-- stages falls back to the whole global stage set for a route nobody has
-- laid out, which is not what this assertion means to exercise) and its own
-- 20 clean 7-day samples. Lead-time samples are pooled globally by design
-- (a vendor's own turnaround does not depend on which internal route we
-- file the job under), so this also combines with the 5x5-day LEAD-FL
-- samples above -- 25 samples sorted give an exact p80 of 7.0 days either way.

RESET ROLE;

INSERT INTO public.production_routes (id, name_ar, is_fallback, ignores_global_stages)
VALUES ('d1000000-0000-0000-0000-000000000002', 'Lead time estimate route', FALSE, FALSE);

INSERT INTO public.production_route_stages (route_id, stage_id, mode, step_no)
SELECT 'd1000000-0000-0000-0000-000000000002', id, 'included', 20
  FROM public.production_stages WHERE code = 'external_full';

SELECT pg_temp.make_external_run('LEAD-EST-'||g, 'full', 'Final',
    now() - (20+g) * interval '1 day', now() - (13+g) * interval '1 day',
    p_route => 'd1000000-0000-0000-0000-000000000002')
  FROM generate_series(1, 20) g;

INSERT INTO public.services (id, name, selling_price, cost_price, route_id)
VALUES ('d5000000-0000-0000-0000-000000000001', 'Lead time estimate service',
        100, 60, 'd1000000-0000-0000-0000-000000000002');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd9000000-0000-0000-0000-000000000001', TRUE);

SELECT is(
    (SELECT (r -> 'estimated_calendar_days')::int
       FROM public.estimate_order_delivery_time(
                'd5000000-0000-0000-0000-000000000001'::uuid, 1) r),
    7,
    'a 7-day wall-clock vendor wait promises 7 calendar days, not stretched through the work calendar');

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
