-- Phase 5: Production Costing, Overhead, and Quality pgTAP Test Suite
-- File: supabase/tests/database/costing_and_profitability.test.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SET search_path TO public, extensions;

SELECT plan(18);

-- ─── 1. Fixtures ────────────────────────────────────────────────────────────

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('e9000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'cost-admin@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name) VALUES
    ('e8000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001',
     'cost_admin', 'admin', 'Cost Admin');

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name)
VALUES ('e7000000-0000-0000-0000-000000000001', 'Dr. Costing Test', '01011112222', 'Cairo Clinic', 'DOC-COST-01', 'Rep 1')
ON CONFLICT DO NOTHING;

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, cost, shade, status, delivery_date
) VALUES (
    'e6000000-0000-0000-0000-000000000001', 'CASE-COST-01', 'e7000000-0000-0000-0000-000000000001',
    'Patient Cost', '[{"service_name": "Zirconia Crown", "quantity": 2}]'::jsonb,
    2000.00, 600.00, 'A2', 'Delivered', CURRENT_DATE
);

SELECT set_config('request.jwt.claim.sub', 'e9000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

-- ─── 2. Table Existence ──────────────────────────────────────────────────────
SELECT has_table('public', 'labor_rates', 'labor_rates table should exist');
SELECT has_table('public', 'overhead_allocation_runs', 'overhead_allocation_runs table should exist');

-- ─── 3. Test freeze_overhead_allocation RPC ──────────────────────────────────
SELECT lives_ok(
    $$
    SELECT public.freeze_overhead_allocation('2026-08-01'::date, 50000.00, 1000, 'August 2026 Overhead');
    $$,
    'freeze_overhead_allocation should succeed with valid inputs'
);

SELECT results_eq(
    $$
    SELECT total_overhead, total_units, rate_per_unit FROM public.overhead_allocation_runs WHERE period_month = '2026-08-01'::date;
    $$,
    $$
    VALUES (50000.00::numeric, 1000, 50.00::numeric);
    $$,
    'Overhead rate per unit should be correctly calculated and stored (50000 / 1000 = 50.00)'
);

-- ─── 4. Test labor_rates insertion ───────────────────────────────────────────
SELECT lives_ok(
    $$
    INSERT INTO public.labor_rates (stage_id, rate_per_unit, effective_from)
    VALUES (
        (SELECT id FROM public.production_stages LIMIT 1), 
        25.00, 
        '2026-08-01'::date
    );
    $$,
    'Inserting default labor rate for a stage should succeed'
);

SELECT results_eq(
    $$
    SELECT rate_per_unit FROM public.labor_rates 
    WHERE stage_id = (SELECT id FROM public.production_stages LIMIT 1) 
      AND employee_id IS NULL;
    $$,
    $$
    VALUES (25.00::numeric);
    $$,
    'Default labor rate should be 25.00'
);

-- ─── 5. Test cost breakdown RPC on an order ──────────────────────────────────
SELECT lives_ok(
    $$
    SELECT public.get_order_cost_breakdown('e6000000-0000-0000-0000-000000000001'::uuid);
    $$,
    'get_order_cost_breakdown should execute cleanly on fixture order'
);

-- ─── 6. Test cost of quality report RPC ──────────────────────────────────────
SELECT lives_ok(
    $$
    SELECT public.get_cost_of_quality_report('2026-01-01'::date, '2026-12-31'::date);
    $$,
    'get_cost_of_quality_report should execute cleanly'
);

-- ─── 7. Test internal vs external benchmark RPC ──────────────────────────────
SELECT lives_ok(
    $$
    SELECT public.get_internal_vs_external_benchmark('2026-01-01'::date, '2026-12-31'::date);
    $$,
    'get_internal_vs_external_benchmark should execute cleanly'
);

-- ─── 8. Test technician material efficiency RPC ──────────────────────────────
SELECT lives_ok(
    $$
    SELECT public.get_technician_material_efficiency('2026-01-01'::date, '2026-12-31'::date);
    $$,
    'get_technician_material_efficiency should execute cleanly'
);

-- ─── 8b. Regression guards from the phase 3-6 review ─────────────────────────
RESET ROLE;

-- C3: units come from order_items, not the legacy orders.items JSONB. Reading
-- orders.items returned 1 unit for most of the live order base and silently
-- corrupted every per-unit figure.
INSERT INTO public.order_items (order_id, product_type, teeth_numbers, shade, price, count)
VALUES ('e6000000-0000-0000-0000-000000000001', 'Zirconia Crown', '["11","21"]'::jsonb, 'A2', 1000.00, 2);

SELECT is(
    (public.get_order_cost_breakdown('e6000000-0000-0000-0000-000000000001'::uuid) ->> 'total_units')::int,
    2,
    'C3: total_units is read from order_items'
);

-- C4: a cancelled case was never worked -- zero cost AND zero revenue (plan 3).
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, cost, shade, status, delivery_date
) VALUES (
    'e6000000-0000-0000-0000-000000000002', 'CASE-COST-CANCELLED',
    'e7000000-0000-0000-0000-000000000001', 'Patient Cancelled', '[]'::jsonb,
    5000.00, 1500.00, 'A2', 'Cancelled', CURRENT_DATE
);

SELECT is(
    ARRAY[
        (public.get_order_cost_breakdown('e6000000-0000-0000-0000-000000000002'::uuid) ->> 'total_cost'),
        (public.get_order_cost_breakdown('e6000000-0000-0000-0000-000000000002'::uuid) ->> 'total_price'),
        (public.get_order_cost_breakdown('e6000000-0000-0000-0000-000000000002'::uuid) ->> 'is_billable')
    ],
    ARRAY['0', '0', 'false'],
    'C4: cancelled case reports zero cost, zero revenue, and is_billable=false'
);

-- C5: a BACKFILLED internal stage run must not make an outsourced case read as
-- in-house. 20260821003000 reconstructed chains for 1152 historical orders, 277
-- of them carrying a completed internal design stage. Those were milled outside
-- and their cost is the vendor invoice -- classifying them as internal drops
-- orders.cost and reports them at zero cost and 100% margin.
INSERT INTO public.production_jobs (id, order_id, route_id, round_no, unit_count, status, is_backfilled)
SELECT 'e5500000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001',
       r.id, 1, 2, 'done', TRUE
  FROM public.production_routes r ORDER BY r.is_fallback DESC, r.created_at LIMIT 1;

INSERT INTO public.production_stage_runs (job_id, stage_id, seq, execution, status, units_in, units_passed, completed_at)
SELECT 'e5500000-0000-0000-0000-000000000001', s.id, 1, 'internal', 'done', 2, 2, now()
  FROM public.production_stages s WHERE s.code = 'design' LIMIT 1;

SELECT is(
    (public.get_order_cost_breakdown('e6000000-0000-0000-0000-000000000001'::uuid) ->> 'is_internal_production'),
    'false',
    'C5: a backfilled internal stage run does not make the case internal'
);

SELECT is(
    (public.get_order_cost_breakdown('e6000000-0000-0000-0000-000000000001'::uuid) ->> 'external_cost')::numeric,
    600.00::numeric,
    'C5: the outsourced case keeps reporting the vendor cost from orders.cost'
);

-- M1: "frozen" has to mean frozen. Re-freezing a month silently restates every
-- cost report that already used its rate.
SELECT throws_ok(
    $$
    SELECT public.freeze_overhead_allocation('2026-08-01'::date, 5000.00, 100);
    $$,
    '55006',
    NULL,
    'M1: re-freezing an already frozen month is refused without p_refreeze'
);

SELECT is(
    (public.freeze_overhead_allocation('2026-08-01'::date, 5000.00, 100, 'تصحيح', TRUE) ->> 'was_refreeze'),
    'true',
    'M1: an explicit refreeze is allowed and reports itself'
);

-- ─── 9. Negative tests ───────────────────────────────────────────────────────
SELECT throws_ok(
    $$
    SELECT public.freeze_overhead_allocation('2026-09-01'::date, -100.00, 100);
    $$,
    '22003',
    'Total overhead cannot be negative',
    'Negative overhead should be rejected'
);

SELECT throws_ok(
    $$
    SELECT public.freeze_overhead_allocation('2026-09-01'::date, 1000.00, 0);
    $$,
    '22003',
    'Total units must be greater than zero',
    'Zero units should be rejected'
);

SELECT * FROM finish();
ROLLBACK;
