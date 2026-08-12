-- Migration: Fix analytics rejection/issue status filters and receivables aging
--
-- Root cause 1: migration 093_add_doctor_and_lab_rejected_statuses.sql renamed
-- order status 'Rejected' -> 'Doctor Rejected', added 'Lab Rejected', and
-- dropped 'Rejected' from orders_status_check entirely (no order can have
-- that status anymore). get_analytics_summary was never updated afterward:
-- its old `return_count` filter (`status IN ('Rejected', 'Returned for
-- Adjustments')`) could no longer match any real rejection, so "حالات
-- بمشاكل" / "نسبة الإرجاع" read ~0, and `active_order_count` leaked
-- Doctor/Lab Rejected orders into "active".
--
-- This splits the old single `return_count` into doctor_rejected_count /
-- lab_rejected_count / returned_count, so the app can distinguish an actual
-- doctor "rejection" (Doctor Rejected status, or a redo) from a lab-internal
-- "issue" (Lab Rejected / Returned for Adjustments) per product decision.
--
-- Root cause 2: SECTION C aged a doctor's ENTIRE current balance off their
-- oldest-ever delivered order date, not off the age of the actually-unpaid
-- amount (docs/audits/receivables-system-audit.md). Replaced with a FIFO-lite
-- per-order attribution -- oldest orders are considered paid first, and only
-- the unpaid remainder is dated to the order(s) it actually belongs to. Built
-- entirely from orders/transactions/adjustments; no schema change, no
-- financial_obligations involvement, no backfill.
--
-- Also adds `pending_revenue_period`: the unpaid balance of orders delivered
-- within the selected date range, replacing the old
-- `total_sales_value - total_income` formula, which mixed this period's
-- accrual sales with cash collected in the period regardless of which
-- invoice/period it was actually paying off (could go negative).

CREATE OR REPLACE FUNCTION public.get_analytics_summary_privileged_20260801(
    p_start_date DATE DEFAULT NULL,
    p_end_date   DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result        JSONB;
    v_order_stats JSONB;
    v_tx_stats    JSONB;
    v_receivables JSONB;
    v_payables    JSONB;
BEGIN
    -- SECTION A: ORDER-BASED METRICS
    SELECT jsonb_build_object(
        'total_sales_value', COALESCE(SUM(total_price) FILTER (WHERE status IN ('Delivered', 'Completed')), 0),
        'total_cost_of_goods', COALESCE(SUM(cost) FILTER (WHERE status IN ('Delivered', 'Completed')), 0),
        'completed_order_count', COALESCE(COUNT(*) FILTER (WHERE status IN ('Delivered', 'Completed')), 0),
        'active_order_count', COALESCE(COUNT(*) FILTER (WHERE status NOT IN ('Delivered', 'Completed', 'Rejected', 'Doctor Rejected', 'Lab Rejected', 'Cancelled')), 0),
        'doctor_rejected_count', COALESCE(COUNT(*) FILTER (WHERE status IN ('Rejected', 'Doctor Rejected')), 0),
        'lab_rejected_count', COALESCE(COUNT(*) FILTER (WHERE status = 'Lab Rejected'), 0),
        'returned_count', COALESCE(COUNT(*) FILTER (WHERE status = 'Returned for Adjustments'), 0),
        'redo_count', COALESCE(COUNT(*) FILTER (WHERE is_redo = true), 0),
        'redo_cost', COALESCE(SUM(cost) FILTER (WHERE is_redo = true), 0),
        'urgent_count', COALESCE(COUNT(*) FILTER (WHERE is_urgent = true AND status NOT IN ('Delivered', 'Completed', 'Rejected', 'Cancelled')), 0),
        'total_order_count', COUNT(*)
    )
    INTO v_order_stats
    FROM orders
    WHERE (COALESCE(is_archived, false) = false)
      AND (
        p_start_date IS NULL
        OR (CASE WHEN status IN ('Delivered', 'Completed')
                THEN COALESCE(delivery_date, created_at::date)
                ELSE created_at::date
            END) BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
      );

    -- SECTION B: TRANSACTION-BASED METRICS (unchanged)
    SELECT jsonb_build_object(
        'total_income', COALESCE(SUM(amount) FILTER (WHERE type = 'income' AND (p_start_date IS NULL OR date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))), 0),
        'total_expenses', COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND (entity_type != 'representative' OR entity_type IS NULL) AND (p_start_date IS NULL OR date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))), 0),
        'doctor_collections', COALESCE(SUM(amount) FILTER (WHERE type = 'income' AND entity_type = 'doctor' AND (p_start_date IS NULL OR date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))), 0),
        'supplier_payments', COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND entity_type = 'supplier' AND (p_start_date IS NULL OR date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))), 0),
        'designer_payments', COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND entity_type = 'designer' AND (p_start_date IS NULL OR date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))), 0),
        'production_costs', COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND entity_type IN ('supplier', 'designer') AND (p_start_date IS NULL OR COALESCE(effective_date, date) BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))), 0),
        'operating_expenses', COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND (entity_type NOT IN ('supplier', 'designer', 'representative') OR entity_type IS NULL) AND (p_start_date IS NULL OR COALESCE(effective_date, date) BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))), 0)
    )
    INTO v_tx_stats
    FROM transactions;

    -- SECTION C: ACCOUNTS RECEIVABLE (FIFO per-order aging)
    WITH doctor_orders AS (
        SELECT
            o.id AS order_id,
            o.doctor_id,
            COALESCE(o.delivery_date, o.created_at::date) AS order_date,
            o.total_price,
            SUM(o.total_price) OVER (
                PARTITION BY o.doctor_id
                ORDER BY COALESCE(o.delivery_date, o.created_at::date), o.created_at, o.id
            ) AS running_billed
        FROM orders o
        WHERE o.status IN ('Delivered', 'Completed') AND COALESCE(o.is_archived, false) = false
    ),
    doctor_payments AS (
        SELECT entity_id, SUM(amount) AS total_paid
        FROM transactions
        WHERE type = 'income' AND entity_type = 'doctor'
        GROUP BY entity_id
    ),
    doctor_adj AS (
        SELECT
            entity_id,
            COALESCE(SUM(amount) FILTER (WHERE type = 'credit'), 0) AS total_credits,
            COALESCE(SUM(amount) FILTER (WHERE type = 'charge'), 0) AS total_charges
        FROM adjustments
        WHERE entity_type = 'doctor'
        GROUP BY entity_id
    ),
    doctor_collected AS (
        SELECT
            ds.doctor_id,
            COALESCE(dp.total_paid, 0) + COALESCE(da.total_credits, 0) - COALESCE(da.total_charges, 0) AS total_collected
        FROM (SELECT DISTINCT doctor_id FROM doctor_orders) ds
        LEFT JOIN doctor_payments dp ON dp.entity_id = ds.doctor_id
        LEFT JOIN doctor_adj da      ON da.entity_id = ds.doctor_id
    ),
    order_unpaid AS (
        -- Oldest orders are considered paid first; only the tail that
        -- exceeds total collections is unpaid, dated to the order(s) it
        -- actually belongs to (standard FIFO-remainder telescoping sum).
        SELECT
            do_.order_date,
            GREATEST(do_.running_billed - dc.total_collected, 0)
                - GREATEST(do_.running_billed - do_.total_price - dc.total_collected, 0) AS unpaid_amount
        FROM doctor_orders do_
        JOIN doctor_collected dc ON dc.doctor_id = do_.doctor_id

        UNION ALL

        -- Charges/adjustments can exceed total billed + payments for a
        -- doctor (e.g. a fee charged before any order covers it). That
        -- residual isn't tied to one specific order, so -- same as the
        -- previous doctor-level aging fallback -- it's dated to the
        -- doctor's oldest order rather than silently dropped.
        SELECT
            MIN(do_.order_date),
            GREATEST(-dc.total_collected, 0)
        FROM doctor_orders do_
        JOIN doctor_collected dc ON dc.doctor_id = do_.doctor_id
        GROUP BY dc.doctor_id, dc.total_collected
        HAVING GREATEST(-dc.total_collected, 0) > 0
    )
    SELECT jsonb_build_object(
        'total_receivables', COALESCE(SUM(unpaid_amount), 0),
        'aging_0_30',    COALESCE(SUM(unpaid_amount) FILTER (WHERE CURRENT_DATE - order_date <= 30), 0),
        'aging_31_60',   COALESCE(SUM(unpaid_amount) FILTER (WHERE CURRENT_DATE - order_date BETWEEN 31 AND 60), 0),
        'aging_61_90',   COALESCE(SUM(unpaid_amount) FILTER (WHERE CURRENT_DATE - order_date BETWEEN 61 AND 90), 0),
        'aging_90_plus', COALESCE(SUM(unpaid_amount) FILTER (WHERE CURRENT_DATE - order_date > 90), 0),
        'pending_revenue_period', COALESCE(SUM(unpaid_amount) FILTER (
            WHERE p_start_date IS NULL OR order_date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
        ), 0)
    )
    INTO v_receivables
    FROM order_unpaid;

    -- SECTION D: ACCOUNTS PAYABLE (unchanged)
    WITH total_costs AS (
        SELECT COALESCE(SUM(cost), 0) AS total_order_costs
        FROM orders
        WHERE status IN ('Delivered', 'Completed') AND COALESCE(is_archived, false) = false
    ),
    total_payments AS (
        SELECT COALESCE(SUM(amount), 0) AS total_supplier_payments
        FROM transactions
        WHERE type = 'expense' AND entity_type IN ('supplier', 'designer')
    ),
    total_adj AS (
        SELECT
            COALESCE(SUM(amount) FILTER (WHERE type = 'charge'), 0) AS total_charges,
            COALESCE(SUM(amount) FILTER (WHERE type = 'credit'), 0) AS total_credits
        FROM adjustments
        WHERE entity_type IN ('supplier', 'designer')
    )
    SELECT jsonb_build_object(
        'total_payables', GREATEST(tc.total_order_costs + ta.total_credits - tp.total_supplier_payments - ta.total_charges, 0)
    )
    INTO v_payables
    FROM total_costs tc, total_payments tp, total_adj ta;

    result := v_order_stats || v_tx_stats || v_receivables || v_payables;
    RETURN result;
END;
$$;
