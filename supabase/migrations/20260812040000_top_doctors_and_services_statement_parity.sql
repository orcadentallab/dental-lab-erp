-- Migration: make get_top_doctors / get_top_services fully consistent with
-- the statement-page-mirroring logic already applied to get_analytics_summary
-- and the Service Analysis tab (StatementTab.tsx).
--
-- Both RPCs still had three gaps relative to that logic:
--   1. Date bucketing used only the scheduled `delivery_date`, not the
--      actual delivery date for final-delivered orders (getOfficialStatementDate)
--      -- an order scheduled for one month but actually delivered the next
--      landed in the wrong month here, same bug already fixed for
--      total_sales_value and Service Analysis.
--   2. Revenue used the raw `total_price`/item price directly instead of
--      the settlement-aware amount (rejected_doctor_amount once a rejection
--      decision is recorded, matching getDoctorReceivableAmount).
--   3. Order inclusion was narrower (Delivered/Completed only) than the
--      statement page's full set (also cancelled/rejected/returned, since a
--      settled rejection still contributes real revenue).
--
-- get_top_services additionally needs the same proportional per-item
-- revenue distribution the client already uses (StatementTab.tsx): an
-- item's share of the order's settlement-aware total is weighted by its own
-- price (or catalog/doctor-custom price when no item price is recorded).

CREATE OR REPLACE FUNCTION public.get_top_doctors_privileged_20260801(
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
            COALESCE(d.parent_id, o.doctor_id) AS doctor_id,
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
    )
    SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
    INTO result
    FROM (
        SELECT jsonb_build_object(
            'name', COALESCE(dd.name, 'غير معروف'),
            'revenue', SUM(do_.receivable_amount),
            'count', COUNT(*)
        ) AS row_data
        FROM doctor_orders do_
        JOIN doctors dd ON dd.id = do_.doctor_id
        WHERE p_start_date IS NULL
           OR do_.statement_date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
        GROUP BY dd.id, dd.name
        ORDER BY SUM(do_.receivable_amount) DESC
        LIMIT p_limit
    ) sub;

    RETURN result;
END;
$$;

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
            END AS receivable_amount
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
        -- Same weighting rule as StatementTab.tsx: an item's own recorded
        -- price wins; otherwise the doctor's custom price for that service
        -- (via their center/parent doctor if any), falling back to the
        -- service's catalog selling price, falling back to equal weighting
        -- (weight = unit_count) when no price is known at all.
        SELECT
            oi.order_id,
            oi.product_type,
            GREATEST(COALESCE(jsonb_array_length(oi.teeth_numbers), 1), 1) AS unit_count,
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
