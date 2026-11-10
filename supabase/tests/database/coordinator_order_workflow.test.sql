BEGIN;
SET search_path TO public, extensions;
SELECT plan(12);

UPDATE public.app_settings SET value = 'on'
WHERE key IN ('workflow_issue_v2_write', 'workflow_issue_v2_enforce');

INSERT INTO auth.users(id, email) VALUES
    ('51cc0000-0000-4000-8000-000000000001', 'workflow-coordinator@example.test'),
    ('51cc0000-0000-4000-8000-000000000002', 'workflow-accountant@example.test');
INSERT INTO public.users(id, auth_id, username, role, name) VALUES
    ('51cc0000-0000-4000-8000-000000000001', '51cc0000-0000-4000-8000-000000000001', 'workflow_coordinator', 'coordinator', 'Coordinator'),
    ('51cc0000-0000-4000-8000-000000000002', '51cc0000-0000-4000-8000-000000000002', 'workflow_accountant', 'accountant', 'Accountant');
INSERT INTO public.doctors(id, name, phone, address, doctor_code, representative_name)
VALUES ('51cc0000-0000-4000-8000-000000000010', 'Test doctor', '01012341234', 'Test', 'COORD-WORKFLOW', 'Test');
INSERT INTO public.orders(id, case_id, doctor_id, patient_name, items, total_price, cost,
    shade, production_status, delivery_date, delivery_type, workflow_type)
VALUES
    ('51cc0000-0000-4000-8000-000000000011', 'COORD-TRYIN', '51cc0000-0000-4000-8000-000000000010',
     'Test patient', '[]', 1000, 0, 'A1', 'in_production', current_date, 'TryIn', 'full'),
    ('51cc0000-0000-4000-8000-000000000012', 'COORD-FINAL', '51cc0000-0000-4000-8000-000000000010',
     'Test patient', '[]', 1000, 0, 'A1', 'in_production', current_date, 'Final', 'full'),
    ('51cc0000-0000-4000-8000-000000000013', 'COORD-SPLIT', '51cc0000-0000-4000-8000-000000000010',
     'Test patient', '[]', 1000, 0, 'A1', 'designing', current_date, 'Final', 'split');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '51cc0000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.update_order_atomic('51cc0000-0000-4000-8000-000000000012',
    '{"production_status":"final_ready"}', NULL, NULL)$$, 'P0001',
    'accountant cannot change workflow or delivery fields', 'Accountant remains blocked');

SELECT set_config('request.jwt.claim.sub', '51cc0000-0000-4000-8000-000000000001', true);
SELECT throws_ok($$SELECT public.update_order_atomic('51cc0000-0000-4000-8000-000000000011',
    '{"production_status":"final_ready"}', NULL, NULL)$$, 'P0001',
    'انتقال الحالة غير مسموح للمنسق من المرحلة الحالية', 'Coordinator cannot skip the Try-In');
SELECT lives_ok($$SELECT public.update_order_atomic('51cc0000-0000-4000-8000-000000000011',
    '{"production_status":"try_in_ready"}', NULL, NULL)$$, 'Coordinator can mark the Try-In ready');
SELECT lives_ok($$SELECT public.update_order_atomic('51cc0000-0000-4000-8000-000000000011',
    '{"production_status":"finalization"}', NULL, NULL)$$, 'Coordinator can move an approved Try-In to finalization');
SELECT lives_ok($$SELECT public.update_order_atomic('51cc0000-0000-4000-8000-000000000011',
    '{"production_status":"final_ready"}', NULL, NULL)$$, 'Coordinator can mark the completed Try-In ready for delivery');
SELECT lives_ok($$SELECT public.update_order_atomic('51cc0000-0000-4000-8000-000000000012',
    '{"production_status":"designing"}', NULL, NULL)$$, 'Coordinator can send a case back to design');
SELECT lives_ok($$SELECT public.update_order_atomic('51cc0000-0000-4000-8000-000000000012',
    '{"production_status":"in_production"}', NULL, NULL)$$, 'Full-workflow case can reenter production');
SELECT lives_ok($$SELECT public.update_order_atomic('51cc0000-0000-4000-8000-000000000012',
    '{"production_status":"final_ready"}', NULL, NULL)$$, 'Coordinator can mark a Final case ready');
SELECT throws_ok($$SELECT public.update_order_atomic('51cc0000-0000-4000-8000-000000000012',
    '{"production_status":"final_delivered"}', NULL, NULL)$$, 'P0001',
    'انتقال الحالة غير مسموح للمنسق من المرحلة الحالية', 'Coordinator must record delivery through the delivery RPC');
SELECT lives_ok($$SELECT public.record_order_final_delivery_v2('51cc0000-0000-4000-8000-000000000012',
    now(), gen_random_uuid())$$, 'Coordinator can record final delivery');
SELECT is((SELECT production_status FROM public.orders WHERE case_id = 'COORD-FINAL'),
    'final_delivered', 'Delivery persists the final stage');
SELECT throws_ok($$SELECT public.update_order_atomic('51cc0000-0000-4000-8000-000000000013',
    '{"production_status":"in_production"}', NULL, NULL)$$, 'P0001',
    'انتقال الحالة غير مسموح للمنسق من المرحلة الحالية', 'Split case still requires a design');

SELECT * FROM finish();
ROLLBACK;
