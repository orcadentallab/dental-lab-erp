-- Let the designer pick the lab-rejection cause/stage at the moment they
-- reject a case, and carry that choice through to admin/representative
-- approval as an editable prefill -- instead of making the approver pick
-- from scratch every time, blind to what the designer already selected.
--
-- Builds on 20260820020000_explicit_issue_cause_v2.sql (already deployed,
-- NOT modified here): that migration added p_cause_category/p_responsible_stage
-- to admin_reject_order_from_tech_status_v2 and review_designer_rejection_v2
-- (approve branch), sourced from whatever the admin/representative typed at
-- approval time. It did not touch request_designer_rejection_v2, so the
-- designer's own rejection reason was never captured as a structured cause --
-- the approver always started blank.
--
-- Fix, in three parts:
--   1. request_designer_rejection_v2 gains the same two optional params, with
--      the lab_rejection vocabulary check, and stores them in order_events
--      .metadata (the row read back later via order_id/event_type/
--      approval_status = pending) exactly like the idempotency payload.
--   2. review_designer_rejection_v2's approve branch: when the caller does
--      NOT send p_cause_category explicitly, read it back from the matched
--      pending order_events row's metadata (the SELECT into v_event already
--      exists) as a fallback -- the admin/representative can still override
--      by sending their own value, unchanged from today.
--   3. admin_reject_order_from_tech_status_v2: same fallback, sourced from
--      v_pending_rejection_id's metadata (already looked up to mark the
--      pending request approved).
--
-- Any pending request created before this migration has no causeCategory in
-- its metadata -- the fallback resolves to NULL and the approver falls back
-- to the existing "pick from scratch" behavior. Zero behavior change there.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. request_designer_rejection_v2 -- adding params changes the signature,
--    so the old 3-arg overload must be dropped first (same lesson learned in
--    20260820020000: CREATE OR REPLACE with a new arg list creates a second
--    overload instead of replacing the old one, and old-arity callers become
--    ambiguous).
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.request_designer_rejection_v2(UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.request_designer_rejection_v2(
    p_order_id UUID,
    p_reason TEXT,
    p_idempotency_key UUID,
    p_cause_category TEXT DEFAULT NULL,
    p_responsible_stage TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := public.get_my_user_id();
    v_acts_as_designer BOOLEAN := public.get_my_role() = 'designer'
        OR (public.get_my_role() = 'representative' AND public.get_my_custom_permission('secondary_designer'));
    v_order public.orders%ROWTYPE;
    v_event_id UUID;
    v_payload JSONB := jsonb_build_object(
        'reason', btrim(p_reason),
        'causeCategory', p_cause_category,
        'responsibleStage', p_responsible_stage
    );
    v_command public.order_transition_commands%ROWTYPE;
    v_result JSONB;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN RAISE EXCEPTION 'Workflow V2 writes are disabled'; END IF;
    IF NOT v_acts_as_designer OR v_user_id IS NULL THEN RAISE EXCEPTION 'Only designer can request rejection'; END IF;
    IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
    IF p_cause_category IS NOT NULL THEN
        IF p_cause_category NOT IN ('scan_impression', 'prep', 'no_space', 'unknown') THEN
            RAISE EXCEPTION 'Invalid cause_category % for lab rejection', p_cause_category;
        END IF;
    END IF;
    INSERT INTO public.order_transition_commands(idempotency_key, order_id, operation, requested_by, request_payload)
    VALUES (p_idempotency_key, p_order_id, 'request_designer_rejection', v_user_id, v_payload)
    ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT * INTO v_command FROM public.order_transition_commands WHERE idempotency_key = p_idempotency_key FOR UPDATE;
    IF v_command.order_id IS DISTINCT FROM p_order_id OR v_command.operation <> 'request_designer_rejection'
       OR v_command.request_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Idempotency key reuse mismatch'; END IF;
    IF v_command.completed_at IS NOT NULL THEN RETURN v_command.result_payload; END IF;
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_order.designer_id IS DISTINCT FROM v_user_id THEN RAISE EXCEPTION 'Order not found or access denied'; END IF;
    IF v_order.production_status <> 'designing' OR v_order.design_submitted_at IS NOT NULL
       OR v_order.first_delivered_at IS NOT NULL OR COALESCE(v_order.issue_state, 'none') <> 'none' THEN
        RAISE EXCEPTION 'Designer rejection is only available before design submission';
    END IF;
    SELECT id INTO v_event_id FROM public.order_events
    WHERE order_id = p_order_id AND event_type = 'designer_rejection_requested' AND approval_status = 'pending'
    ORDER BY created_at DESC LIMIT 1;
    IF v_event_id IS NOT NULL THEN
        v_result := jsonb_build_object('orderId', p_order_id, 'eventId', v_event_id, 'alreadyApplied', TRUE);
        UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
        RETURN v_result;
    END IF;
    INSERT INTO public.order_events(
        order_id, event_type, changed_by, actor_role, reason, notes,
        severity, approval_status, metadata
    ) VALUES (
        p_order_id, 'designer_rejection_requested', v_user_id, v_role,
        btrim(p_reason), btrim(p_reason), 'critical', 'pending',
        jsonb_build_object(
            'idempotencyKey', p_idempotency_key, 'workflowVersion', 2,
            'causeCategory', p_cause_category, 'responsibleStage', p_responsible_stage
        )
    ) RETURNING id INTO v_event_id;
    UPDATE public.orders SET technician_status = 'Rejected', design_status = 'returned', updated_at = timezone('utc', now())
    WHERE id = p_order_id;
    v_result := jsonb_build_object('orderId', p_order_id, 'eventId', v_event_id, 'alreadyApplied', FALSE);
    UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.request_designer_rejection_v2(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_designer_rejection_v2(UUID, TEXT, UUID, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. review_designer_rejection_v2 -- signature unchanged (already 6 args
--    since 20260820020000), so a plain CREATE OR REPLACE is safe. Only the
--    approve branch's cause resolution changes: fall back to the matched
--    pending event's stored metadata when the caller sends no explicit
--    p_cause_category.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.review_designer_rejection_v2(
    p_order_id UUID,
    p_action TEXT,
    p_notes TEXT,
    p_idempotency_key UUID,
    p_cause_category TEXT DEFAULT NULL,
    p_responsible_stage TEXT DEFAULT NULL
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
    v_effective_cause TEXT := p_cause_category;
    v_effective_stage TEXT := p_responsible_stage;
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

-- ─────────────────────────────────────────────────────────────────────────
-- 3. admin_reject_order_from_tech_status_v2 -- same fallback, sourced from
--    the pending designer_rejection_requested event (v_pending_rejection_id)
--    already looked up to mark it approved.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reject_order_from_tech_status_v2(
    p_order_id UUID,
    p_reason TEXT,
    p_idempotency_key UUID,
    p_cause_category TEXT DEFAULT NULL,
    p_responsible_stage TEXT DEFAULT NULL
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
    v_payload JSONB := jsonb_build_object('reason', btrim(p_reason));
    v_command public.order_transition_commands%ROWTYPE;
    v_result JSONB;
    v_pending_rejection_id UUID;
    v_pending_metadata JSONB;
    v_effective_cause TEXT := p_cause_category;
    v_effective_stage TEXT := p_responsible_stage;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN
        RAISE EXCEPTION 'Workflow V2 writes are disabled';
    END IF;
    IF v_role <> 'admin' OR v_user_id IS NULL THEN
        RAISE EXCEPTION 'Only admin can reject directly from technician status';
    END IF;
    IF NULLIF(btrim(p_reason), '') IS NULL THEN
        RAISE EXCEPTION 'Lab rejection reason is required';
    END IF;

    INSERT INTO public.order_transition_commands(
        idempotency_key, order_id, operation, requested_by, request_payload
    ) VALUES (
        p_idempotency_key, p_order_id, 'admin_tech_reject', v_user_id, v_payload
    ) ON CONFLICT (idempotency_key) DO NOTHING;

    SELECT * INTO v_command
    FROM public.order_transition_commands
    WHERE idempotency_key = p_idempotency_key
    FOR UPDATE;
    IF v_command.order_id IS DISTINCT FROM p_order_id
       OR v_command.operation IS DISTINCT FROM 'admin_tech_reject'
       OR v_command.request_payload IS DISTINCT FROM v_payload THEN
        RAISE EXCEPTION 'Idempotency key reuse mismatch';
    END IF;
    IF v_command.completed_at IS NOT NULL THEN
        RETURN v_command.result_payload;
    END IF;

    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id AND COALESCE(is_deleted, FALSE) = FALSE
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

    IF v_order.issue_state = 'lab_rejected' THEN
        v_result := jsonb_build_object(
            'orderId', p_order_id, 'issueState', 'lab_rejected', 'alreadyApplied', TRUE
        );
        UPDATE public.order_transition_commands
        SET result_payload = v_result, completed_at = timezone('utc', now())
        WHERE idempotency_key = p_idempotency_key;
        RETURN v_result;
    END IF;
    IF COALESCE(v_order.issue_state, 'none') <> 'none' THEN
        RAISE EXCEPTION 'Order is already in issue state %', v_order.issue_state;
    END IF;
    IF v_order.first_delivered_at IS NOT NULL
       OR v_order.design_submitted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Lab rejection is only allowed before design submission and final delivery';
    END IF;

    -- An admin override is valid with or without an assigned internal designer.
    -- If the designer did create a proper pending request, consume it so no
    -- orphaned approval remains after the direct technician-status decision.
    SELECT event.id, event.metadata INTO v_pending_rejection_id, v_pending_metadata
    FROM public.order_events event
    WHERE event.order_id = p_order_id
      AND event.event_type = 'designer_rejection_requested'
      AND event.approval_status = 'pending'
    ORDER BY event.created_at DESC
    LIMIT 1
    FOR UPDATE;

    -- Prefill from the designer's own selection when the admin did not send
    -- an explicit override. Old pending rows without a stored cause
    -- (pre-migration) simply resolve to NULL here, same as today.
    IF v_effective_cause IS NULL AND v_pending_rejection_id IS NOT NULL THEN
        v_effective_cause := v_pending_metadata->>'causeCategory';
        v_effective_stage := v_pending_metadata->>'responsibleStage';
    END IF;

    IF v_effective_cause IS NOT NULL THEN
        IF v_effective_cause NOT IN ('scan_impression', 'prep', 'no_space', 'unknown') THEN
            RAISE EXCEPTION 'Invalid cause_category % for lab rejection', v_effective_cause;
        END IF;
        PERFORM set_config('app.explicit_issue_cause', v_effective_cause, true);
        PERFORM set_config('app.explicit_issue_stage', COALESCE(v_effective_stage, ''), true);
    END IF;

    PERFORM set_config('app.order_issue_operation', 'admin_tech_reject', true);
    UPDATE public.orders SET
        status = 'Lab Rejected',
        issue_state = 'lab_rejected',
        technician_status = 'Rejected',
        rejection_doctor_decision = 'zero',
        rejected_doctor_amount = 0,
        rejection_financial_review_status = 'resolved',
        rejected_lab_cost = 0,
        rejected_designer_cost = 0,
        rejected_lab_cost_status = CASE
            WHEN supplier_id IS NULL THEN 'not_applicable' ELSE 'resolved'
        END,
        rejected_designer_cost_status = CASE
            WHEN designer_id IS NULL THEN 'not_applicable' ELSE 'resolved'
        END,
        updated_at = timezone('utc', now())
    WHERE id = p_order_id;

    IF v_pending_rejection_id IS NOT NULL THEN
        UPDATE public.order_events SET
            approval_status = 'approved',
            approved_by = v_user_id,
            approved_at = timezone('utc', now()),
            notes = concat_ws(E'\n', notes, btrim(p_reason)),
            metadata = metadata || jsonb_build_object(
                'reviewAction', 'approve',
                'reviewSource', 'admin_tech_status',
                'reviewIdempotencyKey', p_idempotency_key
            )
        WHERE id = v_pending_rejection_id;
    END IF;

    INSERT INTO public.order_events(
        order_id, event_type, old_value, new_value, changed_by, actor_role,
        reason, notes, severity, approval_status, metadata
    ) VALUES (
        p_order_id, 'case_rejected', COALESCE(v_order.issue_state, 'none'),
        'lab_rejected', v_user_id, v_role, btrim(p_reason), btrim(p_reason),
        'critical', 'none', jsonb_build_object(
            'idempotencyKey', p_idempotency_key,
            'workflowVersion', 2,
            'source', 'admin_tech_status'
        )
    );

    v_result := jsonb_build_object(
        'orderId', p_order_id, 'issueState', 'lab_rejected', 'alreadyApplied', FALSE
    );
    UPDATE public.order_transition_commands
    SET result_payload = v_result, completed_at = timezone('utc', now())
    WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$$;

COMMIT;
