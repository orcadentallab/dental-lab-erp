BEGIN;

SET search_path TO public, extensions;

SELECT plan(8);

-- ─── Rejection / issue bucketing ────────────────────────────────────────
-- Regression check for migration 093_add_doctor_and_lab_rejected_statuses:
-- 'Rejected' was renamed to 'Doctor Rejected' and 'Lab Rejected' was added,
-- but get_analytics_summary kept filtering on the now-impossible 'Rejected'
-- value. Doctor Rejected / Lab Rejected / redo must each land in their own
-- bucket, and none of them may count as "active".

INSERT INTO public.doctors (
    id, name, phone, address, doctor_code, representative_name
) VALUES (
    '10000000-0000-0000-0000-000000000301',
    'Analytics rejection bucket doctor', '01000000000', 'Test address',
    'ANLT-REJ', 'Test representative'
);

-- guard_order_issue_transition_v2 (20260808000000_order_issue_workflow_v2.sql)
-- rejects any INSERT with issue_state <> 'none' (new orders must start
-- clean and reach an issue state via the workflow RPCs). Seeding
-- already-rejected historical-style rows here needs the same
-- session_replication_role bypass used in on_hold_retirement.test.sql.
SET LOCAL session_replication_role = replica;

-- orders_issue_timing_v2_check / orders_zero_issue_financial_fields_check
-- (20260808000000_order_issue_workflow_v2.sql) require, whenever
-- workflow_issue_v2_enforce is on: doctor_rejected/redo rows to carry
-- first_delivered_at, and lab_rejected rows to carry a fully "zeroed and
-- resolved" financial-review state. Set both explicitly so this test passes
-- regardless of that flag's current value.
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, first_delivered_at, cost, production_status, issue_state, is_redo,
    rejection_doctor_decision, rejected_doctor_amount, rejection_financial_review_status,
    rejected_lab_cost, rejected_designer_cost, rejected_lab_cost_status, rejected_designer_cost_status
) VALUES
    (
        '40000000-0000-0000-0000-000000000301', 'ANLT-DOC-REJECTED',
        '10000000-0000-0000-0000-000000000301', 'Doctor rejected case', '[]',
        1000, 'A1', 'Doctor Rejected', CURRENT_DATE, timezone('utc', now()), 400,
        'final_delivered', 'doctor_rejected', FALSE,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL
    ),
    (
        '40000000-0000-0000-0000-000000000302', 'ANLT-LAB-REJECTED',
        '10000000-0000-0000-0000-000000000301', 'Lab rejected case', '[]',
        1000, 'A1', 'Lab Rejected', CURRENT_DATE, NULL, 0,
        'not_started', 'lab_rejected', FALSE,
        'zero', 0, 'resolved', 0, 0, 'not_applicable', 'not_applicable'
    );

SET LOCAL session_replication_role = origin;

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state, is_redo
) VALUES (
    '40000000-0000-0000-0000-000000000303', 'ANLT-REDO-ACTIVE',
    '10000000-0000-0000-0000-000000000301', 'Active redo case', '[]',
    1000, 'A1', 'Under Production', CURRENT_DATE, 400,
    'in_production', 'none', TRUE
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801(NULL, NULL)->>'doctor_rejected_count')::int,
    1,
    'Doctor Rejected order is counted in doctor_rejected_count'
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801(NULL, NULL)->>'lab_rejected_count')::int,
    1,
    'Lab Rejected order is counted in lab_rejected_count, separately from doctor_rejected_count'
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801(NULL, NULL)->>'redo_count')::int,
    1,
    'is_redo order is counted in redo_count regardless of its current status'
);

SELECT ok(
    (public.get_analytics_summary_privileged_20260801(NULL, NULL)->>'active_order_count')::int = 1,
    'Doctor Rejected / Lab Rejected orders no longer leak into active_order_count (only the in-progress redo counts as active)'
);

-- ─── FIFO-lite receivables aging ────────────────────────────────────────
-- A doctor with an old, fully-paid order and a recent, unpaid order must
-- have the unpaid balance aged off the RECENT order's date, not the
-- doctor's oldest-ever order date (the bug being fixed).

INSERT INTO public.doctors (
    id, name, phone, address, doctor_code, representative_name
) VALUES (
    '10000000-0000-0000-0000-000000000302',
    'Analytics FIFO aging doctor', '01000000000', 'Test address',
    'ANLT-FIFO', 'Test representative'
);

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state
) VALUES
    (
        '40000000-0000-0000-0000-000000000304', 'ANLT-FIFO-OLD',
        '10000000-0000-0000-0000-000000000302', 'Old paid order', '[]',
        500, 'A1', 'Delivered', CURRENT_DATE - 100, 0,
        'final_delivered', 'none'
    ),
    (
        '40000000-0000-0000-0000-000000000305', 'ANLT-FIFO-NEW',
        '10000000-0000-0000-0000-000000000302', 'Recent unpaid order', '[]',
        500, 'A1', 'Delivered', CURRENT_DATE - 10, 0,
        'final_delivered', 'none'
    );

INSERT INTO public.transactions (
    id, type, amount, category, date, description, entity_id, entity_type,
    status, is_approved
) VALUES (
    '50000000-0000-0000-0000-000000000301', 'income', 500,
    'collection', CURRENT_DATE, 'Covers only the old order',
    '10000000-0000-0000-0000-000000000302', 'doctor', 'approved', TRUE
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801(NULL, NULL)->>'aging_90_plus')::numeric,
    0::numeric,
    'the paid-off old order does not appear in the 90+ aging bucket'
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801(NULL, NULL)->>'aging_0_30')::numeric,
    500::numeric,
    'the unpaid balance is aged off the recent order date (0-30 bucket), not the doctor''s oldest order'
);

-- ─── Charge-only residual (collected < 0) is not dropped ────────────────
-- A doctor whose adjustment charges exceed their payments must still show
-- the full receivable, even though that excess isn't tied to one order.

INSERT INTO public.doctors (
    id, name, phone, address, doctor_code, representative_name
) VALUES (
    '10000000-0000-0000-0000-000000000303',
    'Analytics residual charge doctor', '01000000000', 'Test address',
    'ANLT-CHG', 'Test representative'
);

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state
) VALUES (
    '40000000-0000-0000-0000-000000000306', 'ANLT-CHG-ORDER',
    '10000000-0000-0000-0000-000000000303', 'Charged order', '[]',
    1000, 'A1', 'Delivered', CURRENT_DATE - 40, 0,
    'final_delivered', 'none'
);

INSERT INTO public.adjustments (
    entity_type, entity_id, amount, type, date, reason
) VALUES (
    'doctor', '10000000-0000-0000-0000-000000000303', 1500, 'charge',
    CURRENT_DATE, 'Test fee exceeding order total'
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801(NULL, NULL)->>'aging_31_60')::numeric,
    2500::numeric,
    'a charge exceeding the order total is not dropped: full 1000 + 1500 residual lands in the 31-60 bucket'
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801(NULL, NULL)->>'total_receivables')::numeric,
    3000::numeric,
    'total_receivables sums all three doctors correctly (500 FIFO-unpaid + 2500 charged)'
);

ROLLBACK;
