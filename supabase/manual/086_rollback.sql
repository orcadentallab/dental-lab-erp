-- Migration 086 — Rollback companion (NOT auto-applied).
--
-- Run manually only if a complete rollback of the unified workflow layer is
-- required. Restores orders to the pre-WF-1 schema. Audit history written into
-- order_events while migration 086 was active is preserved (the table itself
-- predates migration 086 and is not dropped).

-- 1. RPC
DROP FUNCTION IF EXISTS rep_update_order_fields_with_audit(UUID, JSONB, TEXT, TEXT);

-- 2. Trigger + function
DROP TRIGGER IF EXISTS trigger_orders_role_field_guard ON orders;
DROP FUNCTION IF EXISTS orders_role_field_guard();

-- 3. Indexes
DROP INDEX IF EXISTS idx_orders_issue_state;
DROP INDEX IF EXISTS idx_orders_production_status;

-- 4. Constraints + columns
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_issue_state_check;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_production_status_check;
ALTER TABLE orders DROP COLUMN IF EXISTS issue_state;
ALTER TABLE orders DROP COLUMN IF EXISTS production_status;

-- 5. Optional: clear the feature flag default if previously set on the database.
--    (Keeping the GUC is harmless; no orders trigger references it after rollback.)
-- ALTER DATABASE postgres RESET app.workflow_strict_rep;

DO $$ BEGIN
    RAISE NOTICE 'Migration 086 rolled back. orders.status enum, financial logic, and RLS policies remain unchanged.';
END $$;
