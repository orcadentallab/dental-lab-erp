BEGIN;
INSERT INTO public.shipping_areas(name) VALUES
 ('التجمع الأول'),('التجمع الخامس'),('زهراء المعادي'),('الحلمية'),('شيراتون'),('ألف مسكن'),
 ('حدائق الأهرام'),('موقف عبود'),('شبرا الخيمة'),('عين شمس'),('العمرانية'),('بولاق الدكرور - أرض اللواء'),
 ('المنيل'),('غمرة'),('مفيدة - هايد بارك التجمع'),('الشيخ زايد - بيفرلي هيلز'),('العاشر من رمضان')
ON CONFLICT DO NOTHING;

ALTER TABLE public.shipments ADD COLUMN cash_carrier text CHECK(cash_carrier IN ('middle_east','scooter')),
    ADD COLUMN hub_leg boolean NOT NULL DEFAULT false,
    ADD COLUMN previous_shipping_leg uuid REFERENCES public.shipments(id);

CREATE FUNCTION public.create_routed_shipping_request(
    p_id uuid,p_courier uuid,p_doctor uuid,p_tracking text,p_orders uuid[],p_photos text[],p_recipient text,
    p_phone text,p_address text,p_notes text,p_area text,p_direction text,p_expense uuid,p_scooter_pending boolean,
    p_patient text,p_branch text,p_carrier text,p_hub boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; trip_id uuid; prior_leg uuid;
BEGIN
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','accountant','coordinator','production_manager') THEN
        RAISE EXCEPTION 'غير مسموح بتسجيل الشحنة' USING ERRCODE='42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
    SELECT id INTO trip_id FROM public.shipments WHERE shipping_request_id=p_id;
    IF FOUND THEN RETURN jsonb_build_object('success',true,'shipment_id',trip_id); END IF;
    IF (p_carrier IS NOT NULL AND (p_carrier NOT IN ('middle_east','scooter') OR p_courier IS NOT NULL
       OR (p_expense IS NULL AND NOT p_scooter_pending)))
       OR (p_hub AND (p_area IS DISTINCT FROM 'العاشر من رمضان' OR p_direction IS DISTINCT FROM 'to_doctor'
           OR p_courier IS NULL OR p_carrier IS NOT NULL)) THEN RAISE EXCEPTION 'راجع طريقة الشحن'; END IF;
    PERFORM 1 FROM public.orders WHERE id=ANY(p_orders) ORDER BY id FOR UPDATE;
    IF p_hub AND (coalesce(cardinality(p_orders),0)=0 OR EXISTS (
        SELECT 1 FROM public.orders WHERE id=ANY(p_orders) AND (production_status NOT IN ('final_ready','try_in_ready') OR issue_state<>'none')
    )) THEN RAISE EXCEPTION 'اختار أوردرات جاهزة للشحن'; END IF;
    IF p_direction='to_doctor' THEN
        IF EXISTS(SELECT 1 FROM public.shipment_orders l JOIN public.shipments s ON s.id=l.shipment_id
            WHERE l.order_id=ANY(p_orders) AND s.hub_leg AND s.status IN ('packing','ready_for_pickup','dispatched')) THEN
            RAISE EXCEPTION 'أكد وصول الطرد للعاشر أولًا';
        END IF;
        SELECT s.id INTO prior_leg FROM public.shipments s JOIN public.shipment_orders l ON l.shipment_id=s.id
        WHERE s.hub_leg AND s.status='delivered' AND l.order_id=ANY(p_orders)
          AND NOT EXISTS(SELECT 1 FROM public.shipments next_leg JOIN public.shipment_orders next_order ON next_order.shipment_id=next_leg.id
              WHERE next_leg.previous_shipping_leg=s.id AND next_order.order_id=l.order_id AND next_leg.status NOT IN ('returned','cancelled'))
        ORDER BY s.delivered_at DESC LIMIT 1;
        IF prior_leg IS NOT NULL AND (p_hub OR (p_carrier IS DISTINCT FROM 'scooter' AND (p_carrier IS NOT NULL OR p_courier IS NOT NULL)) OR p_area IS DISTINCT FROM 'العاشر من رمضان'
            OR EXISTS(SELECT 1 FROM unnest(p_orders) o(id) WHERE NOT EXISTS (
                SELECT 1 FROM public.shipment_orders l WHERE l.shipment_id=prior_leg AND l.order_id=o.id))) THEN
            RAISE EXCEPTION 'اختار أوردرات نفس طرد العاشر للمرحلة الأخيرة، بالسكوتر أو بدون تكلفة شحن إضافية';
        END IF;
    END IF;
    result:=public.create_shipping_request(p_id,p_courier,p_doctor,p_tracking,p_orders,p_photos,p_recipient,p_phone,
        p_address,p_notes,CASE WHEN p_hub THEN 'ألف مسكن' ELSE p_area END,
        CASE WHEN p_hub THEN 'to_lab' ELSE p_direction END,p_expense,p_scooter_pending,p_patient,p_branch);
    UPDATE public.shipments SET cash_carrier=p_carrier,hub_leg=p_hub,previous_shipping_leg=prior_leg
    WHERE id=(result->>'shipment_id')::uuid;
    RETURN result;
END $$;

DO $$
DECLARE d text:=pg_get_functiondef('public.confirm_shipping_request(uuid,text,timestamptz,text,numeric,uuid)'::regprocedure);
BEGIN
    EXECUTE replace(d,$q$'سكوتر · '||trip.shipment_code$q$,
        $q$(CASE WHEN trip.cash_carrier='middle_east' THEN 'ميدل إيست' ELSE 'سكوتر' END)||' · '||trip.shipment_code$q$);
END $$;
REVOKE ALL ON FUNCTION public.create_routed_shipping_request(uuid,uuid,uuid,text,uuid[],text[],text,text,text,text,text,text,uuid,boolean,text,text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_routed_shipping_request(uuid,uuid,uuid,text,uuid[],text[],text,text,text,text,text,text,uuid,boolean,text,text,text,boolean) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
