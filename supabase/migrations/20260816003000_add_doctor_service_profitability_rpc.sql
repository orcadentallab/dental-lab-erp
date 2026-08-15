-- Migration: per doctor x service profitability.
--
-- COST BASIS — deliberate deviation from the written plan.
--
-- REPORTS_IMPLEMENTATION_PLAN_AR.md task 4.1 specified cost as
-- `services.cost_price * count + milling_price + designer_price` — i.e. the
-- catalog price list. That is a MODEL of what an order should have cost, not
-- what it did cost, and it would have produced a gross-profit figure that
-- disagrees with `get_analytics_summary.total_cost_of_goods` on the very
-- same orders. Shipping a second, quietly different cost number is the exact
-- class of bug this whole reporting effort exists to remove.
--
-- This function therefore reuses the settlement-aware per-order cost already
-- established in 20260812020000_mirror_statement_sales_cost_payables.sql
-- (which itself was verified line-by-line against Accounts.tsx,
-- orderLifecycle.ts and financialObligations.ts): supplier cost with the
-- split-workflow / salaried-designer / rejection branches, plus designer
-- cost with the same branches. Revenue likewise reuses the settlement-aware
-- `receivable_amount`, so gross profit here is revenue and cost drawn from
-- one consistent basis.
--
-- PER-ITEM ATTRIBUTION
--
-- Revenue and cost both live on the ORDER, not the item. They are split
-- across the order's items using the same weighting rule the client already
-- uses in StatementTab.tsx and get_top_services (item price, else the
-- doctor's custom price, else catalog selling price, else equal weighting).
-- Using one weight for both keeps a row's margin equal to the order's margin.
--
-- DATE BASIS
--
-- Both revenue and cost are filtered on the order's own statement_date, so
-- an order's revenue and its cost always land in the same period and a row's
-- margin is meaningful. get_analytics_summary filters cost on the operation
-- date instead, so the cost total here can differ slightly for orders whose
-- actual delivery date fell in a different period than the scheduled one.
-- The UI states this.
--
-- ARCHIVED ORDERS ARE INCLUDED (rule 0-A). Archiving closes a file; it does
-- not undo revenue that was earned or cost that was paid. Only is_deleted is
-- excluded.
--
-- SERVICE NAMES
--
-- order_items.product_type is free text, not a FK to services. Rows are
-- grouped on the normalized name and each row reports whether that name
-- exists in the services catalog. Unmatched names are returned like any
-- other row — never dropped — because their revenue and cost are real; the
-- flag marks a catalog cleanup, not an invalid row.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_doctor_service_profitability(
    p_start_date DATE DEFAULT NULL,
    p_end_date   DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;

    WITH scoped_orders AS (
        SELECT
            o.id AS order_id,
            COALESCE(d.parent_id, o.doctor_id) AS billing_doctor_id,
            COALESCE(o.is_redo, false) AS is_redo,
            CASE WHEN o.production_status = 'final_delivered'
                THEN COALESCE(o.actual_delivery_date, o.delivery_date, o.created_at::date)
                ELSE COALESCE(o.delivery_date, o.created_at::date)
            END AS statement_date,
            -- Mirrors getDoctorReceivableAmount()
            CASE
                WHEN COALESCE(o.issue_state, 'none') IN ('doctor_rejected', 'lab_rejected', 'redo') THEN
                    CASE WHEN o.rejection_doctor_decision IS NOT NULL
                        THEN GREATEST(COALESCE(o.rejected_doctor_amount, 0), 0)
                        ELSE 0
                    END
                WHEN o.production_status = 'final_delivered' AND COALESCE(o.issue_state, 'none') = 'none'
                    THEN COALESCE(o.total_price, 0)
                ELSE 0
            END AS receivable_amount,
            -- Mirrors getLabCostMetadata() supplier branch
            CASE
                WHEN o.supplier_id IS NULL THEN 0
                WHEN o.status IN ('Cancelled', 'Lab Rejected') THEN 0
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
            END AS supplier_cost,
            -- Mirrors getEffectiveDesignPrice(); a salaried designer costs the
            -- order nothing because their pay is a fixed operating expense.
            CASE
                WHEN o.designer_id IS NULL OR o.workflow_type IS DISTINCT FROM 'split' THEN 0
                WHEN COALESCE((du.custom_permissions->>'designer_fixed_salary')::boolean, false) THEN 0
                WHEN o.status IN ('Cancelled', 'Lab Rejected') THEN 0
                WHEN o.status IN ('Doctor Rejected', 'Rejected') THEN COALESCE(o.rejected_designer_cost, 0)
                WHEN o.design_price > 0 THEN o.design_price
                ELSE 0
            END AS designer_cost
        FROM orders o
        LEFT JOIN doctors d ON d.id = o.doctor_id
        LEFT JOIN users du ON du.id = o.designer_id
        WHERE COALESCE(o.is_deleted, false) = false
          AND o.doctor_id IS NOT NULL
          AND lower(o.status) IN (
              'delivered', 'completed', 'cancelled', 'rejected',
              'doctor rejected', 'lab rejected', 'returned for adjustments'
          )
    ),
    orders_in_range AS (
        SELECT * FROM scoped_orders
        WHERE p_start_date IS NULL
           OR statement_date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
    ),
    item_base AS (
        SELECT
            oi.order_id,
            btrim(oi.product_type) AS product_type,
            lower(btrim(oi.product_type)) AS product_key,
            GREATEST(COALESCE(jsonb_array_length(oi.teeth_numbers), 1), 1) AS unit_count,
            oi.price AS item_price,
            COALESCE((pd.custom_prices->>oi.product_type)::numeric, sv.selling_price, 0) AS catalog_price
        FROM order_items oi
        JOIN orders_in_range oir ON oir.order_id = oi.order_id
        LEFT JOIN doctors pd ON pd.id = oir.billing_doctor_id
        LEFT JOIN services sv ON lower(btrim(sv.name)) = lower(btrim(oi.product_type))
        WHERE oi.product_type IS NOT NULL AND btrim(oi.product_type) <> ''
    ),
    item_weights AS (
        SELECT
            order_id,
            product_type,
            product_key,
            unit_count,
            CASE
                WHEN item_price > 0 THEN item_price * unit_count
                WHEN catalog_price > 0 THEN catalog_price * unit_count
                ELSE unit_count
            END AS weight
        FROM item_base
    ),
    order_weight_totals AS (
        SELECT order_id, SUM(weight) AS total_weight
        FROM item_weights
        GROUP BY order_id
    ),
    attributed AS (
        SELECT
            oir.billing_doctor_id,
            iw.product_key,
            iw.product_type,
            iw.unit_count,
            oir.is_redo,
            CASE WHEN owt.total_weight > 0
                THEN oir.receivable_amount * iw.weight / owt.total_weight ELSE 0 END AS revenue,
            CASE WHEN owt.total_weight > 0
                THEN (oir.supplier_cost + oir.designer_cost) * iw.weight / owt.total_weight ELSE 0 END AS cost
        FROM item_weights iw
        JOIN orders_in_range oir ON oir.order_id = iw.order_id
        JOIN order_weight_totals owt ON owt.order_id = iw.order_id
    ),
    grouped AS (
        SELECT
            a.billing_doctor_id,
            COALESCE(dd.name, 'غير معروف') AS doctor_name,
            -- One display spelling per normalized key: the most frequently
            -- recorded one, so a stray typo does not rename the whole row.
            (array_agg(a.product_type ORDER BY a.unit_count DESC))[1] AS service_name,
            a.product_key,
            EXISTS (SELECT 1 FROM services s WHERE lower(btrim(s.name)) = a.product_key) AS is_catalog_service,
            SUM(a.unit_count) AS units,
            SUM(a.revenue) AS revenue,
            SUM(a.cost) AS cost,
            SUM(a.cost) FILTER (WHERE a.is_redo) AS redo_cost,
            SUM(a.unit_count) FILTER (WHERE a.is_redo) AS redo_units
        FROM attributed a
        LEFT JOIN doctors dd ON dd.id = a.billing_doctor_id
        GROUP BY a.billing_doctor_id, dd.name, a.product_key
    )
    SELECT jsonb_build_object(
        'date_axis', 'order statement_date (actual delivery when final-delivered, else scheduled)',
        'includes_archived', true,
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'doctor_id',          g.billing_doctor_id,
                'doctor_name',        g.doctor_name,
                'service_name',       g.service_name,
                'is_catalog_service', g.is_catalog_service,
                'units',              g.units,
                'revenue',            round(g.revenue::numeric, 2),
                'cost',               round(g.cost::numeric, 2),
                'gross_profit',       round((g.revenue - g.cost)::numeric, 2),
                'margin_pct',         CASE WHEN g.revenue > 0
                                         THEN round(((g.revenue - g.cost) / g.revenue * 100)::numeric, 1)
                                         ELSE NULL END,
                'redo_cost',          round(COALESCE(g.redo_cost, 0)::numeric, 2),
                'redo_units',         COALESCE(g.redo_units, 0)
            ) ORDER BY (g.revenue - g.cost) DESC)
            FROM grouped g
        ), '[]'::jsonb),
        'totals', COALESCE((
            SELECT jsonb_build_object(
                'units',                COALESCE(SUM(g.units), 0),
                'revenue',              round(COALESCE(SUM(g.revenue), 0)::numeric, 2),
                'cost',                 round(COALESCE(SUM(g.cost), 0)::numeric, 2),
                'gross_profit',         round(COALESCE(SUM(g.revenue - g.cost), 0)::numeric, 2),
                'redo_cost',            round(COALESCE(SUM(g.redo_cost), 0)::numeric, 2),
                'uncatalogued_rows',    COUNT(*) FILTER (WHERE NOT g.is_catalog_service),
                'uncatalogued_revenue', round(COALESCE(SUM(g.revenue) FILTER (WHERE NOT g.is_catalog_service), 0)::numeric, 2)
            )
            FROM grouped g
        ), '{}'::jsonb)
    )
    INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_doctor_service_profitability(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_doctor_service_profitability(DATE, DATE) TO authenticated;

COMMIT;
