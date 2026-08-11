-- Allow reviewed workflow RPCs to update rejected designer cost atomically.
-- Direct client writes remain admin-only because they cannot set the
-- transaction-local app.order_issue_operation marker.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_rejected_designer_cost_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_operation TEXT := current_setting('app.order_issue_operation', true);
    v_legacy_atomic_rejection BOOLEAN :=
        current_setting('app.order_rejection_in_progress', true) = 'true';
BEGIN
    IF NEW.rejected_designer_cost IS NOT DISTINCT FROM OLD.rejected_designer_cost THEN
        RETURN NEW;
    END IF;

    IF v_role IS NULL OR v_role = 'admin' OR v_legacy_atomic_rejection THEN
        RETURN NEW;
    END IF;

    IF v_role = 'representative'
       AND v_operation IN (
           'cancel_order',
           'return_for_adjustment',
           'doctor_reject_order',
           'create_redo',
           'approve_designer_rejection'
       ) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Only admin can update rejected designer cost';
END;
$$;

DO $$
DECLARE
    v_definition TEXT := pg_get_functiondef(
        'public.guard_rejected_designer_cost_update()'::regprocedure
    );
BEGIN
    IF v_definition NOT LIKE '%app.order_issue_operation%'
       OR v_definition NOT LIKE '%doctor_reject_order%'
       OR v_definition NOT LIKE '%app.order_rejection_in_progress%' THEN
        RAISE EXCEPTION 'V2 rejected designer cost guard was not installed';
    END IF;
END;
$$;

COMMIT;
