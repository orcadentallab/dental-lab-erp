-- The two taps, the rework loop, and the shadow status.
--
-- Guards 20260821006000_production_transitions.sql.
--
-- What breaks if these regress:
--   * Non-idempotent buttons -> a double tap on a lab tablet creates two
--     rework loops, or errors and teaches people to stop pressing.
--   * Internal rework leaking into order_issues -> every doctor and supplier
--     problem report ever produced becomes wrong.
--   * Shadow mode writing -> the finance contract changes before anyone
--     agreed to the cutover.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(15);

-- ─── Fixtures ────────────────────────────────────────────────────────────

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('a9000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'trans-tech@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('a9000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'trans-rep@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name) VALUES
    ('a3000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001',
     'trans_tech', 'technician', 'Transitions technician'),
    ('a3000000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000002',
     'trans_rep', 'representative', 'Transitions rep');

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name)
VALUES ('a2000000-0000-0000-0000-000000000001', 'Transitions doctor',
        '01000000000', 'Test address', 'DBTRANS', 'Test representative');

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state, delivery_type
) VALUES (
    'a5000000-0000-0000-0000-000000000001', 'TRANS-1',
    'a2000000-0000-0000-0000-000000000001', 'Transitions patient', '[]',
    2000, 'A2', 'New Case', CURRENT_DATE + 7, 800, 'not_started', 'none', 'Final');

INSERT INTO public.order_items (order_id, product_type, teeth_numbers, shade, price, count)
VALUES ('a5000000-0000-0000-0000-000000000001', 'Zirconia Crown',
        '["11","12"]'::jsonb, 'A2', 2000, 2);

INSERT INTO public.production_routes (id, name_ar, is_fallback, ignores_global_stages)
VALUES ('a1000000-0000-0000-0000-000000000001', 'Transitions route', FALSE, FALSE);

-- Glaze failures go back to finishing. This is the "where does a rejection
-- send it" control, configured per route rather than hard-coded.
INSERT INTO public.production_route_stages (route_id, stage_id, mode, on_fail_goto_stage_id)
SELECT 'a1000000-0000-0000-0000-000000000001', g.id, 'override', f.id
  FROM public.production_stages g, public.production_stages f
 WHERE g.code = 'glaze' AND f.code = 'finish';

-- Everything runs in-house for this test, so the walk below is not
-- interrupted by an outside lab.
UPDATE public.production_stages SET default_execution = 'internal'
 WHERE code IN ('milling', 'sintering', 'shipping');

SELECT public.materialize_job_from_route(
    'a5000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001') AS job_id \gset

-- ─── 1-4. The two taps ───────────────────────────────────────────────────

SELECT set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

SELECT ok(public.can_work_production(), 'a technician may act on production');

SELECT is(
    (SELECT COUNT(*)::int FROM public.production_stage_runs r
      WHERE r.job_id = :'job_id' AND r.status = 'ready'),
    1,
    'exactly one stage is offered to start with');

SELECT lives_ok(
    format($$SELECT public.start_stage_run(%L)$$,
        (SELECT id FROM public.production_stage_runs
          WHERE job_id = :'job_id' AND status = 'ready')),
    'tap one: start');

-- Pressing start again must not error: a lab tablet double tap is normal.
SELECT ok(
    (public.start_stage_run(
        (SELECT id FROM public.production_stage_runs
          WHERE job_id = :'job_id' AND status = 'in_progress'))
     ->> 'alreadyStarted')::boolean,
    'pressing start twice returns the running stage instead of erroring');

-- ─── 5-7. Finishing opens the next stage by itself ───────────────────────

SELECT lives_ok(
    format($$SELECT public.complete_stage_run(%L)$$,
        (SELECT id FROM public.production_stage_runs
          WHERE job_id = :'job_id' AND status = 'in_progress')),
    'tap two: finish, with no units typed in');

SELECT is(
    (SELECT r.units_passed FROM public.production_stage_runs r
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE r.job_id = :'job_id' AND s.code = 'design'),
    2,
    'units passed defaulted to the whole job: nothing to type');

SELECT is(
    (SELECT s.code FROM public.production_stage_runs r
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE r.job_id = :'job_id' AND r.status = 'ready'),
    'printing',
    'the next stage opened on its own: pull, not push');

-- ─── 8-11. QC failure creates rework and NOT an order issue ──────────────

-- Walk the case forward until glaze is the open stage.
DO $$
DECLARE v_id UUID; v_job UUID;
BEGIN
    SELECT j.id INTO v_job FROM public.production_jobs j
     WHERE j.order_id = 'a5000000-0000-0000-0000-000000000001';

    LOOP
        SELECT r.id INTO v_id
          FROM public.production_stage_runs r
          JOIN public.production_stages s ON s.id = r.stage_id
         WHERE r.job_id = v_job AND r.status = 'ready' AND s.code <> 'glaze'
         ORDER BY r.seq LIMIT 1;

        EXIT WHEN v_id IS NULL;

        PERFORM public.start_stage_run(v_id);
        PERFORM public.complete_stage_run(v_id);
    END LOOP;
END;
$$;

SELECT is(
    (SELECT s.code FROM public.production_stage_runs r
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE r.job_id = :'job_id' AND r.status = 'ready'),
    'glaze',
    'the case walked to glaze');

-- One of the two units fails at glaze.
SELECT ok(
    (public.complete_stage_run(
        (SELECT r.id FROM public.production_stage_runs r
           JOIN public.production_stages s ON s.id = r.stage_id
          WHERE r.job_id = :'job_id' AND r.status = 'ready' AND s.code = 'glaze'),
        1, 1, 'glaze') ->> 'reworkRunId') IS NOT NULL,
    'a failed unit creates a rework run');

SELECT is(
    (SELECT s.code FROM public.production_stage_runs r
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE r.job_id = :'job_id' AND r.rework_of IS NOT NULL),
    'finish',
    'and it goes back to where the route says: finishing, not the start');

-- THE rule from plan 5.1: a failure caught inside the lab is production
-- quality, not a problem with the order. Putting it in order_issues would
-- corrupt every doctor and supplier report that already exists.
SELECT is(
    (SELECT COUNT(*)::int FROM public.order_issues
      WHERE order_id = 'a5000000-0000-0000-0000-000000000001'),
    0,
    'internal rework created NO order_issues row');

RESET ROLE;

-- ─── 12-13. Only production roles may move a case ────────────────────────

SELECT set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000002', TRUE);
SET LOCAL ROLE authenticated;

SELECT ok(NOT public.can_work_production(), 'a representative may not act on production');

SELECT throws_ok(
    format($$SELECT public.start_stage_run(%L)$$,
        (SELECT id FROM public.production_stage_runs
          WHERE job_id = :'job_id' AND status = 'ready' LIMIT 1)),
    '42501',
    NULL,
    'and the RPC refuses them');

RESET ROLE;

-- ─── 14-15. Shadow mode computes but never writes ────────────────────────

SELECT is(
    public.compute_production_status_from_stages('a5000000-0000-0000-0000-000000000001'),
    'in_production',
    'the shadow status reads the stage chain');

-- The finance contract is untouched until the phase-2 cutover.
SELECT is(
    (SELECT production_status FROM public.orders
      WHERE id = 'a5000000-0000-0000-0000-000000000001'),
    'not_started',
    'and orders.production_status was not written to');

SELECT * FROM finish();
ROLLBACK;
