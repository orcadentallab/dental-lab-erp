-- Migration: split lab problem performance into severity tiers.
--
-- OWNER FEEDBACK (2026-08-17): the previous get_supplier_issue_performance
-- treated every issue_type as equally bad, which is not true of this
-- business. A blended "issue rate" let a lab's cancelled/lab-rejected count
-- (cases we simply chose not to continue, no product ever lost) inflate the
-- same rate as its doctor-rejected/redo count (a finished piece that is
-- genuinely gone, whether or not the doctor continues afterward).
--
-- Three tiers, by what was actually lost:
--   SEVERE   (doctor_rejected, redo)   — a delivered/produced piece is lost.
--             Drives the rate that matters: severe_issue_rate_pct.
--   RETURNED (returned)                — some doctor trust cost, but the
--             product itself was not lost. Counted on its own, never folded
--             into the severe rate.
--   MINOR    (cancelled, lab_rejected) — we chose not to continue; nothing
--             was produced and lost. Still counted and shown (owner: "نشوفه
--             بردوا لو كتير") but NEVER inflates a lab's problem rate.
--
-- Everything else (date axis, is_deleted/is_voided exclusion rules, the
-- internal/unassigned NULL-supplier row) is unchanged from 20260816006000.

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
                WHERE EXISTS (
                    SELECT 1 FROM live_issues li
                    WHERE li.order_id = oir.order_id AND li.issue_type IN ('doctor_rejected', 'redo')
                )
            ) AS severe_issue_orders,
            COUNT(*) FILTER (
                WHERE EXISTS (
                    SELECT 1 FROM live_issues li
                    WHERE li.order_id = oir.order_id AND li.issue_type = 'returned'
                )
            ) AS returned_orders,
            COUNT(*) FILTER (
                WHERE EXISTS (
                    SELECT 1 FROM live_issues li
                    WHERE li.order_id = oir.order_id AND li.issue_type IN ('cancelled', 'lab_rejected')
                )
            ) AS minor_issue_orders,
            -- Rejection cost only ever accrues on the severe tier in
            -- practice (rejected_lab_cost/rejected_designer_cost are set on
            -- doctor-rejection settlement) — scoped explicitly so a redo or
            -- a cancelled case can never contribute a cost figure it has none of.
            SUM(oir.rejection_cost) FILTER (
                WHERE EXISTS (
                    SELECT 1 FROM live_issues li
                    WHERE li.order_id = oir.order_id AND li.issue_type IN ('doctor_rejected', 'redo')
                )
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
            COALESCE(SUM(severe_issue_orders), 0) AS all_severe_issue_orders,
            COALESCE(SUM(total_orders), 0) AS all_orders
        FROM per_supplier
    )
    SELECT jsonb_build_object(
        'date_axis', 'order statement_date (both numerator and denominator)',
        'includes_archived', true,
        'total_orders', (SELECT all_orders FROM grand),
        'total_severe_issue_orders', (SELECT all_severe_issue_orders FROM grand),
        'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'supplier_id',        ps.supplier_id,
                'supplier_name',      COALESCE(s.name, 'داخلي / غير محدد'),
                'total_orders',       ps.total_orders,
                'severe_issue_orders', ps.severe_issue_orders,
                'severe_issue_rate_pct', CASE WHEN ps.total_orders > 0
                                          THEN round((ps.severe_issue_orders::numeric / ps.total_orders * 100), 1)
                                          ELSE NULL END,
                'share_of_all_severe_issues_pct', CASE WHEN (SELECT all_severe_issue_orders FROM grand) > 0
                                          THEN round((ps.severe_issue_orders::numeric
                                               / (SELECT all_severe_issue_orders FROM grand) * 100), 1)
                                          ELSE NULL END,
                'returned_orders',    ps.returned_orders,
                'returned_rate_pct',  CASE WHEN ps.total_orders > 0
                                          THEN round((ps.returned_orders::numeric / ps.total_orders * 100), 1)
                                          ELSE NULL END,
                'minor_issue_orders', ps.minor_issue_orders,
                'rejection_cost',     round(COALESCE(ps.rejection_cost, 0)::numeric, 2),
                'by_type', COALESCE((
                    SELECT jsonb_object_agg(tb.issue_type, tb.cnt)
                    FROM type_breakdown tb
                    WHERE tb.supplier_id IS NOT DISTINCT FROM ps.supplier_id
                ), '{}'::jsonb)
            ) ORDER BY ps.severe_issue_orders DESC, ps.total_orders DESC)
            FROM per_supplier ps
            LEFT JOIN suppliers s ON s.id = ps.supplier_id
        ), '[]'::jsonb)
    )
    INTO v_result;

    RETURN v_result;
END;
$$;

-- Signature is unchanged (DATE, DATE) — the existing REVOKE/GRANT and the
-- security_definer_rpc_grants.test.sql entry from 20260816006000 already
-- cover this function; no re-registration needed.

COMMIT;
