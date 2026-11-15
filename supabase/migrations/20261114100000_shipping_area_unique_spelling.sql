BEGIN;

CREATE OR REPLACE FUNCTION public.add_shipping_area(p_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    area_name text := btrim(regexp_replace(p_name, '[[:space:]]+', ' ', 'g'));
    area_key text := lower(translate(area_name, 'أإآىـ', 'اااي'));
    existing_name text;
BEGIN
    IF coalesce(public.get_my_role(), '') NOT IN ('admin', 'representative', 'coordinator') THEN
        RAISE EXCEPTION 'إضافة المناطق تتطلب صلاحية إضافة طبيب' USING ERRCODE='42501';
    END IF;
    IF area_name IS NULL OR length(area_name) NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'راجع اسم المنطقة';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('shipping_areas'), hashtext(area_key));
    SELECT name INTO existing_name FROM public.shipping_areas
    WHERE lower(translate(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')), 'أإآىـ', 'اااي'))=area_key
    ORDER BY name LIMIT 1;
    IF existing_name IS NOT NULL THEN
        IF existing_name = area_name THEN RETURN; END IF;
        RAISE EXCEPTION 'المنطقة مسجلة باسم «%»', existing_name;
    END IF;
    INSERT INTO public.shipping_areas(name) VALUES (area_name);
END $$;

COMMIT;
