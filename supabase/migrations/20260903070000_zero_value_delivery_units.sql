-- =====================================================================
-- Migration: a zero-priced delivery must not dilute the per-unit averages
-- File: supabase/migrations/20260903070000_zero_value_delivery_units.sql
--
-- 20260903020000 and 20260903040000 stopped cancelled and lab-rejected cases
-- from contributing units, because counting their units at zero revenue
-- invents a discount the lab never gave. One case slips past that rule with
-- the same effect: an order DELIVERED with total_price = 0 -- work that left
-- the lab but was written off. Its units still landed in the unit totals at
-- zero, pulling the average selling price per unit down (May 2026: 2 units
-- moved the average from 665.42 to 661.56).
--
-- The order stays a delivered case and keeps its place in every count; only
-- the per-unit averages skip its units. Mirrors isZeroValueDelivery() and
-- contributesProductiveUnits() in src/constants/orderLifecycle.ts.
--
-- Both function bodies are otherwise identical to the ones deployed by
-- 20260903020000 and 20260903040000.
-- =====================================================================

BEGIN;

SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.get_top_services_privileged_20260801(
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
    WITH doctor_orders AS (
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
            END AS receivable_amount,
            (lower(o.status) IN ('cancelled', 'lab rejected')
             OR COALESCE(o.issue_state, 'none') IN ('cancelled', 'lab_rejected')
             -- A case handed over with no price at all: real work, but pricing
             -- its units at zero drags the average selling price per unit down
             -- and reads as a discount the lab never gave. The case still
             -- counts as delivered; only the per-unit averages skip it.
             OR (lower(o.status) IN ('delivered', 'completed')
                 AND COALESCE(o.total_price, 0) = 0)) AS is_non_productive
        FROM orders o
        WHERE COALESCE(o.is_deleted, false) = false
          AND lower(o.status) IN ('delivered', 'completed', 'cancelled', 'rejected', 'doctor rejected', 'lab rejected', 'returned for adjustments')
    ),
    doctor_orders_in_range AS (
        SELECT * FROM doctor_orders
        WHERE p_start_date IS NULL
           OR statement_date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
    ),
    item_base AS (
        SELECT
            oi.order_id,
            oi.product_type,
            CASE
                WHEN do_.is_non_productive THEN 0
                ELSE GREATEST(COALESCE(jsonb_array_length(oi.teeth_numbers), 1), 1)
            END AS unit_count,
            oi.price AS item_price,
            COALESCE((pd.custom_prices->>oi.product_type)::numeric, sv.selling_price, 0) AS catalog_price
        FROM order_items oi
        JOIN doctor_orders_in_range do_ ON do_.order_id = oi.order_id
        LEFT JOIN doctors od ON od.id = do_.doctor_id
        LEFT JOIN doctors pd ON pd.id = COALESCE(od.parent_id, od.id)
        LEFT JOIN services sv ON sv.name = oi.product_type
    ),
    item_weights AS (
        SELECT
            order_id,
            product_type,
            unit_count,
            CASE
                WHEN unit_count = 0 THEN 0
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
    )
    SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
    INTO result
    FROM (
        SELECT jsonb_build_object(
            'name', iw.product_type,
            'count', SUM(iw.unit_count),
            'revenue', SUM(
                CASE WHEN owt.total_weight > 0
                    THEN do_.receivable_amount * iw.weight / owt.total_weight
                    ELSE 0
                END
            )
        ) AS row_data
        FROM item_weights iw
        JOIN doctor_orders_in_range do_ ON do_.order_id = iw.order_id
        JOIN order_weight_totals owt ON owt.order_id = iw.order_id
        GROUP BY iw.product_type
        ORDER BY SUM(iw.unit_count) DESC
        LIMIT p_limit
    ) sub;

    RETURN result;
END;
$$;


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
            CASE
                WHEN o.designer_id IS NULL OR o.workflow_type IS DISTINCT FROM 'split' THEN 0
                WHEN COALESCE((du.custom_permissions->>'designer_fixed_salary')::boolean, false) THEN 0
                WHEN o.status IN ('Cancelled', 'Lab Rejected') THEN 0
                WHEN o.status IN ('Doctor Rejected', 'Rejected') THEN COALESCE(o.rejected_designer_cost, 0)
                WHEN o.design_price > 0 THEN o.design_price
                ELSE 0
            END AS designer_cost,
            (lower(o.status) IN ('cancelled', 'lab rejected')
             OR COALESCE(o.issue_state, 'none') IN ('cancelled', 'lab_rejected')
             -- A case handed over with no price at all: real work, but pricing
             -- its units at zero drags the average selling price per unit down
             -- and reads as a discount the lab never gave. The case still
             -- counts as delivered; only the per-unit averages skip it.
             OR (lower(o.status) IN ('delivered', 'completed')
                 AND COALESCE(o.total_price, 0) = 0)) AS is_non_productive
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
            CASE
                WHEN oir.is_non_productive THEN 0
                ELSE GREATEST(COALESCE(jsonb_array_length(oi.teeth_numbers), 1), 1)
            END AS unit_count,
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
                WHEN unit_count = 0 THEN 0
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
            a.product_key,
            MAX(a.product_type) AS product_type,
            SUM(a.unit_count)::int AS units,
            COUNT(DISTINCT a.billing_doctor_id) AS billing_entity_count,
            COUNT(CASE WHEN a.is_redo THEN 1 END)::int AS redo_cases,
            ROUND(SUM(a.revenue), 2) AS revenue,
            ROUND(SUM(a.cost), 2) AS cost,
            ROUND(SUM(a.revenue) - SUM(a.cost), 2) AS profit,
            CASE
                WHEN SUM(a.revenue) > 0
                THEN ROUND(((SUM(a.revenue) - SUM(a.cost)) / SUM(a.revenue)) * 100, 2)
                ELSE 0
            END AS margin_pct
        FROM attributed a
        LEFT JOIN doctors dd ON dd.id = a.billing_doctor_id
        GROUP BY a.billing_doctor_id, dd.name, a.product_key
    )
    SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT jsonb_build_object(
            'doctor_id', billing_doctor_id,
            'doctor_name', doctor_name,
            'service_key', product_key,
            'service_name', product_type,
            'units', units,
            'redo_cases', redo_cases,
            'revenue', revenue,
            'cost', cost,
            'profit', profit,
            'margin_pct', margin_pct
        ) AS row_data
        FROM grouped
        ORDER BY revenue DESC, units DESC
    ) sub;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_top_families_privileged_20260826(
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
    WITH doctor_orders AS (
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
            END AS receivable_amount,
            (lower(o.status) IN ('cancelled', 'lab rejected')
             OR COALESCE(o.issue_state, 'none') IN ('cancelled', 'lab_rejected')
             -- A case handed over with no price at all: real work, but pricing
             -- its units at zero drags the average selling price per unit down
             -- and reads as a discount the lab never gave. The case still
             -- counts as delivered; only the per-unit averages skip it.
             OR (lower(o.status) IN ('delivered', 'completed')
                 AND COALESCE(o.total_price, 0) = 0)) AS is_non_productive
        FROM orders o
        WHERE COALESCE(o.is_deleted, false) = false
          AND lower(o.status) IN ('delivered', 'completed', 'cancelled', 'rejected', 'doctor rejected', 'lab rejected', 'returned for adjustments')
    ),
    doctor_orders_in_range AS (
        SELECT * FROM doctor_orders
        WHERE p_start_date IS NULL
           OR statement_date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
    ),
    item_base AS (
        SELECT
            oi.order_id,
            oi.product_type,
            -- English first; Arabic only when no English name was entered.
            COALESCE(NULLIF(btrim(sf.name_en), ''), sf.name_ar, oi.product_type) AS family_name,
            COALESCE(sf.color, 'emerald') AS family_color,
            sf.id IS NOT NULL AS is_family,
            CASE
                WHEN do_.is_non_productive THEN 0
                ELSE GREATEST(COALESCE(jsonb_array_length(oi.teeth_numbers), 1), 1)
            END AS unit_count,
            oi.price AS item_price,
            COALESCE((pd.custom_prices->>oi.product_type)::numeric, sv.selling_price, 0) AS catalog_price
        FROM order_items oi
        JOIN doctor_orders_in_range do_ ON do_.order_id = oi.order_id
        LEFT JOIN doctors od ON od.id = do_.doctor_id
        LEFT JOIN doctors pd ON pd.id = COALESCE(od.parent_id, od.id)
        LEFT JOIN services sv ON lower(btrim(sv.name)) = lower(btrim(oi.product_type))
        LEFT JOIN service_families sf ON sf.id = sv.family_id
    ),
    item_weights AS (
        SELECT
            order_id,
            family_name,
            family_color,
            is_family,
            unit_count,
            CASE
                WHEN unit_count = 0 THEN 0
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
    allocated AS (
        SELECT
            iw.family_name,
            iw.family_color,
            iw.is_family,
            iw.unit_count,
            CASE WHEN owt.total_weight > 0
                THEN do_.receivable_amount * iw.weight / owt.total_weight
                ELSE 0
            END AS allocated_revenue
        FROM item_weights iw
        JOIN doctor_orders_in_range do_ ON do_.order_id = iw.order_id
        JOIN order_weight_totals owt ON owt.order_id = iw.order_id
    ),
    grouped AS (
        SELECT
            family_name,
            MAX(family_color) AS family_color,
            bool_or(is_family) AS is_family,
            SUM(unit_count) AS unit_count,
            SUM(allocated_revenue) AS revenue
        FROM allocated
        GROUP BY family_name
    ),
    ranked AS (
        SELECT * FROM grouped
        ORDER BY unit_count DESC
        LIMIT p_limit
    ),
    totals AS (
        SELECT
            (SELECT COALESCE(SUM(receivable_amount), 0) FROM doctor_orders_in_range) AS total_revenue,
            (SELECT COALESCE(SUM(allocated_revenue), 0) FROM allocated)              AS allocated_revenue
    )
    SELECT jsonb_build_object(
        'families', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'name',      r.family_name,
                'color',     r.family_color,
                'count',     r.unit_count,
                'revenue',   r.revenue,
                'is_family', r.is_family
            ) ORDER BY r.unit_count DESC)
            FROM ranked r
        ), '[]'::jsonb),
        'family_count',       (SELECT count(*) FROM service_families),
        'total_revenue',      t.total_revenue,
        'allocated_revenue',  t.allocated_revenue,
        'itemless_revenue',   t.total_revenue - t.allocated_revenue
    )
    INTO result
    FROM totals t;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_top_families_privileged_20260826(DATE, DATE, INT)
    FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_top_services_privileged_20260801(DATE, DATE, INT)
    FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_top_families_privileged_20260826(DATE, DATE, INT)
    FROM PUBLIC, anon, authenticated;

COMMIT;
