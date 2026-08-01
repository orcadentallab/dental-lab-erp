BEGIN;

SET search_path TO public, extensions;

SELECT plan(13);

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
    '92000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'workflow-admin@example.test', '',
    '{}'::jsonb, '{}'::jsonb, now(), now()
);

INSERT INTO public.users (id, auth_id, username, role, name)
VALUES (
    '32000000-0000-0000-0000-000000000001',
    '92000000-0000-0000-0000-000000000001',
    'workflow_admin', 'admin', 'Workflow Admin'
);

SELECT set_config(
    'request.jwt.claim.sub',
    '92000000-0000-0000-0000-000000000001',
    TRUE
);

INSERT INTO public.doctors (
    id, name, phone, address, doctor_code, representative_name
) VALUES (
    '12000000-0000-0000-0000-000000000001',
    'Workflow doctor', '01000000000', 'Test address', 'WORKFLOW-ATOMIC', 'Test rep'
);

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, actual_delivery_date, cost, production_status, issue_state,
    is_deleted
) VALUES (
    '42000000-0000-0000-0000-000000000001', 'WORKFLOW-ATOMIC-1',
    '12000000-0000-0000-0000-000000000001', 'Workflow patient', '[]',
    1000, 'A1', 'Delivered', CURRENT_DATE, CURRENT_DATE, 0,
    'final_delivered', 'none', FALSE
);

SELECT is(
    (SELECT net_amount FROM public.financial_obligations
     WHERE order_id = '42000000-0000-0000-0000-000000000001'
       AND entity_type = 'doctor' AND status <> 'void'),
    1000::numeric,
    'delivering an order creates its doctor obligation in the database transaction'
);

INSERT INTO public.transactions (
    id, type, amount, category, date, description, entity_id, entity_type,
    status, is_approved
) VALUES (
    '52000000-0000-0000-0000-000000000001', 'income', 500,
    'collection', CURRENT_DATE, 'Workflow atomic payment',
    '12000000-0000-0000-0000-000000000001', 'doctor', 'approved', TRUE
);

SELECT is(
    (SELECT COALESCE(SUM(allocated_amount), 0)
     FROM public.payment_allocations
     WHERE payment_transaction_id = '52000000-0000-0000-0000-000000000001'
       AND status = 'active'),
    500::numeric,
    'the approved payment is allocated before deletion'
);

SELECT is(
    (SELECT allocated_by FROM public.payment_allocations
     WHERE payment_transaction_id = '52000000-0000-0000-0000-000000000001'
       AND status = 'active'),
    '32000000-0000-0000-0000-000000000001'::uuid,
    'doctor allocation records the public user profile id, not auth.uid()'
);

SELECT is(
    (SELECT status FROM public.financial_obligations
     WHERE order_id = '42000000-0000-0000-0000-000000000001'
       AND entity_type = 'doctor' AND status <> 'void'),
    'partially_paid'::text,
    'the delivered obligation is partially paid'
);

SELECT throws_ok(
    $$
        UPDATE public.orders
        SET is_deleted = TRUE
        WHERE id = '42000000-0000-0000-0000-000000000001'
    $$,
    'P0001',
    'Financially active orders cannot be deleted; use soft_delete_order_atomic',
    'direct deletion of a financially active order remains blocked'
);

SELECT public.soft_delete_order_atomic(
    '42000000-0000-0000-0000-000000000001'
);

SELECT is(
    (SELECT is_deleted FROM public.orders
     WHERE id = '42000000-0000-0000-0000-000000000001'),
    TRUE,
    'the order soft-delete commits'
);

SELECT is(
    (SELECT status FROM public.financial_obligations
     WHERE order_id = '42000000-0000-0000-0000-000000000001'
       AND entity_type = 'doctor'),
    'void'::text,
    'the same transaction voids the doctor obligation'
);

SELECT is(
    (SELECT count(*)::integer FROM public.payment_allocations
     WHERE payment_transaction_id = '52000000-0000-0000-0000-000000000001'
       AND status = 'active'),
    0,
    'the same transaction removes active allocation from the void obligation'
);

SELECT is(
    (SELECT remaining_amount FROM public.account_credits
     WHERE source_transaction_id = '52000000-0000-0000-0000-000000000001'
       AND status = 'active'),
    500::numeric,
    'the same transaction preserves the payment as doctor credit'
);

SELECT is(
    (SELECT 500
          - COALESCE((SELECT SUM(allocated_amount)
                      FROM public.payment_allocations
                      WHERE payment_transaction_id = '52000000-0000-0000-0000-000000000001'
                        AND status = 'active'), 0)
          - COALESCE((SELECT SUM(remaining_amount)
                      FROM public.account_credits
                      WHERE source_transaction_id = '52000000-0000-0000-0000-000000000001'
                        AND status IN ('active', 'review')), 0)),
    0::numeric,
    'no part of the payment is lost after the workflow mutation'
);

SELECT is(
    (SELECT count(*)::integer
     FROM public.payment_allocations allocation
     JOIN public.financial_obligations obligation ON obligation.id = allocation.obligation_id
     WHERE allocation.status = 'active' AND obligation.status = 'void'),
    0,
    'no active allocation points to a void obligation'
);

-- The same actor-id contract applies to automatic supplier/designer payments.
INSERT INTO public.suppliers (id, name, phone)
VALUES (
    '22000000-0000-0000-0000-000000000001',
    'Workflow supplier', '01000000001'
);

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, supplier_id, production_status, issue_state
) VALUES (
    '42000000-0000-0000-0000-000000000002', 'WORKFLOW-PAYABLE-1',
    '12000000-0000-0000-0000-000000000001', 'Payable patient', '[]',
    1000, 'A1', 'Ready', CURRENT_DATE, 600,
    '22000000-0000-0000-0000-000000000001', 'final_ready', 'none'
);

INSERT INTO public.transactions (
    id, type, amount, category, date, description, entity_id, entity_type,
    status, is_approved
) VALUES (
    '52000000-0000-0000-0000-000000000002', 'expense', 200,
    'supplier_payment', CURRENT_DATE, 'Workflow supplier payment',
    '22000000-0000-0000-0000-000000000001', 'supplier', 'approved', TRUE
);

SELECT is(
    (SELECT COALESCE(SUM(allocated_amount), 0)
     FROM public.payment_allocations
     WHERE payment_transaction_id = '52000000-0000-0000-0000-000000000002'
       AND status = 'active'),
    200::numeric,
    'approved supplier payment allocates successfully for an authenticated user'
);

SELECT is(
    (SELECT allocated_by FROM public.payment_allocations
     WHERE payment_transaction_id = '52000000-0000-0000-0000-000000000002'
       AND status = 'active'),
    '32000000-0000-0000-0000-000000000001'::uuid,
    'supplier allocation records the public user profile id'
);

SELECT * FROM finish();
ROLLBACK;
