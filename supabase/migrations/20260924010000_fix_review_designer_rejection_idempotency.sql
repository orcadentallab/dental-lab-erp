-- Fix: review_designer_rejection_v2 premature idempotency check on 'reject'
--
-- Root cause:
-- review_designer_rejection_v2 checked:
--   IF p_action = 'reject' AND EXISTS (
--       SELECT 1 FROM public.order_events event
--       WHERE event.order_id = p_order_id
--         AND event.event_type = 'designer_rejection_requested'
--         AND event.approval_status = 'rejected'
--         AND event.metadata->>'reviewAction' = 'reject'
--   )
-- This matched ANY previous rejection event in the order's history (e.g. an order rejected,
-- returned to design, and then rejected again; or a legacy fallback event).
-- As a result, the function returned alreadyApplied=TRUE without actually updating
-- the order's technician_status to 'Approved' or design_status to 'in_progress'.
--
-- Solution:
-- For p_action = 'reject', only treat it as already applied if:
--   v_order.technician_status = 'Approved'
--   AND NOT EXISTS (
--       SELECT 1 FROM public.order_events
--       WHERE order_id = p_order_id
--         AND event_type = 'designer_rejection_requested'
--         AND approval_status = 'pending'
--   )

BEGIN;

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
    IF p_action = 'reject'
       AND v_order.technician_status = 'Approved'
       AND NOT EXISTS (
           SELECT 1 FROM public.order_events event
           WHERE event.order_id = p_order_id
             AND event.event_type = 'designer_rejection_requested'
             AND event.approval_status = 'pending'
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
