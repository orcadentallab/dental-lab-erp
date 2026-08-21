-- Production jobs, stage runs, and the three clocks.
--
-- Guards 20260821002000_production_jobs_and_stage_runs.sql.
--
-- Four rules are protected here, each of which silently corrupts a different
-- report if it breaks:
--   1. Touch / wait / stage are three different numbers. Collapsing them
--      charges a technician for a queue he did not create.
--   2. External stages are wall-clock. Running a milling house's turnaround
--      through our shift calendar produces a figure about nobody.
--   3. A batch stage is charged once and split. Otherwise one 90-minute
--      furnace load becomes 18 hours of invented labour.
--   4. The route is snapshot at job creation. Otherwise editing a route
--      rewrites the history of every case in flight.
--
-- Week used: 2026-06-01 is a Monday. Test calendar is 09:00-18:00 Sat-Thu.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(16);

-- ─── Fixtures ────────────────────────────────────────────────────────────

-- The default calendar the duration trigger will resolve to.
UPDATE public.work_calendars SET is_default = FALSE WHERE is_default;

INSERT INTO public.work_calendars (id, name, timezone, is_default, is_active)
VALUES ('e0000000-0000-0000-0000-000000000001',
        'Jobs test lab', 'Africa/Cairo', TRUE, TRUE);

INSERT INTO public.work_shifts (calendar_id, weekday, start_time, end_time)
SELECT 'e0000000-0000-0000-0000-000000000001', d.weekday, TIME '09:00', TIME '18:00'
  FROM (VALUES (0), (1), (2), (3), (4), (6)) AS d(weekday);

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name)
VALUES ('e2000000-0000-0000-0000-000000000001', 'Jobs test doctor',
        '01000000000', 'Test address', 'DBJOBS', 'Test representative');

INSERT INTO public.suppliers (id, name, phone)
VALUES ('e4000000-0000-0000-0000-000000000001', 'Jobs test milling house', '01000000001');

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state, priority
) VALUES (
    'e3000000-0000-0000-0000-000000000001', 'JOBS-1',
    'e2000000-0000-0000-0000-000000000001', 'Jobs patient', '[]',
    3000, 'A2', 'New Case', DATE '2026-06-10', 900, 'not_started', 'none', 'Normal');

INSERT INTO public.order_items (id, order_id, product_type, teeth_numbers, shade, price, count)
VALUES ('e5000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001',
        'Zirconia Crown', '["11","12","13"]'::jsonb, 'A2', 3000, 3);

-- A plain internal route: the whole global chain, milling left outsourced.
INSERT INTO public.production_routes (id, name_ar, is_fallback, ignores_global_stages)
VALUES ('e1000000-0000-0000-0000-000000000001', 'Jobs test route', FALSE, FALSE);

-- ─── 1-5. Materialising a job snapshots the chain ────────────────────────

SELECT lives_ok(
    $$SELECT public.materialize_job_from_route(
        'e3000000-0000-0000-0000-000000000001',
        'e1000000-0000-0000-0000-000000000001')$$,
    'a job can be created from a route');

SELECT is(
    (SELECT COUNT(*)::int FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
      WHERE j.order_id = 'e3000000-0000-0000-0000-000000000001'),
    9,
    'the whole global chain was expanded into concrete stage runs');

-- unit_count comes from the order lines, not from a guess.
SELECT is(
    (SELECT unit_count FROM public.production_jobs
      WHERE order_id = 'e3000000-0000-0000-0000-000000000001'),
    3,
    'the job counts three units, taken from the order item');

-- Pull, not push: exactly one step is offered, the rest wait their turn.
SELECT is(
    (SELECT COUNT(*)::int FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
      WHERE j.order_id = 'e3000000-0000-0000-0000-000000000001' AND r.status = 'ready'),
    1,
    'only the first stage is ready; the rest are pending');

-- Milling is outsourced, so its run carries the supplier and no technician.
SELECT is(
    (SELECT r.execution FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'e3000000-0000-0000-0000-000000000001' AND s.code = 'milling'),
    'external',
    'the milling run inherited the outsourced execution from the catalogue');

-- ─── 6. Editing the route afterwards must not reach the running job ──────

INSERT INTO public.production_route_stages (route_id, stage_id, mode)
SELECT 'e1000000-0000-0000-0000-000000000001', s.id, 'excluded'
  FROM public.production_stages s WHERE s.code = 'cast_print';

SELECT is(
    (SELECT COUNT(*)::int FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
      WHERE j.order_id = 'e3000000-0000-0000-0000-000000000001'),
    9,
    'removing a stage from the route leaves the already-running job untouched');

-- ─── 7-10. The three clocks on an internal stage ─────────────────────────
--
-- The worked example: the case reaches finishing at 10:00 and sits in the
-- queue while the technician clears earlier work. He starts at 11:30 and is
-- done at 11:45.

UPDATE public.production_stage_runs r
   SET queued_at    = TIMESTAMP '2026-06-01 10:00' AT TIME ZONE 'Africa/Cairo',
       started_at   = TIMESTAMP '2026-06-01 11:30' AT TIME ZONE 'Africa/Cairo',
       completed_at = TIMESTAMP '2026-06-01 11:45' AT TIME ZONE 'Africa/Cairo',
       status       = 'done',
       units_passed = 3
  FROM public.production_jobs j, public.production_stages s
 WHERE j.id = r.job_id AND s.id = r.stage_id
   AND j.order_id = 'e3000000-0000-0000-0000-000000000001' AND s.code = 'finish';

SELECT is(
    (SELECT r.touch_minutes FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'e3000000-0000-0000-0000-000000000001' AND s.code = 'finish'),
    15::numeric,
    'touch time is 15 minutes: the only number the technician answers for');

SELECT is(
    (SELECT r.wait_minutes FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'e3000000-0000-0000-0000-000000000001' AND s.code = 'finish'),
    90::numeric,
    'wait time is 90 minutes: the queue, which is a capacity signal not a person');

SELECT is(
    (SELECT r.stage_minutes FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'e3000000-0000-0000-0000-000000000001' AND s.code = 'finish'),
    105::numeric,
    'stage time is 105 minutes: what the case actually experienced');

SELECT is(
    (SELECT r.duration_basis FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'e3000000-0000-0000-0000-000000000001' AND s.code = 'finish'),
    'working',
    'an internal stage is measured on our working calendar');

-- ─── 11-13. An external stage is wall-clock, calendar never applied ──────
--
-- Sent to milling on Thursday afternoon, back Sunday morning. Friday is our
-- day off -- but it is not theirs to answer for, and the doctor waited through
-- it regardless. 66 hours is the honest turnaround.

UPDATE public.production_stage_runs r
   SET queued_at    = TIMESTAMP '2026-06-04 15:00' AT TIME ZONE 'Africa/Cairo',
       started_at   = TIMESTAMP '2026-06-04 15:00' AT TIME ZONE 'Africa/Cairo',
       completed_at = TIMESTAMP '2026-06-07 09:00' AT TIME ZONE 'Africa/Cairo',
       status       = 'done',
       units_passed = 3
  FROM public.production_jobs j, public.production_stages s
 WHERE j.id = r.job_id AND s.id = r.stage_id
   AND j.order_id = 'e3000000-0000-0000-0000-000000000001' AND s.code = 'milling';

SELECT is(
    (SELECT r.duration_basis FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'e3000000-0000-0000-0000-000000000001' AND s.code = 'milling'),
    'wall_clock',
    'an external stage is never passed through our shift calendar');

SELECT is(
    (SELECT r.stage_minutes FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'e3000000-0000-0000-0000-000000000001' AND s.code = 'milling'),
    3960::numeric,
    'the vendor turnaround is 66 hours of wall clock, weekend included');

SELECT is(
    (SELECT r.stage_minutes = r.stage_elapsed_minutes
       FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'e3000000-0000-0000-0000-000000000001' AND s.code = 'milling'),
    TRUE,
    'for an external stage the two clocks agree by definition');

-- ─── 14-15. The batch trap: one furnace load is charged once ─────────────
--
-- Nine cases sinter together in 90 minutes. Charging each of them 90 minutes
-- would report 13.5 hours of labour out of a 90-minute run.

INSERT INTO public.production_jobs (id, order_id, route_id, round_no, unit_count)
SELECT ('e6000000-0000-0000-0000-00000000000' || g)::uuid,
       'e3000000-0000-0000-0000-000000000001',
       'e1000000-0000-0000-0000-000000000001', g + 1, 1
  FROM generate_series(1, 9) AS g;

INSERT INTO public.production_stage_runs
    (job_id, stage_id, seq, execution, status, batch_group_id,
     queued_at, started_at, completed_at, units_in, units_passed)
SELECT j.id, s.id, 40, 'internal', 'done',
       'e7000000-0000-0000-0000-000000000001',
       TIMESTAMP '2026-06-01 13:00' AT TIME ZONE 'Africa/Cairo',
       TIMESTAMP '2026-06-01 13:00' AT TIME ZONE 'Africa/Cairo',
       TIMESTAMP '2026-06-01 14:30' AT TIME ZONE 'Africa/Cairo',
       1, 1
  FROM public.production_jobs j
  CROSS JOIN public.production_stages s
 WHERE j.order_id = 'e3000000-0000-0000-0000-000000000001'
   AND j.round_no > 1
   AND s.code = 'sintering';

SELECT is(
    (SELECT SUM(touch_minutes) FROM public.production_stage_runs
      WHERE batch_group_id = 'e7000000-0000-0000-0000-000000000001'),
    810::numeric,
    'raw touch time naively sums to 810 minutes across the nine cases');

SELECT is(
    (SELECT SUM(costed_touch_minutes) FROM public.production_stage_run_costing
      WHERE batch_group_id = 'e7000000-0000-0000-0000-000000000001'),
    90::numeric,
    'but the costing view charges the furnace run once: 90 minutes total');

-- ─── 16. An external run may not carry a technician ──────────────────────
-- This is how a vendor's turnaround would otherwise leak into a person's
-- productivity figures.

INSERT INTO public.users (id, auth_id, username, role, name)
VALUES ('e8000000-0000-0000-0000-000000000001', NULL,
        'jobs_test_tech', 'lab', 'Jobs test technician');

SELECT throws_ok(
    $$UPDATE public.production_stage_runs r
         SET assignee_id = 'e8000000-0000-0000-0000-000000000001'
        FROM public.production_stages s
       WHERE s.id = r.stage_id AND s.code = 'milling'
         AND r.execution = 'external'$$,
    '23514',
    NULL,
    'an outsourced run cannot be attributed to one of our technicians');

SELECT * FROM finish();
ROLLBACK;
