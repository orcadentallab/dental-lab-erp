-- Doctor logins see only their own entity's data.
-- Covers 20261125100000_doctor_access_lockdown.sql. Runs in a transaction and rolls back.
BEGIN;
SET search_path TO public, extensions;
SELECT plan(17);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
    ('92000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lock-admin@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('92000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lock-doc-a@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name, custom_prices) VALUES
    ('12000000-0000-0000-0000-00000000000a', 'Lock Doctor A', '01000000001', 'Test', 'LOCK-A', 'Rep', '{"Lock Crown": 70}'::jsonb),
    ('12000000-0000-0000-0000-00000000000b', 'Lock Doctor B', '01000000002', 'Test', 'LOCK-B', 'Rep', '{"Lock Crown": 10}'::jsonb);

INSERT INTO public.users (id, auth_id, username, role, name, entity_id) VALUES
    ('32000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', 'lock_admin', 'admin', 'Lock Admin', NULL),
    ('32000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000002', 'lock_doc_a', 'doctor', 'Lock Doctor A', '12000000-0000-0000-0000-00000000000a');

INSERT INTO public.services (id, name, selling_price, cost_price) VALUES
    ('52000000-0000-0000-0000-000000000001', 'Lock Crown', 100, 33);

INSERT INTO public.orders (id, case_id, doctor_id, patient_name, items, total_price, shade, status, delivery_date, cost, production_status, issue_state)
VALUES ('42000000-0000-0000-0000-000000000001', 'LOCK-1', '12000000-0000-0000-0000-00000000000b', 'P', '[]', 100, 'A1', 'New Case', CURRENT_DATE, 0, 'not_started', 'none');

INSERT INTO public.order_attachments (order_id, storage_path, kind) VALUES
    ('42000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001/qc-internal.jpg', 'qc');
INSERT INTO storage.objects (bucket_id, name) VALUES ('case-files', '42000000-0000-0000-0000-000000000001/qc-internal.jpg');
-- Doctor A's own case: one instruction file he may open, one internal QC photo he may not.
INSERT INTO public.orders (id, case_id, doctor_id, patient_name, items, total_price, shade, status, delivery_date, cost, production_status, issue_state)
VALUES ('42000000-0000-0000-0000-000000000002', 'LOCK-2', '12000000-0000-0000-0000-00000000000a', 'P2', '[]', 100, 'A1', 'New Case', CURRENT_DATE, 0, 'not_started', 'none');
INSERT INTO public.order_attachments (order_id, storage_path, kind) VALUES
    ('42000000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-000000000002/instruction/scan.jpg', 'instruction'),
    ('42000000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-000000000002/qc/internal.jpg', 'qc');
INSERT INTO storage.objects (bucket_id, name) VALUES
    ('case-files', '42000000-0000-0000-0000-000000000002/instruction/scan.jpg'),
    ('case-files', '42000000-0000-0000-0000-000000000002/qc/internal.jpg');

-- Doctor A
SELECT set_config('request.jwt.claim.sub', '92000000-0000-0000-0000-000000000002', TRUE);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*)::int FROM public.order_attachments), 1, 'doctor reads exactly one attachment row (his own instruction file)');
SELECT is((SELECT kind FROM public.order_attachments), 'instruction', 'the visible attachment is the instruction file, never qc');
SELECT is((SELECT count(*)::int FROM public.order_attachments WHERE order_id = '42000000-0000-0000-0000-000000000001'), 0, 'another doctor''s attachments are not visible');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'case-files'), 1, 'doctor opens exactly one case file (his own instruction file)');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE name LIKE '%/qc/%' OR name LIKE '%qc-internal%'), 0, 'internal QC photos are not readable');
SELECT is((SELECT count(*)::int FROM public.doctors), 1, 'doctor sees exactly one doctors row');
SELECT is((SELECT id FROM public.doctors), '12000000-0000-0000-0000-00000000000a'::uuid, 'the doctors row is the doctor''s own entity');
SELECT is((SELECT count(*)::int FROM public.doctors WHERE id = '12000000-0000-0000-0000-00000000000b'), 0, 'doctor cannot read another doctor (phone, prices)');
SELECT is((SELECT count(*)::int FROM public.services), 0, 'doctor cannot read the services table (cost columns)');
SELECT is((SELECT count(*)::int FROM public.orders), 0, 'doctor cannot read orders directly');
SELECT is((SELECT price FROM public.get_my_doctor_service_catalog() WHERE name = 'Lock Crown'), 70::numeric, 'catalog returns the doctor''s own custom price');
SELECT is(
    (SELECT count(*)::int FROM pg_proc p, unnest(p.proargnames) n
      WHERE p.oid = 'public.get_my_doctor_service_catalog()'::regprocedure
        AND n IN ('cost_price', 'designer_price', 'milling_price')),
    0, 'catalog exposes no cost columns');

RESET ROLE;
-- Admin still works
SELECT set_config('request.jwt.claim.sub', '92000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.order_attachments), 3, 'admin still reads order attachments');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'case-files'), 3, 'admin still reads case files');
SELECT ok((SELECT count(*) FROM public.services) >= 1, 'admin still reads services');
RESET ROLE;

SELECT is(
    (SELECT string_agg(c.relname, ',' ORDER BY c.relname)
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('production_jobs','production_stage_runs','external_work_orders','machines','work_calendars')
        AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname
                          AND p.policyname = 'doctor_blocked_' || c.relname AND p.permissive = 'RESTRICTIVE')),
    NULL, 'internal production tables carry the doctor-blocking restrictive policy');
SELECT is(
    (SELECT count(*)::int FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='doctor_blocked_internal_buckets' AND permissive='RESTRICTIVE'),
    1, 'storage backstop policy exists');

SELECT * FROM finish();
ROLLBACK;
