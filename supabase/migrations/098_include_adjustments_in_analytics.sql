-- Migration 098: Include adjustments in Analytics RPC

CREATE OR REPLACE FUNCTION get_analytics_summary(
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
    -- SECTION A: ORDER-BASED METRICS (unchanged)
    SELECT jsonb_build_object(
        'total_sales_value', COALESCE(SUM(total_price) FILTER (WHERE status IN ('Delivered', 'Completed')), 0),
        'total_cost_of_goods', COALESCE(SUM(cost) FILTER (WHERE status IN ('Delivered', 'Completed')), 0),
        'completed_order_count', COALESCE(COUNT(*) FILTER (WHERE status IN ('Delivered', 'Completed')), 0),
        'active_order_count', COALESCE(COUNT(*) FILTER (WHERE status NOT IN ('Delivered', 'Completed', 'Rejected', 'Cancelled')), 0),
        'return_count', COALESCE(COUNT(*) FILTER (WHERE status IN ('Rejected', 'Returned for Adjustments')), 0),
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

    -- SECTION C: ACCOUNTS RECEIVABLE (now includes adjustments)
    WITH doctor_sales AS (
        SELECT doctor_id, SUM(total_price) AS total_billed
        FROM orders
        WHERE status IN ('Delivered', 'Completed') AND COALESCE(is_archived, false) = false
        GROUP BY doctor_id
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
    doctor_balances AS (
        SELECT
            ds.doctor_id,
            GREATEST(
                ds.total_billed
                + COALESCE(da.total_charges, 0)
                - COALESCE(dp.total_paid, 0)
                - COALESCE(da.total_credits, 0),
                0
            ) AS balance,
            (SELECT MIN(COALESCE(o2.delivery_date, o2.created_at::date))
             FROM orders o2
             WHERE o2.doctor_id = ds.doctor_id
               AND o2.status IN ('Delivered', 'Completed')
               AND COALESCE(o2.is_archived, false) = false
            ) AS oldest_order_date
        FROM doctor_sales ds
        LEFT JOIN doctor_payments dp ON dp.entity_id = ds.doctor_id
        LEFT JOIN doctor_adj da      ON da.entity_id = ds.doctor_id
        WHERE (ds.total_billed + COALESCE(da.total_charges,0) - COALESCE(dp.total_paid,0) - COALESCE(da.total_credits,0)) > 0
    )
    SELECT jsonb_build_object(
        'total_receivables', COALESCE(SUM(balance), 0),
        'aging_0_30',    COALESCE(SUM(balance) FILTER (WHERE CURRENT_DATE - oldest_order_date <= 30), 0),
        'aging_31_60',   COALESCE(SUM(balance) FILTER (WHERE CURRENT_DATE - oldest_order_date BETWEEN 31 AND 60), 0),
        'aging_61_90',   COALESCE(SUM(balance) FILTER (WHERE CURRENT_DATE - oldest_order_date BETWEEN 61 AND 90), 0),
        'aging_90_plus', COALESCE(SUM(balance) FILTER (WHERE CURRENT_DATE - oldest_order_date > 90), 0)
    )
    INTO v_receivables
    FROM doctor_balances;

    -- SECTION D: ACCOUNTS PAYABLE (now includes adjustments)
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

GRANT EXECUTE ON FUNCTION get_analytics_summary(DATE, DATE) TO authenticated;
