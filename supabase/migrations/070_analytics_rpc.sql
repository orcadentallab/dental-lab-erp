-- =====================================================================
-- Migration 070: Server-Side Analytics RPC
-- Date: 2026-02-17
-- Purpose: Replace client-side aggregation of 5000+ rows with
--          a single server-side RPC that returns compact JSON.
-- =====================================================================
-- ARCHITECTURE:
--   This RPC returns SUMMARY numbers only.
--   It does NOT replace detailed row-level queries needed by:
--     - Invoice generation (fetchFullEntityStatement)
--     - Doctor account statements (fetchFullEntityStatement)
--     - Detailed service analysis (order_items joins)
--     - Full exports (fetchAllOrdersForExport)
--   Those remain unaffected and continue to use SELECT * with pagination.
-- =====================================================================

-- 1. Performance Indexes (idempotent)
-- These dramatically speed up the aggregate queries below.
CREATE INDEX IF NOT EXISTS idx_orders_status_total_price
    ON orders(status, total_price);

CREATE INDEX IF NOT EXISTS idx_orders_status_cost
    ON orders(status, cost);

CREATE INDEX IF NOT EXISTS idx_orders_is_redo
    ON orders(is_redo) WHERE is_redo = true;

CREATE INDEX IF NOT EXISTS idx_orders_is_urgent
    ON orders(is_urgent) WHERE is_urgent = true;

CREATE INDEX IF NOT EXISTS idx_orders_delivery_date_status
    ON orders(delivery_date, status);

CREATE INDEX IF NOT EXISTS idx_transactions_type_entity_type
    ON transactions(type, entity_type);

CREATE INDEX IF NOT EXISTS idx_transactions_entity_id_type
    ON transactions(entity_id, type);

CREATE INDEX IF NOT EXISTS idx_order_items_product_type
    ON order_items(product_type);

-- 2. Main KPI Summary RPC
-- Returns a single JSON object with all dashboard metrics.
-- Accepts optional date range for filtering.
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
        -- Total income (all sources)
        'total_income', COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0),
        -- Total expenses (all sources)
        'total_expenses', COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0),
        -- Production costs (supplier + designer payments)
        'production_costs', COALESCE(SUM(amount) FILTER (
            WHERE type = 'expense' AND entity_type IN ('supplier', 'designer')
        ), 0),
        -- Operating expenses (everything except supplier/designer)
        'operating_expenses', COALESCE(SUM(amount) FILTER (
            WHERE type = 'expense' AND (entity_type NOT IN ('supplier', 'designer') OR entity_type IS NULL)
        ), 0),
        -- Doctor collections specifically
        'doctor_collections', COALESCE(SUM(amount) FILTER (
            WHERE type = 'income' AND entity_type = 'doctor'
        ), 0),
        -- Supplier payments specifically
        'supplier_payments', COALESCE(SUM(amount) FILTER (
            WHERE type = 'expense' AND entity_type = 'supplier'
        ), 0),
        -- Designer payments specifically  
        'designer_payments', COALESCE(SUM(amount) FILTER (
            WHERE type = 'expense' AND entity_type = 'designer'
        ), 0)
    )
    INTO v_tx_stats
    FROM transactions
    WHERE p_start_date IS NULL
       OR date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE);

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

-- 3. Top Doctors RPC (separate for modularity)
CREATE OR REPLACE FUNCTION get_top_doctors(
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
            'name', d.name,
            'revenue', SUM(o.total_price),
            'count', COUNT(*)
        ) AS row_data
        FROM orders o
        JOIN doctors d ON d.id = o.doctor_id
        WHERE o.status IN ('Delivered', 'Completed')
          AND COALESCE(o.is_archived, false) = false
          AND (
            p_start_date IS NULL
            OR COALESCE(o.delivery_date, o.created_at::date)
                BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
          )
        GROUP BY d.id, d.name
        ORDER BY SUM(o.total_price) DESC
        LIMIT p_limit
    ) sub;

    RETURN result;
END;
$$;

-- 4. Top Services RPC (uses normalized order_items table)
CREATE OR REPLACE FUNCTION get_top_services(
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
            'name', oi.product_type,
            'count', SUM(COALESCE(jsonb_array_length(oi.teeth_numbers), 1)),
            'revenue', SUM(oi.price * GREATEST(COALESCE(jsonb_array_length(oi.teeth_numbers), 1), 1))
        ) AS row_data
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.status IN ('Delivered', 'Completed')
          AND COALESCE(o.is_archived, false) = false
          AND (
            p_start_date IS NULL
            OR COALESCE(o.delivery_date, o.created_at::date)
                BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
          )
        GROUP BY oi.product_type
        ORDER BY SUM(COALESCE(jsonb_array_length(oi.teeth_numbers), 1)) DESC
        LIMIT p_limit
    ) sub;

    RETURN result;
END;
$$;

-- 5. Top Expense Categories RPC
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
          AND (entity_type NOT IN ('supplier', 'designer') OR entity_type IS NULL)
          AND (
            p_start_date IS NULL
            OR date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
          )
        GROUP BY category
        ORDER BY SUM(amount) DESC
        LIMIT p_limit
    ) sub;

    RETURN result;
END;
$$;

-- 6. Finance Dashboard Summary (includes capital + assets)
CREATE OR REPLACE FUNCTION get_finance_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
    v_total_income NUMERIC;
    v_production_costs NUMERIC;
    v_operating_expenses NUMERIC;
    v_total_capital NUMERIC;
    v_total_assets NUMERIC;
BEGIN
    -- Transaction totals (full history, no date filter for dashboard balance)
    SELECT
        COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0),
        COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND entity_type IN ('supplier', 'designer')), 0),
        COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND (entity_type NOT IN ('supplier', 'designer') OR entity_type IS NULL)), 0)
    INTO v_total_income, v_production_costs, v_operating_expenses
    FROM transactions;

    -- Capital
    SELECT COALESCE(SUM(amount), 0) INTO v_total_capital FROM capital_entries;

    -- Assets
    SELECT COALESCE(SUM(value), 0) INTO v_total_assets FROM fixed_assets;

    result := jsonb_build_object(
        'total_income', v_total_income,
        'production_costs', v_production_costs,
        'operating_expenses', v_operating_expenses,
        'total_capital', v_total_capital,
        'total_assets', v_total_assets,
        'starting_balance', v_total_capital - v_total_assets,
        'current_balance', (v_total_capital - v_total_assets) + v_total_income - (v_production_costs + v_operating_expenses)
    );

    RETURN result;
END;
$$;

-- 7. Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_analytics_summary(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_top_doctors(DATE, DATE, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_top_services(DATE, DATE, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_top_expense_categories(DATE, DATE, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_finance_dashboard() TO authenticated;
