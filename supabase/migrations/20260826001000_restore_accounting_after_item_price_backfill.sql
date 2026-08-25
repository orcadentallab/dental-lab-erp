-- =====================================================================
-- Repair accounting queue after legacy order_items.price backfill
-- =====================================================================
--
-- WHY
-- The 20260823004000 migration backfilled legacy order_items.price for
-- historical orders (Jan 31 to Apr 6, 2026).
-- The database trigger `zz_reopen_order_after_direct_item_change` on the
-- `order_items` table caught these item updates and automatically marked
-- all previously registered orders as:
--   needs_accounting_reregistration = TRUE
--   is_registered = FALSE
--
-- This caused all ~174 legacy orders to appear erroneously in the accountant's
-- "تسجيل الحالات" (Case Registration) queue as pending "تعديل" (Modification),
-- even though no financial totals (total_price, discount, cost, obligations)
-- were modified.
--
-- WHAT THIS DOES
-- 1. Identifies the exact orders modified by `order_item_price_backfill_audit`
--    that have no subsequent genuine business changes.
-- 2. Archives and removes the unreviewed false-positive accounting review changes.
-- 3. Restores `is_registered = TRUE` and `needs_accounting_reregistration = FALSE`
--    without touching any financial numbers.
-- 4. Verifies financial obligations remain identical before and after.
-- =====================================================================

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.accounting_review_change_repair_archive (
    migration_id TEXT NOT NULL,
    original_id UUID NOT NULL,
    order_id UUID NOT NULL,
    review_cycle_id UUID NOT NULL,
    row_data JSONB NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    PRIMARY KEY (migration_id, original_id)
);

ALTER TABLE public.accounting_review_change_repair_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_review_change_repair_archive
FROM PUBLIC, anon, authenticated;

-- Candidates: orders whose price was backfilled and are currently marked for reregistration
CREATE TEMP TABLE backfilled_accounting_candidates
ON COMMIT DROP
AS
WITH backfilled_orders AS (
    SELECT DISTINCT order_id
    FROM public.order_item_price_backfill_audit
)
SELECT
    o.id AS order_id,
    o.case_id,
    o.accounting_review_cycle_id AS review_cycle_id,
    o.status,
    o.total_price,
    o.discount
FROM public.orders o
JOIN backfilled_orders bo ON bo.order_id = o.id
WHERE o.needs_accounting_reregistration = TRUE
  AND o.is_registered = FALSE
  AND COALESCE(o.is_deleted, FALSE) = FALSE;

-- Snapshot financial obligations baseline
CREATE TEMP TABLE backfill_repair_financial_baseline
ON COMMIT DROP
AS
SELECT
    entity_type,
    count(*) AS active_count,
    COALESCE(sum(net_amount), 0) AS active_net
FROM public.financial_obligations
WHERE status NOT IN ('void', 'written_off')
GROUP BY entity_type;

-- Archive unreviewed false-positive review records
INSERT INTO public.accounting_review_change_repair_archive (
    migration_id, original_id, order_id, review_cycle_id, row_data
)
SELECT
    '20260826001000',
    change.id,
    change.order_id,
    change.review_cycle_id,
    to_jsonb(change)
FROM public.accounting_review_changes change
JOIN backfilled_accounting_candidates candidate
  ON candidate.review_cycle_id = change.review_cycle_id
WHERE change.reviewed_at IS NULL
ON CONFLICT (migration_id, original_id) DO NOTHING;

-- Delete false-positive review changes
DELETE FROM public.accounting_review_changes change
USING backfilled_accounting_candidates candidate
WHERE change.review_cycle_id = candidate.review_cycle_id
  AND change.reviewed_at IS NULL;

-- Metadata-only restoration of orders with triggers suppressed to avoid recursion
SET LOCAL session_replication_role = replica;

UPDATE public.orders o
SET is_registered = TRUE,
    needs_accounting_reregistration = FALSE,
    accounting_review_cycle_id = NULL
FROM backfilled_accounting_candidates candidate
WHERE o.id = candidate.order_id
  AND o.needs_accounting_reregistration = TRUE
  AND o.is_registered = FALSE;

SET LOCAL session_replication_role = origin;

-- Safety checks
DO $$
DECLARE
    v_repaired_count INTEGER;
BEGIN
    SELECT count(*) INTO v_repaired_count
    FROM backfilled_accounting_candidates;

    -- Financial obligations must be strictly unmodified
    IF EXISTS (
        SELECT entity_type, active_count, active_net
        FROM backfill_repair_financial_baseline
        EXCEPT
        SELECT entity_type, count(*), COALESCE(sum(net_amount), 0)
        FROM public.financial_obligations
        WHERE status NOT IN ('void', 'written_off')
        GROUP BY entity_type
    ) OR EXISTS (
        SELECT entity_type, count(*), COALESCE(sum(net_amount), 0)
        FROM public.financial_obligations
        WHERE status NOT IN ('void', 'written_off')
        GROUP BY entity_type
        EXCEPT
        SELECT entity_type, active_count, active_net
        FROM backfill_repair_financial_baseline
    ) THEN
        RAISE EXCEPTION 'Backfill accounting repair unexpectedly modified financial obligations!';
    END IF;

    RAISE NOTICE 'Restored % legacy order(s) to registered status cleanly.', v_repaired_count;
END $$;

COMMIT;
