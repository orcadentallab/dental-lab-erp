-- Category labels are reporting metadata and may be normalized safely without
-- changing an allocated payment's financial identity or allocation history.
-- Amount, entity, transaction type, approval state, and deletion remain guarded.

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
REVOKE ALL ON FUNCTION public.guard_allocated_payable_payment_mutation()
FROM PUBLIC, anon, authenticated;
