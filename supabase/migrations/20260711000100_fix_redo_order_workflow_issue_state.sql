-- Migration: Map 'Rejected' status to 'doctor_rejected' issue state instead of 'rejected' state in sync_workflow_states_fn trigger.

CREATE OR REPLACE FUNCTION sync_workflow_states_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Sync issue_state from status if not explicitly updated to a non-none value
    IF TG_OP = 'INSERT' THEN
        IF NEW.issue_state = 'none' OR NEW.issue_state IS NULL THEN
            NEW.issue_state := CASE
                WHEN NEW.status = 'Returned for Adjustments' THEN 'returned'
                WHEN NEW.status = 'Rejected'                 THEN 'doctor_rejected'
                WHEN NEW.status = 'Doctor Rejected'          THEN 'doctor_rejected'
                WHEN NEW.status = 'Lab Rejected'             THEN 'lab_rejected'
                WHEN NEW.status = 'Cancelled'                THEN 'cancelled'
                ELSE 'none'
            END;
        END IF;

        IF NEW.production_status = 'not_started' OR NEW.production_status IS NULL THEN
            NEW.production_status := CASE
                WHEN NEW.status IN ('Delivered','Completed')                                   THEN 'final_delivered'
                WHEN NEW.status = 'Try In Approved'                                            THEN 'finalization'
                WHEN NEW.status = 'Ready'  AND NEW.delivery_type = 'TryIn'                     THEN 'try_in_ready'
                WHEN NEW.status = 'Ready'                                                      THEN 'final_ready'
                WHEN NEW.status = 'Try In' AND NEW.delivery_type = 'TryIn'                     THEN 'try_in_ready'
                WHEN NEW.status = 'Returned for Adjustments'                                   THEN 'in_production'
                WHEN NEW.status IN ('Under Production','In Progress')                          THEN 'in_production'
                WHEN NEW.status IN ('Under Design','Waiting Dr Approval')                      THEN 'designing'
                WHEN NEW.status IN ('New Case','Pending','Pending Review')                     THEN 'not_started'
                ELSE 'not_started'
            END;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        -- If status changed and issue_state didn't change (or was none)
        IF NEW.status IS DISTINCT FROM OLD.status AND (NEW.issue_state = OLD.issue_state OR NEW.issue_state = 'none') THEN
            NEW.issue_state := CASE
                WHEN NEW.status = 'Returned for Adjustments' THEN 'returned'
                WHEN NEW.status = 'Rejected'                 THEN 'doctor_rejected'
                WHEN NEW.status = 'Doctor Rejected'          THEN 'doctor_rejected'
                WHEN NEW.status = 'Lab Rejected'             THEN 'lab_rejected'
                WHEN NEW.status = 'Cancelled'                THEN 'cancelled'
                ELSE 'none'
            END;
        END IF;

        -- If status changed and production_status didn't change (or was default)
        IF NEW.status IS DISTINCT FROM OLD.status AND (NEW.production_status = OLD.production_status OR NEW.production_status = 'not_started') THEN
            NEW.production_status := CASE
                WHEN NEW.status IN ('Delivered','Completed')                                   THEN 'final_delivered'
                WHEN NEW.status = 'Try In Approved'                                            THEN 'finalization'
                WHEN NEW.status = 'Ready'  AND NEW.delivery_type = 'TryIn' AND COALESCE(OLD.issue_state, '') <> 'returned' AND COALESCE(OLD.production_status, '') NOT IN ('finalization', 'final_ready', 'final_delivered') THEN 'try_in_ready'
                WHEN NEW.status = 'Ready'                                                      THEN 'final_ready'
                WHEN NEW.status = 'Try In' AND NEW.delivery_type = 'TryIn'                     THEN 'try_in_ready'
                WHEN NEW.status = 'Returned for Adjustments'                                   THEN 'in_production'
                WHEN NEW.status IN ('Under Production','In Progress')                          THEN 'in_production'
                WHEN NEW.status IN ('Under Design','Waiting Dr Approval')                      THEN 'designing'
                WHEN NEW.status IN ('New Case','Pending','Pending Review')                     THEN 'not_started'
                ELSE NEW.production_status
            END;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
