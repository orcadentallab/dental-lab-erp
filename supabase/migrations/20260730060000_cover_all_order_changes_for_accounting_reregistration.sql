-- Complete the accounting re-registration rule for every order business field
-- and for item-only edits performed by update_order_atomic.

DO $$
DECLARE
    v_definition TEXT;
    v_patched TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.update_order_atomic(uuid,jsonb,jsonb,jsonb)'::regprocedure
    )
    INTO v_definition;

    -- Expose item-only edits to the orders BEFORE UPDATE trigger. order_items
    -- are replaced after the parent row update, so the trigger cannot otherwise
    -- see that p_items was supplied.
    v_patched := regexp_replace(
        v_definition,
        E'BEGIN\n',
        E'BEGIN\n    PERFORM set_config(''app.order_items_change_in_progress'', CASE WHEN p_items IS NOT NULL THEN ''true'' ELSE ''false'' END, true);\n',
        1,
        1
    );

    IF v_patched = v_definition THEN
        RAISE EXCEPTION 'Could not add item-change signal to update_order_atomic';
    END IF;

    EXECUTE v_patched;
END;
$$;

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
           current_setting('app.order_items_change_in_progress', true) = 'true'
        OR NEW.case_id                         IS DISTINCT FROM OLD.case_id
        OR NEW.doctor_id                       IS DISTINCT FROM OLD.doctor_id
        OR NEW.branch_name                     IS DISTINCT FROM OLD.branch_name
        OR NEW.patient_name                    IS DISTINCT FROM OLD.patient_name
        OR NEW.items                           IS DISTINCT FROM OLD.items
        OR NEW.discount                        IS DISTINCT FROM OLD.discount
        OR NEW.total_price                     IS DISTINCT FROM OLD.total_price
        OR NEW.shade                           IS DISTINCT FROM OLD.shade
        OR NEW.status                          IS DISTINCT FROM OLD.status
        OR NEW.production_status               IS DISTINCT FROM OLD.production_status
        OR NEW.issue_state                     IS DISTINCT FROM OLD.issue_state
        OR NEW.delivery_date                   IS DISTINCT FROM OLD.delivery_date
        OR NEW.actual_delivery_date            IS DISTINCT FROM OLD.actual_delivery_date
        OR NEW.cost                            IS DISTINCT FROM OLD.cost
        OR NEW.manual_cost                     IS DISTINCT FROM OLD.manual_cost
        OR NEW.supplier_id                     IS DISTINCT FROM OLD.supplier_id
        OR NEW.representative_id               IS DISTINCT FROM OLD.representative_id
        OR NEW.designer_id                     IS DISTINCT FROM OLD.designer_id
        OR NEW.design_price                    IS DISTINCT FROM OLD.design_price
        OR NEW.manual_design_price             IS DISTINCT FROM OLD.manual_design_price
        OR NEW.design_status                   IS DISTINCT FROM OLD.design_status
        OR NEW.workflow_type                   IS DISTINCT FROM OLD.workflow_type
        OR NEW.delivery_type                   IS DISTINCT FROM OLD.delivery_type
        OR NEW.priority                        IS DISTINCT FROM OLD.priority
        OR NEW.is_urgent                       IS DISTINCT FROM OLD.is_urgent
        OR NEW.instructions                    IS DISTINCT FROM OLD.instructions
        OR NEW.stl_url                         IS DISTINCT FROM OLD.stl_url
        OR NEW.images_url                      IS DISTINCT FROM OLD.images_url
        OR NEW.design_url                      IS DISTINCT FROM OLD.design_url
        OR NEW.needs_design_review             IS DISTINCT FROM OLD.needs_design_review
        OR NEW.technician_status               IS DISTINCT FROM OLD.technician_status
        OR NEW.feedback                        IS DISTINCT FROM OLD.feedback
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
