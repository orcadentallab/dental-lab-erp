-- Phase 6: Production Capacity, Bottlenecks, Empirical Lead Times & Delivery Date Prediction
-- File: supabase/tests/database/capacity_and_bottlenecks.test.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SET search_path TO public, extensions;

SELECT plan(10);

-- ─── 1. Fixtures ────────────────────────────────────────────────────────────

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('f9000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'cap-admin@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('f9000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'cap-tech@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name) VALUES
    ('f8000000-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-000000000001',
     'cap_admin', 'admin', 'Capacity Admin'),
    ('f8000000-0000-0000-0000-000000000002', 'f9000000-0000-0000-0000-000000000002',
     'cap_tech', 'technician', 'Capacity Tech');

INSERT INTO public.services (id, name, selling_price, cost_price)
VALUES ('f7000000-0000-0000-0000-000000000001', 'Service Cap Test', 1000.00, 300.00)
ON CONFLICT DO NOTHING;

SELECT set_config('request.jwt.claim.sub', 'f9000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

-- ─── 2. Test get_production_capacity_and_bottlenecks RPC ────────────────────
SELECT lives_ok(
    $$
    SELECT public.get_production_capacity_and_bottlenecks('2026-01-01'::date, '2026-12-31'::date);
    $$,
    'get_production_capacity_and_bottlenecks should execute cleanly'
);

SELECT ok(
    (SELECT (public.get_production_capacity_and_bottlenecks('2026-01-01'::date, '2026-12-31'::date)->'stages') IS NOT NULL),
    'get_production_capacity_and_bottlenecks returns stages array'
);

-- ─── 3. Test get_supplier_lead_time_analytics RPC ────────────────────────────
SELECT lives_ok(
    $$
    SELECT public.get_supplier_lead_time_analytics('2026-01-01'::date, '2026-12-31'::date);
    $$,
    'get_supplier_lead_time_analytics should execute cleanly'
);

SELECT ok(
    (SELECT (public.get_supplier_lead_time_analytics('2026-01-01'::date, '2026-12-31'::date)->'suppliers') IS NOT NULL),
    'get_supplier_lead_time_analytics returns suppliers array'
);

-- ─── 4. Test estimate_order_delivery_time RPC ───────────────────────────────
SELECT lives_ok(
    $$
    SELECT public.estimate_order_delivery_time('f7000000-0000-0000-0000-000000000001'::uuid, 2);
    $$,
    'estimate_order_delivery_time should calculate completion for service fixture'
);

SELECT ok(
    (SELECT (public.estimate_order_delivery_time('f7000000-0000-0000-0000-000000000001'::uuid, 1)->>'estimated_delivery_date') IS NOT NULL),
    'estimate_order_delivery_time returns estimated_delivery_date'
);

SELECT ok(
    (SELECT (public.estimate_order_delivery_time('f7000000-0000-0000-0000-000000000001'::uuid, 1)->>'confidence_level') IN ('high', 'moderate', 'default_estimate')),
    'estimate_order_delivery_time returns a valid confidence level'
);

-- ─── 5. Test get_team_throughput_and_productivity RPC ───────────────────────
SELECT lives_ok(
    $$
    SELECT public.get_team_throughput_and_productivity('2026-01-01'::date, '2026-12-31'::date);
    $$,
    'get_team_throughput_and_productivity should execute cleanly'
);

SELECT ok(
    (SELECT (public.get_team_throughput_and_productivity('2026-01-01'::date, '2026-12-31'::date)->'team_productivity') IS NOT NULL),
    'get_team_throughput_and_productivity returns team_productivity array'
);

-- ─── 6. Permissions / Security check ────────────────────────────────────────
SET LOCAL ROLE anon;

SELECT throws_ok(
    $$
    SELECT public.get_production_capacity_and_bottlenecks('2026-01-01'::date, '2026-12-31'::date);
    $$,
    '42501',
    NULL,
    'Anonymous role must be denied get_production_capacity_and_bottlenecks'
);

SELECT * FROM finish();
ROLLBACK;
