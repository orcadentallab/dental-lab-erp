-- Allocate doctor collections and credits FIFO across a doctor/center account.
--
-- Approved production preview (2026-08-01):
--   87 untracked collections             524,730.00
--    5 existing active credits             4,200.00
--   92 source records                    528,930.00
--  340 proposed allocation rows          518,560.00
--  324 affected receivable obligations
--    7 resulting account credits          10,370.00
--
-- The official statements continue to be calculated only from orders,
-- transactions, and adjustments. Allocations and account credits classify
-- already-recorded collections and must never be counted as extra payments.

BEGIN;
LOCK TABLE public.orders,
                  public.transactions,
                  public.adjustments,
                  public.financial_obligations,
                  public.payment_allocations,
                  public.account_credits
IN SHARE ROW EXCLUSIVE MODE;
CREATE OR REPLACE FUNCTION public.canonical_doctor_account_id(p_doctor_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (
            SELECT COALESCE(doctor.parent_id, doctor.id)
            FROM public.doctors doctor
            WHERE doctor.id = p_doctor_id
        ),
        p_doctor_id
    );
$$;
CREATE OR REPLACE FUNCTION public.reconcile_doctor_account_fifo(
    p_doctor_id UUID,
    p_changed_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_account_id UUID := public.canonical_doctor_account_id(p_doctor_id);
    v_source RECORD;
    v_obligation public.financial_obligations%ROWTYPE;
    v_transaction public.transactions%ROWTYPE;
    v_credit public.account_credits%ROWTYPE;
    v_allocation_id UUID;
    v_credit_id UUID;
    v_remaining NUMERIC(12, 2);
    v_allocated_amount NUMERIC(12, 2);
    v_existing_allocated NUMERIC(12, 2);
    v_existing_credit NUMERIC(12, 2);
    v_newly_allocated NUMERIC(12, 2) := 0;
    v_new_credit_amount NUMERIC(12, 2) := 0;
    v_allocation_count INTEGER := 0;
BEGIN
    IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'Doctor account is required for FIFO reconciliation';
    END IF;

    IF current_setting('orca.doctor_fifo_reconciling', TRUE) = '1' THEN
        RETURN jsonb_build_object(
            'accountId', v_account_id,
            'status', 'already_reconciling'
        );
    END IF;

    PERFORM set_config('orca.doctor_fifo_reconciling', '1', TRUE);

    FOR v_source IN
        WITH active_alloc AS (
            SELECT allocation.payment_transaction_id,
                   SUM(allocation.allocated_amount) AS allocated_amount
            FROM public.payment_allocations allocation
            WHERE allocation.status = 'active'
            GROUP BY allocation.payment_transaction_id
        ),
        credit_by_transaction AS (
            SELECT credit.source_transaction_id,
                   SUM(credit.remaining_amount) AS remaining_credit
            FROM public.account_credits credit
            WHERE credit.entity_type = 'doctor'
              AND credit.status IN ('active', 'review')
              AND credit.remaining_amount > 0
              AND credit.source_transaction_id IS NOT NULL
            GROUP BY credit.source_transaction_id
        ),
        sources AS (
            SELECT 'existing_credit'::TEXT AS source_kind,
                   credit.id AS source_id,
                   credit.source_transaction_id,
                   credit.id AS source_credit_id,
                   COALESCE(payment.date, credit.created_at::DATE) AS source_date,
                   credit.created_at AS source_created_at
            FROM public.account_credits credit
            LEFT JOIN public.transactions payment
              ON payment.id = credit.source_transaction_id
            WHERE credit.entity_type = 'doctor'
              AND credit.status IN ('active', 'review')
              AND credit.remaining_amount > 0
              AND credit.source_transaction_id IS NOT NULL
              AND public.canonical_doctor_account_id(credit.entity_id) = v_account_id

            UNION ALL

            SELECT 'untracked_payment'::TEXT,
                   payment.id,
                   payment.id,
                   NULL::UUID,
                   payment.date,
                   payment.created_at
            FROM public.transactions payment
            LEFT JOIN active_alloc allocation
              ON allocation.payment_transaction_id = payment.id
            LEFT JOIN credit_by_transaction credit
              ON credit.source_transaction_id = payment.id
            WHERE payment.type = 'income'
              AND payment.entity_type = 'doctor'
              AND payment.entity_id IS NOT NULL
              AND (
                    COALESCE(payment.status, '') = 'approved'
                    OR COALESCE(payment.is_approved, FALSE)
                  )
              AND public.canonical_doctor_account_id(payment.entity_id) = v_account_id
              AND payment.amount
                    - COALESCE(allocation.allocated_amount, 0)
                    - COALESCE(credit.remaining_credit, 0) > 0.005
        )
        SELECT *
        FROM sources
        ORDER BY source_date, source_created_at, source_kind, source_id
    LOOP
        IF v_source.source_kind = 'existing_credit' THEN
            SELECT *
            INTO v_credit
            FROM public.account_credits
            WHERE id = v_source.source_credit_id
            FOR UPDATE;

            IF NOT FOUND
               OR v_credit.status NOT IN ('active', 'review')
               OR v_credit.remaining_amount <= 0 THEN
                CONTINUE;
            END IF;

            v_remaining := v_credit.remaining_amount;
        ELSE
            SELECT *
            INTO v_transaction
            FROM public.transactions
            WHERE id = v_source.source_transaction_id
            FOR UPDATE;

            IF NOT FOUND
               OR v_transaction.type <> 'income'
               OR v_transaction.entity_type <> 'doctor'
               OR NOT (
                    COALESCE(v_transaction.status, '') = 'approved'
                    OR COALESCE(v_transaction.is_approved, FALSE)
               ) THEN
                CONTINUE;
            END IF;

            SELECT COALESCE(SUM(allocation.allocated_amount), 0)
            INTO v_existing_allocated
            FROM public.payment_allocations allocation
            WHERE allocation.payment_transaction_id = v_transaction.id
              AND allocation.status = 'active';

            SELECT COALESCE(SUM(credit.remaining_amount), 0)
            INTO v_existing_credit
            FROM public.account_credits credit
            WHERE credit.source_transaction_id = v_transaction.id
              AND credit.status IN ('active', 'review')
              AND credit.remaining_amount > 0;

            IF v_existing_allocated + v_existing_credit > v_transaction.amount + 0.005 THEN
                RAISE EXCEPTION
                    'Doctor payment % is over-classified: amount %, allocations %, credits %',
                    v_transaction.id,
                    v_transaction.amount,
                    v_existing_allocated,
                    v_existing_credit;
            END IF;

            v_remaining := GREATEST(
                0,
                v_transaction.amount - v_existing_allocated - v_existing_credit
            );
        END IF;

        FOR v_obligation IN
            SELECT obligation.*
            FROM public.financial_obligations obligation
            WHERE obligation.entity_type = 'doctor'
              AND obligation.direction = 'receivable'
              AND obligation.status IN ('unpaid', 'partially_paid')
              AND obligation.remaining_amount > 0
              AND public.canonical_doctor_account_id(obligation.entity_id) = v_account_id
            ORDER BY obligation.due_date,
                     obligation.trigger_date,
                     obligation.created_at,
                     obligation.id
            FOR UPDATE
        LOOP
            EXIT WHEN v_remaining <= 0.005;

            v_allocated_amount := LEAST(v_remaining, v_obligation.remaining_amount);
            IF v_allocated_amount <= 0.005 THEN
                CONTINUE;
            END IF;

            INSERT INTO public.payment_allocations (
                payment_transaction_id,
                obligation_id,
                entity_type,
                entity_id,
                direction,
                allocated_amount,
                allocation_method,
                status,
                allocated_by,
                metadata
            )
            VALUES (
                v_source.source_transaction_id,
                v_obligation.id,
                'doctor',
                v_account_id,
                'receivable',
                v_allocated_amount,
                CASE
                    WHEN v_source.source_kind = 'existing_credit'
                        THEN 'credit_auto_apply'
                    ELSE 'fifo'
                END,
                'active',
                p_changed_by,
                jsonb_build_object(
                    'automaticFifo', TRUE,
                    'canonicalDoctorAccountId', v_account_id,
                    'recordedObligationDoctorId', v_obligation.entity_id,
                    'source', 'doctor_collection_fifo',
                    'historicalBackfill20260801',
                        COALESCE(current_setting('orca.doctor_fifo_backfill', TRUE), '0') = '1',
                    'creditId', v_source.source_credit_id
                )
            )
            RETURNING id INTO v_allocation_id;

            UPDATE public.financial_obligations
            SET allocated_amount = allocated_amount + v_allocated_amount,
                status = CASE
                    WHEN allocated_amount + v_allocated_amount >= net_amount
                        THEN 'paid'
                    ELSE 'partially_paid'
                END
            WHERE id = v_obligation.id;

            IF v_source.source_kind = 'existing_credit' THEN
                UPDATE public.account_credits
                SET remaining_amount = remaining_amount - v_allocated_amount,
                    status = CASE
                        WHEN remaining_amount - v_allocated_amount <= 0.005
                            THEN 'used'
                        ELSE 'active'
                    END
                WHERE id = v_source.source_credit_id
                RETURNING * INTO v_credit;

                INSERT INTO public.allocation_events (
                    event_type,
                    allocation_id,
                    transaction_id,
                    obligation_id,
                    credit_id,
                    entity_type,
                    entity_id,
                    amount,
                    reason,
                    changed_by,
                    metadata
                )
                VALUES (
                    'credit_applied',
                    v_allocation_id,
                    v_source.source_transaction_id,
                    v_obligation.id,
                    v_source.source_credit_id,
                    'doctor',
                    v_account_id,
                    v_allocated_amount,
                    'automatic FIFO doctor credit application',
                    p_changed_by,
                    jsonb_build_object('automaticFifo', TRUE)
                );
            ELSE
                INSERT INTO public.allocation_events (
                    event_type,
                    allocation_id,
                    transaction_id,
                    obligation_id,
                    entity_type,
                    entity_id,
                    amount,
                    reason,
                    changed_by,
                    metadata
                )
                VALUES (
                    'allocation_created',
                    v_allocation_id,
                    v_source.source_transaction_id,
                    v_obligation.id,
                    'doctor',
                    v_account_id,
                    v_allocated_amount,
                    'automatic FIFO doctor collection allocation',
                    p_changed_by,
                    jsonb_build_object('automaticFifo', TRUE)
                );
            END IF;

            v_remaining := v_remaining - v_allocated_amount;
            v_newly_allocated := v_newly_allocated + v_allocated_amount;
            v_allocation_count := v_allocation_count + 1;
        END LOOP;

        IF v_source.source_kind = 'untracked_payment' AND v_remaining > 0.005 THEN
            INSERT INTO public.account_credits (
                entity_type,
                entity_id,
                amount,
                remaining_amount,
                source,
                source_transaction_id,
                status,
                created_by,
                metadata
            )
            VALUES (
                'doctor',
                v_account_id,
                v_remaining,
                v_remaining,
                'overpayment',
                v_source.source_transaction_id,
                'active',
                p_changed_by,
                jsonb_build_object(
                    'automaticFifo', TRUE,
                    'canonicalDoctorAccountId', v_account_id,
                    'source', 'doctor_collection_fifo',
                    'historicalBackfill20260801',
                        COALESCE(current_setting('orca.doctor_fifo_backfill', TRUE), '0') = '1'
                )
            )
            RETURNING id INTO v_credit_id;

            INSERT INTO public.allocation_events (
                event_type,
                credit_id,
                transaction_id,
                entity_type,
                entity_id,
                amount,
                reason,
                changed_by,
                metadata
            )
            VALUES (
                'credit_created',
                v_credit_id,
                v_source.source_transaction_id,
                'doctor',
                v_account_id,
                v_remaining,
                'doctor collection exceeds current open receivables',
                p_changed_by,
                jsonb_build_object('automaticFifo', TRUE)
            );

            v_new_credit_amount := v_new_credit_amount + v_remaining;
        END IF;
    END LOOP;

    PERFORM set_config('orca.doctor_fifo_reconciling', '0', TRUE);

    RETURN jsonb_build_object(
        'accountId', v_account_id,
        'newAllocationCount', v_allocation_count,
        'newlyAllocatedAmount', v_newly_allocated,
        'newCreditAmount', v_new_credit_amount,
        'status', 'reconciled'
    );
END;
$$;
CREATE OR REPLACE FUNCTION public.reconcile_approved_doctor_collection_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.type = 'income'
       AND NEW.entity_type = 'doctor'
       AND NEW.entity_id IS NOT NULL
       AND (
            COALESCE(NEW.status, '') = 'approved'
            OR COALESCE(NEW.is_approved, FALSE)
       ) THEN
        IF TG_OP = 'INSERT' THEN
            PERFORM public.reconcile_doctor_account_fifo(NEW.entity_id, auth.uid());
        ELSIF COALESCE(OLD.status, '') <> 'approved'
              AND COALESCE(OLD.is_approved, FALSE) = FALSE THEN
            PERFORM public.reconcile_doctor_account_fifo(NEW.entity_id, auth.uid());
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.reconcile_open_doctor_obligation_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF current_setting('orca.doctor_fifo_reconciling', TRUE) = '1' THEN
        RETURN NEW;
    END IF;

    IF NEW.entity_type = 'doctor'
       AND NEW.direction = 'receivable'
       AND NEW.status IN ('unpaid', 'partially_paid')
       AND NEW.remaining_amount > 0 THEN
        IF TG_OP = 'INSERT' THEN
            PERFORM public.reconcile_doctor_account_fifo(NEW.entity_id, auth.uid());
        ELSIF OLD.entity_id IS DISTINCT FROM NEW.entity_id
              OR OLD.net_amount IS DISTINCT FROM NEW.net_amount
              OR OLD.status IS DISTINCT FROM NEW.status THEN
            PERFORM public.reconcile_doctor_account_fifo(NEW.entity_id, auth.uid());
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.reconcile_doctor_credit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF current_setting('orca.doctor_fifo_reconciling', TRUE) = '1' THEN
        RETURN NEW;
    END IF;

    IF NEW.entity_type = 'doctor'
       AND NEW.status IN ('active', 'review')
       AND NEW.remaining_amount > 0
       AND NEW.source_transaction_id IS NOT NULL THEN
        PERFORM public.reconcile_doctor_account_fifo(NEW.entity_id, auth.uid());
    END IF;

    RETURN NEW;
END;
$$;
-- The existing mutation guard already protects allocated transactions. Extend
-- it to protect doctor payments represented only by an active credit as well.
CREATE OR REPLACE FUNCTION public.guard_allocated_payable_payment_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_transaction_id UUID;
    v_financial_fields_changed BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_transaction_id := OLD.id;
        v_financial_fields_changed := TRUE;
    ELSE
        v_transaction_id := NEW.id;
        v_financial_fields_changed :=
            NEW.type IS DISTINCT FROM OLD.type
            OR NEW.amount IS DISTINCT FROM OLD.amount
            OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
            OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
            OR NEW.status IS DISTINCT FROM OLD.status
            OR NEW.is_approved IS DISTINCT FROM OLD.is_approved;
    END IF;

    IF v_financial_fields_changed
       AND (
           EXISTS (
               SELECT 1
               FROM public.payment_allocations
               WHERE payment_transaction_id = v_transaction_id
                 AND status = 'active'
           )
           OR EXISTS (
               SELECT 1
               FROM public.account_credits
               WHERE source_transaction_id = v_transaction_id
                 AND status IN ('active', 'review')
                 AND remaining_amount > 0
           )
           OR EXISTS (
               SELECT 1
               FROM public.financial_exception_reviews
               WHERE transaction_id = v_transaction_id
                 AND status IN ('open', 'in_review')
           )
       ) THEN
        RAISE EXCEPTION
            'Allocated payment cannot be edited or deleted directly; use an atomic payment correction workflow';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_reconcile_approved_doctor_collection
ON public.transactions;
CREATE TRIGGER trigger_reconcile_approved_doctor_collection
AFTER INSERT OR UPDATE OF status, is_approved
ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.reconcile_approved_doctor_collection_trigger();
DROP TRIGGER IF EXISTS trigger_reconcile_open_doctor_obligation
ON public.financial_obligations;
CREATE TRIGGER trigger_reconcile_open_doctor_obligation
AFTER INSERT OR UPDATE OF entity_id, net_amount, status
ON public.financial_obligations
FOR EACH ROW
EXECUTE FUNCTION public.reconcile_open_doctor_obligation_trigger();
DROP TRIGGER IF EXISTS trigger_reconcile_doctor_credit
ON public.account_credits;
CREATE TRIGGER trigger_reconcile_doctor_credit
AFTER INSERT OR UPDATE OF entity_id, remaining_amount, status
ON public.account_credits
FOR EACH ROW
EXECUTE FUNCTION public.reconcile_doctor_credit_trigger();
REVOKE ALL ON FUNCTION public.canonical_doctor_account_id(UUID)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_doctor_account_fifo(UUID, UUID)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_approved_doctor_collection_trigger()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_open_doctor_obligation_trigger()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_doctor_credit_trigger()
FROM PUBLIC, anon, authenticated;
-- Snapshot every source table used by the current doctor statements. A hash
-- mismatch after allocation means the visible statements could have changed,
-- so the migration raises and the surrounding transaction rolls back.
CREATE TEMP TABLE doctor_statement_source_guard_20260801
ON COMMIT DROP
AS
SELECT
    (
        SELECT md5(COALESCE(string_agg(md5(to_jsonb(row_data)::TEXT), '' ORDER BY row_data.id::TEXT), ''))
        FROM public.orders row_data
    ) AS orders_hash,
    (
        SELECT md5(COALESCE(string_agg(md5(to_jsonb(row_data)::TEXT), '' ORDER BY row_data.id::TEXT), ''))
        FROM public.transactions row_data
    ) AS transactions_hash,
    (
        SELECT md5(COALESCE(string_agg(md5(to_jsonb(row_data)::TEXT), '' ORDER BY row_data.id::TEXT), ''))
        FROM public.adjustments row_data
    ) AS adjustments_hash;
CREATE TEMP TABLE existing_doctor_allocations_20260801
ON COMMIT DROP
AS
SELECT allocation.id
FROM public.payment_allocations allocation;
DO $$
DECLARE
    v_account RECORD;
    v_untracked_count INTEGER;
    v_untracked_amount NUMERIC(12, 2);
    v_credit_count INTEGER;
    v_credit_amount NUMERIC(12, 2);
    v_new_allocation_count INTEGER;
    v_new_allocation_amount NUMERIC(12, 2);
    v_affected_obligation_count INTEGER;
    v_remaining_untracked_count INTEGER;
    v_remaining_untracked_amount NUMERIC(12, 2);
    v_result_credit_count INTEGER;
    v_result_credit_amount NUMERIC(12, 2);
    v_orders_hash TEXT;
    v_transactions_hash TEXT;
    v_adjustments_hash TEXT;
    v_historical_allocation_count INTEGER;
    v_historical_allocation_amount NUMERIC(12, 2);
    v_historical_obligation_count INTEGER;
    v_historical_credit_count INTEGER;
    v_historical_credit_amount NUMERIC(12, 2);
    v_already_applied BOOLEAN := FALSE;
BEGIN
    WITH active_alloc AS (
        SELECT payment_transaction_id, SUM(allocated_amount) AS amount
        FROM public.payment_allocations
        WHERE status = 'active'
        GROUP BY payment_transaction_id
    ),
    credit_by_transaction AS (
        SELECT source_transaction_id, SUM(remaining_amount) AS amount
        FROM public.account_credits
        WHERE entity_type = 'doctor'
          AND status IN ('active', 'review')
          AND remaining_amount > 0
          AND source_transaction_id IS NOT NULL
        GROUP BY source_transaction_id
    )
    SELECT COUNT(*) FILTER (WHERE residual > 0.005),
           COALESCE(SUM(residual) FILTER (WHERE residual > 0.005), 0)
    INTO v_untracked_count, v_untracked_amount
    FROM (
        SELECT GREATEST(
            0,
            payment.amount
              - COALESCE(allocation.amount, 0)
              - COALESCE(credit.amount, 0)
        ) AS residual
        FROM public.transactions payment
        LEFT JOIN active_alloc allocation
          ON allocation.payment_transaction_id = payment.id
        LEFT JOIN credit_by_transaction credit
          ON credit.source_transaction_id = payment.id
        WHERE payment.type = 'income'
          AND payment.entity_type = 'doctor'
          AND payment.entity_id IS NOT NULL
          AND (
                COALESCE(payment.status, '') = 'approved'
                OR COALESCE(payment.is_approved, FALSE)
              )
    ) preview;

    SELECT COUNT(*), COALESCE(SUM(remaining_amount), 0)
    INTO v_credit_count, v_credit_amount
    FROM public.account_credits
    WHERE entity_type = 'doctor'
      AND status IN ('active', 'review')
      AND remaining_amount > 0;

    SELECT COUNT(*),
           COALESCE(SUM(allocated_amount), 0),
           COUNT(DISTINCT obligation_id)
    INTO v_historical_allocation_count,
         v_historical_allocation_amount,
         v_historical_obligation_count
    FROM public.payment_allocations
    WHERE metadata->>'historicalBackfill20260801' = 'true';

    SELECT COUNT(*), COALESCE(SUM(amount), 0)
    INTO v_historical_credit_count, v_historical_credit_amount
    FROM public.account_credits
    WHERE metadata->>'historicalBackfill20260801' = 'true';

    IF v_historical_allocation_count = 340
       AND v_historical_allocation_amount = 518560.00
       AND v_historical_obligation_count = 324
       AND v_historical_credit_count = 7
       AND v_historical_credit_amount = 10370.00 THEN
        v_already_applied := TRUE;
    ELSIF v_untracked_count <> 87 OR v_untracked_amount <> 524730.00 THEN
        RAISE EXCEPTION
            'Doctor FIFO guard failed: expected 87 untracked collections / 524730.00, found % / %',
            v_untracked_count,
            v_untracked_amount;
    ELSIF v_credit_count <> 5 OR v_credit_amount <> 4200.00 THEN
        RAISE EXCEPTION
            'Doctor FIFO guard failed: expected 5 active credits / 4200.00, found % / %',
            v_credit_count,
            v_credit_amount;
    END IF;

    IF NOT v_already_applied THEN
        PERFORM set_config('orca.doctor_fifo_backfill', '1', TRUE);

        FOR v_account IN
            WITH source_accounts AS (
                SELECT public.canonical_doctor_account_id(payment.entity_id) AS account_id
                FROM public.transactions payment
                WHERE payment.type = 'income'
                  AND payment.entity_type = 'doctor'
                  AND payment.entity_id IS NOT NULL
                  AND (
                        COALESCE(payment.status, '') = 'approved'
                        OR COALESCE(payment.is_approved, FALSE)
                      )
                UNION
                SELECT public.canonical_doctor_account_id(credit.entity_id)
                FROM public.account_credits credit
                WHERE credit.entity_type = 'doctor'
                  AND credit.status IN ('active', 'review')
                  AND credit.remaining_amount > 0
            )
            SELECT account_id
            FROM source_accounts
            WHERE account_id IS NOT NULL
            ORDER BY account_id
        LOOP
            PERFORM public.reconcile_doctor_account_fifo(v_account.account_id, NULL);
        END LOOP;

        PERFORM set_config('orca.doctor_fifo_backfill', '0', TRUE);

        SELECT COUNT(*),
               COALESCE(SUM(allocation.allocated_amount), 0),
               COUNT(DISTINCT allocation.obligation_id)
        INTO v_new_allocation_count,
             v_new_allocation_amount,
             v_affected_obligation_count
        FROM public.payment_allocations allocation
        WHERE NOT EXISTS (
            SELECT 1
            FROM existing_doctor_allocations_20260801 existing
            WHERE existing.id = allocation.id
        );

        IF v_new_allocation_count <> 340
           OR v_new_allocation_amount <> 518560.00
           OR v_affected_obligation_count <> 324 THEN
            RAISE EXCEPTION
                'Doctor FIFO result differs from Preview: allocations % / amount % / obligations %',
                v_new_allocation_count,
                v_new_allocation_amount,
                v_affected_obligation_count;
        END IF;
    END IF;

    WITH active_alloc AS (
        SELECT payment_transaction_id, SUM(allocated_amount) AS amount
        FROM public.payment_allocations
        WHERE status = 'active'
        GROUP BY payment_transaction_id
    ),
    credit_by_transaction AS (
        SELECT source_transaction_id, SUM(remaining_amount) AS amount
        FROM public.account_credits
        WHERE entity_type = 'doctor'
          AND status IN ('active', 'review')
          AND remaining_amount > 0
          AND source_transaction_id IS NOT NULL
        GROUP BY source_transaction_id
    )
    SELECT COUNT(*) FILTER (WHERE residual > 0.005),
           COALESCE(SUM(residual) FILTER (WHERE residual > 0.005), 0)
    INTO v_remaining_untracked_count, v_remaining_untracked_amount
    FROM (
        SELECT GREATEST(
            0,
            payment.amount
              - COALESCE(allocation.amount, 0)
              - COALESCE(credit.amount, 0)
        ) AS residual
        FROM public.transactions payment
        LEFT JOIN active_alloc allocation
          ON allocation.payment_transaction_id = payment.id
        LEFT JOIN credit_by_transaction credit
          ON credit.source_transaction_id = payment.id
        WHERE payment.type = 'income'
          AND payment.entity_type = 'doctor'
          AND payment.entity_id IS NOT NULL
          AND (
                COALESCE(payment.status, '') = 'approved'
                OR COALESCE(payment.is_approved, FALSE)
              )
    ) remaining_preview;

    IF v_remaining_untracked_count <> 0 OR v_remaining_untracked_amount <> 0 THEN
        RAISE EXCEPTION
            'Doctor FIFO left untracked collections: % / %',
            v_remaining_untracked_count,
            v_remaining_untracked_amount;
    END IF;

    IF NOT v_already_applied THEN
        SELECT COUNT(*), COALESCE(SUM(remaining_amount), 0)
        INTO v_result_credit_count, v_result_credit_amount
        FROM public.account_credits
        WHERE entity_type = 'doctor'
          AND status IN ('active', 'review')
          AND remaining_amount > 0;

        IF v_result_credit_count <> 7 OR v_result_credit_amount <> 10370.00 THEN
            RAISE EXCEPTION
                'Doctor FIFO credit result differs from Preview: % / %',
                v_result_credit_count,
                v_result_credit_amount;
        END IF;
    END IF;

    SELECT COUNT(*),
           COALESCE(SUM(allocated_amount), 0),
           COUNT(DISTINCT obligation_id)
    INTO v_historical_allocation_count,
         v_historical_allocation_amount,
         v_historical_obligation_count
    FROM public.payment_allocations
    WHERE metadata->>'historicalBackfill20260801' = 'true';

    SELECT COUNT(*), COALESCE(SUM(amount), 0)
    INTO v_historical_credit_count, v_historical_credit_amount
    FROM public.account_credits
    WHERE metadata->>'historicalBackfill20260801' = 'true';

    IF v_historical_allocation_count <> 340
       OR v_historical_allocation_amount <> 518560.00
       OR v_historical_obligation_count <> 324
       OR v_historical_credit_count <> 7
       OR v_historical_credit_amount <> 10370.00 THEN
        RAISE EXCEPTION
            'Doctor FIFO historical marker verification failed';
    END IF;

    SELECT
        (
            SELECT md5(COALESCE(string_agg(md5(to_jsonb(row_data)::TEXT), '' ORDER BY row_data.id::TEXT), ''))
            FROM public.orders row_data
        ),
        (
            SELECT md5(COALESCE(string_agg(md5(to_jsonb(row_data)::TEXT), '' ORDER BY row_data.id::TEXT), ''))
            FROM public.transactions row_data
        ),
        (
            SELECT md5(COALESCE(string_agg(md5(to_jsonb(row_data)::TEXT), '' ORDER BY row_data.id::TEXT), ''))
            FROM public.adjustments row_data
        )
    INTO v_orders_hash, v_transactions_hash, v_adjustments_hash;

    IF NOT EXISTS (
        SELECT 1
        FROM doctor_statement_source_guard_20260801 guard
        WHERE guard.orders_hash = v_orders_hash
          AND guard.transactions_hash = v_transactions_hash
          AND guard.adjustments_hash = v_adjustments_hash
    ) THEN
        RAISE EXCEPTION
            'Doctor statement source guard failed; all FIFO changes were rolled back';
    END IF;
END;
$$;
COMMENT ON FUNCTION public.reconcile_doctor_account_fifo(UUID, UUID) IS
    'Atomically allocates doctor collections and credits FIFO across a canonical doctor/center account. Excess collection becomes tracked credit without changing the official statement.';
COMMIT;
