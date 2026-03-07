-- =====================================================================
-- Migration 074: Accrual-Based Financials & Monthly Effective Dates
-- Purpose: Add effective_date to transactions to support Cash vs Accrual
--          financial reporting, and update Analytics RPCs to use it.
-- =====================================================================

-- 1. Add effective_date to transactions
ALTER TABLE transactions Add COLUMN IF NOT EXISTS effective_date DATE;

-- Populate existing transactions with effective_date = date
-- So historical data doesn't break
UPDATE transactions SET effective_date = date WHERE effective_date IS NULL;

-- 2. Update the RPC to use effective_date for P&L sections and date for Cash Flow
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
    result JSONB;
    v_order_stats JSONB;
    v_tx_stats JSONB;
    v_receivables JSONB;
    v_payables JSONB;
BEGIN
    -- =============================================
    -- SECTION A: ORDER-BASED METRICS
    -- =============================================
    -- Uses conditional aggregation (FILTER) to compute
    -- multiple metrics in a single table scan.
    SELECT jsonb_build_object(
        -- Revenue from completed/delivered orders
        'total_sales_value', COALESCE(SUM(total_price) FILTER (
            WHERE status IN ('Delivered', 'Completed')
        ), 0),
        -- Cost of goods sold
        'total_cost_of_goods', COALESCE(SUM(cost) FILTER (
            WHERE status IN ('Delivered', 'Completed')
        ), 0),
        -- Completed order count
        'completed_order_count', COALESCE(COUNT(*) FILTER (
            WHERE status IN ('Delivered', 'Completed')
        ), 0),
        -- Active (non-terminal) order count
        'active_order_count', COALESCE(COUNT(*) FILTER (
            WHERE status NOT IN ('Delivered', 'Completed', 'Rejected', 'Cancelled')
        ), 0),
        -- Returned/rejected count (redo impact)
        'return_count', COALESCE(COUNT(*) FILTER (
            WHERE status IN ('Rejected', 'Returned for Adjustments')
        ), 0),
        -- Redo order count
        'redo_count', COALESCE(COUNT(*) FILTER (
            WHERE is_redo = true
        ), 0),
        -- Redo cost impact
        'redo_cost', COALESCE(SUM(cost) FILTER (
            WHERE is_redo = true
        ), 0),
        -- Urgent cases
        'urgent_count', COALESCE(COUNT(*) FILTER (
            WHERE is_urgent = true
              AND status NOT IN ('Delivered', 'Completed', 'Rejected', 'Cancelled')
        ), 0),
        -- Total order count in range
        'total_order_count', COUNT(*)
    )
    INTO v_order_stats
    FROM orders
    WHERE (COALESCE(is_archived, false) = false)
      AND (
        -- Date range filter: for completed orders use delivery_date, otherwise created_at
        p_start_date IS NULL
        OR (
            CASE
                WHEN status IN ('Delivered', 'Completed')
                    THEN COALESCE(delivery_date, created_at::date)
                ELSE created_at::date
            END
        ) BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
      );

    -- =============================================
    -- SECTION B: TRANSACTION-BASED METRICS
    -- =============================================
    SELECT jsonb_build_object(
        -- CASH FLOW: Uses actual physical date
        'total_income', COALESCE(SUM(amount) FILTER (
            WHERE type = 'income' AND (p_start_date IS NULL OR date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))
        ), 0),
        'total_expenses', COALESCE(SUM(amount) FILTER (
            WHERE type = 'expense' AND (entity_type != 'representative' OR entity_type IS NULL) AND (p_start_date IS NULL OR date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))
        ), 0),
        'doctor_collections', COALESCE(SUM(amount) FILTER (
            WHERE type = 'income' AND entity_type = 'doctor' AND (p_start_date IS NULL OR date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))
        ), 0),
        'supplier_payments', COALESCE(SUM(amount) FILTER (
            WHERE type = 'expense' AND entity_type = 'supplier' AND (p_start_date IS NULL OR date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))
        ), 0),
        'designer_payments', COALESCE(SUM(amount) FILTER (
            WHERE type = 'expense' AND entity_type = 'designer' AND (p_start_date IS NULL OR date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))
        ), 0),

        -- P&L / ACCRUAL: Uses effective_date (the month the expense was meant for)
        'production_costs', COALESCE(SUM(amount) FILTER (
            WHERE type = 'expense' AND entity_type IN ('supplier', 'designer')
              AND (p_start_date IS NULL OR COALESCE(effective_date, date) BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))
        ), 0),
        -- Operating expenses (everything except supplier/designer/representative)
        'operating_expenses', COALESCE(SUM(amount) FILTER (
            WHERE type = 'expense' AND (entity_type NOT IN ('supplier', 'designer', 'representative') OR entity_type IS NULL)
              AND (p_start_date IS NULL OR COALESCE(effective_date, date) BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))
        ), 0)
    )
    INTO v_tx_stats
    FROM transactions;

    -- =============================================
    -- SECTION C: ACCOUNTS RECEIVABLE (always full history, ignoring date filter)
    -- =============================================
    -- Doctor receivables = SUM(delivered order prices) - SUM(doctor payments)
    WITH doctor_sales AS (
        SELECT doctor_id,
               SUM(total_price) AS total_billed
        FROM orders
        WHERE status IN ('Delivered', 'Completed')
          AND COALESCE(is_archived, false) = false
        GROUP BY doctor_id
    ),
    doctor_payments AS (
        SELECT entity_id,
               SUM(amount) AS total_paid
        FROM transactions
        WHERE type = 'income' AND entity_type = 'doctor'
        GROUP BY entity_id
    ),
    doctor_balances AS (
        SELECT
            ds.doctor_id,
            GREATEST(ds.total_billed - COALESCE(dp.total_paid, 0), 0) AS balance,
            -- Find oldest delivered order date per doctor for aging
            (SELECT MIN(COALESCE(o2.delivery_date, o2.created_at::date))
             FROM orders o2
             WHERE o2.doctor_id = ds.doctor_id
               AND o2.status IN ('Delivered', 'Completed')
               AND COALESCE(o2.is_archived, false) = false
            ) AS oldest_order_date
        FROM doctor_sales ds
        LEFT JOIN doctor_payments dp ON dp.entity_id = ds.doctor_id
        WHERE ds.total_billed - COALESCE(dp.total_paid, 0) > 0
    )
    SELECT jsonb_build_object(
        'total_receivables', COALESCE(SUM(balance), 0),
        'aging_0_30',  COALESCE(SUM(balance) FILTER (WHERE CURRENT_DATE - oldest_order_date <= 30), 0),
        'aging_31_60', COALESCE(SUM(balance) FILTER (WHERE CURRENT_DATE - oldest_order_date BETWEEN 31 AND 60), 0),
        'aging_61_90', COALESCE(SUM(balance) FILTER (WHERE CURRENT_DATE - oldest_order_date BETWEEN 61 AND 90), 0),
        'aging_90_plus', COALESCE(SUM(balance) FILTER (WHERE CURRENT_DATE - oldest_order_date > 90), 0)
    )
    INTO v_receivables
    FROM doctor_balances;

    -- =============================================
    -- SECTION D: ACCOUNTS PAYABLE (always full history)
    -- =============================================
    -- Supplier payables = SUM(order costs) - SUM(supplier+designer payments)
    WITH total_costs AS (
        SELECT COALESCE(SUM(cost), 0) AS total_order_costs
        FROM orders
        WHERE status IN ('Delivered', 'Completed')
          AND COALESCE(is_archived, false) = false
    ),
    total_payments AS (
        SELECT COALESCE(SUM(amount), 0) AS total_supplier_payments
        FROM transactions
        WHERE type = 'expense' AND entity_type IN ('supplier', 'designer')
    )
    SELECT jsonb_build_object(
        'total_payables', GREATEST(tc.total_order_costs - tp.total_supplier_payments, 0)
    )
    INTO v_payables
    FROM total_costs tc, total_payments tp;

    -- =============================================
    -- COMBINE ALL SECTIONS
    -- =============================================
    result := v_order_stats || v_tx_stats || v_receivables || v_payables;

    RETURN result;
END;
$$;


-- 3. Top Expense Categories RPC (now uses effective_date)
CREATE OR REPLACE FUNCTION get_top_expense_categories(
    p_start_date DATE DEFAULT NULL,
    p_end_date   DATE DEFAULT NULL,
    p_limit      INT  DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
    INTO result
    FROM (
        SELECT jsonb_build_object(
            'category', category,
            'total', SUM(amount)
        ) AS row_data
        FROM transactions
        WHERE type = 'expense'
          AND (entity_type NOT IN ('supplier', 'designer', 'representative') OR entity_type IS NULL)
          AND (
            p_start_date IS NULL
            OR COALESCE(effective_date, date) BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
          )
        GROUP BY category
        ORDER BY SUM(amount) DESC
        LIMIT p_limit
    ) sub;

    RETURN result;
END;
$$;
