-- Phase 3, DB slice 1: make active zero-financial guards depend only on the
-- authoritative V2 issue axis. No order rows or financial rows are changed.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.guard_lab_rejected_cancelled_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.issue_state IN ('lab_rejected', 'cancelled')
       AND NEW.issue_state IS DISTINCT FROM OLD.issue_state
       AND (
            OLD.production_status = 'final_delivered'
            OR OLD.first_delivered_at IS NOT NULL
            OR COALESCE(OLD.legacy_delivery_confirmed, FALSE)
            OR OLD.actual_delivery_date IS NOT NULL
       ) THEN
        RAISE EXCEPTION
            'A delivered order cannot become Lab Rejected or Cancelled';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_guard_lab_rejected_cancelled_transition
ON public.orders;

CREATE TRIGGER trigger_guard_lab_rejected_cancelled_transition
BEFORE UPDATE OF issue_state ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.guard_lab_rejected_cancelled_transition();

CREATE OR REPLACE FUNCTION public.normalize_zero_fields_for_lab_rejected_cancelled()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.issue_state IN ('lab_rejected', 'cancelled') THEN
        NEW.rejection_doctor_decision := 'zero';
        NEW.rejected_doctor_amount := 0;
        NEW.rejection_financial_review_status := 'resolved';
        NEW.rejected_lab_cost := 0;
        NEW.rejected_lab_cost_status := CASE
            WHEN NEW.supplier_id IS NULL THEN 'not_applicable'
            ELSE 'resolved'
        END;
        NEW.rejected_designer_cost := 0;
        NEW.rejected_designer_cost_status := CASE
            WHEN NEW.designer_id IS NULL THEN 'not_applicable'
            ELSE 'resolved'
        END;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_before_normalize_zero_financial_fields
ON public.orders;

CREATE TRIGGER zz_before_normalize_zero_financial_fields
BEFORE INSERT OR UPDATE OF
    issue_state,
    rejected_lab_cost,
    rejected_designer_cost,
    rejection_doctor_decision,
    rejected_doctor_amount,
    rejected_lab_cost_status,
    rejected_designer_cost_status
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.normalize_zero_fields_for_lab_rejected_cancelled();

-- This legacy function has no trigger or other catalog dependency in the
-- reviewed local and Production inventories. RESTRICT makes the migration
-- fail closed if that assumption changes before deployment.
DROP TRIGGER IF EXISTS zz_trigger_enforce_zero_order_financials
ON public.orders;

DROP FUNCTION public.enforce_zero_order_financials_for_lab_rejected_cancelled()
RESTRICT;

REVOKE ALL ON FUNCTION public.guard_lab_rejected_cancelled_transition()
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.normalize_zero_fields_for_lab_rejected_cancelled()
FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.guard_lab_rejected_cancelled_transition() IS
    'V2 guard: delivered orders cannot enter lab_rejected or cancelled issue states.';

COMMENT ON FUNCTION public.normalize_zero_fields_for_lab_rejected_cancelled() IS
    'V2 normalization: lab_rejected and cancelled issue states carry zero reviewed financial fields.';

COMMIT;
