-- Additive local Design QC. Persistent pause defaults OFF. No historical backfill.
BEGIN;
CREATE TABLE public.design_qc_control(id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT false);
INSERT INTO public.design_qc_control VALUES(true,false);
CREATE TABLE public.design_qc_control_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enabled boolean NOT NULL, reason text NOT NULL, actor_id uuid NOT NULL REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.design_revisions(
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES public.orders(id), revision_no integer NOT NULL,
 execution_url text NOT NULL, execution_path text NOT NULL UNIQUE, preview_path text UNIQUE,
 execution_key text NOT NULL, preview_key text, without_preview_reason text,
 submitted_by uuid NOT NULL REFERENCES public.users(id), submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 requires_qc boolean NOT NULL, UNIQUE(order_id,revision_no),
 CHECK(preview_path IS NOT NULL OR length(btrim(without_preview_reason))>0)
);
CREATE TABLE public.design_qc_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES public.orders(id),
 revision_id uuid REFERENCES public.design_revisions(id), action text NOT NULL CHECK(action IN('submitted','approved','rejected','bypassed','returned','legacy_changed')),
 note text NOT NULL DEFAULT '', actor_id uuid NOT NULL REFERENCES public.users(id), actor_role text NOT NULL,
 needs_followup boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX design_qc_events_order ON public.design_qc_events(order_id,created_at);
ALTER TABLE public.orders ADD COLUMN design_qc_revision_id uuid REFERENCES public.design_revisions(id), ADD COLUMN design_qc_required boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.design_qc_can_read(p_order_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
 SELECT public.get_my_role() IN('admin','coordinator') OR EXISTS(
 SELECT 1 FROM public.orders o WHERE o.id=p_order_id AND NOT coalesce(o.is_deleted,false)
 AND o.designer_id=public.get_my_user_id() AND (public.get_my_role()='designer' OR public.get_my_custom_permission('secondary_designer')))
$$;
CREATE FUNCTION public.design_qc_can_read_files(p_order_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
 SELECT public.design_qc_can_read(p_order_id) OR
 (public.get_my_role() IN('production_manager','technician') AND EXISTS(
 SELECT 1 FROM public.production_jobs j JOIN public.production_stage_runs r ON r.job_id=j.id
 WHERE j.order_id=p_order_id AND (r.assignee_id=public.get_my_user_id() OR public.get_my_role()='production_manager')))
$$;
CREATE FUNCTION public.design_qc_gate_passes(p_revision_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.design_qc_events WHERE revision_id=p_revision_id AND action='bypassed')
 OR (SELECT action='approved' FROM public.design_qc_events WHERE revision_id=p_revision_id AND action IN('approved','rejected','bypassed') ORDER BY created_at DESC,id DESC LIMIT 1)
$$;
CREATE FUNCTION public.set_design_qc_enabled(p_enabled boolean,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
BEGIN
 IF public.get_my_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
 IF p_enabled IS NULL OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.design_qc_control WHERE id FOR UPDATE;
 IF (SELECT enabled FROM public.design_qc_control WHERE id) IS DISTINCT FROM p_enabled THEN
 UPDATE public.design_qc_control SET enabled=p_enabled WHERE id;
 INSERT INTO public.design_qc_control_events(enabled,reason,actor_id) VALUES(p_enabled,btrim(p_reason),public.get_my_user_id());
 END IF;
 RETURN jsonb_build_object('enabled',p_enabled);
END $$;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('design-qc-files','design-qc-files',false,104857600,ARRAY['application/zip','application/octet-stream','text/html']);
-- Restrictive policies also constrain any older broad storage policies.
CREATE POLICY qc_file_insert_limit ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(bucket_id<>'design-qc-files' OR
 (public.design_qc_can_read(((storage.foldername(name))[1])::uuid)
 AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/(execution[.]zip|preview[.]html)$'));
CREATE POLICY qc_file_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='design-qc-files' AND public.design_qc_can_read(((storage.foldername(name))[1])::uuid));
CREATE POLICY qc_file_read_limit ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING(bucket_id<>'design-qc-files' OR public.design_qc_can_read_files(((storage.foldername(name))[1])::uuid));
CREATE POLICY qc_file_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='design-qc-files' AND public.design_qc_can_read_files(((storage.foldername(name))[1])::uuid));
CREATE POLICY qc_no_overwrite ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING(bucket_id<>'design-qc-files') WITH CHECK(bucket_id<>'design-qc-files');
CREATE POLICY qc_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(bucket_id<>'design-qc-files');

CREATE FUNCTION public.submit_design_revision(p_order_id uuid,p_revision_id uuid,p_execution_url text,p_without_preview_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE v_order public.orders%ROWTYPE; v_enabled boolean; v_exec storage.objects%ROWTYPE; v_html storage.objects%ROWTYPE; v_existing public.design_revisions%ROWTYPE; v_n integer;
BEGIN
 IF NOT coalesce(public.design_qc_can_read(p_order_id),false) THEN RAISE EXCEPTION 'Design access denied' USING ERRCODE='42501'; END IF;
 SELECT enabled INTO v_enabled FROM public.design_qc_control WHERE id FOR SHARE;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF v_order.workflow_type IS DISTINCT FROM 'split' OR v_order.designer_id IS NULL OR coalesce(v_order.is_deleted,false) OR v_order.issue_state<>'none' THEN RAISE EXCEPTION 'Split design is unavailable'; END IF;
 IF p_revision_id IS NULL OR coalesce(p_execution_url,'') !~ '^https://[^[:space:]]+$' THEN RAISE EXCEPTION 'HTTPS execution link required' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_existing FROM public.design_revisions WHERE id=p_revision_id;
 IF FOUND THEN
 IF v_existing.order_id<>p_order_id OR v_existing.execution_url<>btrim(p_execution_url) OR coalesce(v_existing.without_preview_reason,'')<>coalesce(btrim(p_without_preview_reason),'') THEN RAISE EXCEPTION 'Revision retry mismatch'; END IF;
 RETURN v_existing.id;
 END IF;
 SELECT * INTO v_exec FROM storage.objects WHERE bucket_id='design-qc-files' AND name=p_order_id::text||'/'||p_revision_id::text||'/execution.zip';
 IF NOT FOUND OR nullif(v_exec.metadata->>'eTag','') IS NULL OR coalesce((v_exec.metadata->>'size')::bigint,0) NOT BETWEEN 1 AND 104857600 THEN RAISE EXCEPTION 'Immutable execution ZIP required' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_html FROM storage.objects WHERE bucket_id='design-qc-files' AND name=p_order_id::text||'/'||p_revision_id::text||'/preview.html';
 IF NOT FOUND AND nullif(btrim(p_without_preview_reason),'') IS NULL THEN RAISE EXCEPTION 'HTML preview or exception reason required' USING ERRCODE='22023'; END IF;
 IF v_html.id IS NOT NULL AND coalesce((v_html.metadata->>'size')::bigint,0) NOT BETWEEN 1 AND 10485760 THEN RAISE EXCEPTION 'HTML preview exceeds 10 MB' USING ERRCODE='22023'; END IF;
 SELECT coalesce(max(revision_no),0)+1 INTO v_n FROM public.design_revisions WHERE order_id=p_order_id;
 INSERT INTO public.design_revisions(id,order_id,revision_no,execution_url,execution_path,preview_path,execution_key,preview_key,without_preview_reason,submitted_by,requires_qc)
 VALUES(p_revision_id,p_order_id,v_n,btrim(p_execution_url),v_exec.name,v_html.name,v_exec.metadata->>'eTag',v_html.metadata->>'eTag',nullif(btrim(p_without_preview_reason),''),public.get_my_user_id(),v_enabled);
 INSERT INTO public.design_qc_events(order_id,revision_id,action,actor_id,actor_role) VALUES(p_order_id,p_revision_id,'submitted',public.get_my_user_id(),public.get_my_role());
 PERFORM set_config('app.design_qc_write','on',true);
 PERFORM set_config('app.order_issue_operation','submit_design',true);
 UPDATE public.orders SET design_qc_revision_id=p_revision_id,design_qc_required=v_enabled,design_url=btrim(p_execution_url),design_status='completed',
 design_submitted_at=coalesce(design_submitted_at,clock_timestamp()),
 production_status=CASE WHEN NOT v_enabled AND production_status='designing' THEN 'in_production' ELSE production_status END WHERE id=p_order_id;
 PERFORM set_config('app.design_qc_write','off',true);
 RETURN p_revision_id;
END $$;

CREATE FUNCTION public.decide_design_revision(p_revision_id uuid,p_event_id uuid,p_action text,p_note text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE v_revision public.design_revisions%ROWTYPE; v_order public.orders%ROWTYPE; v_event public.design_qc_events%ROWTYPE; v_followup boolean;
BEGIN
 SELECT * INTO v_revision FROM public.design_revisions WHERE id=p_revision_id;
 IF NOT FOUND OR NOT coalesce(public.design_qc_can_read(v_revision.order_id),false) THEN RAISE EXCEPTION 'Design access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=v_revision.order_id FOR UPDATE;
 IF p_action NOT IN('approved','rejected','bypassed') OR p_action IS NULL OR p_event_id IS NULL THEN RAISE EXCEPTION 'Invalid review action' USING ERRCODE='22023'; END IF;
 IF p_action='bypassed' THEN
 IF public.get_my_role() NOT IN('admin','coordinator') THEN RAISE EXCEPTION 'Bypass role required' USING ERRCODE='42501'; END IF;
 ELSE
 IF public.get_my_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
 END IF;
 IF p_action IN('rejected','bypassed') AND nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_event FROM public.design_qc_events WHERE id=p_event_id;
 IF FOUND THEN
 IF v_event.revision_id IS DISTINCT FROM p_revision_id OR v_event.action<>p_action OR v_event.note<>coalesce(btrim(p_note),'') OR v_event.actor_id<>public.get_my_user_id() THEN RAISE EXCEPTION 'Review retry mismatch'; END IF;
 RETURN v_event.id;
 END IF;
 IF v_order.design_qc_revision_id IS DISTINCT FROM p_revision_id THEN RAISE EXCEPTION 'Review the current revision' USING ERRCODE='23514'; END IF;
 IF p_action='bypassed' AND EXISTS(SELECT 1 FROM public.design_qc_events e JOIN public.design_revisions r ON r.id=e.revision_id WHERE r.order_id=v_revision.order_id AND r.execution_key=v_revision.execution_key AND e.action='rejected') THEN RAISE EXCEPTION 'Rejected execution files cannot be bypassed' USING ERRCODE='23514'; END IF;
 v_followup := p_action='rejected' AND EXISTS(SELECT 1 FROM public.design_qc_events WHERE revision_id=p_revision_id AND action='bypassed');
 INSERT INTO public.design_qc_events(id,order_id,revision_id,action,note,actor_id,actor_role,needs_followup)
 VALUES(p_event_id,v_revision.order_id,p_revision_id,p_action,coalesce(btrim(p_note),''),public.get_my_user_id(),public.get_my_role(),v_followup);
 RETURN p_event_id;
END $$;

CREATE FUNCTION public.guard_design_qc_order() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE v_enabled boolean; v_file_changed boolean; v_internal boolean:=coalesce(current_setting('app.design_qc_write',true),'')='on';
BEGIN
 SELECT enabled INTO v_enabled FROM public.design_qc_control WHERE id FOR SHARE;
 IF TG_OP='INSERT' THEN
 IF NEW.design_qc_revision_id IS NOT NULL OR NEW.design_qc_required THEN RAISE EXCEPTION 'Use design revision RPC' USING ERRCODE='42501'; END IF;
 RETURN NEW;
 END IF;
 IF NOT v_internal AND (NEW.design_qc_revision_id IS DISTINCT FROM OLD.design_qc_revision_id OR NEW.design_qc_required IS DISTINCT FROM OLD.design_qc_required) THEN RAISE EXCEPTION 'Use design revision RPC' USING ERRCODE='42501'; END IF;
 v_file_changed := NEW.design_url IS DISTINCT FROM OLD.design_url;
 IF NOT v_internal AND v_file_changed AND NEW.workflow_type='split' AND NEW.designer_id IS NOT NULL THEN
 IF v_enabled THEN RAISE EXCEPTION 'Submit immutable files through Design QC' USING ERRCODE='23514'; END IF;
 NEW.design_qc_revision_id:=NULL; NEW.design_qc_required:=false;
 IF public.get_my_user_id() IS NOT NULL THEN INSERT INTO public.design_qc_events(order_id,revision_id,action,note,actor_id,actor_role) VALUES(NEW.id,OLD.design_qc_revision_id,'legacy_changed','File link changed while QC paused',public.get_my_user_id(),public.get_my_role()); END IF;
 END IF;
 IF v_enabled AND NEW.design_qc_required AND NEW.production_status IS DISTINCT FROM OLD.production_status AND NEW.production_status IN('in_production','try_in_ready','waiting_doctor','finalization','final_ready','final_delivered')
 AND NOT coalesce(public.design_qc_gate_passes(NEW.design_qc_revision_id),false) THEN RAISE EXCEPTION 'Design QC approval or permitted bypass required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aac_guard_design_qc BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.guard_design_qc_order();

CREATE FUNCTION public.guard_design_qc_execution() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order_id uuid; v_required boolean; v_revision uuid;
BEGIN
 IF TG_TABLE_NAME='production_stage_runs' THEN
 IF NEW.status NOT IN('in_progress','waiting_external','done') OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM public.production_stages WHERE id=NEW.stage_id AND code='design') THEN RETURN NEW; END IF;
 SELECT order_id INTO v_order_id FROM public.production_jobs WHERE id=NEW.job_id;
 ELSE
 IF NEW.status NOT IN('sent','returned') OR (TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status) THEN RETURN NEW; END IF;
 SELECT j.order_id INTO v_order_id FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id=r.job_id WHERE r.id=NEW.stage_run_id;
 END IF;
 SELECT design_qc_required,design_qc_revision_id INTO v_required,v_revision FROM public.orders WHERE id=v_order_id;
 IF (SELECT enabled FROM public.design_qc_control WHERE id) AND v_required AND NOT coalesce(public.design_qc_gate_passes(v_revision),false) THEN RAISE EXCEPTION 'Design QC approval or permitted bypass required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aac_design_qc_stage BEFORE UPDATE ON public.production_stage_runs FOR EACH ROW EXECUTE FUNCTION public.guard_design_qc_execution();
CREATE TRIGGER aac_design_qc_external BEFORE INSERT OR UPDATE ON public.external_work_orders FOR EACH ROW EXECUTE FUNCTION public.guard_design_qc_execution();

CREATE FUNCTION public.release_design_revision(p_order_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
BEGIN
 IF public.get_my_role() NOT IN('admin','coordinator') OR NOT coalesce(public.design_qc_can_read(p_order_id),false) THEN RAISE EXCEPTION 'Release role required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.orders WHERE id=p_order_id FOR UPDATE;
 UPDATE public.orders SET production_status='in_production' WHERE id=p_order_id AND issue_state='none' AND production_status<>'final_delivered';
END $$;
CREATE FUNCTION public.return_design_revision(p_order_id uuid,p_designer_id uuid,p_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE v_order public.orders%ROWTYPE;
BEGIN
 IF public.get_my_role() NOT IN('admin','coordinator') THEN RAISE EXCEPTION 'Return role required' USING ERRCODE='42501'; END IF;
 IF nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_designer_id AND coalesce(is_active,true) AND (role='designer' OR coalesce((custom_permissions->>'secondary_designer')::boolean,false))) THEN RAISE EXCEPTION 'Active designer required'; END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR v_order.design_qc_revision_id IS NULL THEN RAISE EXCEPTION 'Revision required'; END IF;
 INSERT INTO public.design_qc_events(order_id,revision_id,action,note,actor_id,actor_role) VALUES(p_order_id,v_order.design_qc_revision_id,'returned',btrim(p_note),public.get_my_user_id(),public.get_my_role());
 -- Keep completed design earning/financial responsibility. Return is operational.
 UPDATE public.orders SET designer_id=p_designer_id,production_status='designing' WHERE id=p_order_id;
END $$;

CREATE FUNCTION public.get_design_qc_state(p_order_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
BEGIN
 IF NOT coalesce(public.design_qc_can_read(p_order_id),false) THEN RAISE EXCEPTION 'Design access denied' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('enabled',(SELECT enabled FROM public.design_qc_control WHERE id),
 'currentRevisionId',(SELECT design_qc_revision_id FROM public.orders WHERE id=p_order_id),
 'required',(SELECT design_qc_required FROM public.orders WHERE id=p_order_id),
 'revisions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY revision_no DESC) FROM public.design_revisions r WHERE order_id=p_order_id),'[]'::jsonb),
 'events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at DESC) FROM public.design_qc_events e WHERE order_id=p_order_id),'[]'::jsonb));
END $$;
CREATE FUNCTION public.get_design_execution_path(p_order_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
BEGIN
 IF NOT coalesce(public.design_qc_can_read_files(p_order_id),false) THEN RAISE EXCEPTION 'Design access denied' USING ERRCODE='42501'; END IF;
 RETURN (SELECT r.execution_path FROM public.design_revisions r JOIN public.orders o ON o.design_qc_revision_id=r.id WHERE o.id=p_order_id);
END $$;
CREATE FUNCTION public.get_design_qc_queue() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'caseId',o.case_id,'revisionId',o.design_qc_revision_id,'required',o.design_qc_required,
 'state',coalesce((SELECT action FROM public.design_qc_events WHERE revision_id=o.design_qc_revision_id AND action IN('approved','rejected','bypassed') ORDER BY created_at DESC,id DESC LIMIT 1),'pending')) ORDER BY o.updated_at DESC),'[]'::jsonb)
 FROM public.orders o WHERE o.workflow_type='split' AND o.designer_id IS NOT NULL AND NOT coalesce(o.is_deleted,false) AND public.design_qc_can_read(o.id)
$$;
CREATE FUNCTION public.get_design_qc_designer_options() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name),'[]'::jsonb) FROM public.users WHERE public.get_my_role() IN('admin','coordinator') AND coalesce(is_active,true) AND (role='designer' OR coalesce((custom_permissions->>'secondary_designer')::boolean,false))
$$;

ALTER TABLE public.design_qc_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_qc_control_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_qc_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.design_qc_control,public.design_qc_control_events,public.design_revisions,public.design_qc_events FROM anon,authenticated;
GRANT SELECT ON public.design_qc_control,public.design_qc_control_events,public.design_revisions,public.design_qc_events TO authenticated;
CREATE POLICY qc_control_read ON public.design_qc_control FOR SELECT TO authenticated USING(public.get_my_role() IS NOT NULL AND public.get_my_role()<>'doctor');
CREATE POLICY qc_control_audit ON public.design_qc_control_events FOR SELECT TO authenticated USING(public.get_my_role()='admin');
CREATE POLICY qc_revision_read ON public.design_revisions FOR SELECT TO authenticated USING(public.design_qc_can_read(order_id));
CREATE POLICY qc_event_read ON public.design_qc_events FOR SELECT TO authenticated USING(public.design_qc_can_read(order_id));
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('design_qc_can_read','design_qc_can_read_files','design_qc_gate_passes','set_design_qc_enabled','submit_design_revision','decide_design_revision','guard_design_qc_order','guard_design_qc_execution','release_design_revision','return_design_revision','get_design_qc_state','get_design_execution_path','get_design_qc_queue','get_design_qc_designer_options') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon',f.signature);
 IF f.signature::text NOT LIKE '%guard_%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature); END IF;
 END LOOP;
END $$;
COMMIT;
