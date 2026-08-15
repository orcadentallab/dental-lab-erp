-- Migration: add get_order_issues_summary RPC
--
-- Purpose:
--   `order_issues` is the ONLY trustworthy source for problem/remake counts.
--   Analytics.tsx currently derives its "حالات بمشاكل" card from
--   get_analytics_summary, which reads orders.status -- the order's CURRENT
--   state. Once a problem is resolved the status moves on and the event
--   disappears, so the card under-reports. It also SUMS four type counts
--   (doctor_rejected + redo + lab_rejected + returned), double-counting any
--   order carrying more than one type, and omits `cancelled` entirely.
--
-- Three rules this function encodes, all established by the 2026-08-12
-- row-by-row reconciliation on production (9 rows in Aug 2026):
--
--   (a) DO NOT filter on is_archived. Archiving means "the file was closed",
--       NOT "the problem was cancelled". 4 of the 9 rows sat on archived
--       orders; excluding them hides real problems. Only is_deleted is
--       excluded (1 of 9), because that row is genuinely deleted.
--
--   (b) The date axis is order_issues.created_at -- WHEN THE PROBLEM WAS
--       LOGGED -- not the order's date. Another 4 of the 9 differed purely
--       because the RPC filters on the order date while the issue log filters
--       on the issue date. Both are valid, but they answer different
--       questions, so the axis is returned in the payload and the UI must
--       display it.
--
--   (c) Zero rows differed because of a status change. The "order was fixed
--       and moved on" theory was disproven.
--
-- Note on `redo`: order_issues.issue_type = 'redo' marks the ORIGINAL order
-- that had the problem. orders.is_redo marks the REPLACEMENT order. They are
-- different populations and must never be compared or summed.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_order_issues_summary(
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

    WITH scoped AS (
        SELECT oi.issue_type, oi.cause_category, oi.order_id
        FROM order_issues oi
        LEFT JOIN orders o ON o.id = oi.order_id
        WHERE (p_start_date IS NULL OR oi.created_at::date >= p_start_date)
          AND (p_end_date   IS NULL OR oi.created_at::date <= p_end_date)
          -- is_archived is deliberately NOT filtered here (rule a)
          AND COALESCE(o.is_deleted, false) = false
    )
    SELECT jsonb_build_object(
        'distinct_orders_with_issues', COALESCE(COUNT(DISTINCT order_id), 0),
        'total_issue_events',          COALESCE(COUNT(*), 0),
        'date_axis',                   'order_issues.created_at',
        'by_type', COALESCE(
            (SELECT jsonb_object_agg(issue_type, cnt)
             FROM (SELECT issue_type, COUNT(*) AS cnt
                   FROM scoped GROUP BY issue_type) t), '{}'::jsonb),
        'by_cause', COALESCE(
            (SELECT jsonb_object_agg(COALESCE(cause_category, 'unknown'), cnt)
             FROM (SELECT cause_category, COUNT(*) AS cnt
                   FROM scoped GROUP BY cause_category) t), '{}'::jsonb)
    )
    INTO v_result
    FROM scoped;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_order_issues_summary(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_issues_summary(DATE, DATE) TO authenticated;

COMMIT;
