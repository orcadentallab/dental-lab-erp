BEGIN;
CREATE OR REPLACE FUNCTION public.design_qc_can_read_files(p_order_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
 SELECT public.get_my_role() IS NOT NULL AND (public.design_qc_can_read(p_order_id) OR
 (public.get_my_role() IN('production_manager','technician') AND EXISTS(SELECT 1 FROM public.production_jobs j JOIN public.production_stage_runs r ON r.job_id=j.id WHERE j.order_id=p_order_id AND (r.assignee_id=public.get_my_user_id() OR public.get_my_role()='production_manager'))) OR
 (public.get_my_role()='lab' AND EXISTS(SELECT 1 FROM public.orders o JOIN public.users u ON u.id=public.get_my_user_id() WHERE o.id=p_order_id AND o.supplier_id=u.entity_id AND NOT coalesce(o.is_deleted,false))))
$$;
CREATE OR REPLACE FUNCTION public.design_qc_can_read(p_order_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
 SELECT public.get_my_role() IS NOT NULL AND (public.get_my_role() IN('admin','coordinator') OR EXISTS(SELECT 1 FROM public.orders o WHERE o.id=p_order_id AND NOT coalesce(o.is_deleted,false) AND o.designer_id=public.get_my_user_id() AND (public.get_my_role()='designer' OR public.get_my_custom_permission('secondary_designer'))))
$$;
CREATE OR REPLACE FUNCTION public.get_design_execution_path(p_order_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE v_path text;
BEGIN
 SELECT r.execution_path INTO v_path FROM public.design_revisions r JOIN public.orders o ON o.design_qc_revision_id=r.id WHERE o.id=p_order_id;
 -- Legacy links retain their existing access path; no new case content is returned.
 IF v_path IS NULL THEN RETURN NULL; END IF;
 IF NOT coalesce(public.design_qc_can_read_files(p_order_id),false) THEN RAISE EXCEPTION 'Design access denied' USING ERRCODE='42501'; END IF;
 RETURN v_path;
END $$;
UPDATE storage.buckets SET file_size_limit=52428800 WHERE id='design-qc-files';
DO $$ DECLARE v text; BEGIN
 SELECT pg_get_functiondef('public.submit_design_revision(uuid,uuid,text,text)'::regprocedure) INTO v;
 EXECUTE replace(v,'BETWEEN 1 AND 104857600','BETWEEN 1 AND 52428800');
END $$;
COMMIT;
