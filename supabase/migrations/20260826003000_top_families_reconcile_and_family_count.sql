-- =====================================================================
-- Batch B: make get_top_families reconcile with the doctor statement,
--          and let the caller tell "no families defined yet" apart from
--          "these are real families".
-- =====================================================================
--
-- Two problems with the 20260826000000 version, both of which make the
-- card read as authoritative when it is not:
--
-- 1. It returns a bare ranked array. Revenue reaches a family only through
--    order_items, so the 111 in-scope orders that carry a receivable but
--    have no items at all (legacy Excel imports from Jan/Feb 2026) drop out
--    of the JOIN silently -- 184,900 EGP, ~10% of the period total. The
--    card's numbers therefore cannot be added up against the statement.
--
-- 2. COALESCE(sf.name_ar, oi.product_type) falls back to the raw service
--    name when a service has no family. With zero families defined -- the
--    current production state -- every row is a service name presented
--    under the heading "top families". The fallback is worth keeping, but
--    the caller has to be able to say so.
--
-- The return type changes from a JSONB array to a JSONB object. The only
-- consumer is analyticsService.getTopFamilies, updated in the same change.
-- =====================================================================

BEGIN;

SET LOCAL statement_timeout = '30s';

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
        SELECT
            oi.order_id,
            oi.product_type,
            COALESCE(sf.name_ar, oi.product_type) AS family_name,
            COALESCE(sf.color, 'emerald') AS family_color,
            sf.id IS NOT NULL AS is_family,
            GREATEST(COALESCE(jsonb_array_length(oi.teeth_numbers), 1), 1) AS unit_count,
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
        -- Lets the caller distinguish "no families configured, these rows
        -- are service names" from "these are real families".
        'family_count',       (SELECT count(*) FROM service_families),
        'total_revenue',      t.total_revenue,
        'allocated_revenue',  t.allocated_revenue,
        -- Receivable on in-scope orders that carry no order_items at all,
        -- so it can never reach a family. Surfaced instead of dropped, so
        -- families + itemless adds back up to the statement total.
        'itemless_revenue',   t.total_revenue - t.allocated_revenue
    )
    INTO result
    FROM totals t;

    RETURN result;
END;
$$;

-- CREATE OR REPLACE preserves the existing ACL, so Batch A's revoke still
-- stands after this runs. Repeating it is deliberate anyway: it is
-- idempotent, and it means this file states the intended grant on its own
-- rather than depending on a reader noticing the revoke two files back.
-- The original hole came from exactly that kind of implicit assumption.
REVOKE ALL ON FUNCTION public.get_top_families_privileged_20260826(DATE, DATE, INT)
    FROM PUBLIC, anon, authenticated;

COMMIT;
