-- The three-dot admin correction is one transaction. Financial obligations,
-- allocation releases and credits are owned by the existing order triggers.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_correct_order_production_status_v2(
    p_order_id UUID,
    p_target_status TEXT,
    p_reason TEXT,
    p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user UUID := public.get_my_user_id();
    v_order public.orders%ROWTYPE;
    v_command public.order_transition_commands%ROWTYPE;
    v_production TEXT;
    v_intake TEXT := 'accepted';
    v_design TEXT;
    v_result JSONB;
    v_payload JSONB := jsonb_build_object('targetStatus', p_target_status, 'reason', btrim(p_reason));
    v_previous_operation TEXT := current_setting('app.order_issue_operation', true);
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' OR v_user IS NULL THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;
    IF NULLIF(btrim(p_reason), '') IS NULL OR p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'سبب التصحيح ومعرف العملية مطلوبان' USING ERRCODE = '22023';
    END IF;
    v_production := CASE p_target_status
        WHEN 'Pending Review' THEN 'not_started'
        WHEN 'New Case' THEN 'not_started'
        WHEN 'Under Design' THEN 'designing'
        WHEN 'Waiting Dr Approval' THEN 'designing'
        WHEN 'Under Production' THEN 'in_production'
        WHEN 'Try In' THEN 'try_in_ready'
        WHEN 'Try In Approved' THEN 'finalization'
        WHEN 'Ready' THEN 'final_ready'
        WHEN 'Delivered' THEN 'final_delivered'
    END;
    IF v_production IS NULL THEN
        RAISE EXCEPTION 'حالة إنتاج غير مدعومة للتصحيح' USING ERRCODE = '22023';
    END IF;
    IF p_target_status = 'Pending Review' THEN v_intake := 'pending_review'; END IF;

    INSERT INTO public.order_transition_commands(idempotency_key, order_id, operation, requested_by, request_payload)
    VALUES (p_idempotency_key, p_order_id, 'admin_correct_production_status', v_user, v_payload)
    ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT * INTO v_command FROM public.order_transition_commands
    WHERE idempotency_key = p_idempotency_key FOR UPDATE;
    IF v_command.order_id IS DISTINCT FROM p_order_id
       OR v_command.operation <> 'admin_correct_production_status'
       OR v_command.requested_by IS DISTINCT FROM v_user
       OR v_command.request_payload IS DISTINCT FROM v_payload THEN
        RAISE EXCEPTION 'Idempotency key reuse mismatch';
    END IF;
    IF v_command.completed_at IS NOT NULL THEN RETURN v_command.result_payload; END IF;

    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR COALESCE(v_order.is_deleted, FALSE) THEN RAISE EXCEPTION 'الطلب غير موجود'; END IF;
    IF COALESCE(v_order.issue_state, 'none') <> 'none' THEN
        RAISE EXCEPTION 'صحح حالة المشكلة أولًا من تصحيح المشاكل';
    END IF;
    IF v_production IN ('try_in_ready', 'waiting_doctor', 'finalization')
       AND lower(COALESCE(v_order.delivery_type, '')) NOT IN ('tryin', 'try_in') THEN
        RAISE EXCEPTION 'حالات البروفة تتطلب أن يكون نوع التسليم Try In' USING ERRCODE = '22023';
    END IF;
    v_design := CASE
        WHEN p_target_status IN ('Pending Review', 'New Case') THEN 'pending'
        WHEN p_target_status = 'Under Design' THEN 'in_progress'
        WHEN p_target_status = 'Waiting Dr Approval' THEN 'waiting_approval'
        ELSE 'completed'
    END;

    IF v_production = 'final_delivered' THEN
        -- Reuse the delivery evidence guard and timestamp rules, still inside
        -- this transaction; a later audit failure rolls this call back too.
        PERFORM public.record_order_final_delivery_v2(p_order_id, now(), gen_random_uuid());
    END IF;

    UPDATE public.orders SET
        production_status = v_production,
        intake_state = v_intake,
        design_status = CASE WHEN workflow_type = 'split' THEN v_design ELSE design_status END,
        -- Keep immutable first-delivery history; only the current delivery is
        -- reversed. Historical evidence is not rewritten by production repair.
        actual_delivery_date = CASE
            WHEN v_order.production_status = 'final_delivered' AND v_production <> 'final_delivered' THEN NULL
            ELSE actual_delivery_date END,
        updated_at = now()
    WHERE id = p_order_id;
    -- No exception handler: an audit or financial-trigger error aborts ALL writes.
    INSERT INTO public.order_events(
        order_id, event_type, old_value, new_value, changed_by, actor_role, reason, severity, metadata
    ) VALUES (
        p_order_id,
        CASE WHEN v_order.production_status = 'final_delivered' AND v_production <> 'final_delivered'
            THEN 'delivery_reverted' ELSE 'production_status_changed' END,
        v_order.production_status, v_production, v_user, 'admin', btrim(p_reason), 'warning',
        jsonb_build_object('source', 'admin_correction', 'workflowVersion', 2,
            'idempotencyKey', p_idempotency_key, 'targetStatus', p_target_status,
            'previousIntakeState', v_order.intake_state, 'intakeState', v_intake,
            'previousDesignStatus', v_order.design_status,
            'previousActualDeliveryDate', v_order.actual_delivery_date)
    );
    PERFORM set_config('app.order_issue_operation', COALESCE(v_previous_operation, ''), true);
    v_result := jsonb_build_object('orderId', p_order_id, 'productionStatus', v_production);
    UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = now()
    WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_correct_order_production_status_v2(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_correct_order_production_status_v2(UUID, TEXT, TEXT, UUID) TO authenticated;

COMMIT;
