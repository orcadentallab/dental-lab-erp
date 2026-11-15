BEGIN;
CREATE TABLE public.shipping_areas (name text PRIMARY KEY CHECK(length(btrim(name)) BETWEEN 1 AND 100));
INSERT INTO public.shipping_areas VALUES
 ('القاهرة الجديدة'),('مدينة نصر'),('مصر الجديدة'),('المعادي'),('حلوان'),('وسط البلد'),
 ('شبرا'),('العباسية'),('المقطم'),('الرحاب'),('مدينتي'),('الشروق'),('العبور'),('بدر'),
 ('الجيزة'),('الدقي'),('المهندسين'),('الهرم'),('فيصل'),('أكتوبر'),('الشيخ زايد'),
 ('الإسكندرية'),('بنها'),('الزقازيق'),('المنصورة'),('طنطا'),('الإسماعيلية'),('السويس'),('بورسعيد');
ALTER TABLE public.shipping_areas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shipping_areas FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.shipping_areas TO authenticated;
CREATE POLICY staff_read_shipping_areas ON public.shipping_areas FOR SELECT TO authenticated
USING (public.get_my_role() IN ('admin','accountant','coordinator','production_manager','representative'));

ALTER TABLE public.courier_area_rates ADD COLUMN is_current boolean NOT NULL DEFAULT false;
UPDATE public.courier_area_rates r SET is_current=true WHERE r.id IN (
    SELECT DISTINCT ON (courier_id,lower(area)) id FROM public.courier_area_rates
    ORDER BY courier_id,lower(area),effective_month DESC,id);
CREATE UNIQUE INDEX courier_current_area_rate ON public.courier_area_rates(courier_id,lower(area)) WHERE is_current;
DROP INDEX public.courier_area_rate_month_key;
CREATE OR REPLACE FUNCTION public.save_courier_area_rate(p_courier uuid,p_area text,p_amount numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'تعديل أسعار المناطق للأدمن فقط' USING ERRCODE='42501'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.shipping_areas WHERE name=p_area)
        OR p_amount IS NULL OR p_amount<0 OR p_amount>=10000000000 OR p_amount<>round(p_amount,2) THEN
        RAISE EXCEPTION 'اختار منطقة وسعر صحيح';
    END IF;
    PERFORM 1 FROM public.suppliers WHERE id=p_courier AND supplier_type='courier' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'اختار شركة شحن'; END IF;
    UPDATE public.courier_area_rates SET is_current=false WHERE courier_id=p_courier AND lower(area)=lower(p_area) AND is_current;
    INSERT INTO public.courier_area_rates(courier_id,area,amount,effective_month,is_current)
    VALUES(p_courier,p_area,p_amount,date_trunc('month',now() AT TIME ZONE 'Africa/Cairo')::date,true) RETURNING id INTO result;
    RETURN result;
END $$;
CREATE FUNCTION public.add_shipping_area(p_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'إضافة المناطق للأدمن فقط' USING ERRCODE='42501'; END IF;
    IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'راجع اسم المنطقة'; END IF;
    INSERT INTO public.shipping_areas VALUES(btrim(p_name)) ON CONFLICT DO NOTHING;
END $$;

ALTER TABLE public.shipments ADD COLUMN intake_patient_name text, ADD COLUMN intake_branch_name text,
    ADD COLUMN scooter_payment_pending boolean NOT NULL DEFAULT false;

DO $$
DECLARE d text;
BEGIN
    d:=pg_get_functiondef('public.get_courier_area_rates(uuid,date)'::regprocedure);
    EXECUTE replace(d,'effective_month<=date_trunc(''month'',p_month)::date','is_current');
    d:=pg_get_functiondef('public.create_priced_shipment(uuid,uuid,uuid,text,uuid[],text[],text,text,text,text,text,text,uuid)'::regprocedure);
    EXECUTE replace(d,'effective_month<=date_trunc(''month'',now() AT TIME ZONE ''Africa/Cairo'')::date','is_current');
END $$;

CREATE FUNCTION public.create_shipping_request(
    p_id uuid,p_courier uuid,p_doctor uuid,p_tracking text,p_orders uuid[],p_photos text[],p_recipient text,
    p_phone text,p_address text,p_notes text,p_area text,p_direction text,p_expense uuid,p_scooter_pending boolean,
    p_patient text,p_branch text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE response jsonb; existing public.shipments%ROWTYPE; code text; rate numeric;
BEGIN
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','accountant','coordinator','production_manager') THEN
        RAISE EXCEPTION 'غير مسموح بتسجيل الشحنة' USING ERRCODE='42501';
    END IF;
    IF p_scooter_pending AND (p_courier IS NOT NULL OR p_expense IS NOT NULL OR public.get_my_role() NOT IN ('admin','accountant','coordinator')) THEN
        RAISE EXCEPTION 'راجع طريقة سداد السكوتر';
    END IF;
    IF p_id IS NULL OR (p_area IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.shipping_areas WHERE name=p_area)) THEN
        RAISE EXCEPTION 'اختار منطقة الشحن من القائمة';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
    SELECT * INTO existing FROM public.shipments WHERE shipping_request_id=p_id;
    IF FOUND THEN RETURN jsonb_build_object('shipment_id',existing.id,'shipment_code',existing.shipment_code,'success',true); END IF;
    IF p_direction='to_lab' THEN
        IF p_area IS NULL THEN RAISE EXCEPTION 'اختار منطقة الشحن من القائمة قبل الحفظ'; END IF;
        IF p_doctor IS NULL THEN RAISE EXCEPTION 'اختار الطبيب قبل الحفظ'; END IF;
        IF p_courier IS NULL AND p_expense IS NULL AND NOT p_scooter_pending THEN
            RAISE EXCEPTION 'اختار شركة شحن أو طريقة سداد السكوتر';
        END IF;
    END IF;
    IF nullif(btrim(p_patient),'') IS NOT NULL OR (p_scooter_pending AND p_direction='to_lab') THEN
        IF p_direction IS DISTINCT FROM 'to_lab' OR p_area IS NULL OR p_doctor IS NULL
            OR (p_courier IS NULL AND p_expense IS NULL AND NOT p_scooter_pending)
            OR (nullif(btrim(p_patient),'') IS NULL AND coalesce(cardinality(p_orders),0)=0)
            OR (nullif(btrim(p_patient),'') IS NOT NULL AND coalesce(cardinality(p_orders),0)>0)
            OR EXISTS(SELECT 1 FROM unnest(p_orders) item(id) LEFT JOIN public.orders o ON o.id=item.id
                WHERE o.id IS NULL OR o.doctor_id IS DISTINCT FROM p_doctor OR o.is_deleted) THEN
            RAISE EXCEPTION 'راجع بيانات الاستلام والأوردرات';
        END IF;
        IF p_courier IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=p_courier AND supplier_type='courier') THEN
            RAISE EXCEPTION 'اختار شركة شحن';
        END IF;
        SELECT amount INTO rate FROM public.courier_area_rates WHERE courier_id=p_courier AND area=p_area AND is_current;
        IF p_expense IS NOT NULL THEN
            IF public.get_my_role() NOT IN ('admin','accountant','coordinator') THEN RAISE EXCEPTION 'ربط المصروف لفريق الحسابات والتنسيق' USING ERRCODE='42501'; END IF;
            SELECT amount INTO rate FROM public.transactions WHERE id=p_expense AND type='expense'
                AND (entity_type IS NULL OR entity_type='general') AND category IN ('shipping','شحن وتوصيل')
                AND coalesce(status,CASE WHEN is_approved THEN 'approved' END)='approved' AND amount>0 FOR SHARE;
            IF NOT FOUND OR p_courier IS NOT NULL THEN RAISE EXCEPTION 'اختار مصروف شحن معتمد'; END IF;
        END IF;
        code:=public.generate_shipment_code();
        INSERT INTO public.shipments(id,shipping_request_id,shipment_code,courier_id,doctor_id,tracking_ref,notes,direction,
            shipping_area,base_shipping_cost,cost_amount,immediate_expense_id,scooter_payment_pending,intake_patient_name,intake_branch_name,created_by)
        VALUES(p_id,p_id,code,p_courier,p_doctor,p_tracking,p_notes,'to_lab',p_area,
            CASE WHEN p_expense IS NULL THEN rate END,CASE WHEN p_expense IS NOT NULL THEN rate END,p_expense,p_scooter_pending,
            nullif(btrim(p_patient),''),nullif(btrim(p_branch),''),auth.uid());
        INSERT INTO public.shipment_orders(shipment_id,order_id) SELECT p_id,id FROM (SELECT DISTINCT unnest(p_orders) AS id) orders;
        RETURN jsonb_build_object('success',true,'shipment_id',p_id,'shipment_code',code);
    END IF;
    response:=public.create_priced_shipment(p_id,p_courier,p_doctor,p_tracking,p_orders,p_photos,p_recipient,p_phone,p_address,p_notes,p_area,p_direction,p_expense);
    IF p_scooter_pending THEN
        UPDATE public.shipments SET scooter_payment_pending=true WHERE id=(response->>'shipment_id')::uuid;
    END IF;
    RETURN response;
END $$;

CREATE FUNCTION public.confirm_shipping_request(p_id uuid,p_photo text,p_at timestamptz,p_notes text,p_amount numeric,p_cashbox uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE trip public.shipments%ROWTYPE; payment jsonb; order_id uuid; response jsonb;
BEGIN
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','production_manager','coordinator') THEN RAISE EXCEPTION 'غير مسموح بتأكيد الاستلام' USING ERRCODE='42501'; END IF;
    SELECT * INTO trip FROM public.shipments WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'الشحنة غير موجودة'; END IF;
    IF trip.status='delivered' THEN RETURN jsonb_build_object('success',true,'orders_delivered',0,'orders_skipped','[]'::jsonb); END IF;
    IF trip.scooter_payment_pending THEN
        IF public.get_my_role() NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'تسجيل مصروف السكوتر للأدمن والمنسق' USING ERRCODE='42501'; END IF;
        IF p_amount IS NULL OR p_amount<=0 OR p_amount>=10000000000 OR p_amount<>round(p_amount,2)
            OR NOT EXISTS(SELECT 1 FROM public.cashboxes WHERE id=p_cashbox AND is_active) THEN
            RAISE EXCEPTION 'حدد مبلغ السكوتر ومحفظة السداد';
        END IF;
        payment:=public.create_finance_transaction_atomic('expense',p_amount,'شحن وتوصيل','سكوتر · '||trip.shipment_code,
            (now() AT TIME ZONE 'Africa/Cairo')::date,NULL,'general',NULL,p_cashbox,'approved',0,NULL);
        UPDATE public.shipments SET immediate_expense_id=(payment->>'id')::uuid,cost_amount=p_amount,scooter_payment_pending=false WHERE id=p_id;
    END IF;
    PERFORM set_config('app.confirm_shipping_request',p_id::text,true);
    response:=public.confirm_shipment_delivery(p_id,p_photo,p_at,p_notes);
    PERFORM set_config('app.confirm_shipping_request','',true);
    IF trip.intake_patient_name IS NOT NULL THEN
        INSERT INTO public.orders(case_id,doctor_id,branch_name,patient_name,items,total_price,cost,shade,delivery_date,production_status,intake_state)
        VALUES('IN-'||trip.shipment_code,trip.doctor_id,trip.intake_branch_name,trip.intake_patient_name,'[]',0,0,'',
            (now() AT TIME ZONE 'Africa/Cairo')::date,'not_started','pending_review') RETURNING id INTO order_id;
        INSERT INTO public.shipment_orders(shipment_id,order_id) VALUES(p_id,order_id);
    END IF;
    RETURN response;
END $$;

DO $$
DECLARE
 definition text:=pg_get_functiondef('public.confirm_shipment_delivery(uuid,text,timestamptz,text)'::regprocedure);
 anchor text:=$q$    IF v_shipment.status = 'delivered' THEN$q$;
BEGIN
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected shipping confirmation definition'; END IF;
    EXECUTE replace(definition,anchor,$q$    IF v_shipment.scooter_payment_pending THEN
        RAISE EXCEPTION 'حدد مبلغ السكوتر ومحفظة السداد قبل تأكيد الاستلام';
    END IF;
    IF v_shipment.intake_patient_name IS NOT NULL AND v_shipment.status <> 'delivered'
        AND current_setting('app.confirm_shipping_request',true) IS DISTINCT FROM v_shipment.id::text THEN
        RAISE EXCEPTION 'أكد استلام المقاس من طلب الشحن';
    END IF;
$q$||anchor);
END $$;

REVOKE ALL ON FUNCTION public.save_courier_area_rate(uuid,text,numeric,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.add_shipping_area(text),public.save_courier_area_rate(uuid,text,numeric),
    public.create_shipping_request(uuid,uuid,uuid,text,uuid[],text[],text,text,text,text,text,text,uuid,boolean,text,text),
    public.confirm_shipping_request(uuid,text,timestamptz,text,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_shipping_area(text),public.save_courier_area_rate(uuid,text,numeric),
    public.create_shipping_request(uuid,uuid,uuid,text,uuid[],text[],text,text,text,text,text,text,uuid,boolean,text,text),
    public.confirm_shipping_request(uuid,text,timestamptz,text,numeric,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
