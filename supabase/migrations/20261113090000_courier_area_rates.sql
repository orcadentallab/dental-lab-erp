BEGIN;

CREATE TABLE public.courier_area_rates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    courier_id uuid NOT NULL REFERENCES public.suppliers(id),
    area text NOT NULL CHECK (length(btrim(area)) BETWEEN 1 AND 100),
    amount numeric(12,2) NOT NULL CHECK (amount>=0),
    effective_month date NOT NULL CHECK (extract(day FROM effective_month)=1)
);
CREATE UNIQUE INDEX courier_area_rate_month_key
ON public.courier_area_rates(courier_id,lower(area),effective_month);

CREATE TABLE public.courier_shipment_areas (
    shipment_id uuid PRIMARY KEY REFERENCES public.shipments(id) ON DELETE CASCADE,
    rate_id uuid NOT NULL REFERENCES public.courier_area_rates(id)
);
ALTER TABLE public.courier_area_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_shipment_areas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.courier_area_rates,public.courier_shipment_areas FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_courier_area_rates(p_courier uuid,p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','accountant','coordinator') THEN
        RAISE EXCEPTION 'أسعار الشحن لفريق الحسابات والتنسيق' USING ERRCODE='42501';
    END IF;
    RETURN jsonb_build_object(
      'rates',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.area) FROM (
          SELECT DISTINCT ON (lower(area)) id,area,amount FROM public.courier_area_rates
          WHERE courier_id=p_courier AND effective_month<=date_trunc('month',p_month)::date
          ORDER BY lower(area),effective_month DESC
      ) r),'[]'),
      'assignments',coalesce((SELECT jsonb_object_agg(a.shipment_id,jsonb_build_object('id',r.id,'area',r.area,'amount',r.amount))
          FROM public.courier_shipment_areas a JOIN public.courier_area_rates r ON r.id=a.rate_id
          JOIN public.shipments s ON s.id=a.shipment_id AND s.courier_id=r.courier_id
          WHERE s.courier_id=p_courier
          AND date_trunc('month',coalesce(s.dispatched_at,s.delivered_at,s.created_at) AT TIME ZONE 'Africa/Cairo')::date=date_trunc('month',p_month)::date),'{}')
    );
END $$;

CREATE FUNCTION public.save_courier_area_rate(p_courier uuid,p_area text,p_amount numeric,p_month date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'تعديل أسعار المناطق للأدمن فقط' USING ERRCODE='42501';
    END IF;
    IF p_area IS NULL OR length(btrim(p_area)) NOT BETWEEN 1 AND 100 OR p_amount IS NULL
       OR p_amount<0 OR p_amount>=10000000000 OR p_amount<>round(p_amount,2) OR p_month IS NULL THEN
        RAISE EXCEPTION 'راجع اسم المنطقة والسعر وشهر السريان';
    END IF;
    PERFORM 1 FROM public.suppliers WHERE id=p_courier AND supplier_type='courier' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'اختار شركة شحن'; END IF;
    INSERT INTO public.courier_area_rates(courier_id,area,amount,effective_month)
    VALUES(p_courier,btrim(p_area),p_amount,date_trunc('month',p_month)::date)
    ON CONFLICT(courier_id,lower(area),effective_month) DO UPDATE SET amount=excluded.amount
    WHERE NOT EXISTS (SELECT 1 FROM public.courier_shipment_areas WHERE rate_id=public.courier_area_rates.id)
    RETURNING id INTO result;
    IF result IS NULL THEN RAISE EXCEPTION 'السعر مستخدم. اختار شهر سريان جديد'; END IF;
    RETURN result;
END $$;

CREATE FUNCTION public.assign_courier_shipment_area(p_shipment uuid,p_rate uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE shipment public.shipments%ROWTYPE; month_start date; supplier_id uuid;
BEGIN
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','accountant','coordinator') THEN
        RAISE EXCEPTION 'تحديد منطقة الشحن لفريق الحسابات والتنسيق' USING ERRCODE='42501';
    END IF;
    SELECT courier_id INTO supplier_id FROM public.shipments WHERE id=p_shipment;
    PERFORM 1 FROM public.suppliers WHERE id=supplier_id AND supplier_type='courier' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'الشحنة غير متاحة'; END IF;
    SELECT * INTO shipment FROM public.shipments WHERE id=p_shipment AND courier_id=supplier_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'الشحنة غير متاحة'; END IF;
    month_start:=date_trunc('month',coalesce(shipment.dispatched_at,shipment.delivered_at,shipment.created_at) AT TIME ZONE 'Africa/Cairo')::date;
    IF EXISTS(SELECT 1 FROM public.courier_monthly_invoices WHERE courier_id=shipment.courier_id
       AND period_month=month_start AND status='confirmed') THEN RAISE EXCEPTION 'الفاتورة معتمدة بالفعل'; END IF;
    IF p_rate IS NULL THEN
        DELETE FROM public.courier_shipment_areas WHERE shipment_id=p_shipment;
        RETURN;
    END IF;
    PERFORM 1 FROM public.courier_area_rates WHERE id=p_rate AND courier_id=shipment.courier_id
      AND effective_month<=month_start FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'السعر غير ساري للشركة أو الشهر'; END IF;
    INSERT INTO public.courier_shipment_areas(shipment_id,rate_id) VALUES(p_shipment,p_rate)
    ON CONFLICT(shipment_id) DO UPDATE SET rate_id=excluded.rate_id;
END $$;

REVOKE ALL ON FUNCTION public.get_courier_area_rates(uuid,date),public.save_courier_area_rate(uuid,text,numeric,date),
    public.assign_courier_shipment_area(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_courier_area_rates(uuid,date),public.save_courier_area_rate(uuid,text,numeric,date),
    public.assign_courier_shipment_area(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
