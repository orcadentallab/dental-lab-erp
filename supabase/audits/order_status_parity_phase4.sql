-- Phase 4 read-only status parity audit.
-- Safe for local/staging/production inspection after migration 20261022170000.
-- It performs no writes and intentionally limits detail output to 100 rows.

BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

-- 1. Mirror-off gate. All review dimensions must be zero before phase 5.
SELECT *
FROM public.workflow_v2_status_parity_gate;

-- 2. Bounded reason summary; presentation and financial differences stay
-- separate so an explained label alias cannot conceal an accounting change.
SELECT
    presentation_mismatch_reason,
    financial_difference_reason,
    has_unresolved_legacy_review,
    count(*) AS order_count
FROM public.workflow_v2_status_parity_review
GROUP BY 1, 2, 3
ORDER BY order_count DESC, 1, 2;

-- 3. First review batch only. Continue with keyset pagination by order_id.
SELECT
    order_id,
    case_id,
    legacy_status,
    derived_status,
    expected_legacy_compat_status,
    production_status,
    issue_state,
    intake_state,
    presentation_mismatch_reason,
    legacy_confirmed_without_timestamp,
    has_unresolved_legacy_review,
    legacy_financial_effect,
    v2_financial_effect,
    financial_difference_reason
FROM public.workflow_v2_status_parity_review
ORDER BY order_id
LIMIT 100;

-- 4. Expected Redo compatibility aliases are evidence, not blockers.
SELECT count(*) AS explained_redo_aliases
FROM public.workflow_v2_status_parity_audit
WHERE presentation_mismatch_reason = 'expected_redo_legacy_alias';

-- 5. Direct database dependencies on orders.status. During phase 4 only the
-- backfill/parity audit views are expected; any business view is a blocker.
SELECT
    dependent_ns.nspname AS schema_name,
    dependent.relname AS object_name,
    dependent.relkind AS object_kind
FROM pg_depend dependency
JOIN pg_rewrite rewrite ON rewrite.oid = dependency.objid
JOIN pg_class dependent ON dependent.oid = rewrite.ev_class
JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent.relnamespace
WHERE dependency.refobjid = 'public.orders'::regclass
  AND dependency.refobjsubid = (
      SELECT ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = 'status'
  )
ORDER BY 1, 2;

-- 6. No orders RLS policy may classify workflow through legacy status.
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'orders'
  AND (
      COALESCE(qual, '')
          ~* '(^|[^a-z0-9_.])status[[:space:]]*(=|<>|!=|in|is)'
      OR COALESCE(with_check, '')
          ~* '(^|[^a-z0-9_.])status[[:space:]]*(=|<>|!=|in|is)'
  )
ORDER BY 1, 2, 3;

-- 7. The compatibility mirror must remain on throughout phase 4.
SELECT key, value
FROM public.app_settings
WHERE key = 'workflow_status_legacy_mirror';

ROLLBACK;
