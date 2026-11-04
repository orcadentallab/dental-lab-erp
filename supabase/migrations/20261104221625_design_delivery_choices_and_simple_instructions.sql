BEGIN;
-- Latest owner decision: technical text plus its versions, and either a link
-- OR an uploaded execution package. Existing rich history is retained intact.
CREATE FUNCTION public.save_supplier_design_text(p_supplier_id uuid,p_version_id uuid,p_paragraph text) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public,auth AS $$
 SELECT public.save_supplier_design_instruction(p_supplier_id,p_version_id,p_paragraph,'','approved','[]',true)
$$;
ALTER TABLE public.design_revisions ALTER COLUMN execution_url DROP NOT NULL,ALTER COLUMN execution_path DROP NOT NULL;
ALTER TABLE public.design_revisions ADD CONSTRAINT design_execution_source_present CHECK(execution_path IS NOT NULL OR (execution_url IS NOT NULL AND execution_url ~ '^https://[^[:space:]]+$'));

CREATE FUNCTION public.submit_design_delivery(p_order_id uuid,p_revision_id uuid,p_mode text,p_execution_url text,p_without_preview_reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE o public.orders%ROWTYPE; current_revision public.design_revisions%ROWTYPE; existing public.design_revisions%ROWTYPE; ev public.design_qc_events%ROWTYPE; enabled boolean; exec_meta jsonb; html_meta jsonb; exec_path text; preview_path text; exec_key text; payload jsonb; version integer; clean_url text:=nullif(btrim(p_execution_url),''); reason text:=nullif(btrim(p_without_preview_reason),'');
BEGIN
 IF NOT coalesce(public.design_qc_can_read(p_order_id),false) THEN RAISE EXCEPTION 'Design access denied' USING ERRCODE='42501'; END IF;
 SELECT c.enabled INTO enabled FROM public.design_qc_control c WHERE id FOR SHARE;
 SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR o.workflow_type IS DISTINCT FROM 'split' OR o.designer_id IS NULL OR coalesce(o.is_deleted,false) OR coalesce(o.is_archived,false) OR o.production_status='final_delivered' OR o.issue_state<>'none' THEN RAISE EXCEPTION 'Split design is unavailable'; END IF;
 IF p_revision_id IS NULL OR p_mode IS NULL OR p_mode NOT IN('link','file') THEN RAISE EXCEPTION 'Choose one execution source' USING ERRCODE='22023'; END IF;
 IF p_mode='link' AND (clean_url IS NULL OR clean_url !~ '^https://[^[:space:]]+$') THEN RAISE EXCEPTION 'HTTPS execution link required' USING ERRCODE='22023'; END IF;
 IF p_mode='file' AND clean_url IS NOT NULL THEN RAISE EXCEPTION 'Choose one execution source' USING ERRCODE='22023'; END IF;
 payload:=jsonb_build_object('mode',p_mode,'executionUrl',clean_url,'withoutPreviewReason',reason);
 SELECT * INTO ev FROM public.design_qc_events WHERE id=p_revision_id;
 IF FOUND THEN
 IF ev.order_id IS DISTINCT FROM p_order_id OR ev.actor_id IS DISTINCT FROM public.get_my_user_id() OR ev.action<>'submitted' OR ev.metadata IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Revision retry mismatch'; END IF;
 RETURN ev.revision_id;
 END IF;
 SELECT * INTO existing FROM public.design_revisions WHERE id=p_revision_id;
 IF FOUND THEN RAISE EXCEPTION 'Revision retry mismatch'; END IF;
 SELECT metadata INTO exec_meta FROM storage.objects WHERE bucket_id='design-qc-files' AND name=p_order_id::text||'/'||p_revision_id::text||'/execution.zip';
 IF p_mode='link' AND exec_meta IS NOT NULL THEN RAISE EXCEPTION 'Choose one execution source' USING ERRCODE='22023'; END IF;
 IF p_mode='file' THEN
 IF nullif(exec_meta->>'eTag','') IS NULL OR coalesce((exec_meta->>'size')::bigint,0) NOT BETWEEN 1 AND 52428800 THEN RAISE EXCEPTION 'Immutable execution ZIP required' USING ERRCODE='22023'; END IF;
 exec_path:=p_order_id::text||'/'||p_revision_id::text||'/execution.zip';exec_key:=exec_meta->>'eTag';
 ELSE
 -- A link fingerprint identifies the reference, not bytes hosted elsewhere.
 exec_key:='link:'||encode(extensions.digest(clean_url,'sha256'),'hex');
 END IF;
 SELECT metadata INTO html_meta FROM storage.objects WHERE bucket_id='design-qc-files' AND name=p_order_id::text||'/'||p_revision_id::text||'/preview.html';
 IF html_meta IS NULL AND reason IS NULL THEN RAISE EXCEPTION 'HTML preview or exception reason required' USING ERRCODE='22023'; END IF;
 IF html_meta IS NOT NULL THEN
 IF nullif(html_meta->>'eTag','') IS NULL OR coalesce((html_meta->>'size')::bigint,0) NOT BETWEEN 1 AND 10485760 THEN RAISE EXCEPTION 'HTML preview exceeds 10 MB' USING ERRCODE='22023'; END IF;
 preview_path:=p_order_id::text||'/'||p_revision_id::text||'/preview.html';
 END IF;
 SELECT * INTO current_revision FROM public.design_revisions WHERE id=o.design_qc_revision_id;
 IF p_mode='file' AND current_revision.execution_key=exec_key AND current_revision.preview_key IS NOT DISTINCT FROM html_meta->>'eTag' AND NOT(enabled AND NOT o.design_qc_required) THEN
 INSERT INTO public.design_qc_events(id,order_id,revision_id,action,note,actor_id,actor_role,metadata) VALUES(p_revision_id,p_order_id,current_revision.id,'submitted','إعادة تسليم نفس الملفات دون تغيير الموافقة',public.get_my_user_id(),public.get_my_role(),payload);
 RETURN current_revision.id;
 END IF;
 SELECT coalesce(max(revision_no),0)+1 INTO version FROM public.design_revisions WHERE order_id=p_order_id;
 INSERT INTO public.design_revisions(id,order_id,revision_no,execution_url,execution_path,preview_path,execution_key,preview_key,without_preview_reason,submitted_by,requires_qc)
 VALUES(p_revision_id,p_order_id,version,clean_url,exec_path,preview_path,exec_key,html_meta->>'eTag',reason,public.get_my_user_id(),enabled);
 INSERT INTO public.design_qc_events(id,order_id,revision_id,action,actor_id,actor_role,metadata) VALUES(p_revision_id,p_order_id,p_revision_id,'submitted',public.get_my_user_id(),public.get_my_role(),payload);
 PERFORM set_config('app.design_qc_write','on',true);PERFORM set_config('app.order_issue_operation','submit_design',true);
 UPDATE public.orders SET design_qc_revision_id=p_revision_id,design_qc_required=enabled,design_url=clean_url,design_status='completed',design_submitted_at=coalesce(design_submitted_at,clock_timestamp()),production_status=CASE WHEN NOT enabled AND production_status='designing' THEN 'in_production' ELSE production_status END WHERE id=p_order_id;
 PERFORM set_config('app.design_qc_write','off',true);
 RETURN p_revision_id;
END $$;

CREATE FUNCTION public.get_design_delivery_asset(p_order_id uuid,p_stage_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE revision uuid; asset public.design_revisions%ROWTYPE;
BEGIN
 IF NOT coalesce(public.design_qc_can_read_files(p_order_id),false) THEN RAISE EXCEPTION 'Design access denied' USING ERRCODE='42501'; END IF;
 IF p_stage_id IS NOT NULL THEN
 SELECT r.design_revision_id INTO revision FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id=r.job_id WHERE r.id=p_stage_id AND j.order_id=p_order_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Design access denied' USING ERRCODE='42501'; END IF;
 END IF;
 IF revision IS NULL THEN SELECT design_qc_revision_id INTO revision FROM public.orders WHERE id=p_order_id; END IF;
 IF revision IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO asset FROM public.design_revisions WHERE id=revision AND order_id=p_order_id;
 RETURN jsonb_build_object('revisionId',asset.id,'path',asset.execution_path,'url',asset.execution_url);
END $$;
-- Carry the revision indicator through the existing restricted designer reader.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.get_designer_workspace(uuid,boolean)'::regprocedure) INTO definition;
 IF strpos(definition,'''design_url'', o.design_url')>0 THEN definition:=replace(definition,'''design_url'', o.design_url','''design_qc_revision_id'',o.design_qc_revision_id,''design_url'', o.design_url');
 ELSE definition:=replace(definition,'''design_url'',o.design_url','''design_qc_revision_id'',o.design_qc_revision_id,''design_url'',o.design_url'); END IF;
 EXECUTE definition;
END $$;
REVOKE ALL ON FUNCTION public.save_supplier_design_text(uuid,uuid,text),public.submit_design_delivery(uuid,uuid,text,text,text),public.get_design_delivery_asset(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_supplier_design_text(uuid,uuid,text),public.submit_design_delivery(uuid,uuid,text,text,text),public.get_design_delivery_asset(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
