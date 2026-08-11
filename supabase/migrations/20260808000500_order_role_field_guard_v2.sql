-- Recreate the order role guard in full for V2. Controlled workflow RPCs set
-- app.order_issue_operation transaction-locally; direct REST writes do not.

BEGIN;

CREATE OR REPLACE FUNCTION public.orders_role_field_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_operation TEXT := current_setting('app.order_issue_operation', true);
    v_strict_rep TEXT;
    v_audit_flag TEXT := current_setting('app.rep_audit_in_progress', true);
BEGIN
    IF v_role IS NULL OR v_role = 'admin' THEN RETURN NEW; END IF;

    -- These bypasses are narrow and are revalidated by the V2 transition guard.
    IF v_role = 'representative' AND v_operation IN (
        'cancel_order', 'return_for_adjustment', 'doctor_reject_order',
        'create_redo', 'approve_designer_rejection'
    ) THEN RETURN NEW; END IF;
    IF v_role = 'designer' AND v_operation IN ('submit_design') THEN RETURN NEW; END IF;
    IF v_role = 'lab' AND v_operation IN ('record_final_delivery', 'submit_design') THEN RETURN NEW; END IF;

    IF v_role = 'lab' THEN
        IF NEW.issue_state IN ('doctor_rejected', 'lab_rejected', 'cancelled', 'redo')
           AND OLD.issue_state IS DISTINCT FROM NEW.issue_state THEN
            RAISE EXCEPTION 'lab role cannot apply issue transition %', NEW.issue_state;
        END IF;
        RETURN NEW;
    END IF;

    IF v_role = 'accountant' THEN
        IF NEW.production_status IS DISTINCT FROM OLD.production_status
           OR NEW.issue_state IS DISTINCT FROM OLD.issue_state
           OR NEW.actual_delivery_date IS DISTINCT FROM OLD.actual_delivery_date
           OR NEW.first_delivered_at IS DISTINCT FROM OLD.first_delivered_at
           OR NEW.design_submitted_at IS DISTINCT FROM OLD.design_submitted_at THEN
            RAISE EXCEPTION 'accountant cannot change workflow or delivery fields';
        END IF;
        RETURN NEW;
    END IF;

    IF v_role = 'designer' THEN
        IF NEW.total_price IS DISTINCT FROM OLD.total_price
           OR NEW.cost IS DISTINCT FROM OLD.cost
           OR NEW.manual_cost IS DISTINCT FROM OLD.manual_cost
           OR NEW.manual_design_price IS DISTINCT FROM OLD.manual_design_price
           OR NEW.discount IS DISTINCT FROM OLD.discount
           OR NEW.rejected_lab_cost IS DISTINCT FROM OLD.rejected_lab_cost
           OR NEW.rejected_designer_cost IS DISTINCT FROM OLD.rejected_designer_cost
           OR NEW.rejected_doctor_amount IS DISTINCT FROM OLD.rejected_doctor_amount
           OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
           OR NEW.representative_id IS DISTINCT FROM OLD.representative_id
           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
           OR NEW.designer_id IS DISTINCT FROM OLD.designer_id
           OR NEW.items IS DISTINCT FROM OLD.items
           OR NEW.delivery_type IS DISTINCT FROM OLD.delivery_type
           OR NEW.actual_delivery_date IS DISTINCT FROM OLD.actual_delivery_date
           OR NEW.first_delivered_at IS DISTINCT FROM OLD.first_delivered_at
           OR NEW.issue_state IS DISTINCT FROM OLD.issue_state THEN
            RAISE EXCEPTION 'designer cannot change protected order fields';
        END IF;
        RETURN NEW;
    END IF;

    IF v_role = 'representative' THEN
        SELECT value INTO v_strict_rep FROM public.app_settings WHERE key = 'workflow_strict_rep';
        IF v_strict_rep IS DISTINCT FROM 'on' THEN RETURN NEW; END IF;

        IF NEW.patient_name IS DISTINCT FROM OLD.patient_name
           OR NEW.stl_url IS DISTINCT FROM OLD.stl_url
           OR NEW.images_url IS DISTINCT FROM OLD.images_url
           OR NEW.delivery_date IS DISTINCT FROM OLD.delivery_date
           OR NEW.is_urgent IS DISTINCT FROM OLD.is_urgent
           OR NEW.priority IS DISTINCT FROM OLD.priority
           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
           OR NEW.designer_id IS DISTINCT FROM OLD.designer_id
           OR NEW.instructions IS DISTINCT FROM OLD.instructions
           OR NEW.items IS DISTINCT FROM OLD.items
           OR NEW.total_price IS DISTINCT FROM OLD.total_price
           OR NEW.cost IS DISTINCT FROM OLD.cost
           OR NEW.design_price IS DISTINCT FROM OLD.design_price
           OR NEW.discount IS DISTINCT FROM OLD.discount
           OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
           OR NEW.representative_id IS DISTINCT FROM OLD.representative_id
           OR NEW.workflow_type IS DISTINCT FROM OLD.workflow_type
           OR NEW.is_archived IS DISTINCT FROM OLD.is_archived
           OR NEW.case_id IS DISTINCT FROM OLD.case_id
           OR NEW.is_registered IS DISTINCT FROM OLD.is_registered
           OR NEW.feedback IS DISTINCT FROM OLD.feedback THEN
            IF v_audit_flag IS DISTINCT FROM 'true' THEN
                RAISE EXCEPTION 'representative protected edits require the audited RPC';
            END IF;
        END IF;

        IF (NEW.total_price IS DISTINCT FROM OLD.total_price AND NEW.items IS NOT DISTINCT FROM OLD.items)
           OR (NEW.cost IS DISTINCT FROM OLD.cost AND NEW.items IS NOT DISTINCT FROM OLD.items)
           OR (NEW.design_price IS DISTINCT FROM OLD.design_price AND NEW.items IS NOT DISTINCT FROM OLD.items)
           OR NEW.manual_cost IS DISTINCT FROM OLD.manual_cost
           OR NEW.manual_design_price IS DISTINCT FROM OLD.manual_design_price
           OR NEW.discount IS DISTINCT FROM OLD.discount
           OR NEW.rejected_lab_cost IS DISTINCT FROM OLD.rejected_lab_cost
           OR NEW.rejected_designer_cost IS DISTINCT FROM OLD.rejected_designer_cost
           OR NEW.rejected_doctor_amount IS DISTINCT FROM OLD.rejected_doctor_amount
           OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
           OR NEW.representative_id IS DISTINCT FROM OLD.representative_id
           OR NEW.workflow_type IS DISTINCT FROM OLD.workflow_type
           OR NEW.is_archived IS DISTINCT FROM OLD.is_archived
           OR NEW.case_id IS DISTINCT FROM OLD.case_id
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR NEW.is_registered IS DISTINCT FROM OLD.is_registered THEN
            RAISE EXCEPTION 'representative cannot change protected finance or identity fields';
        END IF;
        IF NEW.issue_state IN ('doctor_rejected', 'lab_rejected', 'cancelled', 'redo')
           AND OLD.issue_state IS DISTINCT FROM NEW.issue_state THEN
            RAISE EXCEPTION 'representative issue transitions require a V2 workflow RPC';
        END IF;
        RETURN NEW;
    END IF;

    IF v_role = 'doctor' THEN RAISE EXCEPTION 'doctor role cannot update orders directly'; END IF;
    RAISE EXCEPTION 'role % is not permitted to update orders', v_role;
END;
$$;

DO $$
BEGIN
    IF pg_get_functiondef('public.orders_role_field_guard()'::regprocedure)
       NOT LIKE '%app.order_issue_operation%' THEN
        RAISE EXCEPTION 'V2 order role guard was not installed';
    END IF;
END;
$$;

COMMIT;
