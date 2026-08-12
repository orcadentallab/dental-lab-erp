-- Allocate future approved supplier/designer payments to open payables atomically.
--
-- This migration intentionally does not backfill existing transactions. The historical
-- payment preview must be reviewed separately before any production rows are changed.

CREATE OR REPLACE FUNCTION public.allocate_payable_transaction_fifo(
    p_transaction_id UUID,
    p_changed_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_transaction public.transactions%ROWTYPE;
    v_obligation public.financial_obligations%ROWTYPE;
    v_entity_type TEXT;
    v_direction CONSTANT TEXT := 'payable';
    v_remaining NUMERIC(12, 2);
    v_allocation_amount NUMERIC(12, 2);
    v_allocated_total NUMERIC(12, 2) := 0;
    v_existing_allocated NUMERIC(12, 2) := 0;
    v_allocation_id UUID;
    v_review_id UUID;
BEGIN
    SELECT *
    INTO v_transaction
    FROM public.transactions
    WHERE id = p_transaction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment transaction % does not exist', p_transaction_id;
    END IF;

    IF v_transaction.type <> 'expense'
       OR v_transaction.entity_id IS NULL
       OR NOT (
           (v_transaction.entity_type = 'supplier' AND v_transaction.category = 'supplier_payment')
           OR (v_transaction.entity_type = 'designer' AND v_transaction.category = 'designer_payment')
       ) THEN
        RAISE EXCEPTION 'Transaction % is not a supplier/designer payment', p_transaction_id;
    END IF;

    IF COALESCE(v_transaction.status, '') <> 'approved'
       AND COALESCE(v_transaction.is_approved, FALSE) = FALSE THEN
        RETURN jsonb_build_object(
            'transactionId', p_transaction_id,
            'allocatedAmount', 0,
            'reviewAmount', 0,
            'status', 'not_approved'
        );
    END IF;

    v_entity_type := CASE
        WHEN v_transaction.entity_type = 'supplier' THEN 'external_lab'
        ELSE 'designer'
    END;

    SELECT COALESCE(SUM(allocated_amount), 0)
    INTO v_existing_allocated
    FROM public.payment_allocations
    WHERE payment_transaction_id = p_transaction_id
      AND status = 'active';

    v_remaining := GREATEST(0, v_transaction.amount - v_existing_allocated);

    FOR v_obligation IN
        SELECT *
        FROM public.financial_obligations
        WHERE entity_type = v_entity_type
          AND entity_id = v_transaction.entity_id
          AND direction = v_direction
          AND status IN ('unpaid', 'partially_paid')
          AND remaining_amount > 0
        ORDER BY due_date, trigger_date, created_at, id
        FOR UPDATE
    LOOP
        EXIT WHEN v_remaining <= 0;

        v_allocation_amount := LEAST(v_remaining, v_obligation.remaining_amount);
        IF v_allocation_amount <= 0 THEN
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
            p_transaction_id,
            v_obligation.id,
            v_entity_type,
            v_transaction.entity_id,
            v_direction,
            v_allocation_amount,
            'fifo',
            'active',
            p_changed_by,
            jsonb_build_object('automaticFifo', TRUE, 'source', 'payable_payment_trigger')
        )
        RETURNING id INTO v_allocation_id;

        UPDATE public.financial_obligations
        SET allocated_amount = allocated_amount + v_allocation_amount,
            status = CASE
                WHEN allocated_amount + v_allocation_amount >= net_amount THEN 'paid'
                ELSE 'partially_paid'
            END
        WHERE id = v_obligation.id;

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
            p_transaction_id,
            v_obligation.id,
            v_entity_type,
            v_transaction.entity_id,
            v_allocation_amount,
            'automatic FIFO allocation for payable payment',
            p_changed_by,
            jsonb_build_object('automaticFifo', TRUE)
        );

        v_remaining := v_remaining - v_allocation_amount;
        v_allocated_total := v_allocated_total + v_allocation_amount;
    END LOOP;

    IF v_remaining > 0 THEN
        SELECT id
        INTO v_review_id
        FROM public.financial_exception_reviews
        WHERE transaction_id = p_transaction_id
          AND review_type = 'supplier_overpayment'
          AND status IN ('open', 'in_review')
        ORDER BY created_at DESC, id
        LIMIT 1
        FOR UPDATE;

        IF v_review_id IS NULL THEN
            INSERT INTO public.financial_exception_reviews (
                review_type,
                status,
                transaction_id,
                entity_type,
                entity_id,
                amount,
                reason,
                metadata
            )
            VALUES (
                'supplier_overpayment',
                'open',
                p_transaction_id,
                v_entity_type,
                v_transaction.entity_id,
                v_remaining,
                'Payment exceeds currently open payable obligations; review settlement/advance before creating credit.',
                jsonb_build_object('automaticFifo', TRUE, 'paymentCategory', v_transaction.category)
            )
            RETURNING id INTO v_review_id;

            INSERT INTO public.allocation_events (
                event_type,
                transaction_id,
                entity_type,
                entity_id,
                amount,
                reason,
                changed_by,
                metadata
            )
            VALUES (
                'supplier_payment_review_required',
                p_transaction_id,
                v_entity_type,
                v_transaction.entity_id,
                v_remaining,
                'unallocated payable payment requires settlement or advance review',
                p_changed_by,
                jsonb_build_object('reviewId', v_review_id)
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'transactionId', p_transaction_id,
        'allocatedAmount', v_existing_allocated + v_allocated_total,
        'newlyAllocatedAmount', v_allocated_total,
        'reviewAmount', v_remaining,
        'reviewId', v_review_id,
        'status', CASE WHEN v_remaining > 0 THEN 'review_required' ELSE 'allocated' END
    );
END;
$$;
CREATE OR REPLACE FUNCTION public.allocate_approved_payable_payment_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.type = 'expense'
       AND NEW.entity_id IS NOT NULL
       AND (
           (NEW.entity_type = 'supplier' AND NEW.category = 'supplier_payment')
           OR (NEW.entity_type = 'designer' AND NEW.category = 'designer_payment')
       )
       AND (COALESCE(NEW.status, '') = 'approved' OR COALESCE(NEW.is_approved, FALSE)) THEN
        IF TG_OP = 'INSERT' THEN
            PERFORM public.allocate_payable_transaction_fifo(NEW.id, auth.uid());
        ELSIF COALESCE(OLD.status, '') <> 'approved'
              AND COALESCE(OLD.is_approved, FALSE) = FALSE THEN
            PERFORM public.allocate_payable_transaction_fifo(NEW.id, auth.uid());
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
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
               FROM public.financial_exception_reviews
               WHERE transaction_id = v_transaction_id
                 AND status IN ('open', 'in_review')
           )
       ) THEN
        RAISE EXCEPTION 'Allocated supplier/designer payments cannot be edited or deleted directly; use an atomic payment correction workflow';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_allocate_approved_payable_payment ON public.transactions;
CREATE TRIGGER trigger_allocate_approved_payable_payment
AFTER INSERT OR UPDATE OF status, is_approved
ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.allocate_approved_payable_payment_trigger();
DROP TRIGGER IF EXISTS trigger_guard_allocated_payable_payment_mutation ON public.transactions;
CREATE TRIGGER trigger_guard_allocated_payable_payment_mutation
BEFORE UPDATE OR DELETE
ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.guard_allocated_payable_payment_mutation();
REVOKE ALL ON FUNCTION public.allocate_payable_transaction_fifo(UUID, UUID)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.allocate_approved_payable_payment_trigger()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_allocated_payable_payment_mutation()
FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.allocate_payable_transaction_fifo(UUID, UUID) IS
    'Atomically allocates an approved supplier/designer payment FIFO. Excess remains unallocated under explicit financial review.';
