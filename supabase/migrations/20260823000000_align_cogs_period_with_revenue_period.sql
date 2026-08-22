-- Migration: put accrual COGS in the SAME period as the revenue it earned.
--
-- Root cause: SECTION A2 of get_analytics_summary_privileged_20260801 dated
-- the two sides of the margin with two different columns:
--
--   revenue (doctor_orders.statement_date) -> actual_delivery_date for
--       production_status = 'final_delivered', delivery_date otherwise
--   cost    (supplier_costs/designer_costs.op_date) -> delivery_date, i.e.
--       the PLANNED date, always
--
-- Any order delivered later than planned therefore booked its revenue in the
-- month of actual delivery and its cost in the month it was scheduled for.
-- Over a monthly window that systematically inflates the current month's
-- gross margin and depresses the previous month's — it is a period-matching
-- bug, not a data problem.
--
-- Measured on production for August 2026 before this fix: of the 64 orders
-- whose revenue (128,300) landed in August, 35,685 of matching supplier /
-- designer cost had been pushed into an earlier month, reporting a 65.9%
-- gross margin for a lab that outsources nearly all production.
--
-- Fix: op_date now uses the exact same expression as statement_date, so an
-- order's revenue and its cost can never fall in different periods.
--
-- Deliberately NOT changed:
--   - the supplier/designer STATEMENT pages (Accounts.tsx) keep dating cost
--     rows by delivery_date. Those are per-entity ledgers, not the P&L; their
--     own operational date is the right basis there, and the parity test
--     compares all-time totals, which this change leaves identical.
--   - SECTION D (payables) has no date basis at all — untouched.
--   - orders with no supplier_id still contribute revenue at zero cost
--     (2,550 in August 2026 — scanner rent only). Revisit when in-house
--     production starts and real internal cost has to enter COGS.
--
-- Everything else in this function is byte-identical to
-- 20260812020000_mirror_statement_sales_cost_payables.sql.

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
    -- SECTION A1: simple order counts (unchanged from the previous fix)
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
    FROM orders
    WHERE (COALESCE(is_archived, false) = false)
      AND (COALESCE(is_deleted, false) = false)
      AND (
        p_start_date IS NULL
        OR (CASE WHEN status IN ('Delivered', 'Completed')
                THEN COALESCE(delivery_date, created_at::date)
                ELSE created_at::date
            END) BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
      );

    -- SECTION A2: total_sales_value + accrual COGS, settlement-aware
    -- (mirrors Accounts.tsx's getDoctorReceivableAmount / getLabCostMetadata)
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
            CASE WHEN COALESCE((du.custom_permissions->>'designer_fixed_salary')::boolean, false) THEN 0
                ELSE
                    CASE
                        WHEN o.status = 'Cancelled' OR o.status = 'Lab Rejected' THEN 0
                        WHEN o.status IN ('Doctor Rejected', 'Rejected') THEN COALESCE(o.rejected_designer_cost, 0)
                        WHEN o.design_price > 0 THEN o.design_price
                        ELSE 0
                    END
            END AS designer_price
        FROM orders o
        LEFT JOIN users du ON du.id = o.designer_id
        WHERE o.designer_id IS NOT NULL
          AND COALESCE(o.is_deleted, false) = false
          AND o.workflow_type = 'split'
          AND (
              o.design_status = 'completed'
              OR o.status IN ('Doctor Rejected', 'Rejected', 'Lab Rejected', 'Cancelled')
          )
    )
    SELECT jsonb_build_object(
        'total_sales_value', (
            SELECT COALESCE(SUM(receivable_amount) FILTER (
                WHERE p_start_date IS NULL OR statement_date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
            ), 0)
            FROM doctor_orders
        ),
        'total_cost_of_goods_suppliers', (
            SELECT COALESCE(SUM(supplier_cost) FILTER (
                WHERE p_start_date IS NULL OR op_date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
            ), 0)
            FROM supplier_costs
        ),
        'total_cost_of_goods_designers', (
            SELECT COALESCE(SUM(designer_price) FILTER (
                WHERE p_start_date IS NULL OR op_date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
            ), 0)
            FROM designer_costs
        )
    )
    INTO v_sales_cogs;
    v_sales_cogs := v_sales_cogs || jsonb_build_object(
        'total_cost_of_goods',
        COALESCE((v_sales_cogs->>'total_cost_of_goods_suppliers')::numeric, 0)
        + COALESCE((v_sales_cogs->>'total_cost_of_goods_designers')::numeric, 0)
    );

    -- SECTION B: TRANSACTION-BASED METRICS — unified date basis
    -- (previously total_expenses/supplier_payments/designer_payments used
    -- `date` while operating_expenses/production_costs used
    -- COALESCE(effective_date, date); now all five use the latter, so the
    -- "Payments" card's breakdown always sums to its own header total)
    SELECT jsonb_build_object(
        'total_income', COALESCE(SUM(amount) FILTER (WHERE type = 'income' AND (p_start_date IS NULL OR date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))), 0),
        'total_expenses', COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND (entity_type != 'representative' OR entity_type IS NULL) AND (p_start_date IS NULL OR COALESCE(effective_date, date) BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))), 0),
        'doctor_collections', COALESCE(SUM(amount) FILTER (WHERE type = 'income' AND entity_type = 'doctor' AND (p_start_date IS NULL OR date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))), 0),
        'supplier_payments', COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND entity_type = 'supplier' AND (p_start_date IS NULL OR COALESCE(effective_date, date) BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))), 0),
        'designer_payments', COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND entity_type = 'designer' AND (p_start_date IS NULL OR COALESCE(effective_date, date) BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))), 0),
        'production_costs', COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND entity_type IN ('supplier', 'designer') AND (p_start_date IS NULL OR COALESCE(effective_date, date) BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))), 0),
        'operating_expenses', COALESCE(SUM(amount) FILTER (WHERE type = 'expense' AND (entity_type NOT IN ('supplier', 'designer', 'representative') OR entity_type IS NULL) AND (p_start_date IS NULL OR COALESCE(effective_date, date) BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE))), 0)
    )
    INTO v_tx_stats
    FROM transactions;

    -- SECTION C: ACCOUNTS RECEIVABLE — FIFO per-order, settlement-aware amount,
    -- widened to the full statement inclusion set (not just Delivered/Completed)
    WITH doctor_orders AS (
        SELECT
            o.id AS order_id,
            COALESCE(d.parent_id, o.doctor_id) AS doctor_id,
            o.created_at,
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
        LEFT JOIN doctors d ON d.id = o.doctor_id
        WHERE COALESCE(o.is_deleted, false) = false
          AND lower(o.status) IN ('delivered', 'completed', 'cancelled', 'rejected', 'doctor rejected', 'lab rejected', 'returned for adjustments')
    ),
    doctor_orders_running AS (
        SELECT
            order_id,
            doctor_id,
            statement_date,
            receivable_amount,
            SUM(receivable_amount) OVER (
                PARTITION BY doctor_id
                ORDER BY statement_date, created_at, order_id
            ) AS running_billed
        FROM doctor_orders
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
        FROM (SELECT DISTINCT doctor_id FROM doctor_orders_running) ds
        LEFT JOIN doctor_payments dp ON dp.entity_id = ds.doctor_id
        LEFT JOIN doctor_adj da      ON da.entity_id = ds.doctor_id
    ),
    order_unpaid AS (
        SELECT
            do_.statement_date AS order_date,
            GREATEST(do_.running_billed - dc.total_collected, 0)
                - GREATEST(do_.running_billed - do_.receivable_amount - dc.total_collected, 0) AS unpaid_amount
        FROM doctor_orders_running do_
        JOIN doctor_collected dc ON dc.doctor_id = do_.doctor_id

        UNION ALL

        -- Charges/adjustments exceeding total billed + payments for a doctor
        -- aren't tied to one order; dated to the doctor's oldest order.
        SELECT
            MIN(do_.statement_date),
            GREATEST(-dc.total_collected, 0)
        FROM doctor_orders_running do_
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

    -- SECTION D: ACCOUNTS PAYABLE — two independent per-entity aggregations
    -- (suppliers, designers), each floored at zero per entity before
    -- summing, so one overpaid entity can no longer silently offset what's
    -- owed to a different one.
    WITH supplier_orders AS (
        SELECT
            o.supplier_id,
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
            END AS cost
        FROM orders o
        LEFT JOIN users du ON du.id = o.designer_id
        WHERE o.supplier_id IS NOT NULL
          AND COALESCE(o.is_deleted, false) = false
          AND (
              o.status = 'Delivered' OR o.status = 'Cancelled' OR o.status = 'Lab Rejected'
              OR (o.status IN ('Doctor Rejected', 'Rejected') AND o.rejected_lab_cost IS NOT NULL)
          )
    ),
    supplier_order_totals AS (
        SELECT supplier_id, SUM(cost) AS total_cost FROM supplier_orders GROUP BY supplier_id
    ),
    supplier_payments AS (
        SELECT entity_id, SUM(amount) AS total_paid
        FROM transactions WHERE type = 'expense' AND entity_type = 'supplier'
        GROUP BY entity_id
    ),
    supplier_adj AS (
        SELECT
            entity_id,
            -- Direction is flipped vs. doctors: suppliers are a payable-side
            -- entity, so a 'charge' reduces what we owe them (acts like a
            -- payment) and a 'credit' increases it (acts like an extra cost).
            COALESCE(SUM(amount) FILTER (WHERE type = 'charge'), 0) AS total_charges_as_payment,
            COALESCE(SUM(amount) FILTER (WHERE type = 'credit'), 0) AS total_credits_as_cost
        FROM adjustments WHERE entity_type = 'supplier'
        GROUP BY entity_id
    ),
    supplier_ids AS (
        SELECT supplier_id AS id FROM supplier_order_totals
        UNION SELECT entity_id FROM supplier_payments
        UNION SELECT entity_id FROM supplier_adj
    ),
    supplier_balances AS (
        SELECT
            (COALESCE(sot.total_cost, 0) + COALESCE(sadj.total_credits_as_cost, 0))
                - (COALESCE(sp.total_paid, 0) + COALESCE(sadj.total_charges_as_payment, 0)) AS balance
        FROM supplier_ids s
        LEFT JOIN supplier_order_totals sot ON sot.supplier_id = s.id
        LEFT JOIN supplier_payments sp ON sp.entity_id = s.id
        LEFT JOIN supplier_adj sadj ON sadj.entity_id = s.id
    ),
    designer_orders AS (
        SELECT
            o.designer_id,
            CASE WHEN COALESCE((du.custom_permissions->>'designer_fixed_salary')::boolean, false) THEN 0
                ELSE
                    CASE
                        WHEN o.status = 'Cancelled' OR o.status = 'Lab Rejected' THEN 0
                        WHEN o.status IN ('Doctor Rejected', 'Rejected') THEN COALESCE(o.rejected_designer_cost, 0)
                        WHEN o.design_price > 0 THEN o.design_price
                        ELSE 0
                    END
            END AS price
        FROM orders o
        LEFT JOIN users du ON du.id = o.designer_id
        WHERE o.designer_id IS NOT NULL
          AND COALESCE(o.is_deleted, false) = false
          AND o.workflow_type = 'split'
          AND (
              o.design_status = 'completed'
              OR o.status IN ('Doctor Rejected', 'Rejected', 'Lab Rejected', 'Cancelled')
          )
    ),
    designer_order_totals AS (
        SELECT designer_id, SUM(price) AS total_price FROM designer_orders GROUP BY designer_id
    ),
    designer_payments AS (
        SELECT entity_id, SUM(amount) AS total_paid
        FROM transactions WHERE type = 'expense' AND entity_type = 'designer'
        GROUP BY entity_id
    ),
    designer_adj AS (
        SELECT
            entity_id,
            COALESCE(SUM(amount) FILTER (WHERE type = 'charge'), 0) AS total_charges_as_payment,
            COALESCE(SUM(amount) FILTER (WHERE type = 'credit'), 0) AS total_credits_as_cost
        FROM adjustments WHERE entity_type = 'designer'
        GROUP BY entity_id
    ),
    designer_ids AS (
        SELECT designer_id AS id FROM designer_order_totals
        UNION SELECT entity_id FROM designer_payments
        UNION SELECT entity_id FROM designer_adj
    ),
    designer_balances AS (
        SELECT
            -- Salaried designers: their order-derived total is already 0
            -- (zeroed in designer_orders), and per Accounts.tsx their
            -- credit-adjustments are discarded too — only payments/charges
            -- affect a salaried designer's balance.
            CASE WHEN COALESCE((du.custom_permissions->>'designer_fixed_salary')::boolean, false)
                THEN 0 - (COALESCE(dp.total_paid, 0) + COALESCE(dadj.total_charges_as_payment, 0))
                ELSE (COALESCE(dot.total_price, 0) + COALESCE(dadj.total_credits_as_cost, 0))
                    - (COALESCE(dp.total_paid, 0) + COALESCE(dadj.total_charges_as_payment, 0))
            END AS balance
        FROM designer_ids d
        LEFT JOIN users du ON du.id = d.id
        LEFT JOIN designer_order_totals dot ON dot.designer_id = d.id
        LEFT JOIN designer_payments dp ON dp.entity_id = d.id
        LEFT JOIN designer_adj dadj ON dadj.entity_id = d.id
    )
    SELECT jsonb_build_object(
        'total_payables_suppliers', (SELECT COALESCE(SUM(GREATEST(balance, 0)), 0) FROM supplier_balances),
        'total_payables_designers', (SELECT COALESCE(SUM(GREATEST(balance, 0)), 0) FROM designer_balances)
    )
    INTO v_payables;
    v_payables := v_payables || jsonb_build_object(
        'total_payables',
        COALESCE((v_payables->>'total_payables_suppliers')::numeric, 0)
        + COALESCE((v_payables->>'total_payables_designers')::numeric, 0)
    );

    result := v_order_stats || v_sales_cogs || v_tx_stats || v_receivables || v_payables;
    RETURN result;
END;
$$;
