BEGIN;

SET search_path TO public, extensions;

SELECT plan(30);

-- Every fixture is intentionally isolated by entity. This prevents FIFO credit
-- application in one scenario from consuming another scenario's obligations.
INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name)
SELECT
    ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    'DB test doctor ' || n,
    '01000000000',
    'DB test address',
    'DBTEST-' || n,
    'DB test representative'
FROM generate_series(1, 8) AS fixture(n);

INSERT INTO public.suppliers (id, name, phone)
SELECT
    ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    'DB test supplier ' || n,
    '01000000000'
FROM generate_series(1, 8) AS fixture(n);

INSERT INTO public.users (id, username, role, name)
SELECT
    ('30000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    'db_test_designer_' || n,
    'designer',
    'DB test designer ' || n
FROM generate_series(1, 8) AS fixture(n);

-- 1. Delivered price correction after full payment: transfer the amount that
-- still belongs to the replacement obligation and turn the excess into credit.
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, actual_delivery_date, cost, supplier_id,
    production_status, issue_state
) VALUES (
    '40000000-0000-0000-0000-000000000001', 'DBTEST-PRICE',
    '10000000-0000-0000-0000-000000000001', 'Price correction', '[]',
    1000, 'A1', 'Delivered', CURRENT_DATE, CURRENT_DATE, 0, NULL,
    'final_delivered', 'none'
);

SELECT is(
    (SELECT gross_amount FROM public.financial_obligations
     WHERE order_id = '40000000-0000-0000-0000-000000000001'
       AND entity_type = 'doctor' AND status <> 'void'),
    1000::numeric,
    'delivered order creates the original doctor receivable'
);

INSERT INTO public.transactions (
    id, type, amount, category, date, description, entity_id, entity_type
) VALUES (
    '50000000-0000-0000-0000-000000000001', 'income', 1000,
    'DB test payment', CURRENT_DATE, 'DB test payment',
    '10000000-0000-0000-0000-000000000001', 'doctor'
);

INSERT INTO public.payment_allocations (
    payment_transaction_id, obligation_id, entity_type, entity_id, direction,
    allocated_amount, allocation_method, status
)
SELECT
    '50000000-0000-0000-0000-000000000001', id, entity_type, entity_id,
    direction, 1000, 'manual', 'active'
FROM public.financial_obligations
WHERE order_id = '40000000-0000-0000-0000-000000000001'
  AND entity_type = 'doctor' AND status <> 'void';

UPDATE public.financial_obligations
SET allocated_amount = 1000, status = 'paid'
WHERE order_id = '40000000-0000-0000-0000-000000000001'
  AND entity_type = 'doctor' AND status <> 'void';

UPDATE public.orders
SET total_price = 800
WHERE id = '40000000-0000-0000-0000-000000000001';

SELECT is(
    (SELECT gross_amount FROM public.financial_obligations
     WHERE order_id = '40000000-0000-0000-0000-000000000001'
       AND entity_type = 'doctor' AND status <> 'void'),
    800::numeric,
    'price correction replaces the receivable with the corrected amount'
);

SELECT is(
    (SELECT allocated_amount FROM public.financial_obligations
     WHERE order_id = '40000000-0000-0000-0000-000000000001'
       AND entity_type = 'doctor' AND status <> 'void'),
    800::numeric,
    'corrected receivable retains the applicable paid amount'
);

SELECT is(
    (SELECT count(*)::integer FROM public.payment_allocations
     WHERE payment_transaction_id = '50000000-0000-0000-0000-000000000001'
       AND status = 'reversed'),
    1,
    'the original payment allocation is reversed'
);

SELECT is(
    (SELECT allocated_amount FROM public.payment_allocations
     WHERE payment_transaction_id = '50000000-0000-0000-0000-000000000001'
       AND allocation_method = 'correction_transfer' AND status = 'active'),
    800::numeric,
    'the corrected amount is transferred atomically'
);

SELECT is(
    (SELECT remaining_amount FROM public.account_credits
     WHERE source_transaction_id = '50000000-0000-0000-0000-000000000001'
       AND status = 'active'),
    200::numeric,
    'the payment excess becomes an active doctor credit'
);

-- 2. Doctor change after payment transfers the allocation to the replacement
-- receivable and does not leave credit behind when the amount is unchanged.
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, actual_delivery_date, cost, production_status, issue_state
) VALUES (
    '40000000-0000-0000-0000-000000000002', 'DBTEST-DOCTOR',
    '10000000-0000-0000-0000-000000000002', 'Doctor change', '[]',
    500, 'A1', 'Delivered', CURRENT_DATE, CURRENT_DATE, 0,
    'final_delivered', 'none'
);

INSERT INTO public.transactions (
    id, type, amount, category, date, description, entity_id, entity_type
) VALUES (
    '50000000-0000-0000-0000-000000000002', 'income', 500,
    'DB test payment', CURRENT_DATE, 'DB test payment',
    '10000000-0000-0000-0000-000000000002', 'doctor'
);

INSERT INTO public.payment_allocations (
    payment_transaction_id, obligation_id, entity_type, entity_id, direction,
    allocated_amount, allocation_method, status
)
SELECT '50000000-0000-0000-0000-000000000002', id, entity_type, entity_id,
       direction, 500, 'manual', 'active'
FROM public.financial_obligations
WHERE order_id = '40000000-0000-0000-0000-000000000002'
  AND entity_type = 'doctor' AND status <> 'void';

UPDATE public.financial_obligations
SET allocated_amount = 500, status = 'paid'
WHERE order_id = '40000000-0000-0000-0000-000000000002'
  AND entity_type = 'doctor' AND status <> 'void';

UPDATE public.orders
SET doctor_id = '10000000-0000-0000-0000-000000000003'
WHERE id = '40000000-0000-0000-0000-000000000002';

SELECT is(
    (SELECT entity_id FROM public.financial_obligations
     WHERE order_id = '40000000-0000-0000-0000-000000000002'
       AND entity_type = 'doctor' AND status <> 'void'),
    '10000000-0000-0000-0000-000000000003'::uuid,
    'doctor change replaces the receivable party'
);

SELECT is(
    (SELECT allocated_amount FROM public.payment_allocations
     WHERE payment_transaction_id = '50000000-0000-0000-0000-000000000002'
       AND allocation_method = 'correction_transfer' AND status = 'active'),
    500::numeric,
    'doctor change transfers the full payment allocation'
);

SELECT is(
    (SELECT count(*)::integer FROM public.account_credits
     WHERE source_transaction_id = '50000000-0000-0000-0000-000000000002'),
    0,
    'doctor change creates no excess credit when the amount is unchanged'
);

-- 3. Supplier change after payment follows the same atomic replacement path.
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, supplier_id, production_status, issue_state
) VALUES (
    '40000000-0000-0000-0000-000000000003', 'DBTEST-SUPPLIER',
    '10000000-0000-0000-0000-000000000004', 'Supplier change', '[]',
    0, 'A1', 'Ready', CURRENT_DATE, 300,
    '20000000-0000-0000-0000-000000000001', 'final_ready', 'none'
);

INSERT INTO public.transactions (
    id, type, amount, category, date, description, entity_id, entity_type
) VALUES (
    '50000000-0000-0000-0000-000000000003', 'expense', 300,
    'DB test payment', CURRENT_DATE, 'DB test payment',
    '20000000-0000-0000-0000-000000000001', 'supplier'
);

INSERT INTO public.payment_allocations (
    payment_transaction_id, obligation_id, entity_type, entity_id, direction,
    allocated_amount, allocation_method, status
)
SELECT '50000000-0000-0000-0000-000000000003', id, entity_type, entity_id,
       direction, 300, 'manual', 'active'
FROM public.financial_obligations
WHERE order_id = '40000000-0000-0000-0000-000000000003'
  AND entity_type = 'external_lab' AND status <> 'void';

UPDATE public.financial_obligations
SET allocated_amount = 300, status = 'paid'
WHERE order_id = '40000000-0000-0000-0000-000000000003'
  AND entity_type = 'external_lab' AND status <> 'void';

UPDATE public.orders
SET supplier_id = '20000000-0000-0000-0000-000000000002'
WHERE id = '40000000-0000-0000-0000-000000000003';

SELECT is(
    (SELECT entity_id FROM public.financial_obligations
     WHERE order_id = '40000000-0000-0000-0000-000000000003'
       AND entity_type = 'external_lab' AND status <> 'void'),
    '20000000-0000-0000-0000-000000000002'::uuid,
    'supplier change replaces the payable party'
);

SELECT is(
    (SELECT allocated_amount FROM public.payment_allocations
     WHERE payment_transaction_id = '50000000-0000-0000-0000-000000000003'
       AND allocation_method = 'correction_transfer' AND status = 'active'),
    300::numeric,
    'supplier change transfers the full payment allocation'
);

-- 4. Doctor Rejected keeps independently approved doctor, supplier, and
-- designer amounts, and later amendments replace every obligation.
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, supplier_id, designer_id, workflow_type,
    design_status, design_price, production_status, issue_state
) VALUES (
    '40000000-0000-0000-0000-000000000004', 'DBTEST-REJECTED',
    '10000000-0000-0000-0000-000000000005', 'Doctor rejected', '[]',
    900, 'A1', 'Ready', CURRENT_DATE, 400,
    '20000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000001', 'split',
    'completed', 100, 'final_ready', 'none'
);

UPDATE public.orders
SET status = 'Doctor Rejected',
    production_status = 'not_started',
    issue_state = 'doctor_rejected',
    rejection_doctor_decision = 'custom_amount',
    rejected_doctor_amount = 350,
    rejection_financial_review_status = 'resolved',
    rejected_lab_cost = 120,
    rejected_lab_cost_status = 'resolved',
    rejected_designer_cost = 50,
    rejected_designer_cost_status = 'resolved'
WHERE id = '40000000-0000-0000-0000-000000000004';

SELECT is((SELECT gross_amount FROM public.financial_obligations
    WHERE order_id = '40000000-0000-0000-0000-000000000004'
      AND entity_type = 'doctor' AND status <> 'void'), 350::numeric,
    'Doctor Rejected creates the approved doctor amount');

SELECT is((SELECT gross_amount FROM public.financial_obligations
    WHERE order_id = '40000000-0000-0000-0000-000000000004'
      AND trigger_type = 'external_lab_issue_settlement' AND status <> 'void'),
    120::numeric, 'Doctor Rejected creates the approved supplier settlement');

SELECT is((SELECT gross_amount FROM public.financial_obligations
    WHERE order_id = '40000000-0000-0000-0000-000000000004'
      AND trigger_type = 'designer_issue_settlement' AND status <> 'void'),
    50::numeric, 'Doctor Rejected creates the approved designer settlement');

SELECT is((SELECT count(*)::integer FROM public.financial_obligations
    WHERE order_id = '40000000-0000-0000-0000-000000000004'
      AND trigger_type = 'external_lab_ready' AND status <> 'void'), 0,
    'Doctor Rejected voids the normal supplier payable');

SELECT is((SELECT count(*)::integer FROM public.financial_obligations
    WHERE order_id = '40000000-0000-0000-0000-000000000004'
      AND trigger_type = 'designer_approved' AND status <> 'void'), 0,
    'Doctor Rejected voids the normal designer payable');

UPDATE public.orders
SET rejected_doctor_amount = 250,
    rejected_lab_cost = 90,
    rejected_designer_cost = 40
WHERE id = '40000000-0000-0000-0000-000000000004';

SELECT is((SELECT gross_amount FROM public.financial_obligations
    WHERE order_id = '40000000-0000-0000-0000-000000000004'
      AND entity_type = 'doctor' AND status <> 'void'), 250::numeric,
    'rejection amendment replaces the doctor amount');

SELECT is((SELECT gross_amount FROM public.financial_obligations
    WHERE order_id = '40000000-0000-0000-0000-000000000004'
      AND trigger_type = 'external_lab_issue_settlement' AND status <> 'void'),
    90::numeric, 'rejection amendment replaces the supplier amount');

SELECT is((SELECT gross_amount FROM public.financial_obligations
    WHERE order_id = '40000000-0000-0000-0000-000000000004'
      AND trigger_type = 'designer_issue_settlement' AND status <> 'void'),
    40::numeric, 'rejection amendment replaces the designer amount');

-- 5. Lab Rejected and Cancelled always normalize financial fields to zero and
-- leave no active order-driven obligation.
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, supplier_id, designer_id, workflow_type,
    design_status, design_price, production_status, issue_state
) VALUES (
    '40000000-0000-0000-0000-000000000005', 'DBTEST-LAB-REJECTED',
    '10000000-0000-0000-0000-000000000006', 'Lab rejected', '[]',
    700, 'A1', 'Ready', CURRENT_DATE, 300,
    '20000000-0000-0000-0000-000000000004',
    '30000000-0000-0000-0000-000000000002', 'split',
    'completed', 80, 'final_ready', 'none'
);

UPDATE public.orders
SET status = 'Lab Rejected', issue_state = 'lab_rejected',
    production_status = 'not_started', rejection_doctor_decision = 'full_price',
    rejected_doctor_amount = 700, rejected_lab_cost = 300,
    rejected_designer_cost = 80
WHERE id = '40000000-0000-0000-0000-000000000005';

SELECT ok((SELECT rejected_doctor_amount = 0 AND rejected_lab_cost = 0
                  AND rejected_designer_cost = 0
           FROM public.orders
           WHERE id = '40000000-0000-0000-0000-000000000005'),
    'Lab Rejected normalizes all order financial fields to zero');

SELECT is((SELECT count(*)::integer FROM public.financial_obligations
    WHERE order_id = '40000000-0000-0000-0000-000000000005'
      AND status <> 'void'), 0,
    'Lab Rejected leaves no active order obligation');

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, supplier_id, production_status, issue_state
) VALUES (
    '40000000-0000-0000-0000-000000000006', 'DBTEST-CANCELLED',
    '10000000-0000-0000-0000-000000000007', 'Cancelled', '[]',
    600, 'A1', 'Ready', CURRENT_DATE, 250,
    '20000000-0000-0000-0000-000000000005', 'final_ready', 'none'
);

UPDATE public.orders
SET status = 'Cancelled', issue_state = 'cancelled',
    production_status = 'not_started', rejected_doctor_amount = 600,
    rejected_lab_cost = 250
WHERE id = '40000000-0000-0000-0000-000000000006';

SELECT ok((SELECT rejected_doctor_amount = 0 AND rejected_lab_cost = 0
           FROM public.orders
           WHERE id = '40000000-0000-0000-0000-000000000006'),
    'Cancelled normalizes all supplied financial fields to zero');

SELECT is((SELECT count(*)::integer FROM public.financial_obligations
    WHERE order_id = '40000000-0000-0000-0000-000000000006'
      AND status <> 'void'), 0,
    'Cancelled leaves no active order obligation');

SELECT throws_like(
    $$UPDATE public.orders
      SET status = 'Cancelled', issue_state = 'cancelled'
      WHERE id = '40000000-0000-0000-0000-000000000001'$$,
    '%delivered order cannot become Lab Rejected or Cancelled%',
    'a delivered order cannot be converted to Cancelled'
);

-- 6. Redo carries only explicitly resolved remake settlements; normal sale and
-- normal production obligations remain inactive on the redo-marked original.
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, supplier_id, designer_id, workflow_type,
    design_status, design_price, production_status, issue_state, is_redo,
    rejected_lab_cost, rejected_lab_cost_status,
    rejected_designer_cost, rejected_designer_cost_status
) VALUES (
    '40000000-0000-0000-0000-000000000007', 'DBTEST-REDO',
    '10000000-0000-0000-0000-000000000008', 'Redo', '[]',
    500, 'A1', 'New Case', CURRENT_DATE, 200,
    '20000000-0000-0000-0000-000000000006',
    '30000000-0000-0000-0000-000000000003', 'split',
    'completed', 60, 'not_started', 'none', TRUE,
    NULL, NULL, NULL, NULL
);

-- V2 invariant: every new row starts issue-free; historical/transition state
-- is applied only after the row exists.
UPDATE public.orders
SET issue_state = 'redo',
    rejected_lab_cost = 70, rejected_lab_cost_status = 'resolved',
    rejected_designer_cost = 30, rejected_designer_cost_status = 'resolved'
WHERE id = '40000000-0000-0000-0000-000000000007';

SELECT is((SELECT gross_amount FROM public.financial_obligations
    WHERE order_id = '40000000-0000-0000-0000-000000000007'
      AND trigger_type = 'external_lab_issue_settlement' AND status <> 'void'),
    70::numeric, 'Redo creates only the resolved supplier settlement');

SELECT is((SELECT gross_amount FROM public.financial_obligations
    WHERE order_id = '40000000-0000-0000-0000-000000000007'
      AND trigger_type = 'designer_issue_settlement' AND status <> 'void'),
    30::numeric, 'Redo creates only the resolved designer settlement');

SELECT is((SELECT count(*)::integer FROM public.financial_obligations
    WHERE order_id = '40000000-0000-0000-0000-000000000007'
      AND entity_type = 'doctor' AND status <> 'void'), 0,
    'Redo creates no doctor receivable on the redo-marked original');

SELECT is((SELECT count(*)::integer FROM public.financial_obligations
    WHERE order_id = '40000000-0000-0000-0000-000000000007'
      AND trigger_type IN ('external_lab_ready', 'designer_approved')
      AND status <> 'void'), 0,
    'Redo creates no normal supplier or designer obligation');

-- Cross-scenario invariants.
SELECT is((SELECT count(*)::integer
    FROM public.payment_allocations allocation
    JOIN public.financial_obligations obligation ON obligation.id = allocation.obligation_id
    WHERE allocation.status = 'active' AND obligation.status = 'void'), 0,
    'no active payment allocation points to a void obligation');

SELECT is((SELECT count(*)::integer FROM public.financial_obligations
    WHERE status <> 'void' AND allocated_amount > net_amount), 0,
    'no active obligation is overallocated');

SELECT * FROM finish();
ROLLBACK;
