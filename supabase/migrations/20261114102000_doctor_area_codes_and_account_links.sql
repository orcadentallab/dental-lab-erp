BEGIN;

ALTER TABLE public.shipping_areas ADD COLUMN doctor_code_prefix integer
    CHECK (doctor_code_prefix IN (1,2,3,5,6));
-- Established regional groups. The remaining mappings require the approved workbook.
UPDATE public.shipping_areas SET doctor_code_prefix=2 WHERE name IN ('العاشر من رمضان','العبور','الشروق');
UPDATE public.shipping_areas SET doctor_code_prefix=3 WHERE name IN ('أكتوبر','6 أكتوبر','الشيخ زايد','الشيخ زايد - بيفرلي هيلز');
INSERT INTO public.shipping_areas(name,doctor_code_prefix) VALUES ('دمياط',5)
ON CONFLICT (name) DO UPDATE SET doctor_code_prefix=excluded.doctor_code_prefix;

ALTER TABLE public.doctors ADD COLUMN merged_into uuid REFERENCES public.doctors(id),
    ADD CONSTRAINT doctor_cannot_merge_into_self CHECK (merged_into IS DISTINCT FROM id);
CREATE INDEX doctors_merged_into_idx ON public.doctors(merged_into) WHERE merged_into IS NOT NULL;

CREATE FUNCTION public.assign_new_doctor_code() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prefix integer; floor_number integer; next_number integer; center public.doctors%ROWTYPE;
BEGIN
    IF nullif(btrim(NEW.doctor_code),'') IS NOT NULL THEN RETURN NEW; END IF;
    IF NEW.parent_id IS NOT NULL THEN
        SELECT * INTO center FROM public.doctors WHERE id=NEW.parent_id FOR UPDATE;
        IF NOT FOUND OR center.is_center IS DISTINCT FROM true OR center.merged_into IS NOT NULL THEN
            RAISE EXCEPTION 'اختار مركزًا فعالًا';
        END IF;
        SELECT min(candidate) INTO next_number FROM generate_series(1,999) candidate
        WHERE NOT EXISTS (
            SELECT 1 FROM public.doctors d
            WHERE starts_with(d.doctor_code,center.doctor_code||'-')
              AND ltrim(substring(d.doctor_code,length(center.doctor_code)+2),'0')=candidate::text
        );
        IF next_number IS NULL THEN RAISE EXCEPTION 'نطاق أكواد المركز اكتمل'; END IF;
        NEW.doctor_code := center.doctor_code||'-'||lpad(next_number::text,greatest(2,length(next_number::text)),'0');
    ELSE
        SELECT doctor_code_prefix INTO prefix FROM public.shipping_areas WHERE name=NEW.shipping_area;
        IF prefix IS NULL THEN RAISE EXCEPTION 'اختار منطقة لها نطاق كود معتمد'; END IF;
        PERFORM pg_advisory_xact_lock(hashtext('doctor regional codes'),prefix);
        floor_number := CASE prefix WHEN 1 THEN 1061 WHEN 2 THEN 2030 ELSE prefix*1000 END;
        SELECT greatest(floor_number,coalesce(max(doctor_code::integer),0))+1 INTO next_number
        FROM public.doctors WHERE doctor_code ~ ('^'||prefix||'[0-9]{3}$');
        IF next_number>prefix*1000+999 THEN RAISE EXCEPTION 'نطاق أكواد المنطقة اكتمل'; END IF;
        NEW.doctor_code := next_number::text;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.assign_new_doctor_code() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER assign_new_doctor_code BEFORE INSERT ON public.doctors
FOR EACH ROW EXECUTE FUNCTION public.assign_new_doctor_code();

CREATE FUNCTION public.merge_doctor_account(p_source uuid,p_target uuid,p_delivery_name text DEFAULT NULL,p_copy_special_prices boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source public.doctors%ROWTYPE; target public.doctors%ROWTYPE;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'دمج حسابات الأطباء للأدمن فقط' USING ERRCODE='42501';
    END IF;
    IF p_source IS NULL OR p_target IS NULL OR p_source=p_target THEN
        RAISE EXCEPTION 'اختار حسابين مختلفين';
    END IF;
    PERFORM 1 FROM public.doctors WHERE id IN (p_source,p_target) ORDER BY id FOR UPDATE;
    SELECT * INTO source FROM public.doctors WHERE id=p_source;
    SELECT * INTO target FROM public.doctors WHERE id=p_target;
    IF source.id IS NULL OR target.id IS NULL THEN RAISE EXCEPTION 'حساب غير موجود'; END IF;
    IF source.merged_into=p_target AND target.merged_into IS NULL THEN RETURN; END IF;
    IF source.merged_into IS NOT NULL OR target.merged_into IS NOT NULL OR source.parent_id IS NOT NULL
       OR target.parent_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM public.doctors WHERE parent_id=p_source OR merged_into=p_source
       ) THEN RAISE EXCEPTION 'راجع علاقات الحسابات قبل الدمج'; END IF;
    IF EXISTS (SELECT 1 FROM public.users WHERE role='doctor' AND entity_id=p_source)
       OR (coalesce(source.custom_prices,'{}'::jsonb)<>'{}'::jsonb
           AND source.custom_prices IS DISTINCT FROM target.custom_prices
           AND (p_copy_special_prices IS DISTINCT FROM true OR coalesce(target.custom_prices,'{}'::jsonb)<>'{}'::jsonb))
       OR jsonb_array_length(coalesce(source.branches,'[]'::jsonb))>0 THEN
        RAISE EXCEPTION 'راجع صلاحيات الدخول أو الأسعار الخاصة أو الفروع قبل الدمج';
    END IF;
    IF nullif(btrim(p_delivery_name),'') IS NOT NULL THEN
        IF nullif(btrim(source.address),'') IS NULL THEN RAISE EXCEPTION 'عنوان الحساب القديم غير موجود'; END IF;
        UPDATE public.doctors SET address=source.address, shipping_area=coalesce(source.shipping_area,target.shipping_area) WHERE id=p_target;
    END IF;
    IF p_copy_special_prices AND coalesce(target.custom_prices,'{}'::jsonb)='{}'::jsonb
       AND coalesce(source.custom_prices,'{}'::jsonb)<>'{}'::jsonb THEN
        UPDATE public.doctors SET custom_prices=source.custom_prices WHERE id=p_target;
    END IF;
    UPDATE public.doctors SET merged_into=p_target WHERE id=p_source;
END $$;
REVOKE ALL ON FUNCTION public.merge_doctor_account(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.merge_doctor_account(uuid,uuid,text,boolean) TO authenticated;

-- Preserve the record for historical documents. Only the merge function may alter the link.
CREATE FUNCTION public.guard_doctor_merge_link() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
    IF NEW.merged_into IS DISTINCT FROM OLD.merged_into AND current_user IN ('authenticated','anon') THEN
        RAISE EXCEPTION 'استخدم مسار دمج حسابات الأطباء' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER guard_doctor_merge_link BEFORE UPDATE OF merged_into ON public.doctors
FOR EACH ROW EXECUTE FUNCTION public.guard_doctor_merge_link();

CREATE FUNCTION public.guard_merged_doctor_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF TG_OP='UPDATE' AND NEW.doctor_id IS NOT DISTINCT FROM OLD.doctor_id THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM public.doctors WHERE id=NEW.doctor_id AND merged_into IS NOT NULL) THEN
        RAISE EXCEPTION 'الحساب مدموج. اختار الحساب الحالي';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_merged_doctor_order() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_merged_doctor_order BEFORE INSERT OR UPDATE OF doctor_id ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_merged_doctor_order();

NOTIFY pgrst,'reload schema';
COMMIT;
