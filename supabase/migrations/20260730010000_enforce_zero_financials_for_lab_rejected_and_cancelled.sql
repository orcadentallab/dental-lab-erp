-- Enforce the approved financial rules for Lab Rejected / Cancelled orders.
--
-- Rules:
--   * A delivered order cannot later become Lab Rejected or Cancelled.
--   * Lab Rejected and Cancelled carry zero doctor, supplier, and designer
--     order-driven obligations.
--   * The enforcement runs after the canonical synchronization trigger, so it
--     also removes a previously earned payable that older logic preserved.

CREATE OR REPLACE FUNCTION public.guard_lab_rejected_cancelled_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status IN ('Lab Rejected', 'Cancelled')
       AND NEW.status IS DISTINCT FROM OLD.status
       AND (
            OLD.production_status = 'final_delivered'
            OR OLD.actual_delivery_date IS NOT NULL
            OR OLD.status = 'Delivered'
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
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.guard_lab_rejected_cancelled_transition();
CREATE OR REPLACE FUNCTION public.normalize_zero_fields_for_lab_rejected_cancelled()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status IN ('Lab Rejected', 'Cancelled')
       OR COALESCE(NEW.issue_state, 'none') IN ('lab_rejected', 'cancelled') THEN
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
    status,
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
CREATE OR REPLACE FUNCTION public.enforce_zero_order_financials_for_lab_rejected_cancelled()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_changed_by UUID;
    v_trigger_date DATE;
BEGIN
    IF COALESCE(NEW.is_deleted, FALSE)
       OR (
            NEW.status NOT IN ('Lab Rejected', 'Cancelled')
            AND COALESCE(NEW.issue_state, 'none')
                NOT IN ('lab_rejected', 'cancelled')
       ) THEN
        RETURN NEW;
    END IF;

    SELECT id
    INTO v_changed_by
    FROM public.users
    WHERE auth_id = auth.uid()
    LIMIT 1;

    v_trigger_date := COALESCE(
        NEW.delivery_date,
        NEW.created_at::DATE,
        CURRENT_DATE
    );

    -- Passing a null party/amount atomically voids the active obligation and
    -- reallocates any payment according to the canonical FIFO/credit rules.
    PERFORM public.sync_single_order_obligation(
        NEW.id, 'doctor', NULL, 'receivable', 'doctor_delivered',
        NEW.status, v_trigger_date, NULL, 'order',
        jsonb_build_object('caseId', NEW.case_id, 'zeroReason', NEW.status),
        v_changed_by, FALSE
    );

    PERFORM public.sync_single_order_obligation(
        NEW.id, 'external_lab', NULL, 'payable', 'external_lab_ready',
        NEW.status, v_trigger_date, NULL, 'order',
        jsonb_build_object('caseId', NEW.case_id, 'zeroReason', NEW.status),
        v_changed_by, FALSE
    );

    PERFORM public.sync_single_order_obligation(
        NEW.id, 'designer', NULL, 'payable', 'designer_approved',
        NEW.status, v_trigger_date, NULL, 'order',
        jsonb_build_object('caseId', NEW.case_id, 'zeroReason', NEW.status),
        v_changed_by, FALSE
    );

    PERFORM public.sync_single_order_obligation(
        NEW.id, 'external_lab', NULL, 'payable',
        'external_lab_issue_settlement',
        NEW.status, v_trigger_date, NULL, 'order',
        jsonb_build_object('caseId', NEW.case_id, 'zeroReason', NEW.status),
        v_changed_by, FALSE
    );

    PERFORM public.sync_single_order_obligation(
        NEW.id, 'designer', NULL, 'payable', 'designer_issue_settlement',
        NEW.status, v_trigger_date, NULL, 'order',
        jsonb_build_object('caseId', NEW.case_id, 'zeroReason', NEW.status),
        v_changed_by, FALSE
    );

    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS zz_trigger_enforce_zero_order_financials
ON public.orders;
-- PostgreSQL executes same-event triggers alphabetically. The zz_ prefix
-- ensures this final enforcement runs after trigger_sync_order_financial_obligations.
CREATE TRIGGER zz_trigger_enforce_zero_order_financials
AFTER INSERT OR UPDATE OF
    status,
    issue_state,
    production_status,
    actual_delivery_date,
    rejected_lab_cost,
    rejected_designer_cost,
    rejected_doctor_amount,
    rejected_lab_cost_status,
    rejected_designer_cost_status,
    is_deleted
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_zero_order_financials_for_lab_rejected_cancelled();
REVOKE ALL ON FUNCTION public.guard_lab_rejected_cancelled_transition()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_zero_fields_for_lab_rejected_cancelled()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_zero_order_financials_for_lab_rejected_cancelled()
FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.enforce_zero_order_financials_for_lab_rejected_cancelled() IS
    'Final financial invariant: Lab Rejected and Cancelled orders have zero order-driven obligations.';
