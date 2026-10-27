-- Catalog assertions plus actual access checks; never writes business data.
BEGIN;
SET search_path TO public, extensions;
SELECT plan(9);

SELECT ok((SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.order_item_price_backfill_audit'::regclass),
    'Maintenance price audit has RLS enabled');

SELECT ok(NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['anon', 'authenticated']) AS r(role_name)
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege_name)
    WHERE has_table_privilege(r.role_name, 'public.order_item_price_backfill_audit', p.privilege_name)
), 'Client roles cannot read, modify or truncate maintenance audit evidence');

SELECT is((SELECT count(*)::integer FROM pg_class c
    WHERE c.oid IN ('public.production_history_quality'::regclass,
        'public.production_stage_run_costing'::regclass,
        'public.machine_downtime_impact'::regclass,
        'public.order_cost_component_audit'::regclass)
    AND 'security_invoker=true' = ANY(c.reloptions)), 4,
    'All four reporting views enforce caller privileges and RLS');

SELECT ok(NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['production_history_quality', 'production_stage_run_costing',
        'machine_downtime_impact', 'order_cost_component_audit']) AS v(view_name)
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege_name)
    WHERE has_table_privilege('anon', 'public.' || v.view_name, p.privilege_name)
), 'Signed-out users have no reporting view privileges');

SELECT ok(NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['production_history_quality', 'production_stage_run_costing',
        'machine_downtime_impact', 'order_cost_component_audit']) AS v(view_name)
    WHERE NOT has_table_privilege('authenticated', 'public.' || v.view_name, 'SELECT')
        OR has_table_privilege('authenticated', 'public.' || v.view_name, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
), 'Signed-in users have SELECT only on reports');

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"role":"authenticated"}';
SELECT is((SELECT count(*)::integer FROM public.production_history_quality), 0,
    'Unlinked authenticated session sees no production history');
SELECT is((SELECT count(*)::integer FROM public.production_stage_run_costing), 0,
    'Unlinked authenticated session sees no stage costing');
SELECT is((SELECT count(*)::integer FROM public.machine_downtime_impact), 0,
    'Unlinked authenticated session sees no machine impact');
SELECT is((SELECT count(*)::integer FROM public.order_cost_component_audit), 0,
    'Unlinked authenticated session sees no order cost audit');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
