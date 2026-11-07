BEGIN;
-- Match the six states already used by the designer UI and V2 RPCs. Unknown
-- states remain invalid; no order is rewritten and no finance rule changes.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_design_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_design_status_check CHECK(design_status IN('pending','accepted','in_progress','waiting_approval','completed','returned'));
-- Primary designers read an explicit technical/personal-finance projection.
-- Other operational roles retain their existing policies and responsibilities.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['orders','order_items','order_comments','order_history','order_events','suppliers','doctors','services','design_qc_assignments'] LOOP
 EXECUTE format('CREATE POLICY designer_projection_only ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING(public.get_my_role() IS DISTINCT FROM ''designer'')',t);
 END LOOP;
END $$;
CREATE POLICY designer_own_profile ON public.users AS RESTRICTIVE FOR SELECT TO authenticated USING(public.get_my_role() IS DISTINCT FROM 'designer' OR id=public.get_my_user_id());
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.get_dashboard_data()'::regprocedure) INTO definition;
 IF strpos(definition,'RETURN public.get_dashboard_data_privileged_20260801();')=0 THEN RAISE EXCEPTION 'Unexpected dashboard reader contract'; END IF;
 EXECUTE replace(definition,'RETURN public.get_dashboard_data_privileged_20260801();','IF public.get_my_role()=''designer'' THEN RAISE EXCEPTION ''Designer cannot read commercial dashboard'' USING ERRCODE=''42501''; END IF; RETURN public.get_dashboard_data_privileged_20260801();');
END $$;
CREATE FUNCTION public.designer_can_read_case_asset(p_bucket text,p_path text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
 SELECT public.get_my_role()='designer' AND EXISTS(SELECT 1 FROM public.orders o WHERE o.designer_id=public.get_my_user_id() AND NOT coalesce(o.is_deleted,false) AND (o.id::text=split_part(p_path,'/',1) OR EXISTS(SELECT 1 FROM public.order_attachments a WHERE a.order_id=o.id AND a.storage_bucket=p_bucket AND a.storage_path=p_path)))
$$;
CREATE POLICY designer_case_asset_scope ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING(public.get_my_role() IS DISTINCT FROM 'designer' OR bucket_id NOT IN('case-scans','case-files') OR public.designer_can_read_case_asset(bucket_id,name));
CREATE POLICY designer_case_asset_write_scope ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.get_my_role() IS DISTINCT FROM 'designer' OR bucket_id NOT IN('case-scans','case-files') OR public.designer_can_read_case_asset(bucket_id,name));
CREATE POLICY designer_attachment_scope ON public.order_attachments AS RESTRICTIVE FOR SELECT TO authenticated USING(public.get_my_role() IS DISTINCT FROM 'designer' OR public.design_qc_can_read(order_id));

CREATE FUNCTION public.record_designer_technical_rejection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.event_type='designer_rejection_requested' AND NEW.changed_by IS NOT NULL THEN
 INSERT INTO public.order_comments(order_id,content,user_id,user_name,created_at)
 SELECT NEW.order_id,'[رفض المصمم]: '||coalesce(NEW.reason,NEW.notes,''),u.id,u.name,NEW.created_at FROM public.users u WHERE u.id=NEW.changed_by;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_designer_technical_rejection() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER record_designer_technical_rejection AFTER INSERT ON public.order_events FOR EACH ROW EXECUTE FUNCTION public.record_designer_technical_rejection();

CREATE FUNCTION public.get_designer_workspace(p_order_id uuid DEFAULT NULL,p_finance boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE result jsonb;
BEGIN
 IF public.get_my_role() IS DISTINCT FROM 'designer' THEN RAISE EXCEPTION 'Designer role required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(row ORDER BY created_at DESC,id),'[]'::jsonb) INTO result FROM (
 SELECT o.id,o.created_at,
 CASE WHEN p_finance THEN jsonb_build_object('id',o.id,'case_id',o.case_id,'designer_id',o.designer_id,'workflow_type',o.workflow_type,'design_price',o.design_price,'manual_design_price',o.manual_design_price,'designer_cost',o.designer_cost,'design_status',o.design_status,'created_at',o.created_at,'design_submitted_at',o.design_submitted_at,'actual_delivery_date',o.actual_delivery_date,'delivery_date',o.delivery_date,'production_status',o.production_status,'issue_state',o.issue_state,'intake_state',o.intake_state,'rejected_designer_cost',o.rejected_designer_cost,'rejected_designer_cost_status',o.rejected_designer_cost_status,'is_redo',o.is_redo,'original_order_id',o.original_order_id,'is_archived',o.is_archived,'is_deleted',o.is_deleted)
 ELSE jsonb_build_object('id',o.id,'case_id',o.case_id,'patient_name',o.patient_name,'shade',o.shade,'designer_id',o.designer_id,'workflow_type',o.workflow_type,'design_status',o.design_status,'design_url',o.design_url,'stl_url',o.stl_url,'images_url',o.images_url,'delivery_date',o.delivery_date,'created_at',o.created_at,'production_status',o.production_status,'issue_state',o.issue_state,'intake_state',o.intake_state,'technician_status',o.technician_status,'is_archived',o.is_archived,'is_deleted',o.is_deleted,'priority',o.priority,'is_urgent',o.is_urgent,'design_submitted_at',o.design_submitted_at,'needs_design_review',o.needs_design_review,'design_price',o.design_price)
 ||jsonb_build_object('instructions',replace(replace(coalesce(o.instructions,''),coalesce(nullif(s.name,''),chr(1)),'[المورد]'),coalesce(nullif(s.phone,''),chr(1)),'[بيانات خاصة]'),
 'order_comments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'content',replace(replace(c.content,coalesce(nullif(s.name,''),chr(1)),'[المورد]'),coalesce(nullif(s.phone,''),chr(1)),'[بيانات خاصة]'),'user_id',c.user_id,'user_name',c.user_name,'created_at',c.created_at) ORDER BY c.created_at) FROM public.order_comments c JOIN public.users u ON u.id=c.user_id WHERE c.order_id=o.id AND u.role IN('designer','admin','coordinator') AND c.content NOT LIKE '⚠️%'),'[]'::jsonb)) END
 ||jsonb_build_object('order_items',coalesce((SELECT jsonb_agg(jsonb_build_object('product_type',i.product_type,'teeth_numbers',i.teeth_numbers,'shade',i.shade,'price',0)) FROM public.order_items i WHERE i.order_id=o.id),'[]'::jsonb)) AS row
 FROM public.orders o LEFT JOIN public.suppliers s ON s.id=o.supplier_id
 WHERE o.designer_id=public.get_my_user_id() AND o.workflow_type='split' AND NOT coalesce(o.is_deleted,false) AND (p_order_id IS NULL OR o.id=p_order_id)
 ) projected;
 RETURN result;
END $$;

CREATE FUNCTION public.update_designer_workspace(p_order_id uuid,p_updates jsonb,p_comments jsonb DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE c jsonb; v_user public.users%ROWTYPE;
BEGIN
 IF public.get_my_role() IS DISTINCT FROM 'designer' OR NOT coalesce(public.design_qc_can_read(p_order_id),false) THEN RAISE EXCEPTION 'Design access denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF jsonb_typeof(p_updates) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_updates) k WHERE k NOT IN('technician_status','design_status','design_url','production_status','status_history','needs_design_review')) THEN RAISE EXCEPTION 'Designer field denied' USING ERRCODE='42501'; END IF;
 -- Reuse the authoritative field/workflow/QC guards and finance triggers. Never
 -- return update_order_atomic's full order JSON across the designer boundary.
 PERFORM public.update_order_atomic(p_order_id,p_updates,NULL,NULL);
 SELECT * INTO v_user FROM public.users WHERE id=public.get_my_user_id();
 FOR c IN SELECT value FROM jsonb_array_elements(coalesce(p_comments,'[]'::jsonb)) LOOP
 IF c->>'userId'=v_user.id::text AND nullif(btrim(c->>'text'),'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.order_comments WHERE order_id=p_order_id AND user_id=v_user.id AND created_at=(c->>'createdAt')::timestamptz) THEN
 INSERT INTO public.order_comments(order_id,content,user_id,user_name,created_at) VALUES(p_order_id,c->>'text',v_user.id,v_user.name,coalesce((c->>'createdAt')::timestamptz,now()));
 END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.get_designer_workspace(uuid,boolean),public.update_designer_workspace(uuid,jsonb,jsonb),public.designer_can_read_case_asset(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_designer_workspace(uuid,boolean),public.update_designer_workspace(uuid,jsonb,jsonb),public.designer_can_read_case_asset(text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
