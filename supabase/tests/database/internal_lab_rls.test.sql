-- Test: internal_lab_rls.test.sql
-- Purpose: Verify RLS policies for technician and production manager.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(12);

-- ─── Fixtures ────────────────────────────────────────────────────────────

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('e1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'tech-user@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('e1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'pm-user@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name) VALUES
    ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
     'tech_user', 'technician', 'Test Technician'),
    ('e2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002',
     'pm_user', 'production_manager', 'Test PM');

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name)
VALUES ('e3000000-0000-0000-0000-000000000001', 'RLS Test Doctor', '01000000001', 'Cairo', 'DOC-RLS', 'Rep');

INSERT INTO public.suppliers (id, name, phone)
VALUES ('e4000000-0000-0000-0000-000000000001', 'RLS Test Supplier', '01000000002');

-- Order 1: Has an active production job
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state
) VALUES (
    'e5000000-0000-0000-0000-000000000001', 'CASE-ACTIVE',
    'e3000000-0000-0000-0000-000000000001', 'Patient Active', '[]', 100,
    'A1', 'New Case', CURRENT_DATE, 0, 'in_production', 'none'
);

INSERT INTO public.production_jobs (id, order_id, status, priority, unit_count)
VALUES ('e6000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'active', 'Normal', 1);

-- Order 2: Has a done production job (should also be visible to technician)
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state
) VALUES (
    'e5000000-0000-0000-0000-000000000002', 'CASE-DONE',
    'e3000000-0000-0000-0000-000000000001', 'Patient Done', '[]', 150,
    'A2', 'Delivered', CURRENT_DATE, 0, 'final_delivered', 'none'
);

INSERT INTO public.production_jobs (id, order_id, status, priority, unit_count)
VALUES ('e6000000-0000-0000-0000-000000000002', 'e5000000-0000-0000-0000-000000000002', 'done', 'Normal', 1);

-- Order 3: No production job (technician should NOT see this)
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state
) VALUES (
    'e5000000-0000-0000-0000-000000000003', 'CASE-NOJOB',
    'e3000000-0000-0000-0000-000000000001', 'Patient No Job', '[]', 200,
    'A3', 'New Case', CURRENT_DATE, 0, 'not_started', 'none'
);

-- ─── Tests as Technician ──────────────────────────────────────────────────

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "e1000000-0000-0000-0000-000000000001", "role": "authenticated"}';

SELECT results_eq(
    'SELECT case_id FROM public.orders ORDER BY case_id',
    ARRAY['CASE-ACTIVE', 'CASE-DONE'],
    'Technician can read orders with active or done jobs, but not orders without jobs'
);

SELECT results_eq(
    'SELECT name FROM public.doctors WHERE id = ''e3000000-0000-0000-0000-000000000001''',
    ARRAY['RLS Test Doctor'],
    'Technician can read doctors for run card embedding'
);

SELECT results_eq(
    'SELECT name FROM public.suppliers WHERE id = ''e4000000-0000-0000-0000-000000000001''',
    ARRAY['RLS Test Supplier'],
    'Technician can read suppliers for run card embedding'
);

SELECT results_eq(
    'SELECT name FROM public.users WHERE id = ''e2000000-0000-0000-0000-000000000001''',
    ARRAY['Test Technician'],
    'Technician can read users for run card embedding'
);

-- Technician cannot update orders
UPDATE public.orders SET patient_name = 'Hacked' WHERE id = 'e5000000-0000-0000-0000-000000000001';
SELECT results_eq(
    'SELECT patient_name FROM public.orders WHERE id = ''e5000000-0000-0000-0000-000000000001''',
    ARRAY['Patient Active'],
    'Technician cannot update orders'
);

-- ─── Tests as Production Manager ──────────────────────────────────────────

SET LOCAL "request.jwt.claims" TO '{"sub": "e1000000-0000-0000-0000-000000000002", "role": "authenticated"}';

SELECT results_eq(
    'SELECT count(*)::int FROM public.orders WHERE id IN (''e5000000-0000-0000-0000-000000000001'', ''e5000000-0000-0000-0000-000000000002'', ''e5000000-0000-0000-0000-000000000003'')',
    ARRAY[3],
    'Production manager can see all orders including ones without jobs'
);

SELECT results_eq(
    'SELECT name FROM public.doctors WHERE id = ''e3000000-0000-0000-0000-000000000001''',
    ARRAY['RLS Test Doctor'],
    'Production manager can read doctors'
);

SELECT results_eq(
    'SELECT name FROM public.suppliers WHERE id = ''e4000000-0000-0000-0000-000000000001''',
    ARRAY['RLS Test Supplier'],
    'Production manager can read suppliers'
);

SELECT results_eq(
    'SELECT name FROM public.users WHERE id = ''e2000000-0000-0000-0000-000000000002''',
    ARRAY['Test PM'],
    'Production manager can read users'
);

-- Production manager cannot update orders directly
UPDATE public.orders SET patient_name = 'Hacked PM' WHERE id = 'e5000000-0000-0000-0000-000000000001';
SELECT results_eq(
    'SELECT patient_name FROM public.orders WHERE id = ''e5000000-0000-0000-0000-000000000001''',
    ARRAY['Patient Active'],
    'Production manager cannot update orders directly'
);

SELECT is_empty(
    'SELECT 1 FROM public.orders WHERE patient_name LIKE ''Hacked%''',
    'No unauthorized order updates occurred'
);

SELECT ok(true, 'internal lab RLS tests complete');

ROLLBACK;
