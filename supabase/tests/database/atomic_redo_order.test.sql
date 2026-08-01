BEGIN;

SET search_path TO public, extensions;

SELECT plan(18);

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
    '90000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'redo-admin@example.test', '',
    '{}'::jsonb, '{}'::jsonb, now(), now()
);

INSERT INTO public.users (id, auth_id, username, role, name)
VALUES (
    '30000000-0000-0000-0000-000000000101',
    '90000000-0000-0000-0000-000000000001',
    'redo_test_admin', 'admin', 'Redo Test Admin'
);

SELECT set_config(
    'request.jwt.claim.sub',
    '90000000-0000-0000-0000-000000000001',
    TRUE
);

INSERT INTO public.doctors (
    id, name, phone, address, doctor_code, representative_name
) VALUES (
    '10000000-0000-0000-0000-000000000101',
    'Redo test doctor', '01000000000', 'Test address', 'DBREDO', 'Test rep'
);

INSERT INTO public.suppliers (id, name, phone)
VALUES (
    '20000000-0000-0000-0000-000000000101',
    'Redo test supplier', '01000000000'
);

INSERT INTO public.users (id, username, role, name)
VALUES (
    '30000000-0000-0000-0000-000000000102',
    'redo_test_designer', 'designer', 'Redo Test Designer'
);

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, discount, total_price, shade,
    status, delivery_date, actual_delivery_date, cost, supplier_id,
    workflow_type, designer_id, design_status, design_price,
    production_status, issue_state, is_registered
) VALUES (
    '40000000-0000-0000-0000-000000000101', 'DBREDO-ORIGINAL',
    '10000000-0000-0000-0000-000000000101', 'Redo patient',
    '[{"serviceType":"Zr","teethNumbers":["11","12"],"price":1000}]'::jsonb,
    50, 1000, 'A1', 'Delivered', CURRENT_DATE, CURRENT_DATE, 400,
    '20000000-0000-0000-0000-000000000101', 'split',
    '30000000-0000-0000-0000-000000000102', 'completed', 100,
    'final_delivered', 'none', TRUE
);

INSERT INTO public.order_items (
    order_id, product_type, teeth_numbers, shade, price, count
) VALUES
    ('40000000-0000-0000-0000-000000000101', 'Zr', '["11"]', 'A1', 500, 1),
    ('40000000-0000-0000-0000-000000000101', 'Zr', '["12"]', 'A1', 500, 1);

CREATE TEMP TABLE redo_rpc_result (payload jsonb);

INSERT INTO redo_rpc_result (payload)
SELECT public.create_redo_order_atomic(
    '40000000-0000-0000-0000-000000000101',
    'lab_error',
    'The remake must be atomic',
    120,
    40
);

SELECT ok(
    (SELECT (payload->>'newOrderId')::uuid IS NOT NULL FROM redo_rpc_result),
    'atomic redo returns the new order id'
);

SELECT ok(
    (SELECT payload->>'newCaseId' ~ '^DBREDO-[0-9]{6}-[0-9]+$'
     FROM redo_rpc_result),
    'atomic redo generates a doctor-owned case id'
);

SELECT ok((
    SELECT status = 'Doctor Rejected'
       AND issue_state = 'redo'
       AND production_status = 'not_started'
       AND actual_delivery_date IS NULL
    FROM public.orders
    WHERE id = '40000000-0000-0000-0000-000000000101'
), 'atomic redo closes the original in the redo issue state');

SELECT ok((
    SELECT is_redo
       AND original_order_id = '40000000-0000-0000-0000-000000000101'
       AND status = 'New Case'
       AND issue_state = 'none'
       AND production_status = 'not_started'
    FROM public.orders
    WHERE id = (SELECT (payload->>'newOrderId')::uuid FROM redo_rpc_result)
), 'atomic redo creates one linked replacement order');

SELECT ok((
    SELECT doctor_id = '10000000-0000-0000-0000-000000000101'
       AND patient_name = 'Redo patient'
       AND total_price = 1000
       AND discount = 50
       AND cost = 400
       AND supplier_id = '20000000-0000-0000-0000-000000000101'
       AND designer_id = '30000000-0000-0000-0000-000000000102'
       AND design_status = 'pending'
    FROM public.orders
    WHERE id = (SELECT (payload->>'newOrderId')::uuid FROM redo_rpc_result)
), 'replacement order copies the required business fields and resets workflow');

SELECT is((
    SELECT count(*)::integer
    FROM public.order_items
    WHERE order_id = (SELECT (payload->>'newOrderId')::uuid FROM redo_rpc_result)
), 2, 'replacement order copies normalized items');

SELECT ok((
    SELECT rejected_lab_cost = 120 AND rejected_lab_cost_status = 'resolved'
    FROM public.orders
    WHERE id = '40000000-0000-0000-0000-000000000101'
), 'redo resolves the separately entered supplier settlement');

SELECT ok((
    SELECT rejected_designer_cost = 40
       AND rejected_designer_cost_status = 'resolved'
    FROM public.orders
    WHERE id = '40000000-0000-0000-0000-000000000101'
), 'redo resolves the separately entered designer settlement');

SELECT is((
    SELECT count(*)::integer FROM public.order_comments
    WHERE order_id = '40000000-0000-0000-0000-000000000101'
      AND content LIKE 'إعادة إنتاج من #%'
), 1, 'original order receives the remake comment');

SELECT is((
    SELECT count(*)::integer FROM public.order_comments
    WHERE order_id = (SELECT (payload->>'newOrderId')::uuid FROM redo_rpc_result)
      AND content LIKE 'إعادة إنتاج من #%'
), 1, 'replacement order receives the remake comment');

SELECT is((
    SELECT count(*)::integer FROM public.order_events
    WHERE order_id = '40000000-0000-0000-0000-000000000101'
      AND event_type = 'remake_requested'
      AND metadata->>'atomicRedo' = 'true'
), 1, 'original order receives an atomic remake event');

SELECT is((
    SELECT count(*)::integer FROM public.order_events
    WHERE order_id = (SELECT (payload->>'newOrderId')::uuid FROM redo_rpc_result)
      AND event_type = 'order_created'
      AND metadata->>'atomicRedo' = 'true'
), 1, 'replacement order receives an atomic creation event');

SELECT is((
    SELECT count(*)::integer FROM public.financial_obligations
    WHERE order_id = '40000000-0000-0000-0000-000000000101'
      AND trigger_type IN ('doctor_delivered', 'external_lab_ready', 'designer_approved')
      AND status <> 'void'
), 0, 'redo voids every normal original-order obligation');

SELECT is((
    SELECT gross_amount FROM public.financial_obligations
    WHERE order_id = '40000000-0000-0000-0000-000000000101'
      AND trigger_type = 'external_lab_issue_settlement'
      AND status <> 'void'
), 120::numeric, 'redo creates the approved supplier issue settlement');

SELECT is((
    SELECT gross_amount FROM public.financial_obligations
    WHERE order_id = '40000000-0000-0000-0000-000000000101'
      AND trigger_type = 'designer_issue_settlement'
      AND status <> 'void'
), 40::numeric, 'redo creates the approved designer issue settlement');

SELECT is((
    SELECT count(*)::integer FROM public.financial_obligations
    WHERE order_id = (SELECT (payload->>'newOrderId')::uuid FROM redo_rpc_result)
      AND status <> 'void'
), 0, 'new redo order starts without financial obligations');

SELECT throws_like(
    $$SELECT public.create_redo_order_atomic(
        '40000000-0000-0000-0000-000000000101',
        'other', 'Duplicate redo attempt', NULL, NULL
    )$$,
    '%already-redone orders cannot create another redo%',
    'the original cannot create a duplicate redo'
);

SELECT is((
    SELECT count(*)::integer FROM public.orders
    WHERE original_order_id = '40000000-0000-0000-0000-000000000101'
      AND COALESCE(is_deleted, FALSE) = FALSE
), 1, 'a failed duplicate attempt leaves exactly one replacement order');

SELECT * FROM finish();
ROLLBACK;
