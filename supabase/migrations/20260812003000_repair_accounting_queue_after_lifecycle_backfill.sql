-- Repair accounting review rows opened by the 2026-08-11 lifecycle timestamp
-- backfill.  The repair is evidence based: a cycle is repaired only when every
-- row in it was created by the timestamp batch, it contains no business field,
-- and neither order_history nor the legacy accounting marker proves a later
-- business change.  Do not rebuild accounting snapshots in this repair: that
-- function is intentionally avoided because a production-wide invocation is
-- too expensive for the live database.

BEGIN;

-- Fail fast on a busy production database.  This repair must never wait long
-- enough to affect portal availability; every timeout rolls the transaction
-- back before any metadata restoration is committed.
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
    IF to_regprocedure('public.capture_accounting_review_change_v2()') IS NULL THEN
        RAISE EXCEPTION 'capture_accounting_review_change_v2() is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.orders'::regclass
          AND tgname = 'zzz_capture_accounting_review_change_v2'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'Accounting V2 capture trigger is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.orders'::regclass
          AND tgname = 'zz_reopen_registered_order_for_accounting'
          AND NOT tgisinternal
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.orders'::regclass
          AND tgname = 'zzy_guard_accounting_registration_v2'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'Expected accounting registration triggers are missing';
    END IF;
END;
$$;

-- Lifecycle metadata is operational evidence, not a commercial amendment.
-- Recreate the complete function instead of patching pg_get_functiondef text.
CREATE OR REPLACE FUNCTION public.capture_accounting_review_change_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
        'design_submitted_at', 'legacy_delivery_confirmed'
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
$$;

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

CREATE TEMP TABLE accounting_queue_possible_candidates
ON COMMIT DROP
AS
WITH batch_cycles AS (
    SELECT
        review_cycle_id,
        min(created_at) AS first_at,
        max(created_at) AS last_at,
        count(*) AS audit_row_count,
        bool_and(
            reviewed_at IS NULL
            AND NOT EXISTS (
                SELECT 1
                FROM jsonb_object_keys(changed_fields) AS changed_key(key)
                WHERE changed_key.key NOT IN (
                    'first_delivered_at',
                    'first_delivered_source',
                    'design_submitted_at',
                    'legacy_delivery_confirmed'
                )
            )
        ) AS contains_only_unreviewed_lifecycle_metadata
    FROM public.accounting_review_changes
    GROUP BY review_cycle_id
)
SELECT
    orders.id AS order_id,
    orders.case_id,
    orders.accounting_review_cycle_id AS review_cycle_id,
    cycles.audit_row_count,
    orders.status,
    orders.issue_state,
    orders.exclude_from_accounting_registration,
    orders.is_deleted,
    orders.accounting_registered_at,
    orders.comments
FROM public.orders orders
JOIN batch_cycles cycles
  ON cycles.review_cycle_id = orders.accounting_review_cycle_id
WHERE orders.needs_accounting_reregistration = TRUE
  AND orders.is_registered = FALSE
  AND cycles.contains_only_unreviewed_lifecycle_metadata
  AND cycles.first_at = '2026-08-11 21:11:49.361096+00'::timestamptz
  AND cycles.last_at = '2026-08-11 21:11:49.361096+00'::timestamptz;

CREATE INDEX accounting_queue_possible_candidates_order_idx
ON accounting_queue_possible_candidates(order_id);
ANALYZE accounting_queue_possible_candidates;

CREATE TEMP TABLE accounting_queue_false_positive_candidates
ON COMMIT DROP
AS
WITH history_evidence AS MATERIALIZED (
    SELECT DISTINCT possible.order_id
    FROM accounting_queue_possible_candidates possible
    JOIN public.order_history history
      ON history.order_id = possible.order_id
     AND history.created_at > COALESCE(
         possible.accounting_registered_at,
         'epoch'::timestamptz
     )
     AND history.created_at
         < '2026-08-11 21:11:49.361096+00'::timestamptz
    CROSS JOIN LATERAL jsonb_object_keys(
        COALESCE(history.changes, '{}'::jsonb)
    ) AS history_key(key)
    WHERE history_key.key NOT IN (
        'updated_at',
        'first_delivered_at',
        'first_delivered_source',
        'design_submitted_at',
        'legacy_delivery_confirmed',
        'accounting_review_cycle_id',
        'needs_accounting_reregistration',
        'is_registered'
    )
), comment_evidence AS MATERIALIZED (
    SELECT DISTINCT possible.order_id
    FROM accounting_queue_possible_candidates possible
    CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(possible.comments, '[]'::jsonb)
    ) AS comment
    WHERE comment ->> 'text' LIKE '%بعد التسجيل المحاسبي%'
      AND comment ->> 'createdAt'
          ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}'
      AND (comment ->> 'createdAt')::timestamptz
          > COALESCE(possible.accounting_registered_at, 'epoch'::timestamptz)
)
SELECT
    possible.order_id,
    possible.case_id,
    possible.review_cycle_id,
    possible.audit_row_count,
    possible.status,
    possible.issue_state,
    possible.exclude_from_accounting_registration,
    possible.is_deleted,
    possible.accounting_registered_at
FROM accounting_queue_possible_candidates possible
LEFT JOIN history_evidence history
  ON history.order_id = possible.order_id
LEFT JOIN comment_evidence comment
  ON comment.order_id = possible.order_id
WHERE history.order_id IS NULL
  AND comment.order_id IS NULL;

DO $$
DECLARE
    v_orders INTEGER;
    v_visible_changes INTEGER;
    v_cancellations INTEGER;
    v_not_visible INTEGER;
BEGIN
    SELECT
        count(*),
        count(*) FILTER (
            WHERE status <> 'Cancelled'
              AND NOT COALESCE(exclude_from_accounting_registration, FALSE)
              AND NOT COALESCE(is_deleted, FALSE)
        ),
        count(*) FILTER (WHERE status = 'Cancelled'),
        count(*) FILTER (
            WHERE COALESCE(exclude_from_accounting_registration, FALSE)
               OR COALESCE(is_deleted, FALSE)
        )
    INTO v_orders, v_visible_changes, v_cancellations, v_not_visible
    FROM accounting_queue_false_positive_candidates;

    -- Zero is expected on a fresh/local database and makes the migration
    -- idempotent.  Production must match the reviewed dry-run exactly.
    IF v_orders NOT IN (0, 1018) THEN
        RAISE EXCEPTION
            'Accounting queue repair scope changed: expected 0 or 1018 orders, found %',
            v_orders;
    END IF;

    -- One order from the original dry-run (3003-260729-524) received a real
    -- redo transition afterwards, so history evidence correctly retains it.
    IF v_orders = 1018 AND (
        v_visible_changes <> 985
        OR v_cancellations <> 9
        OR v_not_visible <> 24
    ) THEN
        RAISE EXCEPTION
            'Accounting queue repair breakdown changed: visible %, cancellations %, hidden %',
            v_visible_changes, v_cancellations, v_not_visible;
    END IF;
END;
$$;

CREATE TEMP TABLE accounting_queue_financial_baseline
ON COMMIT DROP
AS
SELECT
    entity_type,
    count(*) AS active_count,
    COALESCE(sum(net_amount), 0) AS active_net
FROM public.financial_obligations
WHERE status NOT IN ('void', 'written_off')
GROUP BY entity_type;

INSERT INTO public.accounting_review_change_repair_archive (
    migration_id, original_id, order_id, review_cycle_id, row_data
)
SELECT
    '20260812003000',
    change.id,
    change.order_id,
    change.review_cycle_id,
    to_jsonb(change)
FROM public.accounting_review_changes change
JOIN accounting_queue_false_positive_candidates candidate
  ON candidate.review_cycle_id = change.review_cycle_id
ON CONFLICT (migration_id, original_id) DO NOTHING;

DELETE FROM public.accounting_review_changes change
USING accounting_queue_false_positive_candidates candidate
WHERE change.review_cycle_id = candidate.review_cycle_id;

-- This is a metadata-only restoration.  Suppress all row triggers for this one
-- statement at session scope instead of ALTER TABLE ... DISABLE TRIGGER, which
-- takes an ACCESS EXCLUSIVE lock and can stall the live portal.  SET LOCAL is
-- transaction-scoped and is restored automatically on every error/rollback.
SET LOCAL session_replication_role = replica;

UPDATE public.orders orders
SET is_registered = TRUE,
    needs_accounting_reregistration = FALSE,
    accounting_review_cycle_id = NULL
FROM accounting_queue_false_positive_candidates candidate
WHERE orders.id = candidate.order_id
  AND orders.accounting_review_cycle_id = candidate.review_cycle_id
  AND orders.needs_accounting_reregistration = TRUE
  AND orders.is_registered = FALSE;

SET LOCAL session_replication_role = origin;

DO $$
DECLARE
    v_expected INTEGER;
    v_updated INTEGER;
BEGIN
    SELECT count(*) INTO v_expected
    FROM accounting_queue_false_positive_candidates;

    SELECT count(*) INTO v_updated
    FROM public.orders orders
    JOIN accounting_queue_false_positive_candidates candidate
      ON candidate.order_id = orders.id
    WHERE orders.is_registered = TRUE
      AND orders.needs_accounting_reregistration = FALSE
      AND orders.accounting_review_cycle_id IS NULL;

    IF v_updated <> v_expected THEN
        RAISE EXCEPTION
            'Accounting queue repair updated % of % expected orders',
            v_updated, v_expected;
    END IF;

    IF EXISTS (
        SELECT entity_type, active_count, active_net
        FROM accounting_queue_financial_baseline
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
        FROM accounting_queue_financial_baseline
    ) THEN
        RAISE EXCEPTION 'Accounting queue repair changed active financial obligations';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = 'public.orders'::regclass
          AND tgname IN (
              'zz_reopen_registered_order_for_accounting',
              'zzy_guard_accounting_registration_v2',
              'zzz_capture_accounting_review_change_v2'
          )
          AND NOT tgenabled = 'O'
    ) THEN
        RAISE EXCEPTION 'An accounting trigger was not re-enabled';
    END IF;
END;
$$;

COMMIT;
