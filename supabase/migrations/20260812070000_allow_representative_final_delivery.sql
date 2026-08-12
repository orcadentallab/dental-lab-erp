-- Fix: "Only admin or lab can record final delivery" incorrectly blocked
-- representatives from marking an order as delivered. In this lab's actual
-- workflow the representative is the first person to transition an order to
-- "Delivered" (they hand it to the doctor), so both the RLS policy and the
-- workflow V2 RPC that enforced admin/lab-only were wrong and are corrected
-- here to also allow the representative role.
--
-- Also: orders_select hard-blocked representatives from ever reading a
-- Delivered/Completed order at the database level. Hiding finished orders
-- from the default list is a soft UI preference (the "hide finished"
-- checkbox on the Orders page, on by default) — it should stay reachable by
-- toggling the filter, searching, or opening it for a rep edit-with-approval
-- request (rep_update_order_fields_with_audit already allows editing
-- delivered orders, but the client can't do that for a row RLS never
-- returned in the first place). Remove the hard block from SELECT as well.

BEGIN;

DROP POLICY IF EXISTS "orders_select" ON public.orders;
CREATE POLICY "orders_select" ON public.orders FOR SELECT TO authenticated
USING (
    get_my_role() IN ('admin', 'accountant')
    OR (get_my_role() = 'designer' AND designer_id = get_my_user_id())
    OR get_my_role() = 'representative'
    OR (get_my_role() = 'lab' AND supplier_id = get_my_entity_id())
);

DROP POLICY IF EXISTS "orders_update" ON public.orders;
CREATE POLICY "orders_update" ON public.orders FOR UPDATE TO authenticated
USING (
    get_my_role() IN ('admin', 'accountant')
    OR (get_my_role() = 'designer' AND designer_id = get_my_user_id())
    OR (get_my_role() = 'representative' AND status != 'Delivered')
    OR (get_my_role() = 'lab' AND supplier_id = get_my_entity_id())
)
WITH CHECK (
    get_my_role() IN ('admin', 'accountant')
    OR (get_my_role() = 'designer' AND designer_id = get_my_user_id())
    OR (get_my_role() = 'representative')
    OR (get_my_role() = 'lab' AND supplier_id = get_my_entity_id())
);

CREATE OR REPLACE FUNCTION public.record_order_final_delivery_v2(
    p_order_id UUID,
    p_delivered_at TIMESTAMPTZ,
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
    v_result JSONB;
    v_payload JSONB := jsonb_build_object('deliveredAt', p_delivered_at);
    v_command public.order_transition_commands%ROWTYPE;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN RAISE EXCEPTION 'Workflow V2 writes are disabled'; END IF;
    IF v_role NOT IN ('admin', 'lab', 'representative') OR v_user_id IS NULL THEN
        RAISE EXCEPTION 'Only admin, lab, or representative can record final delivery';
    END IF;
    INSERT INTO public.order_transition_commands(idempotency_key, order_id, operation, requested_by, request_payload)
    VALUES (p_idempotency_key, p_order_id, 'record_final_delivery', v_user_id, v_payload)
    ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT * INTO v_command FROM public.order_transition_commands WHERE idempotency_key = p_idempotency_key FOR UPDATE;
    IF v_command.order_id IS DISTINCT FROM p_order_id OR v_command.operation <> 'record_final_delivery'
       OR v_command.request_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Idempotency key reuse mismatch'; END IF;
    IF v_command.completed_at IS NOT NULL THEN RETURN v_command.result_payload; END IF;
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
    IF COALESCE(v_order.issue_state, 'none') <> 'none' THEN
        RAISE EXCEPTION 'Cannot deliver an order with an active issue';
    END IF;
    IF v_order.production_status = 'final_delivered' AND v_order.first_delivered_at IS NOT NULL THEN
        v_result := jsonb_build_object('orderId', p_order_id, 'productionStatus', 'final_delivered', 'alreadyApplied', TRUE);
        UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
        RETURN v_result;
    END IF;
    PERFORM set_config('app.order_issue_operation', 'record_final_delivery', true);
    UPDATE public.orders SET
        status = 'Delivered', production_status = 'final_delivered',
        actual_delivery_date = COALESCE(p_delivered_at, timezone('utc', now()))::date,
        first_delivered_at = COALESCE(first_delivered_at, p_delivered_at, timezone('utc', now())),
        first_delivered_source = COALESCE(first_delivered_source, 'direct_transition'),
        updated_at = timezone('utc', now())
    WHERE id = p_order_id;
    INSERT INTO public.order_events(order_id, event_type, old_value, new_value, changed_by, actor_role, severity, metadata)
    VALUES (p_order_id, 'order_delivered', v_order.production_status, 'final_delivered', v_user_id, v_role, 'info',
        jsonb_build_object('idempotencyKey', p_idempotency_key, 'workflowVersion', 2));
    v_result := jsonb_build_object('orderId', p_order_id, 'productionStatus', 'final_delivered', 'alreadyApplied', FALSE);
    UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.record_order_final_delivery_v2(UUID, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_order_final_delivery_v2(UUID, TIMESTAMPTZ, UUID) TO authenticated;

COMMIT;
