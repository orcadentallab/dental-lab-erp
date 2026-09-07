-- Drop get_orders_paginated(): a live experiment nobody finished, and nobody
-- calls.
--
-- Found while auditing production for drift against the migration chain
-- (docs/PRODUCTION_ROLES_PLAN_AR.md section 8.6). It exists only in
-- production -- created directly against the live database, never through a
-- migration file -- and `grep -rn get_orders_paginated src/` across the whole
-- frontend returns nothing. No page, no service, no RPC call anywhere reaches
-- it.
--
-- The function body itself is the evidence it was left mid-thought rather
-- than shipped: it reasons out loud in its own comments --
--   "Actually, for variable sorting column, dynamic SQL is best."
--   "Wait, if we access 'orders' directly, RLS applies."
--   "Does UI read from 'order_items' table or 'items' column? ... To be
--    safe, let's fetch from 'order_items' table and aggregate as JSON."
-- -- and computes v_total_count twice in a row, the first result discarded.
-- That reads as someone thinking through an approach in the SQL editor, not a
-- finished feature that shipped without its migration.
--
-- Safe to drop:
--   - Zero callers in the frontend (grepped, not assumed).
--   - Not part of the migration chain, so a fresh environment built from
--     supabase/migrations/ alone has never had it -- dropping it in
--     production makes environments agree, it does not remove a capability
--     any environment currently depends on.
--   - No other function or trigger references it (plain SELECT-only body,
--     nothing depends on its return type or OUT parameters).
--
-- IF EXISTS: this must succeed cleanly whether run against production (where
-- it exists) or a chain-only rebuild (where it never did).

BEGIN;

DROP FUNCTION IF EXISTS public.get_orders_paginated(
    integer, integer, text, text, text, text
);

COMMIT;
