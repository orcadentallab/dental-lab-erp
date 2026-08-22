-- Entering production, the flag guard, and the cost rule.
--
-- Guards 20260822000000_attachments_and_cutover.sql. Three things that each
-- break something expensive if they regress:
--
--   1. An order with two services on two routes must become TWO jobs. One job
--      would average a fast service with a slow one and make every cycle-time
--      number meaningless.
--   2. The cutover writes NOTHING while production_v1 is off. If it leaked,
--      orders.production_status -- the contract finance reads for receivables,
--      invoices and aging -- would start moving before anyone approved it.
--   3. A stage cost never reaches financial_obligations. Internal work is
--      already an expense through payroll; booking it as a per-order liability
--      too would double-count it into the P&L.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(16);

-- ─── Fixtures ────────────────────────────────────────────────────────────

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('b9000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'cutover-admin@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name)
VALUES ('b3000000-0000-0000-0000-000000000001',
        'b9000000-0000-0000-0000-000000000001',
        'cutover_admin', 'admin', 'Cutover admin');

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name)
VALUES ('b2000000-0000-0000-0000-000000000001', 'Cutover doctor',
        '01000000000', 'Test address', 'DBCUT', 'Test representative');

-- Two routes, so the order genuinely has to split.
INSERT INTO public.production_routes (id, name_ar, is_fallback, ignores_global_stages)
VALUES ('b1000000-0000-0000-0000-000000000001', 'Cutover zirconia route', FALSE, FALSE),
       ('b1000000-0000-0000-0000-000000000002', 'Cutover temporary route', FALSE, FALSE);

INSERT INTO public.services (id, name, selling_price, cost_price, route_id)
VALUES ('b4000000-0000-0000-0000-000000000001', 'Cutover Zirconia', 1000, 400,
        'b1000000-0000-0000-0000-000000000001'),
       ('b4000000-0000-0000-0000-000000000002', 'Cutover Temp PMMA', 300, 100,
        'b1000000-0000-0000-0000-000000000002');

-- A standard cost on finishing, so the cost path has something to read.
UPDATE public.production_stages SET standard_cost_per_unit = 25 WHERE code = 'finish';

-- Everything in-house for this test, so the walk is not interrupted by an
-- outside lab handover.
UPDATE public.production_stages SET default_execution = 'internal'
 WHERE code IN ('milling', 'sintering', 'shipping');

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state, delivery_type
) VALUES (
    'b5000000-0000-0000-0000-000000000001', 'CUT-1',
    'b2000000-0000-0000-0000-000000000001', 'Cutover patient', '[]',
    3300, 'A2', 'New Case', CURRENT_DATE + 7, 1000, 'not_started', 'none', 'Final');

INSERT INTO public.order_items (order_id, product_type, teeth_numbers, shade, price, count)
VALUES ('b5000000-0000-0000-0000-000000000001', 'Cutover Zirconia',
        '["11","12","13"]'::jsonb, 'A2', 3000, 3),
       ('b5000000-0000-0000-0000-000000000001', 'Cutover Temp PMMA',
        '["21","22"]'::jsonb, 'A2', 300, 2);

-- ─── 1-2. Storage and attachments exist ──────────────────────────────────

SELECT is(
    (SELECT public FROM storage.buckets WHERE id = 'case-files'),
    FALSE,
    'the case-files bucket is private: patient photos are not world-readable');

SELECT has_table('public', 'order_attachments', 'attachments table exists');

-- ─── 3-7. One job per route ──────────────────────────────────────────────

SELECT set_config('request.jwt.claim.sub', 'b9000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

SELECT is(
    (public.start_production_for_order('b5000000-0000-0000-0000-000000000001')
     ->> 'jobCount')::int,
    2,
    'an order with two services on two routes becomes two jobs');

SELECT is(
    (SELECT SUM(unit_count)::int FROM public.production_jobs
      WHERE order_id = 'b5000000-0000-0000-0000-000000000001' AND NOT is_backfilled),
    5,
    'and the units are split 3 + 2, not counted twice');

-- Each job carries only its own lines: this is what lets the two chains be
-- costed and timed separately.
SELECT is(
    (SELECT COUNT(*)::int FROM public.production_job_items pji
       JOIN public.production_jobs j ON j.id = pji.job_id
      WHERE j.order_id = 'b5000000-0000-0000-0000-000000000001'),
    2,
    'each job kept only the order lines that belong to its route');

-- Pressing the button twice must not build the case twice.
SELECT ok(
    (public.start_production_for_order('b5000000-0000-0000-0000-000000000001')
     ->> 'alreadyStarted')::boolean,
    'starting production twice returns the existing jobs');

SELECT is(
    (SELECT COUNT(*)::int FROM public.production_jobs
      WHERE order_id = 'b5000000-0000-0000-0000-000000000001' AND NOT is_backfilled),
    2,
    'and no third job was created');

-- ─── 8-10. The flag guard ────────────────────────────────────────────────

SELECT is(
    (SELECT value FROM public.app_settings WHERE key = 'production_v1'),
    'off',
    'the cutover flag ships off');

-- Walk one stage to completion, which calls the cutover on the way out.
DO $$
DECLARE v_id UUID;
BEGIN
    SELECT r.id INTO v_id
      FROM public.production_stage_runs r
      JOIN public.production_jobs j ON j.id = r.job_id
     WHERE j.order_id = 'b5000000-0000-0000-0000-000000000001' AND r.status = 'ready'
     ORDER BY r.seq LIMIT 1;

    PERFORM public.start_stage_run(v_id);
    PERFORM public.complete_stage_run(v_id);
END;
$$;

SELECT is(
    (SELECT production_status FROM public.orders
      WHERE id = 'b5000000-0000-0000-0000-000000000001'),
    'not_started',
    'with the flag off, finishing a stage does not touch the finance contract');

SELECT is(
    public.apply_production_status_from_stages('b5000000-0000-0000-0000-000000000001'),
    NULL,
    'and the cutover function itself refuses to write');

-- The safety property that matters most before the cutover: working the
-- production chain moves no money at all.
SELECT is(
    (SELECT COUNT(*)::int FROM public.financial_obligations
      WHERE order_id = 'b5000000-0000-0000-0000-000000000001'),
    0,
    'and no financial obligation was created while the flag is off');

RESET ROLE;

-- Now turn it on and prove the mechanism actually works when asked.
UPDATE public.app_settings SET value = 'on' WHERE key = 'production_v1';

SELECT set_config('request.jwt.claim.sub', 'b9000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

SELECT isnt(
    public.apply_production_status_from_stages('b5000000-0000-0000-0000-000000000001'),
    NULL,
    'with the flag on, the stage chain drives the status');

-- ─── 11-13. Cost is analytical, never a liability ────────────────────────

DO $$
DECLARE v_id UUID;
BEGIN
    LOOP
        SELECT r.id INTO v_id
          FROM public.production_stage_runs r
          JOIN public.production_jobs j ON j.id = r.job_id
         WHERE j.order_id = 'b5000000-0000-0000-0000-000000000001'
           AND r.status = 'ready'
         ORDER BY r.seq LIMIT 1;

        EXIT WHEN v_id IS NULL;
        PERFORM public.start_stage_run(v_id);
        PERFORM public.complete_stage_run(v_id);
    END LOOP;
END;
$$;

SELECT ok(
    (SELECT MAX(r.cost_amount) > 0
       FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'b5000000-0000-0000-0000-000000000001'
        AND s.code = 'finish' AND r.status = 'done'),
    'a finished internal stage carries its standard cost');

SELECT is(
    (SELECT r.cost_source FROM public.production_stage_runs r
       JOIN public.production_jobs j ON j.id = r.job_id
       JOIN public.production_stages s ON s.id = r.stage_id
      WHERE j.order_id = 'b5000000-0000-0000-0000-000000000001'
        AND s.code = 'finish' AND r.status = 'done'
      LIMIT 1),
    'standard',
    'and says where the number came from, so no figure is unattributed');

-- The load-bearing rule of the whole cost model.
--
-- With the flag on, the chain reaching its end DOES trigger the existing
-- finance pipeline -- a doctor receivable on delivery is exactly what the
-- cutover is for, and the trigger on orders has always done that. What must
-- never happen is the internal PRODUCTION COST becoming a liability: that work
-- is already an expense through payroll and materials, so booking it per order
-- as well would double-count it straight into the P&L.
-- Every obligation raised is a doctor receivable from the delivery, which the
-- trigger on orders has always produced. Nothing payable appeared: this order
-- has no outside lab, and the in-house work must not become one.
SELECT is(
    (SELECT COUNT(*)::int FROM public.financial_obligations
      WHERE order_id = 'b5000000-0000-0000-0000-000000000001'
        AND direction = 'payable'),
    0,
    'in-house production raised no payable: internal work is an expense, not a liability');

SELECT is(
    (SELECT COUNT(*)::int
       FROM public.financial_obligations fo
      WHERE fo.order_id = 'b5000000-0000-0000-0000-000000000001'
        AND fo.gross_amount IN (
            SELECT r.cost_amount
              FROM public.production_stage_runs r
              JOIN public.production_jobs j ON j.id = r.job_id
             WHERE j.order_id = 'b5000000-0000-0000-0000-000000000001'
               AND r.cost_source = 'standard'
               AND r.cost_amount IS NOT NULL)),
    0,
    'and no internal stage cost was ever billed as an amount');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
