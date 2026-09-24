-- Fix: review_designer_rejection_v2 fails with 400 "Pending designer rejection request is required"
-- when approving a rejection for orders in technician_status IN ('Rejected', 'NeedDetails')
-- that lack a pending order_events row (e.g. NeedDetails orders created by designers, or legacy orders).
--
-- Root cause:
-- While review_designer_rejection_v2 was updated to allow reviewing orders with
-- technician_status IN ('Rejected', 'NeedDetails') even when no pending designer_rejection_requested
-- event exists (by falling back to creating an audited fallback event row), the underlying trigger
-- guard_order_issue_transition_v2() still unconditionally checked for a pending order_events row
-- on lab_rejected issue transitions. When the RPC updated public.orders to issue_state = 'lab_rejected',
-- the trigger threw "Pending designer rejection request is required".
--
-- Solution:
-- 1. Update guard_order_issue_transition_v2() to allow approve_designer_rejection when
--    OLD.technician_status IN ('Rejected', 'NeedDetails'), matching review_designer_rejection_v2's fallback.
-- 2. Update review_designer_rejection_v2() to also explicitly set technician_status = 'Rejected' on approval
--    and populate approved_by / approved_at on the fallback order_events row.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_order_issue_transition_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_operation TEXT := current_setting('app.order_issue_operation', true);
    v_correcting BOOLEAN := current_setting('app.order_issue_operation', true)
                            = 'admin_correct_issue_state';
    v_pending_rejection UUID;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.issue_state = 'on_hold' THEN
            RAISE EXCEPTION 'on_hold is retired';
        END IF;
        IF COALESCE(NEW.issue_state, 'none') <> 'none' THEN
            RAISE EXCEPTION 'New orders must start with issue_state=none';
        END IF;
        IF NEW.first_delivered_at IS NOT NULL OR NEW.design_submitted_at IS NOT NULL THEN
            RAISE EXCEPTION 'New orders cannot inherit delivery timestamps';
        END IF;
        RETURN NEW;
    END IF;

    IF NOT public.workflow_flag_enabled('workflow_issue_v2_enforce') THEN
        RETURN NEW;
    END IF;

    IF NEW.first_delivered_at IS DISTINCT FROM OLD.first_delivered_at
       AND v_operation IS DISTINCT FROM 'record_final_delivery' THEN
        RAISE EXCEPTION 'first_delivered_at can only be changed by final delivery RPC';
    END IF;
    IF NEW.design_submitted_at IS DISTINCT FROM OLD.design_submitted_at
       AND v_operation IS DISTINCT FROM 'submit_design' THEN
        RAISE EXCEPTION 'design_submitted_at can only be changed by design submission RPC';
    END IF;
    IF NEW.issue_state IS NOT DISTINCT FROM OLD.issue_state THEN
        RETURN NEW;
    END IF;
    IF v_operation IS NULL THEN
        RAISE EXCEPTION 'Issue transitions must use an approved workflow RPC';
    END IF;
    IF v_role NOT IN ('admin', 'representative', 'coordinator') THEN
        RAISE EXCEPTION 'Only admin or representative can apply issue transitions';
    END IF;

    -- A correction is an admin privilege only; a rep who mislabelled a case
    -- must ask an admin, exactly like the legacy-status override.
    IF v_correcting AND v_role <> 'admin' THEN
        RAISE EXCEPTION 'Only admin can correct an issue state';
    END IF;

    CASE NEW.issue_state
        WHEN 'none' THEN
            -- Leaving an issue state is ONLY ever a correction. There is no
            -- ordinary "un-reject" in the workflow.
            IF NOT v_correcting THEN
                RAISE EXCEPTION 'Clearing an issue state requires the admin correction RPC';
            END IF;
            IF COALESCE(OLD.issue_state, 'none') = 'redo' THEN
                RAISE EXCEPTION 'A redo owns a replacement order and cannot be cleared';
            END IF;
        WHEN 'cancelled' THEN
            IF v_operation NOT IN ('cancel_order', 'admin_correct_issue_state')
               OR OLD.first_delivered_at IS NOT NULL THEN
                RAISE EXCEPTION 'Cancellation is only allowed before first delivery';
            END IF;
        WHEN 'returned' THEN
            IF v_operation NOT IN ('return_for_adjustment', 'admin_correct_issue_state')
               OR OLD.first_delivered_at IS NULL THEN
                RAISE EXCEPTION 'Return for adjustment requires prior delivery';
            END IF;
        WHEN 'doctor_rejected' THEN
            IF v_operation NOT IN ('doctor_reject_order', 'admin_correct_issue_state')
               OR OLD.first_delivered_at IS NULL THEN
                RAISE EXCEPTION 'Doctor rejection requires prior delivery';
            END IF;
        WHEN 'redo' THEN
            IF v_operation <> 'create_redo' OR OLD.first_delivered_at IS NULL THEN
                RAISE EXCEPTION 'Redo requires prior delivery';
            END IF;
        WHEN 'lab_rejected' THEN
            IF v_operation NOT IN (
                    'approve_designer_rejection', 'admin_tech_reject',
                    'admin_correct_issue_state'
               )
               OR OLD.first_delivered_at IS NOT NULL
               OR OLD.design_submitted_at IS NOT NULL THEN
                RAISE EXCEPTION 'Lab rejection is only allowed before design submission and final delivery';
            END IF;
            IF v_operation = 'admin_tech_reject' THEN
                IF v_role <> 'admin' THEN
                    RAISE EXCEPTION 'Only admin can reject directly from technician status';
                END IF;
            ELSIF v_operation = 'approve_designer_rejection' THEN
                SELECT event.id INTO v_pending_rejection
                FROM public.order_events event
                WHERE event.order_id = OLD.id
                  AND event.event_type = 'designer_rejection_requested'
                  AND event.approval_status = 'pending'
                ORDER BY event.created_at DESC
                LIMIT 1 FOR UPDATE;
                IF v_pending_rejection IS NULL AND OLD.technician_status NOT IN ('Rejected', 'NeedDetails') THEN
                    RAISE EXCEPTION 'Pending designer rejection request is required';
                END IF;
            END IF;
        ELSE
            RAISE EXCEPTION 'Unsupported issue transition: %', NEW.issue_state;
    END CASE;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.review_designer_rejection_v2(
    p_order_id uuid,
    p_action text,
    p_notes text,
    p_idempotency_key uuid,
    p_cause_category text DEFAULT NULL::text,
    p_responsible_stage text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := public.get_my_user_id();
    v_order public.orders%ROWTYPE;
    v_event public.order_events%ROWTYPE;
    v_payload JSONB := jsonb_build_object('action', p_action, 'notes', NULLIF(btrim(p_notes), ''));
    v_command public.order_transition_commands%ROWTYPE;
    v_result JSONB;
    v_effective_cause TEXT := p_cause_category;
    v_effective_stage TEXT := p_responsible_stage;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN RAISE EXCEPTION 'Workflow V2 writes are disabled'; END IF;
    IF v_role NOT IN ('admin', 'representative', 'coordinator') OR v_user_id IS NULL THEN RAISE EXCEPTION 'Only admin or representative can review'; END IF;
    IF p_action NOT IN ('approve', 'reject', 'request_details') THEN RAISE EXCEPTION 'Invalid review action'; END IF;
    IF p_action <> 'approve' AND NULLIF(btrim(p_notes), '') IS NULL THEN RAISE EXCEPTION 'Review notes are required'; END IF;
    INSERT INTO public.order_transition_commands(idempotency_key, order_id, operation, requested_by, request_payload)
    VALUES (p_idempotency_key, p_order_id, 'review_designer_rejection', v_user_id, v_payload)
    ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT * INTO v_command FROM public.order_transition_commands WHERE idempotency_key = p_idempotency_key FOR UPDATE;
    IF v_command.order_id IS DISTINCT FROM p_order_id OR v_command.operation <> 'review_designer_rejection'
       OR v_command.request_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Idempotency key reuse mismatch'; END IF;
    IF v_command.completed_at IS NOT NULL THEN RETURN v_command.result_payload; END IF;
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
    IF p_action = 'approve' AND v_order.issue_state = 'lab_rejected' THEN
        v_result := jsonb_build_object('orderId', p_order_id, 'action', p_action, 'alreadyApplied', TRUE);
        UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now())
        WHERE idempotency_key = p_idempotency_key;
        RETURN v_result;
    END IF;
    IF p_action = 'reject' AND EXISTS (
        SELECT 1 FROM public.order_events event
        WHERE event.order_id = p_order_id
          AND event.event_type = 'designer_rejection_requested'
          AND event.approval_status = 'rejected'
          AND event.metadata->>'reviewAction' = 'reject'
    ) THEN
        v_result := jsonb_build_object('orderId', p_order_id, 'action', p_action, 'alreadyApplied', TRUE);
        UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now())
        WHERE idempotency_key = p_idempotency_key;
        RETURN v_result;
    END IF;
    SELECT * INTO v_event FROM public.order_events
    WHERE order_id = p_order_id AND event_type = 'designer_rejection_requested' AND approval_status = 'pending'
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND AND v_order.technician_status NOT IN ('Rejected', 'NeedDetails') THEN
        RAISE EXCEPTION 'Pending designer rejection request not found';
    END IF;
    IF p_action = 'approve' THEN
        -- Prefill from the designer's own selection when the approver did not
        -- send an explicit override. Old pending rows without a stored cause
        -- (pre-migration) simply resolve to NULL here, same as today.
        IF v_effective_cause IS NULL AND v_event.id IS NOT NULL THEN
            v_effective_cause := v_event.metadata->>'causeCategory';
            v_effective_stage := v_event.metadata->>'responsibleStage';
        END IF;
        IF v_effective_cause IS NOT NULL THEN
            IF v_effective_cause NOT IN ('scan_impression', 'prep', 'no_space', 'unknown') THEN
                RAISE EXCEPTION 'Invalid cause_category % for lab rejection', v_effective_cause;
            END IF;
            PERFORM set_config('app.explicit_issue_cause', v_effective_cause, true);
            PERFORM set_config('app.explicit_issue_stage', COALESCE(v_effective_stage, ''), true);
        END IF;
        PERFORM set_config('app.order_issue_operation', 'approve_designer_rejection', true);
        UPDATE public.orders SET
            status = 'Lab Rejected', issue_state = 'lab_rejected',
            technician_status = 'Rejected',
            rejection_doctor_decision = 'zero', rejected_doctor_amount = 0,
            rejection_financial_review_status = 'resolved', rejected_lab_cost = 0,
            rejected_designer_cost = 0,
            rejected_lab_cost_status = CASE WHEN supplier_id IS NULL THEN 'not_applicable' ELSE 'resolved' END,
            rejected_designer_cost_status = CASE WHEN designer_id IS NULL THEN 'not_applicable' ELSE 'resolved' END,
            updated_at = timezone('utc', now())
        WHERE id = p_order_id;
    ELSIF p_action = 'reject' THEN
        UPDATE public.orders SET technician_status = 'Approved', design_status = 'in_progress',
            production_status = 'designing', status = 'Under Design', updated_at = timezone('utc', now())
        WHERE id = p_order_id;
    ELSE
        UPDATE public.orders SET technician_status = 'NeedDetails', updated_at = timezone('utc', now())
        WHERE id = p_order_id;
    END IF;
    IF v_event.id IS NOT NULL THEN
        UPDATE public.order_events SET
            approval_status = CASE WHEN p_action = 'approve' THEN 'approved' WHEN p_action = 'reject' THEN 'rejected' ELSE 'pending' END,
            approved_by = CASE WHEN p_action = 'request_details' THEN NULL ELSE v_user_id END,
            approved_at = CASE WHEN p_action = 'request_details' THEN NULL ELSE timezone('utc', now()) END,
            notes = concat_ws(E'\n', notes, NULLIF(btrim(p_notes), '')),
            metadata = metadata || jsonb_build_object('reviewAction', p_action, 'reviewIdempotencyKey', p_idempotency_key)
        WHERE id = v_event.id;
    ELSE
        INSERT INTO public.order_events(
            order_id, event_type, changed_by, actor_role, reason, notes,
            severity, approval_status, approved_by, approved_at, metadata
        ) VALUES (
            p_order_id, 'designer_rejection_requested', v_user_id, v_role,
            'Legacy designer rejection reviewed without a matching v2 request event',
            NULLIF(btrim(p_notes), ''), 'critical',
            CASE WHEN p_action = 'approve' THEN 'approved' WHEN p_action = 'reject' THEN 'rejected' ELSE 'pending' END,
            CASE WHEN p_action = 'request_details' THEN NULL ELSE v_user_id END,
            CASE WHEN p_action = 'request_details' THEN NULL ELSE timezone('utc', now()) END,
            jsonb_build_object('reviewAction', p_action, 'reviewIdempotencyKey', p_idempotency_key, 'legacyFallback', TRUE)
        );
    END IF;
    v_result := jsonb_build_object('orderId', p_order_id, 'action', p_action, 'alreadyApplied', FALSE);
    UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.review_designer_rejection_v2(UUID, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_designer_rejection_v2(UUID, TEXT, TEXT, UUID, TEXT, TEXT) TO authenticated;

COMMIT;
