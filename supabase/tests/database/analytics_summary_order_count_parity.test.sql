-- Order-count parity for get_analytics_summary_privileged_20260801.
--
-- Guards 20260903050000_align_order_counts_with_statement_parity.sql.
--
-- Why this file exists: analytics_summary_statement_parity.test.sql asserts
-- MONEY only (sales, receivables, COGS, payables) and always calls the RPC
-- with a NULL date range. So when 20260903030000 restored the audited
-- receivables/payables sections it silently reinstated the OLD SECTION A1 --
-- counts fell back to scheduled delivery_date/created_at and re-acquired an
-- is_archived filter -- and every existing test stayed green while the
-- Overview page reported 85 cases for 2026-08 against 95 on the statement.
-- These assertions pin the COUNTS and exercise a real date window.
--
-- Three rules, confirmed with the lab owner 2026-09-03:
--   1. ACTUAL DELIVERY DECIDES THE MONTH. An order delivered in month N
--      belongs to month N even if it was scheduled for month N-1. Same rule
--      as getOfficialStatementDate() on the client.
--   2. total_order_count MEANS ORDERS THAT CLOSED. Terminal statuses only --
--      work in progress belongs to active_order_count, not to this number.
--   3. is_archived IS NOT A REPORTING FILTER. Archiving only declutters the
--      orders page and the dashboard card; the order stays fully effective.
--   4. AN ORDER BEING REWORKED HAS NOT CLOSED. 'Returned for Adjustments' is
--      a transient status -- the case goes back to the bench and is delivered
--      again (50 episodes in production, averaging 44.5 hours, up to 23 days).
--      It stays visible on the doctor statement, but counting it as closed
--      would book the same case twice: once at zero here, and again in the
--      period it is finally delivered in.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(9);

INSERT INTO public.doctors (
    id, name, phone, address, doctor_code, representative_name
) VALUES (
    '10000000-0000-0000-0000-000000000501',
    'Count parity doctor', '01000000000', 'Test address',
    'PARITY-CNT', 'Test representative'
);

SET LOCAL session_replication_role = replica;

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, actual_delivery_date, cost, production_status, issue_state,
    is_archived, created_at
) VALUES
    -- (1) Scheduled June, actually delivered in the July window. Counts in July.
    ('40000000-0000-0000-0000-000000000501', 'CNT-LATE-DELIVERY',
     '10000000-0000-0000-0000-000000000501', 'Delivered late', '[]',
     1000, 'A1', 'Delivered', DATE '2026-06-20', DATE '2026-07-10', 400,
     'final_delivered', 'none', FALSE, TIMESTAMPTZ '2026-06-01 09:00+03'),

    -- (2) Scheduled inside the July window but actually delivered in August.
    --     Must NOT count in July.
    ('40000000-0000-0000-0000-000000000502', 'CNT-SLIPPED-OUT',
     '10000000-0000-0000-0000-000000000501', 'Slipped to August', '[]',
     1000, 'A1', 'Delivered', DATE '2026-07-20', DATE '2026-08-05', 400,
     'final_delivered', 'none', FALSE, TIMESTAMPTZ '2026-07-01 09:00+03'),

    -- (3) Archived, cancelled, settled inside the window. Still a real order.
    ('40000000-0000-0000-0000-000000000503', 'CNT-ARCHIVED-CANCELLED',
     '10000000-0000-0000-0000-000000000501', 'Archived cancelled', '[]',
     1000, 'A1', 'Cancelled', DATE '2026-07-15', NULL, 400,
     'not_started', 'cancelled', TRUE, TIMESTAMPTZ '2026-07-02 09:00+03'),

    -- (4) Archived, doctor-rejected and financially settled inside the window.
    ('40000000-0000-0000-0000-000000000504', 'CNT-ARCHIVED-REJECTED',
     '10000000-0000-0000-0000-000000000501', 'Archived rejected', '[]',
     1000, 'A1', 'Doctor Rejected', DATE '2026-07-16', DATE '2026-07-16', 400,
     'final_delivered', 'doctor_rejected', TRUE, TIMESTAMPTZ '2026-07-03 09:00+03'),

    -- (6) Sent back to the bench inside the window. On the statement, but not
    --     closed -- it will be delivered again later.
    ('40000000-0000-0000-0000-000000000506', 'CNT-REWORK',
     '10000000-0000-0000-0000-000000000501', 'Back on the bench', '[]',
     800, 'A1', 'Returned for Adjustments', DATE '2026-07-18', NULL, 300,
     'in_production', 'none', FALSE, TIMESTAMPTZ '2026-07-06 09:00+03'),

    -- (5) Still in production, created inside the window. Pipeline, not settled.
    ('40000000-0000-0000-0000-000000000505', 'CNT-IN-PROGRESS',
     '10000000-0000-0000-0000-000000000501', 'Still running', '[]',
     1000, 'A1', 'Under Production', DATE '2026-07-25', NULL, 400,
     'in_production', 'none', FALSE, TIMESTAMPTZ '2026-07-05 09:00+03');

UPDATE public.orders
   SET rejection_doctor_decision = 'custom_amount', rejected_doctor_amount = 300
 WHERE id = '40000000-0000-0000-0000-000000000504';

SET LOCAL session_replication_role = origin;

-- ─── Rule 1 + 2: the settlement window ────────────────────────────────────
-- Orders 1, 3 and 4 settle inside July. Order 2 slipped to August, order 5
-- has not closed. So exactly 3.

SELECT is(
    (public.get_analytics_summary_privileged_20260801(
        DATE '2026-07-01', DATE '2026-07-31')->>'total_order_count')::int,
    3,
    'total_order_count follows actual delivery, covers closed statuses only, and ignores is_archived'
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801(
        DATE '2026-07-01', DATE '2026-07-31')->>'completed_order_count')::int,
    1,
    'the order scheduled in June but actually delivered in July is the only completed order in the July window'
);

-- The August window must pick up the slipped order -- proving the July
-- exclusion above is a re-dating, not a disappearance.
SELECT is(
    (public.get_analytics_summary_privileged_20260801(
        DATE '2026-08-01', DATE '2026-08-31')->>'completed_order_count')::int,
    1,
    'an order scheduled for July but actually delivered in August is counted in August, never dropped'
);

-- ─── Rule 3: archived orders are real ─────────────────────────────────────

SELECT is(
    (public.get_analytics_summary_privileged_20260801(
        DATE '2026-07-01', DATE '2026-07-31')->>'lab_rejected_count')::int
    + (public.get_analytics_summary_privileged_20260801(
        DATE '2026-07-01', DATE '2026-07-31')->>'doctor_rejected_count')::int,
    1,
    'an archived doctor-rejected order still counts in the rejection breakdown'
);

-- ─── Work in progress stays out of the settled count ──────────────────────

SELECT is(
    (public.get_analytics_summary_privileged_20260801(
        DATE '2026-07-01', DATE '2026-07-31')->>'active_order_count')::int,
    2,
    'both the in-production order and the one sent back for rework count as active work'
);

-- ─── An order being reworked has not closed ───────────────────────────────

SELECT is(
    (public.get_analytics_summary_privileged_20260801(
        DATE '2026-07-01', DATE '2026-07-31')->>'returned_count')::int,
    1,
    'the rework queue is still reported on its own'
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801(
        DATE '2026-07-01', DATE '2026-07-31')->>'total_order_count')::int,
    3,
    'the order being reworked is NOT counted among the cases that closed in the period'
);

-- ─── Counts and money share one scope ─────────────────────────────────────
-- The whole point of the parity work: the settled rejection amount (300) is
-- the only revenue in July -- order 1 is a plain delivery of 1000, order 3 is
-- cancelled (zero), order 4 contributes its settled 300. If the count scope
-- and the money scope ever drift apart again, one of these two fails.

SELECT is(
    (public.get_analytics_summary_privileged_20260801(
        DATE '2026-07-01', DATE '2026-07-31')->>'total_sales_value')::numeric,
    1300::numeric,
    'July sales cover exactly the orders July counts: the delivery (1000) plus the settled rejection (300); the cancelled order adds nothing'
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801(
        DATE '2026-06-01', DATE '2026-06-30')->>'total_order_count')::int,
    0,
    'nothing is counted in the month an order was merely scheduled for'
);

SELECT * FROM finish();
ROLLBACK;
