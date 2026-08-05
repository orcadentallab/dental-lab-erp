-- Any business change made after accounting registration must return the order
-- to Case Registration, regardless of the caller or update path.

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS needs_accounting_reregistration BOOLEAN NOT NULL DEFAULT FALSE;
CREATE OR REPLACE FUNCTION public.reopen_registered_order_for_accounting()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_business_changed BOOLEAN;
BEGIN
    v_business_changed :=
           NEW.case_id                         IS DISTINCT FROM OLD.case_id
        OR NEW.doctor_id                       IS DISTINCT FROM OLD.doctor_id
        OR NEW.branch_name                     IS DISTINCT FROM OLD.branch_name
        OR NEW.patient_name                    IS DISTINCT FROM OLD.patient_name
        OR NEW.items                           IS DISTINCT FROM OLD.items
        OR NEW.discount                        IS DISTINCT FROM OLD.discount
        OR NEW.total_price                     IS DISTINCT FROM OLD.total_price
        OR NEW.shade                           IS DISTINCT FROM OLD.shade
        OR NEW.status                          IS DISTINCT FROM OLD.status
        OR NEW.delivery_date                   IS DISTINCT FROM OLD.delivery_date
        OR NEW.actual_delivery_date            IS DISTINCT FROM OLD.actual_delivery_date
        OR NEW.cost                            IS DISTINCT FROM OLD.cost
        OR NEW.manual_cost                     IS DISTINCT FROM OLD.manual_cost
        OR NEW.supplier_id                     IS DISTINCT FROM OLD.supplier_id
        OR NEW.representative_id               IS DISTINCT FROM OLD.representative_id
        OR NEW.designer_id                     IS DISTINCT FROM OLD.designer_id
        OR NEW.design_price                    IS DISTINCT FROM OLD.design_price
        OR NEW.manual_design_price             IS DISTINCT FROM OLD.manual_design_price
        OR NEW.workflow_type                   IS DISTINCT FROM OLD.workflow_type
        OR NEW.delivery_type                   IS DISTINCT FROM OLD.delivery_type
        OR NEW.is_redo                         IS DISTINCT FROM OLD.is_redo
        OR NEW.original_order_id                IS DISTINCT FROM OLD.original_order_id
        OR NEW.is_archived                     IS DISTINCT FROM OLD.is_archived
        OR NEW.is_deleted                      IS DISTINCT FROM OLD.is_deleted
        OR NEW.rejected_lab_cost               IS DISTINCT FROM OLD.rejected_lab_cost
        OR NEW.rejected_designer_cost          IS DISTINCT FROM OLD.rejected_designer_cost
        OR NEW.rejection_doctor_decision       IS DISTINCT FROM OLD.rejection_doctor_decision
        OR NEW.rejected_doctor_amount          IS DISTINCT FROM OLD.rejected_doctor_amount
        OR NEW.rejection_financial_review_status IS DISTINCT FROM OLD.rejection_financial_review_status
        OR NEW.rejected_lab_cost_status        IS DISTINCT FROM OLD.rejected_lab_cost_status
        OR NEW.rejected_designer_cost_status   IS DISTINCT FROM OLD.rejected_designer_cost_status;

    IF OLD.is_registered = TRUE AND v_business_changed THEN
        NEW.is_registered := FALSE;
        NEW.needs_accounting_reregistration := TRUE;
    ELSIF NEW.is_registered = TRUE AND OLD.is_registered = FALSE THEN
        NEW.needs_accounting_reregistration := FALSE;
    END IF;

    RETURN NEW;
END;
$$;
-- Run after the existing permission guards. The trigger changes registration
-- state internally, so non-accountant update paths cannot bypass this rule.
DROP TRIGGER IF EXISTS zz_reopen_registered_order_for_accounting ON public.orders;
CREATE TRIGGER zz_reopen_registered_order_for_accounting
BEFORE UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.reopen_registered_order_for_accounting();
-- Repair currently registered rejected/returned/cancelled rows that were
-- changed through the known bypass paths before this protection existed.
UPDATE public.orders
SET is_registered = FALSE,
    needs_accounting_reregistration = TRUE
WHERE is_registered = TRUE
  AND status IN (
      'Doctor Rejected',
      'Lab Rejected',
      'Rejected',
      'Returned for Adjustments',
      'Cancelled'
  );
