BEGIN;

-- Final delivery is also the completion of a return once production is ready.
-- Keep issue corrections and the rest of the issue transition guard intact.
DO $migration$
DECLARE
    v_definition text;
    v_anchor text;
BEGIN
    v_definition := pg_get_functiondef('public.guard_order_issue_transition_v2()'::regprocedure);
    v_anchor := '    IF v_operation IS NULL THEN';
    IF strpos(v_definition, v_anchor) = 0 THEN
        RAISE EXCEPTION 'Expected order issue transition guard was not found';
    END IF;
    v_definition := replace(v_definition, v_anchor, $guard$
    IF v_operation = 'record_final_delivery'
       AND v_role IN ('admin', 'production_manager', 'representative', 'coordinator')
       AND OLD.issue_state = 'returned' AND NEW.issue_state = 'none'
       AND OLD.production_status = 'final_ready' AND NEW.production_status = 'final_delivered'
       AND (OLD.first_delivered_at IS NOT NULL OR OLD.legacy_delivery_confirmed) THEN
        RETURN NEW;
    END IF;

$guard$ || v_anchor);

    -- A subsequent return can still use confirmed legacy delivery evidence.
    v_anchor := $guard$               OR OLD.first_delivered_at IS NULL THEN
                RAISE EXCEPTION 'Return for adjustment requires prior delivery';$guard$;
    IF strpos(v_definition, v_anchor) = 0 THEN
        RAISE EXCEPTION 'Expected return for adjustment guard was not found';
    END IF;
    EXECUTE replace(v_definition, v_anchor, $guard$               OR (OLD.first_delivered_at IS NULL AND NOT OLD.legacy_delivery_confirmed) THEN
                RAISE EXCEPTION 'Return for adjustment requires prior delivery';$guard$);

    v_definition := pg_get_functiondef('public.apply_order_issue_transition_v2(uuid,text,text,uuid,text,numeric,text,text,text)'::regprocedure);
    v_anchor := $guard$          AND v_order.first_delivered_at IS NULL THEN
        RAISE EXCEPTION 'This operation requires prior delivery';$guard$;
    IF strpos(v_definition, v_anchor) = 0 THEN
        RAISE EXCEPTION 'Expected prior delivery check was not found';
    END IF;
    EXECUTE replace(v_definition, v_anchor, $guard$          AND v_order.first_delivered_at IS NULL
          AND NOT (p_operation = 'return_for_adjustment' AND v_order.legacy_delivery_confirmed) THEN
        RAISE EXCEPTION 'This operation requires prior delivery';$guard$);

    v_definition := pg_get_functiondef('public.orders_role_field_guard()'::regprocedure);
    v_anchor := '    IF v_role = ANY (ARRAY[''accountant'', ''coordinator'']) THEN';
    IF strpos(v_definition, v_anchor) = 0 THEN
        RAISE EXCEPTION 'Expected coordinator field guard was not found';
    END IF;
    EXECUTE replace(v_definition, v_anchor, $guard$
    IF v_role = 'coordinator' AND v_operation = 'record_final_delivery'
       AND OLD.issue_state = 'returned' AND NEW.issue_state = 'none'
       AND OLD.production_status = 'final_ready' AND NEW.production_status = 'final_delivered' THEN
        RETURN NEW;
    END IF;

$guard$ || v_anchor);
END;
$migration$;

CREATE OR REPLACE FUNCTION public.record_order_final_delivery_v2(
    p_order_id uuid, p_delivered_at timestamptz, p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
    v_role text := public.get_my_role();
    v_user_id uuid := public.get_my_user_id();
    v_order public.orders%ROWTYPE;
    v_result jsonb;
    v_payload jsonb := jsonb_build_object('deliveredAt', p_delivered_at);
    v_command public.order_transition_commands%ROWTYPE;
    v_is_return boolean;
    v_previous_operation text := current_setting('app.order_issue_operation', true);
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN
        RAISE EXCEPTION 'Workflow V2 writes are disabled';
    END IF;
    IF v_role IS NULL OR v_role NOT IN ('admin', 'production_manager', 'representative', 'coordinator') OR v_user_id IS NULL THEN
        RAISE EXCEPTION 'Only admin, lab, or representative can record final delivery';
    END IF;

    INSERT INTO public.order_transition_commands(idempotency_key, order_id, operation, requested_by, request_payload)
    VALUES (p_idempotency_key, p_order_id, 'record_final_delivery', v_user_id, v_payload)
    ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT * INTO v_command FROM public.order_transition_commands WHERE idempotency_key = p_idempotency_key FOR UPDATE;
    IF v_command.order_id IS DISTINCT FROM p_order_id OR v_command.operation <> 'record_final_delivery'
       OR v_command.request_payload IS DISTINCT FROM v_payload THEN
        RAISE EXCEPTION 'Idempotency key reuse mismatch';
    END IF;
    IF v_command.completed_at IS NOT NULL THEN RETURN v_command.result_payload; END IF;

    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id AND NOT COALESCE(is_deleted, false) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
    v_is_return := COALESCE(v_order.issue_state = 'returned', false);
    IF v_is_return THEN
        IF v_order.production_status IS DISTINCT FROM 'final_ready' THEN
            RAISE EXCEPTION 'الحالة المرتجعة لازم تكون جاهزة للتسليم بعد التعديل';
        END IF;
        IF v_order.first_delivered_at IS NULL AND NOT v_order.legacy_delivery_confirmed THEN
            RAISE EXCEPTION 'إعادة التسليم تتطلب إثبات التسليم السابق';
        END IF;
    ELSIF COALESCE(v_order.issue_state, 'none') <> 'none' THEN
        RAISE EXCEPTION 'Cannot deliver an order with an active issue';
    END IF;

    IF v_order.production_status = 'final_delivered' AND (
        v_order.first_delivered_at IS NOT NULL OR
        (v_order.legacy_delivery_confirmed AND v_order.actual_delivery_date IS NOT NULL)
    ) THEN
        v_result := jsonb_build_object('orderId', p_order_id, 'productionStatus', 'final_delivered', 'alreadyApplied', true);
        UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
        RETURN v_result;
    END IF;

    PERFORM set_config('app.order_issue_operation', 'record_final_delivery', true);
    UPDATE public.orders SET
        production_status = 'final_delivered',
        issue_state = CASE WHEN v_is_return THEN 'none' ELSE issue_state END,
        actual_delivery_date = COALESCE(p_delivered_at, timezone('utc', now()))::date,
        -- A legacy return can have evidence of delivery without a known first date.
        first_delivered_at = CASE WHEN NOT v_is_return THEN COALESCE(first_delivered_at, p_delivered_at, timezone('utc', now())) ELSE first_delivered_at END,
        first_delivered_source = CASE WHEN NOT v_is_return THEN COALESCE(first_delivered_source, 'direct_transition') ELSE first_delivered_source END,
        updated_at = timezone('utc', now())
    WHERE id = p_order_id;
    PERFORM set_config('app.order_issue_operation', COALESCE(v_previous_operation, ''), true);

    INSERT INTO public.order_events(order_id, event_type, old_value, new_value, changed_by, actor_role, severity, metadata)
    VALUES (p_order_id, 'order_delivered', v_order.production_status, 'final_delivered', v_user_id, v_role, 'info',
        jsonb_build_object('idempotencyKey', p_idempotency_key, 'workflowVersion', 2)
        || CASE WHEN v_is_return THEN '{"previousIssueState":"returned","issueState":"none"}'::jsonb ELSE '{}'::jsonb END);
    v_result := jsonb_build_object('orderId', p_order_id, 'productionStatus', 'final_delivered', 'alreadyApplied', false);
    UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$function$;

COMMIT;
