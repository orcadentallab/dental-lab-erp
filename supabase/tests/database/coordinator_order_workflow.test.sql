BEGIN;
SET search_path TO public, extensions;
SELECT plan(25);

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
SELECT throws_ok($$UPDATE public.orders SET patient_name='Bypass' WHERE case_id='COORD-FINAL'$$, '42501',
    'Coordinator order edits require the audited RPC', 'Direct order update is denied');
SELECT throws_ok($$SELECT public.update_order_atomic('51cc0000-0000-4000-8000-000000000012',
    '{"production_status":"final_ready","patient_name":"Bypass"}', NULL, NULL)$$, '42501',
    'Coordinator order edits require the audited RPC', 'Valid workflow action cannot carry an unaudited edit');
SELECT lives_ok($$SELECT public.rep_update_order_fields_with_audit('51cc0000-0000-4000-8000-000000000012',
    '{"patient_name":"Audited patient","items":[{"serviceType":"Test","teethNumbers":["11"],"price":100,"shade":"A1"}]}',
    'internal_correction', NULL)$$, 'Audited edit can change order data and line items');
SELECT is((SELECT patient_name FROM public.orders WHERE case_id='COORD-FINAL'),
    'Audited patient', 'Audited patient name persisted');
SELECT throws_ok($$UPDATE public.order_items SET price=200 WHERE order_id='51cc0000-0000-4000-8000-000000000012'$$,
    '42501', 'Coordinator order edits require the audited RPC', 'Direct item update is denied');
SELECT throws_ok($$DELETE FROM public.order_items WHERE order_id='51cc0000-0000-4000-8000-000000000012'$$,
    '42501', 'Coordinator order edits require the audited RPC', 'Direct item deletion is denied');
SELECT throws_ok($$INSERT INTO public.order_items(order_id,product_type,teeth_numbers,price)
    VALUES ('51cc0000-0000-4000-8000-000000000012','Test','["12"]',100)$$,
    '42501', 'Coordinator order edits require the audited RPC', 'Direct item insert on an existing order is denied');
SELECT lives_ok($$INSERT INTO storage.objects(bucket_id,name)
    VALUES ('case-files','51cc0000-0000-4000-8000-000000000012/instruction/coordinator-test.pdf')$$,
    'Coordinator can upload a case attachment');
SELECT lives_ok($$INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,
    shade,production_status,intake_state,delivery_date,delivery_type,workflow_type)
    VALUES ('51cc0000-0000-4000-8000-000000000014','COORD-INTAKE','51cc0000-0000-4000-8000-000000000010',
      'Test patient','[{"serviceType":"Test","teethNumbers":["11","12"],"price":100,"shade":"A1"}]',
      200,0,'A1','not_started','pending_review',current_date,'Final','full')$$, 'Coordinator can create an order');
SELECT is((SELECT count FROM public.order_items WHERE order_id='51cc0000-0000-4000-8000-000000000014'),
    2, 'New order items are stored in the same operation');
SELECT lives_ok($$SELECT public.accept_coordinator_order('51cc0000-0000-4000-8000-000000000014',
    'COORD-INTAKE', 'full', NULL, NULL, now(), current_date)$$, 'Coordinator can accept a pending intake');
SELECT throws_ok($$SELECT public.accept_coordinator_order('51cc0000-0000-4000-8000-000000000014',
    'COORD-INTAKE', 'full', NULL, NULL, now(), current_date)$$, '22023',
    'Order is not awaiting intake', 'Intake operation cannot edit the case a second time');
SELECT lives_ok($$SELECT public.apply_order_issue_transition_v2('51cc0000-0000-4000-8000-000000000014',
    'cancel_order','Synthetic cancellation',gen_random_uuid())$$, 'Coordinator can cancel using the workflow RPC');
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
