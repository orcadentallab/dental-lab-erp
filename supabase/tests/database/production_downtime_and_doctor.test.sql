-- Time at the doctor, and time lost to a dead machine.
--
-- Guards 20260821004000_conditional_global_stages.sql and
--        20260821005000_machines_and_downtime.sql.
--
-- Two ways a stage gets blamed for time that was never its fault:
--   1. A try-in sits at the doctor's clinic for a week. If no stage represents
--      that, the week lands on whichever stage comes next and finishing looks
--      like a bottleneck.
--   2. The furnace dies for five hours. Without downtime attribution those
--      hours land on sintering, and the technician standing next to a dead
--      machine looks slow.
--
-- Week used: 2026-06-01 is a Monday. Calendar is 09:00-18:00 Sat-Thu.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(12);

-- ─── Fixtures ────────────────────────────────────────────────────────────

UPDATE public.work_calendars SET is_default = FALSE WHERE is_default;

INSERT INTO public.work_calendars (id, name, timezone, is_default, is_active)
VALUES ('f0000000-0000-0000-0000-000000000001',
        'Downtime test lab', 'Africa/Cairo', TRUE, TRUE);

INSERT INTO public.work_shifts (calendar_id, weekday, start_time, end_time)
SELECT 'f0000000-0000-0000-0000-000000000001', d.weekday, TIME '09:00', TIME '18:00'
  FROM (VALUES (0), (1), (2), (3), (4), (6)) AS d(weekday);

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name)
VALUES ('f2000000-0000-0000-0000-000000000001', 'Downtime test doctor',
        '01000000000', 'Test address', 'DBDOWN', 'Test representative');

INSERT INTO public.production_routes (id, name_ar, is_fallback, ignores_global_stages)
VALUES ('f1000000-0000-0000-0000-000000000001', 'Downtime test route', FALSE, FALSE);

-- ─── 1-4. doctor_review is global but only fires on a try-in ─────────────

SELECT is(
    (SELECT scope FROM public.production_stages WHERE code = 'doctor_review'),
    'global',
    'the doctor stage is global, so no service can forget to add it');

SELECT is(
    (SELECT default_condition FROM public.production_stages WHERE code = 'doctor_review'),
    '{"delivery_type": "TryIn"}'::jsonb,
    'and it carries its own condition, so it is not spurious on final cases');

SELECT ok(
    NOT EXISTS (SELECT 1 FROM public.get_effective_route_stages(
                    'f1000000-0000-0000-0000-000000000001',
                    '{"delivery_type": "Final"}'::jsonb)
                 WHERE stage_code = 'doctor_review'),
    'a final-delivery case has no doctor stage');

SELECT ok(
    EXISTS (SELECT 1 FROM public.get_effective_route_stages(
                'f1000000-0000-0000-0000-000000000001',
                '{"delivery_type": "TryIn"}'::jsonb)
             WHERE stage_code = 'doctor_review' AND execution = 'external'),
    'a try-in gets the doctor stage automatically, measured as external time');

-- ─── 5-6. The internal try-in really does carry the stage ────────────────

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state, delivery_type
) VALUES (
    'f3000000-0000-0000-0000-000000000001', 'DOWN-TRYIN-1',
    'f2000000-0000-0000-0000-000000000001', 'Try-in patient', '[]',
    2000, 'A2', 'New Case', DATE '2026-06-10', 700, 'not_started', 'none', 'TryIn');

SELECT lives_ok(
    $$SELECT public.materialize_job_from_route(
        'f3000000-0000-0000-0000-000000000001',
        'f1000000-0000-0000-0000-000000000001')$$,
    'an internal try-in job can be created');

SELECT ok(
    EXISTS (SELECT 1 FROM public.production_stage_runs r
              JOIN public.production_jobs j ON j.id = r.job_id
              JOIN public.production_stages s ON s.id = r.stage_id
             WHERE j.order_id = 'f3000000-0000-0000-0000-000000000001'
               AND s.code = 'doctor_review'
               AND r.execution = 'external'),
    'the internal job has a doctor stage, so the wait at the clinic has somewhere to go');

-- ─── 7-12. A dead machine is charged for the halt ────────────────────────

INSERT INTO public.machines (id, code, name_ar, stage_id, status)
SELECT 'f4000000-0000-0000-0000-000000000001', 'FURNACE-1', 'فرن السنترة',
       s.id, 'running'
  FROM public.production_stages s WHERE s.code = 'sintering';

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state
) VALUES (
    'f3000000-0000-0000-0000-000000000002', 'DOWN-HALT-1',
    'f2000000-0000-0000-0000-000000000001', 'Halted patient', '[]',
    1000, 'A1', 'New Case', DATE '2026-06-10', 400, 'not_started', 'none');

INSERT INTO public.production_jobs (id, order_id, route_id, unit_count)
VALUES ('f5000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000002',
        'f1000000-0000-0000-0000-000000000001', 1);

-- The case waits at sintering from 09:00 to 15:00 on Monday: six working
-- hours of queue, then one hour of actual work.
INSERT INTO public.production_stage_runs
    (id, job_id, stage_id, seq, execution, status, machine_id,
     queued_at, started_at, completed_at, units_in, units_passed)
SELECT 'f6000000-0000-0000-0000-000000000001',
       'f5000000-0000-0000-0000-000000000001', s.id, 40, 'internal', 'done',
       'f4000000-0000-0000-0000-000000000001',
       TIMESTAMP '2026-06-01 09:00' AT TIME ZONE 'Africa/Cairo',
       TIMESTAMP '2026-06-01 15:00' AT TIME ZONE 'Africa/Cairo',
       TIMESTAMP '2026-06-01 16:00' AT TIME ZONE 'Africa/Cairo',
       1, 1
  FROM public.production_stages s WHERE s.code = 'sintering';

SELECT is(
    (SELECT wait_minutes FROM public.production_stage_runs
      WHERE id = 'f6000000-0000-0000-0000-000000000001'),
    360::numeric,
    'before any fault is logged the run shows six hours of waiting');

SELECT is(
    (SELECT COALESCE(blocked_minutes, 0) FROM public.production_stage_runs
      WHERE id = 'f6000000-0000-0000-0000-000000000001'),
    0::numeric,
    'and nothing is blocked yet');

-- The furnace was dead from 10:00 to 15:00 -- logged afterwards, as it would
-- be in real life.
INSERT INTO public.machine_downtime (machine_id, started_at, ended_at, reason, cost_amount)
VALUES ('f4000000-0000-0000-0000-000000000001',
        TIMESTAMP '2026-06-01 10:00' AT TIME ZONE 'Africa/Cairo',
        TIMESTAMP '2026-06-01 15:00' AT TIME ZONE 'Africa/Cairo',
        'breakdown', 1500);

SELECT is(
    (SELECT blocked_minutes FROM public.production_stage_runs
      WHERE id = 'f6000000-0000-0000-0000-000000000001'),
    300::numeric,
    'logging the fault reaches back and attributes five hours to it');

-- The gross figure is deliberately untouched: the case really did sit there
-- and the doctor really did wait.
SELECT is(
    (SELECT wait_minutes FROM public.production_stage_runs
      WHERE id = 'f6000000-0000-0000-0000-000000000001'),
    360::numeric,
    'the gross wait is unchanged: the delay is moved, never erased');

SELECT is(
    (SELECT wait_minutes_net FROM public.production_stage_run_costing
      WHERE stage_run_id = 'f6000000-0000-0000-0000-000000000001'),
    60::numeric,
    'but the stage only answers for one hour once the dead furnace is removed');

SELECT is(
    (SELECT blocked_minutes_on_named_runs FROM public.machine_downtime_impact
      WHERE machine_id = 'f4000000-0000-0000-0000-000000000001'),
    300::numeric,
    'and the five hours land on the machine, where the maintenance decision is made');

SELECT * FROM finish();
ROLLBACK;
