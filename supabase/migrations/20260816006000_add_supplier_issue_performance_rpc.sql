-- Migration: per-lab problem performance, sourced from order_issues.
--
-- REPLACES, DOES NOT PORT, the supplier table in src/pages/Quality.tsx.
--
-- That table derived rejections from orders.status and wasRejected(), which
-- reports only an order's CURRENT state. Any problem that was later resolved
-- disappeared from it entirely, so a lab that fixed its rejections looked
-- identical to a lab that never had any. Rule 5 of the reporting plan exists
-- because of exactly this: problem counts come from order_issues, the event
-- log, and from nowhere else.
--
-- DATE AXIS (rule 0-B): BOTH the denominator (all of the lab's cases) and
-- the numerator (its cases carrying a problem) are filtered on the ORDER's
-- statement date. The issues list on the same page filters on
-- order_issues.created_at instead, which answers "how many problems were
-- logged this month". Those are different questions and mixing the two axes
-- inside one ratio was a documented source of wrong numbers in phase 0, so
-- this function commits to one axis and the UI states which.
--
-- ARCHIVED ORDERS ARE INCLUDED (rule 0-A); only is_deleted is excluded.
-- Voided issues are excluded — a mis-logged problem an admin voided is not
-- evidence against the lab.
--
-- Orders with no supplier report under a NULL supplier_id row, which the UI
-- labels as in-house/unassigned. Dropping them would silently shrink the
-- denominator and flatter every named lab.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_supplier_issue_performance(
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

    WITH orders_in_range AS (
        SELECT
            o.id AS order_id,
            o.supplier_id,
            COALESCE(o.rejected_lab_cost, 0) + COALESCE(o.rejected_designer_cost, 0) AS rejection_cost
        FROM orders o
        WHERE COALESCE(o.is_deleted, false) = false
          AND (
              p_start_date IS NULL
              OR (CASE WHEN o.production_status = 'final_delivered'
                      THEN COALESCE(o.actual_delivery_date, o.delivery_date, o.created_at::date)
                      ELSE COALESCE(o.delivery_date, o.created_at::date)
                  END) BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
          )
    ),
    live_issues AS (
        SELECT oi.order_id, oi.issue_type
        FROM order_issues oi
        JOIN orders_in_range oir ON oir.order_id = oi.order_id
        WHERE COALESCE(oi.is_voided, false) = false
    ),
    per_supplier AS (
        SELECT
            oir.supplier_id,
            COUNT(*) AS total_orders,
            COUNT(*) FILTER (
                WHERE EXISTS (SELECT 1 FROM live_issues li WHERE li.order_id = oir.order_id)
            ) AS orders_with_issues,
            SUM(oir.rejection_cost) FILTER (
                WHERE EXISTS (SELECT 1 FROM live_issues li WHERE li.order_id = oir.order_id)
            ) AS rejection_cost
        FROM orders_in_range oir
        GROUP BY oir.supplier_id
    ),
    type_breakdown AS (
        SELECT
            oir.supplier_id,
            li.issue_type,
            COUNT(*) AS cnt
        FROM live_issues li
        JOIN orders_in_range oir ON oir.order_id = li.order_id
        GROUP BY oir.supplier_id, li.issue_type
    ),
    grand AS (
        SELECT
            COALESCE(SUM(orders_with_issues), 0) AS all_orders_with_issues,
            COALESCE(SUM(total_orders), 0) AS all_orders
        FROM per_supplier
    )
    SELECT jsonb_build_object(
        'date_axis', 'order statement_date (both numerator and denominator)',
        'includes_archived', true,
        'total_orders', (SELECT all_orders FROM grand),
        'total_orders_with_issues', (SELECT all_orders_with_issues FROM grand),
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'supplier_id',        ps.supplier_id,
                'supplier_name',      COALESCE(s.name, 'داخلي / غير محدد'),
                'total_orders',       ps.total_orders,
                'orders_with_issues', ps.orders_with_issues,
                'issue_rate_pct',     CASE WHEN ps.total_orders > 0
                                          THEN round((ps.orders_with_issues::numeric / ps.total_orders * 100), 1)
                                          ELSE NULL END,
                -- Share of ALL problem-carrying cases in the period, so the
                -- column answers "who is generating most of our problems"
                -- rather than repeating the per-lab rate.
                'share_of_all_issues_pct', CASE WHEN (SELECT all_orders_with_issues FROM grand) > 0
                                          THEN round((ps.orders_with_issues::numeric
                                               / (SELECT all_orders_with_issues FROM grand) * 100), 1)
                                          ELSE NULL END,
                'rejection_cost',     round(COALESCE(ps.rejection_cost, 0)::numeric, 2),
                'by_type', COALESCE((
                    SELECT jsonb_object_agg(tb.issue_type, tb.cnt)
                    FROM type_breakdown tb
                    WHERE tb.supplier_id IS NOT DISTINCT FROM ps.supplier_id
                ), '{}'::jsonb)
            ) ORDER BY ps.orders_with_issues DESC, ps.total_orders DESC)
            FROM per_supplier ps
            LEFT JOIN suppliers s ON s.id = ps.supplier_id
        ), '[]'::jsonb)
    )
    INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_supplier_issue_performance(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_supplier_issue_performance(DATE, DATE) TO authenticated;

COMMIT;
