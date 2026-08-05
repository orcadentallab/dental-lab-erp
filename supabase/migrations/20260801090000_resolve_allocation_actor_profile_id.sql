-- payment_allocations.allocated_by and related audit columns reference
-- public.users(id), while auth.uid() returns auth.users(id). Resolve the app
-- profile id explicitly in every automatic allocation trigger.

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
            PERFORM public.allocate_payable_transaction_fifo(NEW.id, public.get_my_user_id());
        ELSIF COALESCE(OLD.status, '') <> 'approved'
              AND COALESCE(OLD.is_approved, FALSE) = FALSE THEN
            PERFORM public.allocate_payable_transaction_fifo(NEW.id, public.get_my_user_id());
        END IF;
    END IF;

    RETURN NEW;
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
            PERFORM public.reconcile_doctor_account_fifo(NEW.entity_id, public.get_my_user_id());
        ELSIF COALESCE(OLD.status, '') <> 'approved'
              AND COALESCE(OLD.is_approved, FALSE) = FALSE THEN
            PERFORM public.reconcile_doctor_account_fifo(NEW.entity_id, public.get_my_user_id());
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
            PERFORM public.reconcile_doctor_account_fifo(NEW.entity_id, public.get_my_user_id());
        ELSIF OLD.entity_id IS DISTINCT FROM NEW.entity_id
              OR OLD.net_amount IS DISTINCT FROM NEW.net_amount
              OR OLD.status IS DISTINCT FROM NEW.status THEN
            PERFORM public.reconcile_doctor_account_fifo(NEW.entity_id, public.get_my_user_id());
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
        PERFORM public.reconcile_doctor_account_fifo(NEW.entity_id, public.get_my_user_id());
    END IF;

    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.allocate_approved_payable_payment_trigger()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_approved_doctor_collection_trigger()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_open_doctor_obligation_trigger()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_doctor_credit_trigger()
FROM PUBLIC, anon, authenticated;
