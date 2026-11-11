BEGIN;

ALTER TABLE public.adjustments
    ADD COLUMN shipping_order_id uuid REFERENCES public.orders(id),
    ADD COLUMN service_charge_kind text CHECK (service_charge_kind IN ('shipping','scan_visit')),
    ADD CONSTRAINT adjustment_shipping_once UNIQUE (shipping_order_id);

CREATE TABLE public.scan_visits (
    id uuid PRIMARY KEY,
    doctor_id uuid NOT NULL REFERENCES public.doctors(id),
    representative_id uuid NOT NULL REFERENCES public.users(id),
    scanner_id uuid NOT NULL REFERENCES public.machines(id),
    branch text,
    visited_at timestamptz NOT NULL,
    visit_minutes integer NOT NULL CHECK (visit_minutes > 0),
    scan_minutes integer NOT NULL CHECK (scan_minutes >= 0 AND scan_minutes <= visit_minutes),
    notes text,
    fee numeric(12,2) NOT NULL CHECK (fee >= 0),
    adjustment_id uuid UNIQUE REFERENCES public.adjustments(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((fee > 0) = (adjustment_id IS NOT NULL))
);

ALTER TABLE public.scan_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scan_visits FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.scan_visits TO authenticated;
CREATE POLICY scan_visits_staff_read ON public.scan_visits FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin','accountant','coordinator'));

CREATE FUNCTION public.add_doctor_shipping_charge(p_order uuid,p_amount numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    case_row public.orders%ROWTYPE;
    charge_id uuid;
BEGIN
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','accountant','coordinator') THEN
        RAISE EXCEPTION 'غير مسموح بتسجيل رسوم الشحن' USING ERRCODE='42501';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount >= 10000000000 OR p_amount<>round(p_amount,2) THEN
        RAISE EXCEPTION 'أدخل مبلغ شحن صحيحًا';
    END IF;
    SELECT * INTO case_row FROM public.orders WHERE id=p_order AND NOT is_deleted FOR UPDATE;
    IF NOT FOUND OR case_row.doctor_id IS NULL OR coalesce(case_row.issue_state,'none') IN ('cancelled','rejected') THEN
        RAISE EXCEPTION 'الأوردر غير متاح لإضافة رسوم الشحن';
    END IF;
    INSERT INTO public.adjustments(entity_type,entity_id,type,amount,date,reason,created_by,shipping_order_id,service_charge_kind)
    VALUES ('doctor',case_row.doctor_id,'charge',p_amount,(now() AT TIME ZONE 'Africa/Cairo')::date,
            'رسوم شحن · '||case_row.case_id,auth.uid(),p_order,'shipping')
    ON CONFLICT (shipping_order_id) DO NOTHING RETURNING id INTO charge_id;
    IF charge_id IS NULL THEN
        SELECT id INTO charge_id FROM public.adjustments WHERE shipping_order_id=p_order AND amount=p_amount;
        IF charge_id IS NULL THEN RAISE EXCEPTION 'رسوم الشحن مسجلة بالفعل لهذا الأوردر'; END IF;
    END IF;
    RETURN charge_id;
END;
$$;

CREATE FUNCTION public.record_scan_visit(p_id uuid,p_doctor uuid,p_representative uuid,p_scanner uuid,
    p_branch text,p_visited_at timestamptz,p_visit_minutes integer,p_scan_minutes integer,p_notes text,p_fee numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    charge_id uuid;
BEGIN
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','accountant','coordinator') THEN
        RAISE EXCEPTION 'غير مسموح بتسجيل زيارة سكان' USING ERRCODE='42501';
    END IF;
    IF p_id IS NULL OR p_visited_at IS NULL OR p_visit_minutes IS NULL OR p_visit_minutes<=0
       OR p_scan_minutes IS NULL OR p_scan_minutes<0 OR p_scan_minutes>p_visit_minutes
       OR p_fee IS NULL OR p_fee<0 OR p_fee>=10000000000 OR p_fee<>round(p_fee,2) THEN
        RAISE EXCEPTION 'راجع مدة الزيارة ووقت السكان والرسوم';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
    IF EXISTS (SELECT 1 FROM public.scan_visits WHERE id=p_id) THEN RETURN p_id; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.doctors WHERE id=p_doctor)
       OR NOT EXISTS (SELECT 1 FROM public.users WHERE id=p_representative AND role='representative' AND is_active)
       OR NOT EXISTS (SELECT 1 FROM public.machines WHERE id=p_scanner AND is_active) THEN
        RAISE EXCEPTION 'اختر الطبيب والمندوب والجهاز من القوائم';
    END IF;
    IF p_fee>0 THEN
        INSERT INTO public.adjustments(entity_type,entity_id,type,amount,date,reason,created_by,service_charge_kind)
        VALUES ('doctor',p_doctor,'charge',p_fee,(now() AT TIME ZONE 'Africa/Cairo')::date,
                'رسوم زيارة سكان · '||left(p_id::text,8),auth.uid(),'scan_visit') RETURNING id INTO charge_id;
    END IF;
    INSERT INTO public.scan_visits(id,doctor_id,representative_id,scanner_id,branch,visited_at,visit_minutes,scan_minutes,notes,fee,adjustment_id)
    VALUES (p_id,p_doctor,p_representative,p_scanner,nullif(btrim(p_branch),''),p_visited_at,
            p_visit_minutes,p_scan_minutes,nullif(btrim(p_notes),''),p_fee,charge_id);
    RETURN p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_doctor_shipping_charge(uuid,numeric),
    public.record_scan_visit(uuid,uuid,uuid,uuid,text,timestamptz,integer,integer,text,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.add_doctor_shipping_charge(uuid,numeric),
    public.record_scan_visit(uuid,uuid,uuid,uuid,text,timestamptz,integer,integer,text,numeric) TO authenticated;
UPDATE public.services SET is_active=false WHERE name='Scanner Rent';
NOTIFY pgrst, 'reload schema';
COMMIT;
