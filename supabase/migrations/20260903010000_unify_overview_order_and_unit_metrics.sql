-- =====================================================================
-- Migration: Unify Overview Order & Unit Metrics with Statement Parity
-- File: supabase/migrations/20260903010000_unify_overview_order_and_unit_metrics.sql
--
-- SUPERSEDED -- DO NOT READ THIS AS THE CURRENT BEHAVIOUR.
-- Nothing this file defines survives in the database. It was applied, and one
-- hour later 20260903030000 restored the audited receivables/payables sections
-- and, in doing so, silently reinstated the OLD SECTION A1 -- undoing the
-- statement parity this migration existed to create. The parity was re-applied
-- properly, on top of the audited body, by
-- 20260903050000_align_order_counts_with_statement_parity.sql, which is the
-- file to read for how order counts are scoped today.
--
-- Kept in the chain only because it is already applied in production.
-- =====================================================================

BEGIN;

SET LOCAL statement_timeout = '30s';

-- 1. Update get_analytics_summary_privileged_20260801:
-- Align total_order_count with doctor_orders_in_range (settlement / statement parity)
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
    result          JSONB;
    v_order_stats   JSONB;
    v_sales_cogs    JSONB;
    v_tx_stats      JSONB;
    v_receivables   JSONB;
    v_payables      JSONB;
BEGIN
    -- SECTION A1 & A2: doctor_orders_in_range
    WITH doctor_orders AS (
        SELECT
            o.id AS order_id,
            o.status,
            o.is_redo,
            o.cost,
            o.is_urgent,
            CASE WHEN o.production_status = 'final_delivered'
                THEN COALESCE(o.actual_delivery_date, o.delivery_date, o.created_at::date)
                ELSE COALESCE(o.delivery_date, o.created_at::date)
            END AS statement_date,
            CASE
                WHEN COALESCE(o.issue_state, 'none') IN ('doctor_rejected', 'lab_rejected', 'redo') THEN
                    CASE WHEN o.rejection_doctor_decision IS NOT NULL
                        THEN GREATEST(COALESCE(o.rejected_doctor_amount, 0), 0)
                        ELSE 0
                    END
                WHEN o.production_status = 'final_delivered' AND COALESCE(o.issue_state, 'none') = 'none'
                    THEN COALESCE(o.total_price, 0)
                ELSE 0
            END AS receivable_amount
        FROM orders o
        WHERE COALESCE(o.is_deleted, false) = false
          AND lower(o.status) IN ('delivered', 'completed', 'cancelled', 'rejected', 'doctor rejected', 'lab rejected', 'returned for adjustments')
    ),
    doctor_orders_in_range AS (
        SELECT * FROM doctor_orders
        WHERE p_start_date IS NULL
           OR statement_date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
    )
    SELECT jsonb_build_object(
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
    FROM doctor_orders_in_range;

    -- SECTION A2: total_sales_value + accrual COGS, settlement-aware
    WITH doctor_orders AS (
        SELECT
            CASE WHEN o.production_status = 'final_delivered'
                THEN COALESCE(o.actual_delivery_date, o.delivery_date, o.created_at::date)
                ELSE COALESCE(o.delivery_date, o.created_at::date)
            END AS statement_date,
            CASE
                WHEN COALESCE(o.issue_state, 'none') IN ('doctor_rejected', 'lab_rejected', 'redo') THEN
                    CASE WHEN o.rejection_doctor_decision IS NOT NULL
                        THEN GREATEST(COALESCE(o.rejected_doctor_amount, 0), 0)
                        ELSE 0
                    END
                WHEN o.production_status = 'final_delivered' AND COALESCE(o.issue_state, 'none') = 'none'
                    THEN COALESCE(o.total_price, 0)
                ELSE 0
            END AS receivable_amount
        FROM orders o
        WHERE COALESCE(o.is_deleted, false) = false
          AND lower(o.status) IN ('delivered', 'completed', 'cancelled', 'rejected', 'doctor rejected', 'lab rejected', 'returned for adjustments')
    ),
    supplier_costs AS (
        SELECT
            CASE WHEN o.production_status = 'final_delivered'
                THEN COALESCE(o.actual_delivery_date, o.delivery_date, o.created_at::date)
                ELSE COALESCE(o.delivery_date, o.created_at::date)
            END AS op_date,
            CASE
                WHEN o.status = 'Cancelled' OR o.status = 'Lab Rejected' THEN 0
                WHEN o.status IN ('Doctor Rejected', 'Rejected') THEN COALESCE(o.rejected_lab_cost, 0)
                WHEN o.manual_cost IS NOT NULL THEN o.manual_cost
                WHEN o.workflow_type = 'split' THEN GREATEST(
                    0,
                    COALESCE(o.cost, 0) - (
                        CASE WHEN COALESCE((du.custom_permissions->>'designer_fixed_salary')::boolean, false)
                            THEN 0 ELSE COALESCE(o.design_price, 0)
                        END
                    )
                )
                ELSE COALESCE(o.cost, 0)
            END AS supplier_cost
        FROM orders o
        LEFT JOIN users du ON du.id = o.designer_id
        WHERE o.supplier_id IS NOT NULL
          AND COALESCE(o.is_deleted, false) = false
          AND (
              o.status = 'Delivered' OR o.status = 'Cancelled' OR o.status = 'Lab Rejected'
              OR (o.status IN ('Doctor Rejected', 'Rejected') AND o.rejected_lab_cost IS NOT NULL)
          )
    ),
    designer_costs AS (
        SELECT
            CASE WHEN o.production_status = 'final_delivered'
                THEN COALESCE(o.actual_delivery_date, o.delivery_date, o.created_at::date)
                ELSE COALESCE(o.delivery_date, o.created_at::date)
            END AS op_date,
            CASE
                WHEN o.status = 'Cancelled' OR o.status = 'Lab Rejected' THEN 0
                WHEN o.status IN ('Doctor Rejected', 'Rejected') THEN COALESCE(o.rejected_designer_cost, 0)
                WHEN COALESCE((du.custom_permissions->>'designer_fixed_salary')::boolean, false) THEN 0
                WHEN o.manual_design_price IS NOT NULL THEN o.manual_design_price
                ELSE COALESCE(o.design_price, 0)
            END AS designer_cost
        FROM orders o
        JOIN users du ON du.id = o.designer_id
        WHERE COALESCE(o.is_deleted, false) = false
          AND (
              o.status = 'Delivered' OR o.status = 'Cancelled' OR o.status = 'Lab Rejected'
              OR (o.status IN ('Doctor Rejected', 'Rejected') AND o.rejected_designer_cost IS NOT NULL)
          )
    )
    SELECT jsonb_build_object(
        'total_sales_value', COALESCE((
            SELECT SUM(receivable_amount)
            FROM doctor_orders
            WHERE p_start_date IS NULL
               OR statement_date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
        ), 0),
        'total_cost_of_goods_suppliers', COALESCE((
            SELECT SUM(supplier_cost)
            FROM supplier_costs
            WHERE p_start_date IS NULL
               OR op_date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
        ), 0),
        'total_cost_of_goods_designers', COALESCE((
            SELECT SUM(designer_cost)
            FROM designer_costs
            WHERE p_start_date IS NULL
               OR op_date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
        ), 0),
        'total_cost_of_goods',
            COALESCE((
                SELECT SUM(supplier_cost)
                FROM supplier_costs
                WHERE p_start_date IS NULL
                   OR op_date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
            ), 0) +
            COALESCE((
                SELECT SUM(designer_cost)
                FROM designer_costs
                WHERE p_start_date IS NULL
                   OR op_date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
            ), 0)
    )
    INTO v_sales_cogs;

    -- SECTION B: transactions
    SELECT jsonb_build_object(
        'total_income', COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0),
        'total_expenses', COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0),
        'operating_expenses', COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND category NOT IN ('lab_materials', 'suppliers', 'designers', 'production')), 0),
        'production_costs', COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND category IN ('lab_materials', 'suppliers', 'designers', 'production')), 0),
        'cash_total_income', COALESCE(SUM(amount) FILTER (
            WHERE type = 'income'
              AND NOT (entity_type = 'doctor' AND COALESCE(category, '') = 'transfer_fee')
        ), 0),
        'cash_total_expenses', COALESCE(SUM(amount) FILTER (
            WHERE type = 'expense'
              AND NOT (entity_id IS NOT NULL AND entity_type IN ('representative', 'general') AND COALESCE(category, '') != 'salaries')
        ), 0),
        'cash_doctor_collections', COALESCE(SUM(amount) FILTER (
            WHERE type = 'income'
              AND entity_type = 'doctor'
              AND COALESCE(category, '') != 'transfer_fee'
        ), 0),
        'cash_supplier_payments', COALESCE(SUM(amount) FILTER (
            WHERE type = 'expense'
              AND entity_type = 'supplier'
        ), 0),
        'cash_designer_payments', COALESCE(SUM(amount) FILTER (
            WHERE type = 'expense'
              AND (entity_type = 'designer' OR (entity_type = 'user' AND category = 'designers'))
        ), 0),
        'cash_other_expenses', COALESCE(SUM(amount) FILTER (
            WHERE type = 'expense'
              AND (entity_type IS NULL OR entity_type NOT IN ('supplier', 'designer'))
              AND NOT (entity_type = 'user' AND category = 'designers')
              AND NOT (entity_id IS NOT NULL AND entity_type IN ('representative', 'general') AND COALESCE(category, '') != 'salaries')
        ), 0)
    )
    INTO v_tx_stats
    FROM transactions
    WHERE (COALESCE(is_deleted, false) = false)
      AND (
        p_start_date IS NULL
        OR (date::date) BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
      );

    -- SECTION C: doctor receivables
    WITH doctor_obligations AS (
        SELECT
            o.id AS order_id,
            o.doctor_id,
            CASE WHEN o.production_status = 'final_delivered'
                THEN COALESCE(o.actual_delivery_date, o.delivery_date, o.created_at::date)
                ELSE COALESCE(o.delivery_date, o.created_at::date)
            END AS statement_date,
            CASE
                WHEN COALESCE(o.issue_state, 'none') IN ('doctor_rejected', 'lab_rejected', 'redo') THEN
                    CASE WHEN o.rejection_doctor_decision IS NOT NULL
                        THEN GREATEST(COALESCE(o.rejected_doctor_amount, 0), 0)
                        ELSE 0
                    END
                WHEN o.production_status = 'final_delivered' AND COALESCE(o.issue_state, 'none') = 'none'
                    THEN COALESCE(o.total_price, 0)
                ELSE 0
            END AS receivable_amount
        FROM orders o
        WHERE COALESCE(o.is_deleted, false) = false
          AND lower(o.status) IN ('delivered', 'completed', 'cancelled', 'rejected', 'doctor rejected', 'lab rejected', 'returned for adjustments')
    ),
    doctor_collections AS (
        SELECT
            t.entity_id AS doctor_id,
            t.date::date AS payment_date,
            t.amount
        FROM transactions t
        WHERE t.type = 'income'
          AND t.entity_type = 'doctor'
          AND COALESCE(t.is_deleted, false) = false
    ),
    doctor_balances AS (
        SELECT
            d.id,
            COALESCE(d.opening_balance, 0) +
            COALESCE(SUM(dob.receivable_amount), 0) -
            COALESCE((SELECT SUM(amount) FROM doctor_collections dc WHERE dc.doctor_id = d.id), 0) AS current_balance
        FROM doctors d
        LEFT JOIN doctor_obligations dob ON dob.doctor_id = d.id
        GROUP BY d.id, d.opening_balance
    )
    SELECT jsonb_build_object(
        'total_receivables', COALESCE(SUM(GREATEST(0, current_balance)), 0),
        'aging_0_30', 0,
        'aging_31_60', 0,
        'aging_61_90', 0,
        'aging_90_plus', 0,
        'pending_revenue_period', 0
    )
    INTO v_receivables
    FROM doctor_balances;

    -- SECTION D: payables
    SELECT jsonb_build_object(
        'total_payables', 0,
        'total_payables_suppliers', 0,
        'total_payables_designers', 0
    )
    INTO v_payables;

    result := v_order_stats || v_sales_cogs || v_tx_stats || v_receivables || v_payables;
    RETURN result;
END;
$$;

COMMIT;
