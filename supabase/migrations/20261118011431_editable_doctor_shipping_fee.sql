BEGIN;

CREATE FUNCTION public.sync_edited_doctor_shipping_fee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    charge public.adjustments%ROWTYPE;
    previous_amount numeric;
    charge_id uuid;
BEGIN
    SELECT * INTO charge FROM public.adjustments WHERE shipping_order_id = NEW.id FOR UPDATE;
    previous_amount := coalesce(charge.amount, OLD.quoted_shipping_fee);
    IF NEW.quoted_shipping_fee IS NOT DISTINCT FROM OLD.quoted_shipping_fee
       AND (charge.id IS NULL OR NEW.quoted_shipping_fee IS NOT DISTINCT FROM charge.amount) THEN
        RETURN NEW;
    END IF;
    -- Match the current permission for deleting financial adjustments.
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'تعديل رسوم شحن الأوردر للأدمن فقط' USING ERRCODE = '42501';
    END IF;
    IF coalesce(NEW.is_deleted, false) OR NEW.doctor_id IS NULL
       OR (NEW.quoted_shipping_fee IS NOT NULL AND NEW.issue_state IN ('cancelled','rejected','doctor_rejected','lab_rejected')
           AND charge.id IS NULL) THEN
        RAISE EXCEPTION 'الأوردر غير متاح لتعديل رسوم الشحن' USING ERRCODE = '23514';
    END IF;

    charge_id := charge.id;
    IF NEW.quoted_shipping_fee IS NULL THEN
        DELETE FROM public.adjustments WHERE id = charge.id;
    ELSIF charge.id IS NOT NULL THEN
        UPDATE public.adjustments
        SET amount = NEW.quoted_shipping_fee, entity_id = NEW.doctor_id
        WHERE id = charge.id AND (amount, entity_id) IS DISTINCT FROM (NEW.quoted_shipping_fee, NEW.doctor_id);
    ELSIF NEW.first_delivered_at IS NOT NULL OR NEW.production_status = 'final_delivered' THEN
        INSERT INTO public.adjustments(entity_type, entity_id, type, amount, date, reason, created_by, shipping_order_id, service_charge_kind)
        VALUES ('doctor', NEW.doctor_id, 'charge', NEW.quoted_shipping_fee,
            (now() AT TIME ZONE 'Africa/Cairo')::date, 'رسوم شحن · ' || NEW.case_id, auth.uid(), NEW.id, 'shipping')
        RETURNING id INTO charge_id;
    END IF;

    INSERT INTO public.order_events(order_id, event_type, old_value, new_value, changed_by, actor_role,
        financial_impact, related_adjustment_id)
    VALUES (NEW.id, 'doctor_shipping_fee_edited', previous_amount::text, NEW.quoted_shipping_fee::text,
        public.get_my_user_id(), public.get_my_role(),
        coalesce(NEW.quoted_shipping_fee, 0) - coalesce(previous_amount, 0), charge_id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER sync_edited_doctor_shipping_fee BEFORE UPDATE OF quoted_shipping_fee ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.sync_edited_doctor_shipping_fee();
REVOKE ALL ON FUNCTION public.sync_edited_doctor_shipping_fee() FROM PUBLIC, anon, authenticated;

-- Keep ordinary order permissions and item/comment handling in the existing
-- RPC. The shipping edit and the order form either both commit or both fail.
CREATE FUNCTION public.update_order_with_doctor_shipping_fee(
    p_order_id uuid, p_updates jsonb, p_items jsonb, p_comments jsonb, p_shipping_fee numeric
) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'تعديل رسوم شحن الأوردر للأدمن فقط' USING ERRCODE = '42501';
    END IF;
    IF p_shipping_fee IS NOT NULL AND (
        p_shipping_fee <= 0 OR p_shipping_fee >= 10000000000 OR p_shipping_fee <> round(p_shipping_fee, 2)
    ) THEN
        RAISE EXCEPTION 'أدخل رسوم شحن صحيحة بمنزلتين عشريتين على الأكثر' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'الأوردر غير متاح لتعديل رسوم الشحن' USING ERRCODE = '42501'; END IF;
    IF p_updates <> '{}'::jsonb OR p_items IS NOT NULL OR p_comments IS NOT NULL THEN
        PERFORM public.update_order_atomic(p_order_id, p_updates, p_items, p_comments);
    END IF;
    UPDATE public.orders SET quoted_shipping_fee = p_shipping_fee WHERE id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_order_with_doctor_shipping_fee(uuid,jsonb,jsonb,jsonb,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_with_doctor_shipping_fee(uuid,jsonb,jsonb,jsonb,numeric) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
