-- ===========================================================================
-- Before/after proof for the lab_cost / designer_cost split
-- (migrations 20260907000000, 20260907001000, 20260907002000, 20260907003000)
--
-- Run STEP 1 immediately before clicking Deploy.
-- Run STEP 2 immediately after the deploy finishes.
-- STEP 2 prints one row per metric that moved, and says whether it was
-- supposed to. No row marked UNEXPECTED is the pass condition.
--
-- Every metric is pinned to orders that already existed at the moment STEP 1
-- ran, and uses gross/net amounts rather than remaining balances, so new cases
-- and new payments between the two runs cannot pollute the comparison.
-- Anything that moves is the migration's doing.
-- ===========================================================================


-- ===========================================================================
-- STEP 1 -- run this FIRST, right before deploying
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public._cost_split_preflight (
    phase       text        NOT NULL,
    metric      text        NOT NULL,
    value       numeric,
    cutoff      timestamptz NOT NULL,
    captured_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (phase, metric)
);

INSERT INTO public._cost_split_preflight (phase, metric, value, cutoff)
WITH cut AS (SELECT now() AS ts),
scoped AS (
    SELECT o.* FROM public.orders o, cut
     WHERE COALESCE(o.is_deleted, false) = false AND o.created_at <= cut.ts
),
ob AS (
    SELECT f.* FROM public.financial_obligations f
      JOIN scoped o ON o.id = f.order_id
     WHERE f.status <> 'void'
),
m AS (
    -- Money owed. This is the accounting source of truth; none of it may move.
    SELECT 'oblig_' || entity_type || '_' || direction || '_gross' AS metric,
           ROUND(SUM(gross_amount), 2) AS value FROM ob GROUP BY entity_type, direction
    UNION ALL
    SELECT 'oblig_' || entity_type || '_' || direction || '_net',
           ROUND(SUM(net_amount), 2)   FROM ob GROUP BY entity_type, direction
    UNION ALL
    SELECT 'oblig_rows', COUNT(*)::numeric FROM ob
    UNION ALL
    -- Per entity as well as in total: a total can hide two errors that cancel
    -- each other out, a per-supplier / per-designer list cannot.
    SELECT 'oblig_by_entity_' || entity_id::text, ROUND(SUM(net_amount), 2)
      FROM ob GROUP BY entity_id
    UNION ALL
    -- The P&L basis. getLabCostAmount() reads orders.cost.
    SELECT 'pnl_revenue', ROUND(SUM(COALESCE(total_price, 0)), 2) FROM scoped
    UNION ALL
    SELECT 'pnl_cost',    ROUND(SUM(COALESCE(cost, 0)), 2)        FROM scoped
    UNION ALL
    SELECT 'pnl_cost_productive', ROUND(SUM(COALESCE(cost, 0)), 2) FROM scoped
     WHERE status NOT IN ('Cancelled', 'Lab Rejected', 'Doctor Rejected', 'Rejected')
    UNION ALL
    SELECT 'orders_rows', COUNT(*)::numeric FROM scoped
    UNION ALL
    -- The accounting queue. The blacklist-diff trap would surface here.
    SELECT 'registered', COUNT(*)::numeric FROM scoped WHERE is_registered
    UNION ALL
    SELECT 'needs_reregistration', COUNT(*)::numeric
      FROM scoped WHERE needs_accounting_reregistration
    UNION ALL
    SELECT 'accounting_review_change_rows', COUNT(*)::numeric
      FROM public.accounting_review_changes c JOIN scoped o ON o.id = c.order_id
    UNION ALL
    -- Stored accounting snapshots. These are EXPECTED to move in phase 2.
    SELECT 'snapshot_labcost_sum',
           ROUND(SUM((accounting_snapshot->>'labCost')::numeric), 2)
      FROM scoped WHERE accounting_snapshot IS NOT NULL
    UNION ALL
    SELECT 'snapshot_designcost_sum',
           ROUND(SUM((accounting_snapshot->>'designCost')::numeric), 2)
      FROM scoped WHERE accounting_snapshot IS NOT NULL
)
SELECT 'before_scoped', m.metric, m.value, cut.ts FROM m, cut
ON CONFLICT (phase, metric) DO UPDATE
    SET value = EXCLUDED.value, cutoff = EXCLUDED.cutoff, captured_at = now();

SELECT COUNT(*) AS metrics_captured,
       MIN(cutoff) AS cutoff_pinned_at
  FROM public._cost_split_preflight WHERE phase = 'before_scoped';


-- ===========================================================================
-- STEP 2 -- run this AFTER the deploy finishes
-- ===========================================================================

WITH cut AS (
    SELECT MIN(cutoff) AS ts FROM public._cost_split_preflight
     WHERE phase = 'before_scoped'
),
scoped AS (
    SELECT o.* FROM public.orders o, cut
     WHERE COALESCE(o.is_deleted, false) = false AND o.created_at <= cut.ts
),
ob AS (
    SELECT f.* FROM public.financial_obligations f
      JOIN scoped o ON o.id = f.order_id
     WHERE f.status <> 'void'
),
after_values AS (
    SELECT 'oblig_' || entity_type || '_' || direction || '_gross' AS metric,
           ROUND(SUM(gross_amount), 2) AS value FROM ob GROUP BY entity_type, direction
    UNION ALL
    SELECT 'oblig_' || entity_type || '_' || direction || '_net',
           ROUND(SUM(net_amount), 2)   FROM ob GROUP BY entity_type, direction
    UNION ALL
    SELECT 'oblig_rows', COUNT(*)::numeric FROM ob
    UNION ALL
    SELECT 'oblig_by_entity_' || entity_id::text, ROUND(SUM(net_amount), 2)
      FROM ob GROUP BY entity_id
    UNION ALL
    SELECT 'pnl_revenue', ROUND(SUM(COALESCE(total_price, 0)), 2) FROM scoped
    UNION ALL
    SELECT 'pnl_cost',    ROUND(SUM(COALESCE(cost, 0)), 2)        FROM scoped
    UNION ALL
    SELECT 'pnl_cost_productive', ROUND(SUM(COALESCE(cost, 0)), 2) FROM scoped
     WHERE status NOT IN ('Cancelled', 'Lab Rejected', 'Doctor Rejected', 'Rejected')
    UNION ALL
    SELECT 'orders_rows', COUNT(*)::numeric FROM scoped
    UNION ALL
    SELECT 'registered', COUNT(*)::numeric FROM scoped WHERE is_registered
    UNION ALL
    SELECT 'needs_reregistration', COUNT(*)::numeric
      FROM scoped WHERE needs_accounting_reregistration
    UNION ALL
    SELECT 'accounting_review_change_rows', COUNT(*)::numeric
      FROM public.accounting_review_changes c JOIN scoped o ON o.id = c.order_id
    UNION ALL
    SELECT 'snapshot_labcost_sum',
           ROUND(SUM((accounting_snapshot->>'labCost')::numeric), 2)
      FROM scoped WHERE accounting_snapshot IS NOT NULL
    UNION ALL
    SELECT 'snapshot_designcost_sum',
           ROUND(SUM((accounting_snapshot->>'designCost')::numeric), 2)
      FROM scoped WHERE accounting_snapshot IS NOT NULL
),
diff AS (
    -- b.metric / a.metric being NULL means the metric is missing from that
    -- side entirely -- an entity that gained or lost every obligation, say.
    -- That is different from a metric whose VALUE is legitimately NULL, which
    -- is simply an empty aggregate and not a change.
    SELECT COALESCE(b.metric, a.metric) AS metric,
           b.value AS before_value,
           a.value AS after_value,
           ROUND(COALESCE(a.value, 0) - COALESCE(b.value, 0), 2) AS delta,
           (b.metric IS NULL) AS appeared,
           (a.metric IS NULL) AS disappeared
      FROM (SELECT metric, value FROM public._cost_split_preflight
             WHERE phase = 'before_scoped') b
      FULL JOIN after_values a ON a.metric = b.metric
)
SELECT metric, before_value, after_value, delta,
       CASE
           WHEN appeared    THEN '*** UNEXPECTED -- metric appeared after deploy ***'
           WHEN disappeared THEN '*** UNEXPECTED -- metric vanished after deploy ***'
           -- Case 1041-260507-501 was saved as 100 when it cost 160.
           WHEN metric IN ('pnl_cost', 'pnl_cost_productive') AND delta = 60.00
                THEN 'EXPECTED: case 1041-260507-501 repaired, 100 -> 160'
           -- Phase 2 restates the snapshot cost lines so they sum to the case
           -- cost. Neither line is displayed anywhere in the UI.
           WHEN metric = 'snapshot_labcost_sum'    AND delta <> 0
                THEN 'EXPECTED: phase 2 restated the labCost lines'
           WHEN metric = 'snapshot_designcost_sum' AND delta <> 0
                THEN 'EXPECTED: phase 2 zeroed designCost for salaried designers'
           ELSE '*** UNEXPECTED -- STOP AND INVESTIGATE ***'
       END AS verdict
  FROM diff
 WHERE COALESCE(delta, 0) <> 0 OR appeared OR disappeared
 ORDER BY verdict DESC, metric;


-- ===========================================================================
-- STEP 3 -- independent structural checks (also after the deploy)
-- ===========================================================================

SELECT
    (SELECT COUNT(*) FROM public.order_cost_component_audit WHERE finding <> 'ok')
        AS problems_must_be_0,
    (SELECT COUNT(*) FROM public.orders
      WHERE COALESCE(is_deleted, false) = false
        AND COALESCE(cost, 0) <> lab_cost + designer_cost)
        AS invariant_breaks_must_be_0,
    (SELECT cost FROM public.orders WHERE case_id = '1041-260507-501')
        AS case_1041_must_be_160,
    (SELECT COUNT(*) FROM public.orders
      WHERE COALESCE(is_deleted, false) = false
        AND accounting_snapshot IS NOT NULL
        AND accounting_snapshot->>'status' NOT IN
            ('Cancelled', 'Lab Rejected', 'Doctor Rejected', 'Rejected')
        AND (accounting_snapshot->>'labCost')::numeric = lab_cost
        AND (accounting_snapshot->>'designCost')::numeric <> designer_cost)
        AS half_restated_snapshots_must_be_0;


-- ===========================================================================
-- STEP 4 -- once everything is verified, clean up
-- ===========================================================================
-- DROP TABLE public._cost_split_preflight;
-- DROP FUNCTION IF EXISTS public._cost_split_metrics();
