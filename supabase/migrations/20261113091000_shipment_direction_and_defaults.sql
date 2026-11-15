BEGIN;
ALTER TABLE public.doctors ADD COLUMN shipping_area text CHECK(length(shipping_area)<=100);
ALTER TABLE public.shipments
    ADD COLUMN shipping_request_id uuid UNIQUE,
    ADD COLUMN shipping_area text CHECK(length(shipping_area)<=100),
    ADD COLUMN direction text NOT NULL DEFAULT 'to_doctor' CHECK(direction IN ('to_doctor','to_lab')),
    ADD COLUMN immediate_expense_id uuid UNIQUE REFERENCES public.transactions(id),
    ADD COLUMN base_shipping_cost numeric(12,2) CHECK(base_shipping_cost>=0);

CREATE FUNCTION public.create_priced_shipment(
    p_id uuid,p_courier_id uuid,p_doctor_id uuid,p_tracking_ref text,p_order_ids uuid[],
    p_packing_proof_urls text[],p_recipient_name text,p_recipient_phone text,p_delivery_address text,
    p_notes text,p_area text,p_direction text,p_expense uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; shipment_id uuid; code text; rate numeric; expense numeric;
BEGIN
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','accountant','coordinator','production_manager') THEN
        RAISE EXCEPTION 'غير مسموح بتسجيل الشحنة' USING ERRCODE='42501';
    END IF;
    IF p_id IS NULL OR p_doctor_id IS NULL OR p_direction IS NULL OR p_direction NOT IN ('to_doctor','to_lab')
       OR length(btrim(p_area))>100 OR (p_courier_id IS NOT NULL AND p_expense IS NOT NULL)
       OR ((p_direction='to_lab' OR p_expense IS NOT NULL) AND nullif(btrim(p_area),'') IS NULL)
       OR (p_direction='to_lab' AND p_courier_id IS NULL AND p_expense IS NULL) THEN
        RAISE EXCEPTION 'راجع بيانات الشحنة';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
    SELECT s.id,s.shipment_code INTO shipment_id,code FROM public.shipments s WHERE s.shipping_request_id=p_id;
    IF FOUND THEN RETURN jsonb_build_object('success',true,'shipment_id',shipment_id,'shipment_code',code); END IF;
    IF coalesce(cardinality(p_order_ids),0)=0 OR EXISTS (
        SELECT 1 FROM unnest(p_order_ids) item(id) LEFT JOIN public.orders o ON o.id=item.id
        WHERE o.id IS NULL OR o.doctor_id IS DISTINCT FROM p_doctor_id OR coalesce(o.is_deleted,false)
    ) THEN RAISE EXCEPTION 'اختار أوردرات لنفس الطبيب'; END IF;
    IF p_courier_id IS NOT NULL THEN
        PERFORM 1 FROM public.suppliers WHERE id=p_courier_id AND supplier_type='courier' FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'اختار شركة شحن'; END IF;
        SELECT amount INTO rate FROM public.courier_area_rates
        WHERE courier_id=p_courier_id AND lower(area)=lower(btrim(p_area))
        AND effective_month<=date_trunc('month',now() AT TIME ZONE 'Africa/Cairo')::date
        ORDER BY effective_month DESC LIMIT 1;
    END IF;
    IF p_expense IS NOT NULL THEN
        IF public.get_my_role() NOT IN ('admin','accountant','coordinator') THEN
            RAISE EXCEPTION 'ربط مصروف السكوتر لفريق الحسابات والتنسيق' USING ERRCODE='42501';
        END IF;
        SELECT amount INTO expense FROM public.transactions WHERE id=p_expense AND type='expense'
          AND (entity_type IS NULL OR entity_type='general') AND category IN ('shipping','شحن وتوصيل')
          AND coalesce(status,CASE WHEN is_approved THEN 'approved' END)='approved' AND amount>0 FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'اختار مصروف شحن معتمد'; END IF;
    END IF;
    IF p_direction='to_doctor' THEN
        result:=public.create_shipment(p_courier_id,p_doctor_id,p_tracking_ref,p_order_ids,p_packing_proof_urls,
            p_recipient_name,p_recipient_phone,p_delivery_address,p_notes);
        shipment_id:=(result->>'shipment_id')::uuid;
        UPDATE public.shipments SET shipping_request_id=p_id,shipping_area=nullif(btrim(p_area),''),
            base_shipping_cost=rate,immediate_expense_id=p_expense,cost_amount=expense WHERE id=shipment_id;
        RETURN result;
    END IF;
    code:=public.generate_shipment_code();
    INSERT INTO public.shipments(id,shipping_request_id,shipment_code,courier_id,doctor_id,tracking_ref,recipient_name,recipient_phone,
        delivery_address,notes,direction,shipping_area,base_shipping_cost,immediate_expense_id,cost_amount,created_by)
    VALUES(p_id,p_id,code,p_courier_id,p_doctor_id,p_tracking_ref,p_recipient_name,p_recipient_phone,p_delivery_address,
        p_notes,'to_lab',nullif(btrim(p_area),''),rate,p_expense,expense,auth.uid());
    INSERT INTO public.shipment_orders(shipment_id,order_id) SELECT p_id,id FROM (SELECT DISTINCT unnest(p_order_ids) AS id) x;
    RETURN jsonb_build_object('success',true,'shipment_id',p_id,'shipment_code',code);
END $$;

DO $$
DECLARE d text; anchor text;
BEGIN
    d:=pg_get_functiondef('public.link_mixed_try_in_shipment()'::regprocedure);
    EXECUTE regexp_replace(d,'BEGIN',$patch$BEGIN
    IF EXISTS (SELECT 1 FROM public.shipments WHERE id=NEW.shipment_id AND direction='to_lab') THEN
        NEW.production_stage_run_id:=NULL;
        RETURN NEW;
    END IF;$patch$);
    d:=pg_get_functiondef('public.create_shipment(uuid,uuid,text,uuid[],text[],text,text,text,text)'::regprocedure);
    anchor:=$patch$AND s.status IN ('packing', 'ready_for_pickup', 'dispatched')$patch$;
    IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'Unexpected shipment duplicate guard'; END IF;
    EXECUTE replace(d,anchor,anchor||$patch$ AND s.direction='to_doctor'$patch$);
    d:=pg_get_functiondef('public.confirm_shipment_delivery(uuid,text,timestamptz,text)'::regprocedure);
    anchor:='    FOR v_order IN';
    IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'Unexpected shipment confirmation'; END IF;
    EXECUTE replace(d,anchor,$patch$    IF v_shipment.direction='to_lab' THEN
        RETURN jsonb_build_object('success',true,'orders_delivered',0,'orders_skipped','[]'::jsonb,'delivered_at',v_delivered_time);
    END IF;
$patch$||anchor);
    d:=pg_get_functiondef('public.get_courier_statement(uuid,date)'::regprocedure);
    anchor:=$patch$'status',s.status,'previous_cost',s.cost_amount$patch$;
    IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'Unexpected courier statement'; END IF;
    EXECUTE replace(d,anchor,anchor||$patch$,'area',s.shipping_area,'direction',s.direction,'base_cost',s.base_shipping_cost$patch$);
END $$;

REVOKE ALL ON FUNCTION public.create_priced_shipment(uuid,uuid,uuid,text,uuid[],text[],text,text,text,text,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_priced_shipment(uuid,uuid,uuid,text,uuid[],text[],text,text,text,text,text,text,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
