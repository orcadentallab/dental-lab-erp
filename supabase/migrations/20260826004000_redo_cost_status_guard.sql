-- =====================================================================
-- Batch C: apply the cancelled / lab-rejected guard to the redo_cost KPI.
-- =====================================================================
--
-- get_analytics_summary_privileged_20260801 states the rule four times --
-- COGS suppliers, COGS designers, payables suppliers, payables designers
-- all open with `WHEN o.status = 'Cancelled' OR o.status = 'Lab Rejected'
-- THEN 0`, because a case in either state was never worked on.
--
-- The redo_cost aggregate in section A1 is the one place that reads
-- orders.cost with no such guard. orders.cost is the estimate captured when
-- the order was created and is never cleared on cancellation, so a redo
-- case that is later cancelled would contribute its stale estimate to the
-- KPI. No production order is in that combination today (8 redo orders,
-- none cancelled or lab-rejected), which is exactly why this is worth
-- fixing now rather than after it starts reporting a number.
--
-- WHY THIS PATCHES INSTEAD OF REDECLARING
-- The function body is ~23k characters and has been redefined by six
-- migrations. Pasting a copy to change one FILTER clause would silently
-- revert anything a later migration changed that the copy predates. This
-- reads the definition actually deployed, rewrites the single expression,
-- and refuses to run if that expression is not found exactly once.
-- =====================================================================

BEGIN;

SET LOCAL statement_timeout = '30s';

DO $do$
DECLARE
    v_def      TEXT;
    v_needle   TEXT := '''redo_cost'', COALESCE(SUM(cost) FILTER (WHERE is_redo = true), 0),';
    v_replace  TEXT := '''redo_cost'', COALESCE(SUM(cost) FILTER (WHERE is_redo = true AND status NOT IN (''Cancelled'', ''Lab Rejected'')), 0),';
    v_hits     INT;
BEGIN
    SELECT pg_get_functiondef(p.oid)
    INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_analytics_summary_privileged_20260801';

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'get_analytics_summary_privileged_20260801 not found';
    END IF;

    v_hits := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);

    IF v_hits <> 1 THEN
        RAISE EXCEPTION
            'Expected exactly one unguarded redo_cost aggregate, found %. The function was rewritten upstream; re-check the guard by hand.',
            v_hits;
    END IF;

    EXECUTE replace(v_def, v_needle, v_replace);

    RAISE NOTICE 'redo_cost now excludes cancelled and lab-rejected orders.';
END
$do$;

-- pg_get_functiondef emits CREATE OR REPLACE, which preserves the ACL, so
-- the existing revoke still stands. Restated for the same reason as in
-- 20260826003000: the grant should be readable from this file alone.
REVOKE ALL ON FUNCTION public.get_analytics_summary_privileged_20260801(DATE, DATE)
    FROM PUBLIC, anon, authenticated;

COMMIT;
