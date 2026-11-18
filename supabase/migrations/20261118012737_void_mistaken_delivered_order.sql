BEGIN;

CREATE FUNCTION public.void_mistaken_delivered_order(p_order_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_actor UUID := public.get_my_user_id();
    v_reason TEXT := regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
    v_order public.orders%ROWTYPE;
    v_obligation_id UUID;
    v_previous_delete_flag TEXT := current_setting('app.atomic_order_soft_delete', TRUE);
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' OR v_actor IS NULL THEN
        RAISE EXCEPTION 'هذا الإجراء متاح للأدمن فقط' USING ERRCODE = '42501';
    END IF;
    IF NULLIF(v_reason, '') IS NULL THEN
        RAISE EXCEPTION 'سبب الإبطال مطلوب' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الأوردر غير موجود';
    END IF;
    IF COALESCE(v_order.is_deleted, FALSE) THEN
        IF EXISTS (
            SELECT 1 FROM public.order_events
            WHERE order_id = p_order_id AND event_type = 'mistaken_order_voided'
        ) THEN
            RETURN;
        END IF;
        RAISE EXCEPTION 'الأوردر محذوف بالفعل';
    END IF;
    IF NOT COALESCE(
        v_order.production_status = 'final_delivered',
        lower(btrim(v_order.status)) IN ('delivered', 'completed'),
        FALSE
    ) THEN
        RAISE EXCEPTION 'حالة الأوردر تغيرت. حدّث القائمة قبل إعادة المحاولة';
    END IF;

    -- Use the existing delete synchronization to unwind order obligations.
    -- Reset current delivery while preserving first-delivery audit evidence.
    PERFORM set_config('app.atomic_order_soft_delete', 'true', TRUE);
    UPDATE public.orders
    SET is_deleted = TRUE,
        production_status = 'not_started',
        actual_delivery_date = NULL,
        updated_at = now()
    WHERE id = p_order_id;
    PERFORM set_config('app.atomic_order_soft_delete', COALESCE(v_previous_delete_flag, ''), TRUE);

    -- Independent obligations (such as design revision settlements) are
    -- outside the order sync. Void them before releasing their allocations.
    FOR v_obligation_id IN
        UPDATE public.financial_obligations
        SET status = 'void',
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                'voidReason', 'mistaken_order_voided',
                'voidedAt', now()
            )
        WHERE order_id = p_order_id AND status NOT IN ('void', 'written_off')
        RETURNING id
    LOOP
        PERFORM public.reallocate_voided_obligation_allocations(v_obligation_id, NULL, v_actor);
    END LOOP;

    INSERT INTO public.order_events (
        order_id, event_type, old_value, new_value, changed_by, actor_role, reason, severity, metadata
    ) VALUES (
        p_order_id, 'mistaken_order_voided', 'final_delivered', 'deleted', v_actor, 'admin',
        v_reason, 'warning', jsonb_build_object('previousActualDeliveryDate', v_order.actual_delivery_date)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.void_mistaken_delivered_order(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_mistaken_delivered_order(UUID, TEXT) TO authenticated;

COMMIT;
