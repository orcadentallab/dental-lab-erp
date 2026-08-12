-- Read-only inventory for retiring public.orders.status.
-- Safe for local/staging/production catalog inspection; performs no writes.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

SELECT dependent_ns.nspname AS schema_name,
       dependent.relname AS object_name,
       dependent.relkind AS object_kind,
       pg_get_viewdef(dependent.oid, true) AS definition
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

SELECT namespace.nspname AS schema_name,
       procedure.proname AS function_name,
       pg_get_functiondef(procedure.oid) AS definition
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.prokind IN ('f', 'p')
  AND pg_get_functiondef(procedure.oid) ILIKE '%status%'
ORDER BY 1, 2;

SELECT event_object_schema,
       event_object_table,
       trigger_name,
       event_manipulation,
       action_timing,
       action_condition,
       action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND (
      action_statement ILIKE '%status%'
      OR COALESCE(action_condition, '') ILIKE '%status%'
  )
ORDER BY 1, 2, 3, 4;

SELECT schemaname,
       tablename,
       policyname,
       cmd,
       qual,
       with_check
FROM pg_policies
WHERE COALESCE(qual, '') ILIKE '%status%'
   OR COALESCE(with_check, '') ILIKE '%status%'
ORDER BY 1, 2, 3;

SELECT schemaname,
       viewname,
       definition
FROM pg_views
WHERE schemaname = 'public'
  AND definition ILIKE '%status%'
ORDER BY 1, 2;

SELECT production_status,
       issue_state,
       status AS legacy_status,
       COUNT(*) AS order_count
FROM public.orders
GROUP BY production_status, issue_state, status
ORDER BY production_status, issue_state, status;

ROLLBACK;
