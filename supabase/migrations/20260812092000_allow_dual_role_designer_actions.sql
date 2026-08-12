-- Fix: users with a primary role of 'representative' who are also flagged as a
-- secondary/dual-role designer (users.custom_permissions->>'secondary_designer')
-- could not submit designs or request a designer rejection.
--
-- The frontend has always understood this dual-role concept (see
-- isDesignerUser()/canAccessDesignerFeatures() in src/lib/userRoles.ts, driven by
-- the DUAL_ROLE_DESIGNER_PERMISSION custom permission) and shows these users the
-- designer UI. But the workflow V2 RPCs added on 2026-08-08
-- (submit_order_design_v2, request_designer_rejection_v2) only ever checked
-- get_my_role() = 'designer' directly, with no awareness of the custom
-- permission — so a rep+designer dual-role user hit "Role cannot submit a
-- design" / "Only designer can request rejection" for every order assigned to
-- them as designer. This was a pre-existing gap from the V2 rollout, not
-- something introduced by prior fixes in this migration set.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_custom_permission(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE((custom_permissions->>p_key)::BOOLEAN, FALSE)
    FROM public.users WHERE auth_id = auth.uid() LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_my_custom_permission(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_custom_permission(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_order_design_v2(
    p_order_id UUID,
    p_design_url TEXT,
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
    v_acts_as_designer BOOLEAN := public.get_my_role() = 'designer'
        OR (public.get_my_role() = 'representative' AND public.get_my_custom_permission('secondary_designer'));
    v_order public.orders%ROWTYPE;
    v_payload JSONB := jsonb_build_object('designUrl', btrim(p_design_url));
    v_command public.order_transition_commands%ROWTYPE;
    v_result JSONB;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN RAISE EXCEPTION 'Workflow V2 writes are disabled'; END IF;
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authenticated user is required'; END IF;
    INSERT INTO public.order_transition_commands(idempotency_key, order_id, operation, requested_by, request_payload)
    VALUES (p_idempotency_key, p_order_id, 'submit_design', v_user_id, v_payload)
    ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT * INTO v_command FROM public.order_transition_commands WHERE idempotency_key = p_idempotency_key FOR UPDATE;
    IF v_command.order_id IS DISTINCT FROM p_order_id OR v_command.operation <> 'submit_design'
       OR v_command.request_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Idempotency key reuse mismatch'; END IF;
    IF v_command.completed_at IS NOT NULL THEN RETURN v_command.result_payload; END IF;
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
    IF v_acts_as_designer AND v_order.designer_id IS DISTINCT FROM v_user_id THEN
        RAISE EXCEPTION 'Designer is not assigned to this order';
    END IF;
    IF v_role NOT IN ('admin', 'lab') AND NOT v_acts_as_designer THEN
        RAISE EXCEPTION 'Role cannot submit a design';
    END IF;
    IF NULLIF(btrim(p_design_url), '') IS NULL THEN RAISE EXCEPTION 'Design URL is required'; END IF;
    IF v_order.design_submitted_at IS NOT NULL AND v_order.design_url = btrim(p_design_url) THEN
        v_result := jsonb_build_object('orderId', p_order_id, 'designSubmitted', TRUE, 'alreadyApplied', TRUE);
        UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
        RETURN v_result;
    END IF;
    IF v_order.production_status <> 'designing' OR COALESCE(v_order.issue_state, 'none') <> 'none' THEN
        RAISE EXCEPTION 'Order is not available for design submission';
    END IF;
    PERFORM set_config('app.order_issue_operation', 'submit_design', true);
    UPDATE public.orders SET
        design_url = btrim(p_design_url), design_status = 'completed',
        design_submitted_at = COALESCE(design_submitted_at, timezone('utc', now())),
        technician_status = 'Pending', production_status = 'in_production',
        status = 'Under Production', updated_at = timezone('utc', now())
    WHERE id = p_order_id;
    INSERT INTO public.order_events(order_id, event_type, changed_by, actor_role, severity, metadata)
    VALUES (p_order_id, 'design_submitted_to_lab', v_user_id, v_role, 'info',
        jsonb_build_object('idempotencyKey', p_idempotency_key, 'workflowVersion', 2));
    v_result := jsonb_build_object('orderId', p_order_id, 'designSubmitted', TRUE, 'alreadyApplied', FALSE);
    UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_designer_rejection_v2(
    p_order_id UUID,
    p_reason TEXT,
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
    v_acts_as_designer BOOLEAN := public.get_my_role() = 'designer'
        OR (public.get_my_role() = 'representative' AND public.get_my_custom_permission('secondary_designer'));
    v_order public.orders%ROWTYPE;
    v_event_id UUID;
    v_payload JSONB := jsonb_build_object('reason', btrim(p_reason));
    v_command public.order_transition_commands%ROWTYPE;
    v_result JSONB;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN RAISE EXCEPTION 'Workflow V2 writes are disabled'; END IF;
    IF NOT v_acts_as_designer OR v_user_id IS NULL THEN RAISE EXCEPTION 'Only designer can request rejection'; END IF;
    IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
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
        jsonb_build_object('idempotencyKey', p_idempotency_key, 'workflowVersion', 2)
    ) RETURNING id INTO v_event_id;
    UPDATE public.orders SET technician_status = 'Rejected', design_status = 'returned', updated_at = timezone('utc', now())
    WHERE id = p_order_id;
    v_result := jsonb_build_object('orderId', p_order_id, 'eventId', v_event_id, 'alreadyApplied', FALSE);
    UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_order_design_v2(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_order_design_v2(UUID, TEXT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.request_designer_rejection_v2(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_designer_rejection_v2(UUID, TEXT, UUID) TO authenticated;

COMMIT;
