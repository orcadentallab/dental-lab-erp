-- Doctors choose service names; internal cost prices remain staff-only.
CREATE POLICY portal_service_costs_private ON public.services AS RESTRICTIVE FOR SELECT TO authenticated USING(public.get_my_role() IS NOT NULL AND public.get_my_role()<>'doctor');
CREATE POLICY portal_route_estimates_private ON public.production_routes AS RESTRICTIVE FOR SELECT TO authenticated USING(public.get_my_role() IS NOT NULL AND public.get_my_role()<>'doctor');
CREATE POLICY portal_stage_estimates_private ON public.production_stages AS RESTRICTIVE FOR SELECT TO authenticated USING(public.get_my_role() IS NOT NULL AND public.get_my_role()<>'doctor');
CREATE POLICY portal_route_stage_estimates_private ON public.production_route_stages AS RESTRICTIVE FOR SELECT TO authenticated USING(public.get_my_role() IS NOT NULL AND public.get_my_role()<>'doctor');
CREATE FUNCTION public.get_doctor_portal_catalog()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'familyId',s.family_id) ORDER BY s.name),'[]'::jsonb)
 FROM public.services s WHERE public.get_my_role()='doctor';
$$;
REVOKE ALL ON FUNCTION public.get_doctor_portal_catalog() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_doctor_portal_catalog() TO authenticated;
NOTIFY pgrst,'reload schema';
