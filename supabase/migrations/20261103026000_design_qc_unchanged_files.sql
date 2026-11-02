-- Re-uploading identical immutable bytes is not a design change. Keep current
-- approval and record the submission/reference change separately and idempotently.
BEGIN;
ALTER TABLE public.design_qc_events ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';
ALTER FUNCTION public.submit_design_revision(uuid,uuid,text,text) RENAME TO submit_design_revision_new_files;
REVOKE ALL ON FUNCTION public.submit_design_revision_new_files(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.submit_design_revision(p_order_id uuid,p_revision_id uuid,p_execution_url text,p_without_preview_reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE v_order public.orders%ROWTYPE;v_current public.design_revisions%ROWTYPE;v_event public.design_qc_events%ROWTYPE;v_exec jsonb;v_html jsonb;v_enabled boolean;v_payload jsonb;
BEGIN
 IF NOT coalesce(public.design_qc_can_read(p_order_id),false) THEN RAISE EXCEPTION 'Design access denied' USING ERRCODE='42501'; END IF;
 SELECT enabled INTO v_enabled FROM public.design_qc_control WHERE id FOR SHARE;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR v_order.workflow_type IS DISTINCT FROM 'split' OR v_order.designer_id IS NULL OR coalesce(v_order.is_deleted,false) OR v_order.issue_state<>'none' THEN RAISE EXCEPTION 'Split design is unavailable'; END IF;
 v_payload:=jsonb_build_object('requestRevisionId',p_revision_id,'executionUrl',btrim(p_execution_url),'withoutPreviewReason',coalesce(btrim(p_without_preview_reason),''));
 SELECT * INTO v_event FROM public.design_qc_events WHERE id=p_revision_id;
 IF FOUND THEN
 IF v_event.action<>'submitted' OR v_event.order_id<>p_order_id OR v_event.actor_id<>public.get_my_user_id() OR v_event.metadata IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Revision retry mismatch'; END IF;
 RETURN v_event.revision_id;
 END IF;
 SELECT * INTO v_current FROM public.design_revisions WHERE id=v_order.design_qc_revision_id;
 SELECT metadata INTO v_exec FROM storage.objects WHERE bucket_id='design-qc-files' AND name=p_order_id::text||'/'||p_revision_id::text||'/execution.zip';
 SELECT metadata INTO v_html FROM storage.objects WHERE bucket_id='design-qc-files' AND name=p_order_id::text||'/'||p_revision_id::text||'/preview.html';
 IF p_revision_id IS NOT NULL AND coalesce(p_execution_url,'') ~ '^https://[^[:space:]]+$'
 AND v_current.id IS NOT NULL AND v_exec->>'eTag'=v_current.execution_key
 AND (v_exec->>'size')::bigint BETWEEN 1 AND 52428800
 AND (v_html->>'eTag') IS NOT DISTINCT FROM v_current.preview_key
 AND (v_html IS NULL OR (v_html->>'size')::bigint BETWEEN 1 AND 10485760)
 AND (v_html IS NOT NULL OR nullif(btrim(p_without_preview_reason),'') IS NOT NULL)
 AND NOT (v_enabled AND NOT v_order.design_qc_required) THEN
 INSERT INTO public.design_qc_events(id,order_id,revision_id,action,note,actor_id,actor_role,metadata)
 VALUES(p_revision_id,p_order_id,v_current.id,'submitted','إعادة تسليم نفس الملفات دون تغيير الموافقة',public.get_my_user_id(),public.get_my_role(),v_payload);
 PERFORM set_config('app.order_issue_operation','submit_design',true);
 UPDATE public.orders SET design_status='completed',design_submitted_at=coalesce(design_submitted_at,clock_timestamp()) WHERE id=p_order_id;
 RETURN v_current.id;
 END IF;
 RETURN public.submit_design_revision_new_files(p_order_id,p_revision_id,p_execution_url,p_without_preview_reason);
END $$;
REVOKE ALL ON FUNCTION public.submit_design_revision(uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_design_revision(uuid,uuid,text,text) TO authenticated;
COMMIT;
