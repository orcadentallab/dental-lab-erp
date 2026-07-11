-- Migration: Allow designer to transition order statuses by aligning production_status and issue_state checks.
-- Date: 2026-07-11

CREATE OR REPLACE FUNCTION orders_role_field_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := get_my_role();
    v_strict_rep TEXT;
    v_audit_flag TEXT;
BEGIN
    -- Bypass: service role / migrations / unauthenticated.
    IF v_role IS NULL THEN
        RETURN NEW;
    END IF;

    -- Bypass: admin.
    IF v_role = 'admin' THEN
        RETURN NEW;
    END IF;

    -- Lab: existing check_order_update_permissions handles general column
    -- restrictions. Add ONLY the issue_state carve-out here:
    -- lab cannot set doctor_rejected, lab_rejected, or cancelled.
    IF v_role = 'lab' THEN
        IF NEW.issue_state IN ('doctor_rejected','lab_rejected','cancelled')
           AND OLD.issue_state IS DISTINCT FROM NEW.issue_state THEN
            RAISE EXCEPTION 'lab role cannot set issue_state=%', NEW.issue_state
                USING HINT = 'Only admin can reject or cancel orders';
        END IF;
        RETURN NEW;
    END IF;

    -- Accountant: cannot touch workflow / delivery axes.
    IF v_role = 'accountant' THEN
        IF NEW.production_status   IS DISTINCT FROM OLD.production_status
        OR NEW.issue_state         IS DISTINCT FROM OLD.issue_state
        OR NEW.actual_delivery_date IS DISTINCT FROM OLD.actual_delivery_date THEN
            RAISE EXCEPTION 'accountant cannot change workflow fields'
                USING HINT = 'production_status / issue_state / actual_delivery_date are admin/lab only';
        END IF;
        RETURN NEW;
    END IF;

    -- Designer: only design-related columns.
    IF v_role = 'designer' THEN
        DECLARE
            v_expected_prod_status TEXT;
            v_expected_issue_state TEXT;
        BEGIN
            v_expected_prod_status := CASE
                WHEN NEW.status IN ('Delivered','Completed') THEN 'final_delivered'
                WHEN NEW.status = 'Try In Approved' THEN 'finalization'
                WHEN NEW.status = 'Ready' AND NEW.delivery_type = 'TryIn' THEN 'try_in_ready'
                WHEN NEW.status = 'Ready' THEN 'final_ready'
                WHEN NEW.status = 'Try In' AND NEW.delivery_type = 'TryIn' THEN 'try_in_ready'
                WHEN NEW.status = 'Returned for Adjustments' THEN 'in_production'
                WHEN NEW.status IN ('Under Production','In Progress') THEN 'in_production'
                WHEN NEW.status IN ('Under Design','Waiting Dr Approval') THEN 'designing'
                ELSE 'not_started'
            END;

            v_expected_issue_state := CASE
                WHEN NEW.status = 'Returned for Adjustments' THEN 'returned'
                WHEN NEW.status = 'Rejected'                 THEN 'doctor_rejected'
                WHEN NEW.status = 'Doctor Rejected'          THEN 'doctor_rejected'
                WHEN NEW.status = 'Lab Rejected'             THEN 'lab_rejected'
                WHEN NEW.status = 'Cancelled'                THEN 'cancelled'
                ELSE 'none'
            END;

            IF (NEW.production_status IS DISTINCT FROM OLD.production_status AND NEW.production_status IS DISTINCT FROM v_expected_prod_status)
            OR (NEW.issue_state IS DISTINCT FROM OLD.issue_state AND NEW.issue_state IS DISTINCT FROM v_expected_issue_state)
            OR NEW.actual_delivery_date IS DISTINCT FROM OLD.actual_delivery_date
            OR NEW.total_price         IS DISTINCT FROM OLD.total_price
            OR NEW.cost                IS DISTINCT FROM OLD.cost
            OR NEW.manual_cost         IS DISTINCT FROM OLD.manual_cost
            OR NEW.discount            IS DISTINCT FROM OLD.discount
            OR NEW.rejected_lab_cost   IS DISTINCT FROM OLD.rejected_lab_cost
            OR NEW.doctor_id           IS DISTINCT FROM OLD.doctor_id
            OR NEW.representative_id   IS DISTINCT FROM OLD.representative_id
            OR NEW.supplier_id         IS DISTINCT FROM OLD.supplier_id
            OR NEW.delivery_type       IS DISTINCT FROM OLD.delivery_type
            OR NEW.items               IS DISTINCT FROM OLD.items THEN
                RAISE EXCEPTION 'designer cannot change this field';
            END IF;
        END;
        RETURN NEW;
    END IF;

    -- Representative: feature-flag-gated.
    IF v_role = 'representative' THEN
        BEGIN
            SELECT value INTO v_strict_rep FROM public.app_settings WHERE key = 'workflow_strict_rep';
        EXCEPTION WHEN OTHERS THEN
            v_strict_rep := NULL;
        END;

        IF v_strict_rep IS DISTINCT FROM 'on' THEN
            -- Strict mode disabled — preserve existing behavior.
            RETURN NEW;
        END IF;

        -- Check if modifying protected data fields.
        IF NEW.patient_name        IS DISTINCT FROM OLD.patient_name
        OR NEW.stl_url             IS DISTINCT FROM OLD.stl_url
        OR NEW.images_url          IS DISTINCT FROM OLD.images_url
        OR NEW.delivery_date       IS DISTINCT FROM OLD.delivery_date
        OR NEW.is_urgent           IS DISTINCT FROM OLD.is_urgent
        OR NEW.priority            IS DISTINCT FROM OLD.priority
        OR NEW.supplier_id         IS DISTINCT FROM OLD.supplier_id
        OR NEW.designer_id         IS DISTINCT FROM OLD.designer_id
        OR NEW.instructions        IS DISTINCT FROM OLD.instructions
        OR NEW.items               IS DISTINCT FROM OLD.items
        OR NEW.total_price         IS DISTINCT FROM OLD.total_price
        OR NEW.cost                IS DISTINCT FROM OLD.cost
        OR NEW.design_price        IS DISTINCT FROM OLD.design_price
        OR NEW.discount            IS DISTINCT FROM OLD.discount
        OR NEW.rejected_lab_cost   IS DISTINCT FROM OLD.rejected_lab_cost
        OR NEW.doctor_id           IS DISTINCT FROM OLD.doctor_id
        OR NEW.representative_id   IS DISTINCT FROM OLD.representative_id
        OR NEW.workflow_type       IS DISTINCT FROM OLD.workflow_type
        OR NEW.is_archived         IS DISTINCT FROM OLD.is_archived
        OR NEW.case_id             IS DISTINCT FROM OLD.case_id
        OR NEW.created_at          IS DISTINCT FROM OLD.created_at
        OR NEW.is_registered       IS DISTINCT FROM OLD.is_registered
        OR NEW.feedback            IS DISTINCT FROM OLD.feedback THEN

            -- These fields require the audited RPC.
            BEGIN
                v_audit_flag := current_setting('app.rep_audit_in_progress', true);
            EXCEPTION WHEN OTHERS THEN
                v_audit_flag := NULL;
            END;

            IF v_audit_flag IS DISTINCT FROM 'true' THEN
                RAISE EXCEPTION 'representative edits to protected data must go through rep_update_order_fields_with_audit'
                    USING HINT = 'Direct edits to patient info, files, prices, or assignments by representatives are not allowed when strict workflow mode is on';
            END IF;
        END IF;

        -- Even with audit flag, hard-deny finance/identity/status columns.
        IF (NEW.total_price        IS DISTINCT FROM OLD.total_price AND NEW.items IS NOT DISTINCT FROM OLD.items)
        OR (NEW.cost               IS DISTINCT FROM OLD.cost AND NEW.items IS NOT DISTINCT FROM OLD.items)
        OR (NEW.design_price       IS DISTINCT FROM OLD.design_price AND NEW.items IS NOT DISTINCT FROM OLD.items)
        OR NEW.manual_cost         IS DISTINCT FROM OLD.manual_cost
        OR NEW.discount            IS DISTINCT FROM OLD.discount
        OR NEW.rejected_lab_cost   IS DISTINCT FROM OLD.rejected_lab_cost
        OR NEW.doctor_id           IS DISTINCT FROM OLD.doctor_id
        OR NEW.representative_id   IS DISTINCT FROM OLD.representative_id
        OR NEW.workflow_type       IS DISTINCT FROM OLD.workflow_type
        OR NEW.is_archived         IS DISTINCT FROM OLD.is_archived
        OR NEW.case_id             IS DISTINCT FROM OLD.case_id
        OR NEW.created_at          IS DISTINCT FROM OLD.created_at
        OR NEW.is_registered       IS DISTINCT FROM OLD.is_registered THEN
            RAISE EXCEPTION 'representative cannot change protected finance/identity fields even via audited RPC';
        END IF;

        -- Lab-like check: representative cannot set issue_state to doctor_rejected, lab_rejected, or cancelled.
        IF NEW.issue_state IN ('doctor_rejected','lab_rejected','cancelled')
           AND OLD.issue_state IS DISTINCT FROM NEW.issue_state THEN
            RAISE EXCEPTION 'representative cannot set issue_state=%', NEW.issue_state
                USING HINT = 'Only admin can reject or cancel orders';
        END IF;

        RETURN NEW;
    END IF;

    -- Doctor: read-only.
    IF v_role = 'doctor' THEN
        RAISE EXCEPTION 'doctor role cannot update orders';
    END IF;

    -- Unknown role: be conservative.
    RAISE EXCEPTION 'role % is not permitted to update orders', v_role;
END $$;
