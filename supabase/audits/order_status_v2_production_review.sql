-- Order Workflow V2 production review (read-only)
-- First executed: 2026-10-21
-- This file intentionally contains SELECT statements only.

-- 1. Compare the legacy status with the V2-derived presentation status.
WITH classified AS (
    SELECT
        id,
        production_status,
        issue_state,
        status AS legacy_status,
        public.derive_order_display_status_v2(
            production_status,
            issue_state
        ) AS derived_status,
        CASE
            WHEN public.derive_order_display_status_v2(
                production_status,
                issue_state
            ) IS NULL THEN 'invalid_axes'
            WHEN status IS NOT DISTINCT FROM
                public.derive_order_display_status_v2(
                    production_status,
                    issue_state
                ) THEN 'match'
            WHEN issue_state = 'redo'
                AND status = 'Doctor Rejected'
                THEN 'expected_redo_legacy_encoding'
            ELSE 'unexpected_mismatch'
        END AS review_class
    FROM public.orders
)
SELECT
    review_class,
    production_status,
    issue_state,
    legacy_status,
    derived_status,
    COUNT(*) AS order_count
FROM classified
GROUP BY
    review_class,
    production_status,
    issue_state,
    legacy_status,
    derived_status
ORDER BY
    review_class,
    order_count DESC,
    production_status,
    issue_state;

-- 2. Verify that redo rows have explicit structured-event evidence where
-- available. Older rows are checked against order_history in query 3.
SELECT
    o.id AS order_id,
    o.production_status,
    o.issue_state,
    o.status AS legacy_status,
    public.derive_order_display_status_v2(
        o.production_status,
        o.issue_state
    ) AS derived_status,
    COUNT(e.id) FILTER (
        WHERE e.event_type ILIKE '%redo%'
           OR e.old_value ILIKE '%redo%'
           OR e.new_value ILIKE '%redo%'
    ) AS redo_event_count,
    COALESCE(
        string_agg(DISTINCT e.event_type, ', ') FILTER (
            WHERE e.event_type ILIKE '%redo%'
               OR e.old_value ILIKE '%redo%'
               OR e.new_value ILIKE '%redo%'
        ),
        '(no explicit redo event)'
    ) AS redo_event_types
FROM public.orders o
LEFT JOIN public.order_events e ON e.order_id = o.id
WHERE o.issue_state = 'redo'
GROUP BY o.id, o.production_status, o.issue_state, o.status
ORDER BY o.production_status, o.id;

-- 3. Verify legacy redo rows that predate structured redo events through the
-- raw workflow history. No names, notes, or clinical fields are selected.
SELECT
    o.id AS order_id,
    o.production_status,
    o.issue_state,
    o.status AS legacy_status,
    h.created_at AS latest_workflow_history_at,
    h.changes -> 'issue_state' AS issue_state_change,
    h.changes -> 'status' AS legacy_status_change
FROM public.orders o
LEFT JOIN LATERAL (
    SELECT oh.created_at, oh.changes
    FROM public.order_history oh
    WHERE oh.order_id = o.id
      AND (
          COALESCE(oh.changes, '{}'::jsonb) ? 'issue_state'
          OR COALESCE(oh.changes, '{}'::jsonb) ? 'status'
      )
    ORDER BY oh.created_at DESC
    LIMIT 1
) h ON TRUE
WHERE o.issue_state = 'redo'
  AND NOT EXISTS (
      SELECT 1
      FROM public.order_events e
      WHERE e.order_id = o.id
        AND (
            e.event_type ILIKE '%redo%'
            OR e.old_value ILIKE '%redo%'
            OR e.new_value ILIKE '%redo%'
        )
  )
ORDER BY o.id;
