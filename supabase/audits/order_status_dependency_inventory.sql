-- Read-only inventory for retiring public.orders.status.
-- Safe for local/staging/production catalog inspection; performs no writes.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

SELECT dependent_ns.nspname AS schema_name,
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

SELECT namespace.nspname AS schema_name,
       procedure.proname AS function_name,
       procedure.oid::regprocedure AS signature,
       md5(pg_get_functiondef(procedure.oid)) AS definition_hash
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.prokind IN ('f', 'p')
  AND pg_get_functiondef(procedure.oid)
      ~* '(new|old|o|orders|v_order|p_order)[.]status'
ORDER BY 1, 2;

SELECT trigger.tgname AS trigger_name,
       procedure.proname AS function_name,
       pg_get_triggerdef(trigger.oid, true) AS trigger_definition,
       md5(pg_get_functiondef(procedure.oid)) AS function_definition_hash
FROM pg_trigger trigger
JOIN pg_proc procedure ON procedure.oid = trigger.tgfoid
WHERE trigger.tgrelid = 'public.orders'::regclass
  AND NOT trigger.tgisinternal
  AND pg_get_functiondef(procedure.oid) ILIKE '%status%'
ORDER BY 1, 2;

SELECT schemaname,
       tablename,
       policyname,
       cmd,
       qual,
       with_check
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

SELECT schemaname,
       viewname,
       md5(definition) AS definition_hash
FROM pg_views
WHERE schemaname = 'public'
  AND definition ~* '(^|[^a-z_])(o|orders)[.]status'
ORDER BY 1, 2;

SELECT production_status,
       issue_state,
       status AS legacy_status,
       COUNT(*) AS order_count
FROM public.orders
GROUP BY production_status, issue_state, status
ORDER BY production_status, issue_state, status;

SELECT key, value
FROM public.app_settings
WHERE key = 'workflow_status_legacy_mirror';

ROLLBACK;
