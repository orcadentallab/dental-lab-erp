-- =====================================================================
-- Batch A: close the exposed family RPC, and restore the accounting
--          review-cycle pointers that 20260826001000 severed.
-- =====================================================================

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

-- ---------------------------------------------------------------------
-- A1. get_top_families_privileged_20260826 was left executable by
-- PUBLIC/anon/authenticated.
--
-- Every other reporting RPC in this schema is split the same way: a
-- SECURITY DEFINER `*_privileged_*` body that trusts its caller, plus a
-- thin public wrapper that enforces the role check first. That split only
-- holds if the privileged half is unreachable -- 20260801080000 revokes
-- all six of its own privileged functions for exactly this reason.
--
-- 20260826000000 revoked the wrapper and not the body, so the admin gate
-- in get_top_families() could be bypassed by calling the inner function
-- directly. Being SECURITY DEFINER, it also bypasses RLS: any signed-in
-- user (and anon, holding only the publishable key) could read lab-wide
-- revenue by service family.
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_top_families_privileged_20260826(DATE, DATE, INT)
    FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- A2. Restore orders.accounting_review_cycle_id.
--
-- 20260826001000 repaired the registration flags after the legacy
-- order_items.price backfill, and additionally set
-- accounting_review_cycle_id = NULL on every order it touched. That column
-- was never part of the damage: reopen_order_after_direct_item_change only
-- writes is_registered and needs_accounting_reregistration, so the cycle
-- pointer each order carried was its own, pre-existing, already-reviewed
-- cycle -- not something the backfill created.
--
-- Nulling it detached 192 reviewed accounting_review_changes rows from the
-- 162 orders they document. Nothing deleted them; they are simply
-- unreachable, because CaseRegistration.tsx gates the accounting-history
-- button on order.accountingReviewCycleId being set.
--
-- Restoring the pointer cannot reopen the accountant's queue: that queue
-- is driven by is_registered / needs_accounting_reregistration, which this
-- statement does not touch.
-- ---------------------------------------------------------------------

-- Only orders whose change rows agree on a single cycle are restorable.
-- More than one distinct cycle means we would be guessing which one was
-- current, so those are left alone rather than repaired wrongly.
CREATE TEMP TABLE review_cycle_restore_candidates
ON COMMIT DROP
AS
SELECT
    o.id AS order_id,
    o.case_id,
    -- HAVING below guarantees a single distinct value; picking element 1 of
    -- the aggregate is how you read it back, because there is no min(uuid).
    (array_agg(DISTINCT change.review_cycle_id))[1] AS review_cycle_id,
    count(*) AS change_rows
FROM public.orders o
JOIN public.accounting_review_changes change ON change.order_id = o.id
JOIN (SELECT DISTINCT order_id FROM public.order_item_price_backfill_audit) backfilled
     ON backfilled.order_id = o.id
WHERE o.accounting_review_cycle_id IS NULL
  AND COALESCE(o.is_deleted, FALSE) = FALSE
GROUP BY o.id, o.case_id
HAVING count(DISTINCT change.review_cycle_id) = 1;

-- Same obligations baseline the repair migration used: this is a metadata
-- restore, and must be provably one.
CREATE TEMP TABLE review_cycle_restore_baseline
ON COMMIT DROP
AS
SELECT
    entity_type,
    count(*) AS active_count,
    COALESCE(sum(net_amount), 0) AS active_net
FROM public.financial_obligations
WHERE status NOT IN ('void', 'written_off')
GROUP BY entity_type;

-- How many of the candidates sit in the accountant's queue right now. The
-- assertion below compares against this rather than against zero: an order
-- legitimately re-opened for review between writing and deploying this
-- migration must not make it abort, since the UPDATE never touches those
-- two columns. What matters is that the number does not grow.
CREATE TEMP TABLE review_cycle_restore_queue_baseline
ON COMMIT DROP
AS
SELECT count(*) AS flagged_before
FROM public.orders o
JOIN review_cycle_restore_candidates candidate ON candidate.order_id = o.id
WHERE o.needs_accounting_reregistration = TRUE
   OR o.is_registered = FALSE;

-- Triggers stay suppressed for the same reason as in 20260826001000: this
-- writes one metadata column, and no accounting side effect should follow
-- from it.
SET LOCAL session_replication_role = replica;

UPDATE public.orders o
SET accounting_review_cycle_id = candidate.review_cycle_id
FROM review_cycle_restore_candidates candidate
WHERE o.id = candidate.order_id
  AND o.accounting_review_cycle_id IS NULL;

SET LOCAL session_replication_role = origin;

DO $$
DECLARE
    v_restored INTEGER;
    v_still_orphaned INTEGER;
    v_flagged_before INTEGER;
    v_flagged_after INTEGER;
BEGIN
    SELECT count(*) INTO v_restored FROM review_cycle_restore_candidates;

    IF EXISTS (
        SELECT entity_type, active_count, active_net
        FROM review_cycle_restore_baseline
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
        FROM review_cycle_restore_baseline
    ) THEN
        RAISE EXCEPTION 'Review-cycle restore unexpectedly modified financial obligations!';
    END IF;

    -- No order may be pushed back into the accountant's queue by this.
    SELECT count(*) INTO v_flagged_after
    FROM public.orders o
    JOIN review_cycle_restore_candidates candidate ON candidate.order_id = o.id
    WHERE o.needs_accounting_reregistration = TRUE
       OR o.is_registered = FALSE;

    SELECT flagged_before INTO v_flagged_before FROM review_cycle_restore_queue_baseline;

    IF v_flagged_after > v_flagged_before THEN
        RAISE EXCEPTION 'Review-cycle restore pushed % order(s) into the re-registration queue!',
            v_flagged_after - v_flagged_before;
    END IF;

    SELECT count(DISTINCT change.order_id) INTO v_still_orphaned
    FROM public.accounting_review_changes change
    WHERE NOT EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.accounting_review_cycle_id = change.review_cycle_id
    );

    RAISE NOTICE 'Restored review cycle on % order(s); % order(s) still have unreachable change rows (ambiguous or deleted).',
        v_restored, v_still_orphaned;
END $$;

COMMIT;
