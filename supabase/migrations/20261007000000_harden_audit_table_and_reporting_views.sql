-- Security Advisor: one maintenance audit table without RLS and four views
-- that used the owner's privileges instead of the caller's RLS policies.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Maintenance-only rollback evidence; no application reads this table.
-- Keep owner/service_role access and preserve every historical row.
ALTER TABLE public.order_item_price_backfill_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_item_price_backfill_audit
    FROM PUBLIC, anon, authenticated;

ALTER VIEW public.production_history_quality SET (security_invoker = true);
ALTER VIEW public.production_stage_run_costing SET (security_invoker = true);
ALTER VIEW public.machine_downtime_impact SET (security_invoker = true);
ALTER VIEW public.order_cost_component_audit SET (security_invoker = true);

-- Reports are read-only for signed-in users. Base-table policies determine
-- which rows they see; these views must never expose data to signed-out users.
REVOKE ALL ON TABLE public.production_history_quality,
    public.production_stage_run_costing, public.machine_downtime_impact,
    public.order_cost_component_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.production_history_quality,
    public.production_stage_run_costing, public.machine_downtime_impact,
    public.order_cost_component_audit TO authenticated;

COMMIT;
