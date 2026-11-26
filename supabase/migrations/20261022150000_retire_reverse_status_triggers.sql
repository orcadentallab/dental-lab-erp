-- V2 axes are authoritative. Reject direct legacy status UPDATE statements,
-- then remove reverse-sync triggers that attempted to infer V2 from status.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.guard_direct_legacy_order_status_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Legacy order status writes are not allowed; update workflow V2 axes instead.'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_direct_legacy_order_status_write()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aaa_guard_direct_legacy_order_status_write ON public.orders;
CREATE TRIGGER aaa_guard_direct_legacy_order_status_write
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.guard_direct_legacy_order_status_write();

CREATE OR REPLACE FUNCTION public.check_order_update_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF get_my_role() = 'admin' THEN
    RETURN NEW;
  END IF;

  IF get_my_role() = 'lab' THEN
    IF (NEW.id IS DISTINCT FROM OLD.id) OR
       (NEW.case_id IS DISTINCT FROM OLD.case_id) OR
       (NEW.doctor_id IS DISTINCT FROM OLD.doctor_id) OR
       (NEW.patient_name IS DISTINCT FROM OLD.patient_name) OR
       (NEW.items IS DISTINCT FROM OLD.items) OR
       (NEW.discount IS DISTINCT FROM OLD.discount) OR
       (NEW.total_price IS DISTINCT FROM OLD.total_price) OR
       (NEW.cost IS DISTINCT FROM OLD.cost) OR
       (NEW.shade IS DISTINCT FROM OLD.shade) OR
       (NEW.delivery_date IS DISTINCT FROM OLD.delivery_date) OR
       (NEW.stl_url IS DISTINCT FROM OLD.stl_url) OR
       (NEW.images_url IS DISTINCT FROM OLD.images_url) OR
       (NEW.supplier_id IS DISTINCT FROM OLD.supplier_id) OR
       (NEW.instructions IS DISTINCT FROM OLD.instructions) OR
       (NEW.priority IS DISTINCT FROM OLD.priority) OR
       (NEW.delivery_type IS DISTINCT FROM OLD.delivery_type) OR
       (NEW.is_urgent IS DISTINCT FROM OLD.is_urgent) OR
       (NEW.representative_id IS DISTINCT FROM OLD.representative_id) OR
       (NEW.workflow_type IS DISTINCT FROM OLD.workflow_type) OR
       (NEW.designer_id IS DISTINCT FROM OLD.designer_id) OR
       (NEW.design_status IS DISTINCT FROM OLD.design_status) OR
       (NEW.design_price IS DISTINCT FROM OLD.design_price) OR
       (NEW.design_url IS DISTINCT FROM OLD.design_url) OR
       (NEW.is_registered IS DISTINCT FROM OLD.is_registered) OR
       (NEW.needs_design_review IS DISTINCT FROM OLD.needs_design_review) OR
       (NEW.created_at IS DISTINCT FROM OLD.created_at)
    THEN
       RAISE EXCEPTION 'Unauthorized: Labs can only update external_lab_status, external_lab_notes, and technician_status';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_lab_column_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  current_role TEXT;
BEGIN
  SELECT role INTO current_role FROM public.users WHERE auth_id = auth.uid();

  IF current_role = 'lab' THEN
    IF (
       (NEW.doctor_id IS DISTINCT FROM OLD.doctor_id) OR
       (NEW.patient_name IS DISTINCT FROM OLD.patient_name) OR
       (NEW.total_price IS DISTINCT FROM OLD.total_price) OR
       (NEW.representative_id IS DISTINCT FROM OLD.representative_id)
    ) THEN
       RAISE EXCEPTION 'Unauthorized: Labs can only update technician_status, external_lab_status, and notes';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_archive_is_display_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF COALESCE(NEW.is_archived, false) IS DISTINCT FROM COALESCE(OLD.is_archived, false) THEN
        IF COALESCE(NEW.issue_state, 'none') IS DISTINCT FROM COALESCE(OLD.issue_state, 'none')
           OR NEW.production_status IS DISTINCT FROM OLD.production_status
           OR COALESCE(NEW.total_price, 0) IS DISTINCT FROM COALESCE(OLD.total_price, 0)
           OR COALESCE(NEW.cost, 0) IS DISTINCT FROM COALESCE(OLD.cost, 0)
        THEN
            RAISE EXCEPTION
                'Archiving only hides an order; it cannot change its workflow or its money in the same update (order %). Make the workflow or price change first, then archive.',
                NEW.id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS initialize_order_intake_state_v2 ON public.orders;
DROP FUNCTION IF EXISTS public.initialize_order_intake_state_v2();

DROP TRIGGER IF EXISTS trigger_sync_workflow_states ON public.orders;
DROP FUNCTION IF EXISTS public.sync_workflow_states_fn();

DROP TRIGGER IF EXISTS trg_sync_design_status ON public.orders;
DROP FUNCTION IF EXISTS public.sync_design_status_on_order_update();

DROP TRIGGER IF EXISTS trg_audit_design_status ON public.orders;
DROP FUNCTION IF EXISTS public.log_design_status_inconsistency();

COMMIT;
