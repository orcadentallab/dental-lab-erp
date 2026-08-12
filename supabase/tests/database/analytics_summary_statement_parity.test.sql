BEGIN;

SET search_path TO public, extensions;

SELECT plan(6);

-- ─── Doctor side: settled rejection amount counts as sales/receivable ──
-- Accounts.tsx's getDoctorReceivableAmount counts a doctor-rejected order's
-- settled amount (rejected_doctor_amount) once rejection_doctor_decision is
-- recorded. get_analytics_summary used to ignore this entirely.

INSERT INTO public.doctors (
    id, name, phone, address, doctor_code, representative_name
) VALUES (
    '10000000-0000-0000-0000-000000000401',
    'Statement parity doctor', '01000000000', 'Test address',
    'PARITY-DOC', 'Test representative'
);

-- guard_order_issue_transition_v2 blocks INSERT with issue_state <> 'none';
-- bypass triggers to seed an already-decided rejected order, same pattern
-- used in on_hold_retirement.test.sql / the earlier analytics test.
SET LOCAL session_replication_role = replica;

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state,
    rejection_doctor_decision, rejected_doctor_amount
) VALUES
    (
        '40000000-0000-0000-0000-000000000401', 'PARITY-DECIDED-REJECT',
        '10000000-0000-0000-0000-000000000401', 'Decided rejection', '[]',
        1000, 'A1', 'Doctor Rejected', CURRENT_DATE, 400,
        'final_delivered', 'doctor_rejected',
        'custom_amount', 400
    ),
    (
        '40000000-0000-0000-0000-000000000402', 'PARITY-UNDECIDED-REJECT',
        '10000000-0000-0000-0000-000000000401', 'Undecided rejection', '[]',
        1000, 'A1', 'Doctor Rejected', CURRENT_DATE, 400,
        'final_delivered', 'doctor_rejected',
        NULL, NULL
    );

SET LOCAL session_replication_role = origin;

SELECT is(
    (public.get_analytics_summary_privileged_20260801(NULL, NULL)->>'total_sales_value')::numeric,
    400::numeric,
    'a settled rejection amount (rejection_doctor_decision recorded) counts as sales; an undecided one does not'
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801(NULL, NULL)->>'total_receivables')::numeric,
    400::numeric,
    'the same settled amount is outstanding as a receivable when unpaid'
);

-- ─── Supplier side: split-workflow cost excludes design price ──────────
-- getLabCostMetadata excludes design_price from the supplier's lab cost for
-- split-workflow orders UNLESS the assigned designer is salaried.

INSERT INTO public.doctors (
    id, name, phone, address, doctor_code, representative_name
) VALUES (
    '10000000-0000-0000-0000-000000000402',
    'Statement parity doctor 2', '01000000000', 'Test address',
    'PARITY-DOC2', 'Test representative'
);

INSERT INTO public.suppliers (id, name, phone) VALUES
    ('20000000-0000-0000-0000-000000000401', 'Parity supplier A', '01000000001'),
    ('20000000-0000-0000-0000-000000000402', 'Parity supplier B', '01000000002');

INSERT INTO public.users (id, username, role, name, custom_permissions) VALUES
    ('30000000-0000-0000-0000-000000000401', 'parity_designer_nonsalaried', 'designer', 'Non-salaried designer', '{}'::jsonb),
    ('30000000-0000-0000-0000-000000000402', 'parity_designer_salaried', 'designer', 'Salaried designer', '{"designer_fixed_salary": true}'::jsonb);

INSERT INTO public.orders (
    id, case_id, doctor_id, supplier_id, designer_id, patient_name, items,
    total_price, shade, status, delivery_date, cost, workflow_type,
    design_price, design_status, production_status, issue_state
) VALUES
    (
        '40000000-0000-0000-0000-000000000403', 'PARITY-SPLIT-NONSALARIED',
        '10000000-0000-0000-0000-000000000402',
        '20000000-0000-0000-0000-000000000401',
        '30000000-0000-0000-0000-000000000401',
        'Split non-salaried', '[]', 1200, 'A1', 'Delivered', CURRENT_DATE,
        1000, 'split', 200, 'completed', 'final_delivered', 'none'
    ),
    (
        '40000000-0000-0000-0000-000000000404', 'PARITY-SPLIT-SALARIED',
        '10000000-0000-0000-0000-000000000402',
        '20000000-0000-0000-0000-000000000402',
        '30000000-0000-0000-0000-000000000402',
        'Split salaried', '[]', 1200, 'A1', 'Delivered', CURRENT_DATE,
        1000, 'split', 200, 'completed', 'final_delivered', 'none'
    );

-- Order 403 (non-salaried): supplier cost = GREATEST(0, 1000-200) = 800.
-- Order 404 (salaried): supplier cost = full 1000 (no design_price subtraction).
-- Total supplier COGS = 800 + 1000 = 1800.
SELECT is(
    (public.get_analytics_summary_privileged_20260801(NULL, NULL)->>'total_cost_of_goods_suppliers')::numeric,
    1800::numeric,
    'split-workflow supplier cost excludes design_price only for a non-salaried designer (800), not for a salaried one (full 1000)'
);

-- Order 403 (non-salaried): designer owed design_price = 200.
-- Order 404 (salaried): designer cost is always zeroed regardless of design_price.
-- Total designer COGS = 200 + 0 = 200.
SELECT is(
    (public.get_analytics_summary_privileged_20260801(NULL, NULL)->>'total_cost_of_goods_designers')::numeric,
    200::numeric,
    'non-salaried designer''s design price counts as designer COGS (200); salaried designer''s is zeroed'
);

-- ─── Payables: per-entity, not netted across suppliers ─────────────────
-- Supplier A: cost 800 (from the non-salaried split order above), no
-- payment -> owed 800. Supplier B: cost 1000 (salaried order, full cost,
-- no design_price subtraction), paid 1300 -> overpaid by 300. Total
-- payables must be 800 (A only), not 800-300=500 netted across entities.

INSERT INTO public.transactions (
    id, type, amount, category, date, description, entity_id, entity_type,
    status, is_approved
) VALUES (
    '50000000-0000-0000-0000-000000000401', 'expense', 1300,
    'supplier_payment', CURRENT_DATE, 'Overpayment to supplier B',
    '20000000-0000-0000-0000-000000000402', 'supplier', 'approved', TRUE
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801(NULL, NULL)->>'total_payables_suppliers')::numeric,
    800::numeric,
    'supplier B''s overpayment does not offset what is owed to supplier A -- each entity is floored at zero independently before summing'
);

-- Non-salaried designer: owed 200 (design_price), unpaid -> balance 200.
-- Salaried designer: balance forced to 0 - payments/charges = 0 (no payments).
-- Total = 200 + 0 = 200.
SELECT is(
    (public.get_analytics_summary_privileged_20260801(NULL, NULL)->>'total_payables_designers')::numeric,
    200::numeric,
    'non-salaried designer''s unpaid design fee is owed (200); the salaried designer''s payable is zero regardless'
);

ROLLBACK;
