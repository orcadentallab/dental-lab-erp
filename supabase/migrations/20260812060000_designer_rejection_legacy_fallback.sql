-- Fix: reviewing a designer rejection ("return to designer" / "reject case" from the
-- designer feedback card) fails with 400 "Pending designer rejection request not found"
-- for orders whose technician_status was set to Rejected/NeedDetails before the v2
-- event-sourced workflow existed (or otherwise lost their order_events row), because
-- review_designer_rejection_v2 unconditionally required a pending
-- designer_rejection_requested event to exist.
--
-- The dashboard's "designer feedback" card is driven purely by
-- orders.technician_status IN ('Rejected', 'NeedDetails'), so it can show orders that
-- have no matching event row. review_designer_rejection_v2 now falls back to a
-- legacy-safe path in that case instead of raising, mirroring the same optional-event
-- pattern already used by admin_reject_order_from_tech_status_v2.

BEGIN;

CREATE OR REPLACE FUNCTION public.review_designer_rejection_v2(
    p_order_id UUID,
    p_action TEXT,
    p_notes TEXT,
    p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := public.get_my_user_id();
    v_order public.orders%ROWTYPE;
    v_event public.order_events%ROWTYPE;
    v_payload JSONB := jsonb_build_object('action', p_action, 'notes', NULLIF(btrim(p_notes), ''));
    v_command public.order_transition_commands%ROWTYPE;
    v_result JSONB;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN RAISE EXCEPTION 'Workflow V2 writes are disabled'; END IF;
    IF v_role NOT IN ('admin', 'representative') OR v_user_id IS NULL THEN RAISE EXCEPTION 'Only admin or representative can review'; END IF;
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
        PERFORM set_config('app.order_issue_operation', 'approve_designer_rejection', true);
        UPDATE public.orders SET
            status = 'Lab Rejected', issue_state = 'lab_rejected',
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
            severity, approval_status, metadata
        ) VALUES (
            p_order_id, 'designer_rejection_requested', v_user_id, v_role,
            'Legacy designer rejection reviewed without a matching v2 request event',
            NULLIF(btrim(p_notes), ''), 'critical',
            CASE WHEN p_action = 'approve' THEN 'approved' WHEN p_action = 'reject' THEN 'rejected' ELSE 'pending' END,
            jsonb_build_object('reviewAction', p_action, 'reviewIdempotencyKey', p_idempotency_key, 'legacyFallback', TRUE)
        );
    END IF;
    v_result := jsonb_build_object('orderId', p_order_id, 'action', p_action, 'alreadyApplied', FALSE);
    UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.review_designer_rejection_v2(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_designer_rejection_v2(UUID, TEXT, TEXT, UUID) TO authenticated;

COMMIT;
