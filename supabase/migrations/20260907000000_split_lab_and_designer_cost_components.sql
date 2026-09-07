-- Phase 1 of separating the two cost components that orders.cost currently
-- bundles together.
--
-- WHY
-- ---
-- orders.cost is a derived, overloaded number.  For a split case with a
-- per-piece designer the client writes  cost = milling + design_price;  for a
-- salaried designer it writes  cost = milling  only.  Nothing in the orders row
-- says which of those two shapes a given row is in -- the answer lives in
-- users.custom_permissions->>'designer_fixed_salary'.  So every reader that
-- wants the milling figure has to re-derive it, and that derivation is
-- currently duplicated in six places and got it wrong in four others:
--
--   correct   sync_order_financial_obligations
--             sync_preserved_external_lab_price_change
--             get_doctor_service_profitability
--             get_analytics_summary_privileged_20260801   (twice)
--             getLabCostMetadata()      (src/constants/financialObligations.ts)
--
--   wrong     build_order_accounting_snapshot      COALESCE(manual_cost, cost)
--             capture_cutover_baseline             COALESCE(manual_cost, cost)
--             get_internal_vs_external_benchmark   COALESCE(manual_cost, cost)
--             get_order_cost_breakdown             COALESCE(manual_cost, cost)
--
-- COALESCE(manual_cost, cost) flips meaning depending on whether an admin ever
-- overrode the milling price: it returns the milling cost when manual_cost is
-- set, and the whole case cost when it is not.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Adds the two components as first-class stored columns:
--
--   lab_cost       effective milling / external-lab cost (manual or automatic)
--   designer_cost  what is actually owed to the designer -- 0 for a salaried
--                  designer, otherwise the effective design price
--
-- with the invariant  cost = lab_cost + designer_cost  on every row.
--
-- WHAT IT DELIBERATELY DOES NOT DO
-- --------------------------------
-- It does not move a single existing number.  lab_cost is derived FROM cost
-- (cost - designer_cost), not from manual_cost, so the sum reproduces the
-- stored cost exactly, by construction.  No reader is repointed here -- that is
-- phase 2.  Writers keep writing cost -- that is phase 3.
--
-- TWO TRAPS THIS MIGRATION HAS TO STEP AROUND
-- -------------------------------------------
-- 1. capture_accounting_review_change_v2 (flag workflow_accounting_audit_v2 is
--    ON) detects business changes with a BLACKLIST diff:
--        to_jsonb(OLD) - v_ignored   vs   to_jsonb(NEW) - v_ignored
--    Any column it does not know about counts as a business change and kicks
--    the order back out of the accounting queue (is_registered := FALSE).  Two
--    new columns would therefore have re-opened every registered order.  The
--    function is patched below -- before any row is written -- to ignore them.
--    They carry no information of their own in this phase: they are pure
--    derivations of cost / design_price / manual_design_price, all three of
--    which that diff already watches.
--
--    reopen_registered_order_for_accounting needs no change: it uses an
--    explicit whitelist of business fields, so unknown columns are ignored.
--
-- 2. The backfill runs with session_replication_role = replica so that none of
--    the 25 triggers on public.orders fire for it -- the same pattern as
--    20260812003000 and 20260826001000.  updated_at is left alone, no
--    obligations are resynced, no accounting review rows are written.  For the
--    same reason the invariant is enforced by the trigger below and NOT by a
--    table CHECK constraint: replica mode skips triggers but still evaluates
--    CHECK constraints, and four pgTAP suites insert orders in replica mode
--    without supplying cost components.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS lab_cost      NUMERIC(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS designer_cost NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.orders.lab_cost IS
    'Effective external-lab / milling cost for the case: the manual override when one was entered, otherwise the automatic figure. Excludes the designer. Invariant: cost = lab_cost + designer_cost.';

COMMENT ON COLUMN public.orders.designer_cost IS
    'Effective amount owed to the designer for this case: 0 for a fixed-salary designer or a non-split workflow, otherwise the effective design price. design_price stays as the reference figure even for salaried designers.';

-- ---------------------------------------------------------------------------
-- 2. Salaried-designer lookup, in one place
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.order_designer_is_salaried(p_designer_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
    SELECT COALESCE((u.custom_permissions->>'designer_fixed_salary')::BOOLEAN, FALSE)
      FROM public.users u
     WHERE u.id = p_designer_id;
$fn$;

COMMENT ON FUNCTION public.order_designer_is_salaried(UUID) IS
    'TRUE when the designer is paid a fixed salary and therefore earns nothing per case. Returns NULL for a missing or unknown designer; callers COALESCE to FALSE.';

-- ---------------------------------------------------------------------------
-- 3. Trap 1: teach the accounting audit diff to ignore the derived columns.
--    This has to happen BEFORE the backfill.  The body is unchanged apart from
--    the two new entries in v_ignored.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.capture_accounting_review_change_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_cycle UUID;
    v_sequence INTEGER;
    v_changed_by UUID;
    v_before JSONB;
    v_after JSONB;
    v_changed_fields JSONB;
    v_ignored TEXT[] := ARRAY[
        'updated_at', 'comments', 'accounting_review_cycle_id',
        'needs_accounting_reregistration', 'is_registered',
        'accounting_snapshot', 'accounting_previous_snapshot',
        'accounting_registered_at', 'accounting_reviewed_by',
        'accounting_last_review_type',
        'first_delivered_at', 'first_delivered_source',
        'design_submitted_at', 'legacy_delivery_confirmed',
        -- Derived from cost / design_price / manual_design_price, which this
        -- same diff already watches.  Listing them here keeps one business
        -- change from being reported twice, and stops the mere addition of the
        -- columns from re-opening every registered order.
        'lab_cost', 'designer_cost'
    ];
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_accounting_audit_v2') THEN
        RETURN NEW;
    END IF;

    IF NEW.is_registered = TRUE AND OLD.is_registered = FALSE THEN
        UPDATE public.accounting_review_changes
        SET reviewed_at = timezone('utc', now()),
            reviewed_by = public.get_my_user_id()
        WHERE review_cycle_id = OLD.accounting_review_cycle_id
          AND reviewed_at IS NULL;
        NEW.accounting_review_cycle_id := NULL;
        RETURN NEW;
    END IF;

    IF OLD.accounting_snapshot IS NULL THEN
        RETURN NEW;
    END IF;

    v_before := to_jsonb(OLD) - v_ignored;
    v_after := to_jsonb(NEW) - v_ignored;

    SELECT COALESCE(
        jsonb_object_agg(
            key,
            jsonb_build_object('old', v_before -> key, 'new', v_after -> key)
        ),
        '{}'::jsonb
    )
    INTO v_changed_fields
    FROM jsonb_object_keys(v_before || v_after) AS key
    WHERE v_before -> key IS DISTINCT FROM v_after -> key;

    IF v_changed_fields = '{}'::jsonb THEN
        RETURN NEW;
    END IF;

    v_cycle := COALESCE(OLD.accounting_review_cycle_id, gen_random_uuid());
    NEW.accounting_review_cycle_id := v_cycle;
    NEW.needs_accounting_reregistration := TRUE;
    NEW.is_registered := FALSE;
    NEW.exclude_from_accounting_registration := FALSE;

    SELECT id INTO v_changed_by
    FROM public.users
    WHERE auth_id = auth.uid()
    LIMIT 1;

    SELECT COALESCE(MAX(sequence_no), 0) + 1
    INTO v_sequence
    FROM public.accounting_review_changes
    WHERE review_cycle_id = v_cycle;

    INSERT INTO public.accounting_review_changes (
        order_id, review_cycle_id, sequence_no, changed_by, event_type,
        before_snapshot, after_snapshot, changed_fields
    ) VALUES (
        NEW.id, v_cycle, v_sequence, v_changed_by, 'order_business_change',
        v_before, v_after, v_changed_fields
    );

    RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Backfill, every trigger on public.orders suppressed.
--    designer_cost is computed from the same inputs the correct readers use;
--    lab_cost is then whatever is left of cost, so the sum cannot drift.
-- ---------------------------------------------------------------------------

SET LOCAL session_replication_role = replica;

UPDATE public.orders o
SET designer_cost = c.designer_cost,
    lab_cost      = COALESCE(o.cost, 0) - c.designer_cost
FROM (
    SELECT id,
           CASE
               WHEN workflow_type = 'split'
                AND NOT COALESCE(public.order_designer_is_salaried(designer_id), FALSE)
               THEN COALESCE(manual_design_price, design_price, 0)
               ELSE 0
           END AS designer_cost
      FROM public.orders
) c
WHERE c.id = o.id
  AND (o.designer_cost IS DISTINCT FROM c.designer_cost
       OR o.lab_cost   IS DISTINCT FROM COALESCE(o.cost, 0) - c.designer_cost);

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- 5. Prove the backfill moved nothing.  Any violation aborts the migration.
-- ---------------------------------------------------------------------------

DO $do$
DECLARE
    v_broken   INTEGER;
    v_negative INTEGER;
    v_manual   INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_broken
      FROM public.orders
     WHERE COALESCE(cost, 0) <> lab_cost + designer_cost;

    IF v_broken > 0 THEN
        RAISE EXCEPTION
            'cost = lab_cost + designer_cost is violated on % row(s); refusing to continue',
            v_broken;
    END IF;

    -- Not fatal, but the operator must know.  A negative lab_cost would mean
    -- cost was written without the design price that design_price claims.
    SELECT COUNT(*) INTO v_negative
      FROM public.orders
     WHERE lab_cost < 0 AND COALESCE(is_deleted, false) = false;

    -- Rows where the recorded manual milling price disagrees with the milling
    -- cost implied by cost - designer_cost.  These are PRE-EXISTING data
    -- errors, not something this migration introduces; cost is left alone.
    SELECT COUNT(*) INTO v_manual
      FROM public.orders
     WHERE manual_cost IS NOT NULL
       AND lab_cost <> manual_cost
       AND COALESCE(is_deleted, false) = false;

    RAISE NOTICE 'cost components backfilled; invariant holds on every row';
    RAISE NOTICE 'rows with negative lab_cost: %', v_negative;
    RAISE NOTICE 'rows where lab_cost <> manual_cost (pre-existing data errors): %', v_manual;
END;
$do$;

-- ---------------------------------------------------------------------------
-- 6. Keep the components in step on every future write.
--
--    Named zy_* on purpose.  BEFORE triggers fire in alphabetical order, so
--    this must sort AFTER trigger_orders_role_field_guard (so the role guard
--    still judges the caller's own change set) and BEFORE the zz_/zzz_
--    accounting triggers (so they see populated components).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_order_cost_components()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
    v_designer_cost NUMERIC(10,2);
    v_recompute     BOOLEAN;
BEGIN
    v_recompute := TG_OP = 'INSERT'
        OR NEW.cost                IS DISTINCT FROM OLD.cost
        OR NEW.design_price        IS DISTINCT FROM OLD.design_price
        OR NEW.manual_design_price IS DISTINCT FROM OLD.manual_design_price
        OR NEW.designer_id         IS DISTINCT FROM OLD.designer_id
        OR NEW.workflow_type       IS DISTINCT FROM OLD.workflow_type;

    IF NOT v_recompute THEN
        -- Phase 1: the components are derived, never independently writable.
        -- Fail loudly rather than silently discarding someone's write.
        IF NEW.lab_cost      IS DISTINCT FROM OLD.lab_cost
        OR NEW.designer_cost IS DISTINCT FROM OLD.designer_cost THEN
            RAISE EXCEPTION
                'lab_cost/designer_cost are derived from cost and design_price; set those instead';
        END IF;
        RETURN NEW;
    END IF;

    v_designer_cost := CASE
        WHEN NEW.workflow_type = 'split'
         AND NOT COALESCE(public.order_designer_is_salaried(NEW.designer_id), FALSE)
        THEN COALESCE(NEW.manual_design_price, NEW.design_price, 0)
        ELSE 0
    END;

    NEW.designer_cost := v_designer_cost;
    NEW.lab_cost      := COALESCE(NEW.cost, 0) - v_designer_cost;

    RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.sync_order_cost_components() IS
    'Phase 1: keeps orders.lab_cost + orders.designer_cost equal to orders.cost. cost stays the written value and the components are derived from it, so no existing number moves.';

DROP TRIGGER IF EXISTS zy_sync_order_cost_components ON public.orders;
CREATE TRIGGER zy_sync_order_cost_components
    BEFORE INSERT OR UPDATE ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_order_cost_components();

-- ---------------------------------------------------------------------------
-- 7. A reusable health check for the operator.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.order_cost_component_audit AS
SELECT o.id,
       o.case_id,
       o.workflow_type,
       o.cost,
       o.lab_cost,
       o.designer_cost,
       o.manual_cost,
       o.design_price,
       o.manual_design_price,
       COALESCE(public.order_designer_is_salaried(o.designer_id), FALSE) AS designer_is_salaried,
       CASE
           WHEN COALESCE(o.cost, 0) <> o.lab_cost + o.designer_cost THEN 'invariant_broken'
           WHEN o.lab_cost < 0                                      THEN 'negative_lab_cost'
           WHEN o.manual_cost IS NOT NULL AND o.lab_cost <> o.manual_cost
                                                                    THEN 'manual_cost_disagrees'
           ELSE 'ok'
       END AS finding
  FROM public.orders o
 WHERE COALESCE(o.is_deleted, false) = false;

COMMENT ON VIEW public.order_cost_component_audit IS
    'Health check for the lab_cost/designer_cost split. Anything with finding <> ok needs a human decision.';

REVOKE ALL ON public.order_cost_component_audit FROM PUBLIC;
GRANT SELECT ON public.order_cost_component_audit TO authenticated;
