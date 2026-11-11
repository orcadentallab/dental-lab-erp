BEGIN;

ALTER TABLE public.scan_visits
    ADD COLUMN case_count integer CHECK (case_count > 0),
    ALTER COLUMN scan_minutes DROP NOT NULL;

CREATE POLICY scan_visits_representative_read ON public.scan_visits FOR SELECT TO authenticated
    USING (public.get_my_role()='representative' AND representative_id=public.get_my_user_id());

DO $$
DECLARE
    definition text := pg_get_functiondef('public.record_scan_visit(uuid,uuid,uuid,uuid,text,timestamptz,integer,integer,text,numeric)'::regprocedure);
    original text := $old$IF coalesce(public.get_my_role(),'') NOT IN ('admin','accountant','coordinator') THEN$old$;
BEGIN
    IF strpos(definition,original)=0 THEN RAISE EXCEPTION 'Unexpected scan visit authorization'; END IF;
    EXECUTE replace(definition,original,$new$IF coalesce(public.get_my_role(),'') NOT IN ('admin','accountant','coordinator')
       AND (public.get_my_role() IS DISTINCT FROM 'representative' OR p_representative IS DISTINCT FROM public.get_my_user_id()) THEN$new$);
END;
$$;

CREATE FUNCTION public.record_scan_visit_summary(p_id uuid,p_doctor uuid,p_representative uuid,p_scanner uuid,
    p_branch text,p_visit_minutes integer,p_case_count integer,p_notes text,p_fee numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','accountant','coordinator')
       AND (public.get_my_role() IS DISTINCT FROM 'representative' OR p_representative IS DISTINCT FROM public.get_my_user_id()) THEN
        RAISE EXCEPTION 'غير مسموح بتسجيل زيارة سكان' USING ERRCODE='42501';
    END IF;
    IF p_case_count IS NULL OR p_case_count<=0 THEN RAISE EXCEPTION 'أدخل عدد الحالات'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
    IF EXISTS (SELECT 1 FROM public.scan_visits WHERE id=p_id) THEN RETURN p_id; END IF;
    PERFORM public.record_scan_visit(p_id,p_doctor,p_representative,p_scanner,p_branch,now(),p_visit_minutes,0,p_notes,p_fee);
    UPDATE public.scan_visits SET case_count=p_case_count,scan_minutes=NULL WHERE id=p_id AND case_count IS NULL;
    RETURN p_id;
END;
$$;

CREATE FUNCTION public.get_scan_visit_devices()
RETURNS TABLE (id uuid,name_ar text,is_active boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT m.id,m.name_ar,m.is_active FROM public.machines m
    WHERE public.get_my_role() IN ('admin','accountant','coordinator','representative')
    ORDER BY m.name_ar,m.id;
$$;

REVOKE ALL ON FUNCTION public.record_scan_visit_summary(uuid,uuid,uuid,uuid,text,integer,integer,text,numeric),
    public.get_scan_visit_devices() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_scan_visit_summary(uuid,uuid,uuid,uuid,text,integer,integer,text,numeric),
    public.get_scan_visit_devices() TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
