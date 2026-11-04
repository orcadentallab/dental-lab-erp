BEGIN;
CREATE TABLE public.supplier_design_instructions(
 id uuid PRIMARY KEY, supplier_id uuid NOT NULL REFERENCES public.suppliers(id), version_no integer NOT NULL,
 paragraph text NOT NULL, source_reference text NOT NULL DEFAULT '', status text NOT NULL CHECK(status IN('experimental','approved','stopped')),
 files jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(files)='array'), privacy_reviewed boolean NOT NULL CHECK(privacy_reviewed),
 created_by uuid NOT NULL REFERENCES public.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(supplier_id,version_no));
ALTER TABLE public.supplier_design_instructions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_design_instructions FROM anon,authenticated;
GRANT SELECT ON public.supplier_design_instructions TO authenticated;
CREATE POLICY supplier_design_admin_read ON public.supplier_design_instructions FOR SELECT TO authenticated USING(public.get_my_role()='admin');
ALTER TABLE public.design_revisions ADD COLUMN supplier_instruction_id uuid REFERENCES public.supplier_design_instructions(id);
CREATE FUNCTION public.snapshot_supplier_design_instruction() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 SELECT i.id INTO NEW.supplier_instruction_id FROM public.supplier_design_instructions i JOIN public.orders o ON o.supplier_id=i.supplier_id WHERE o.id=NEW.order_id ORDER BY i.version_no DESC LIMIT 1;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.snapshot_supplier_design_instruction() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER snapshot_supplier_design_instruction BEFORE INSERT ON public.design_revisions FOR EACH ROW EXECUTE FUNCTION public.snapshot_supplier_design_instruction();

CREATE FUNCTION public.save_supplier_design_instruction(p_supplier_id uuid,p_version_id uuid,p_paragraph text,p_source text,p_status text,p_files jsonb,p_privacy_confirmed boolean) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE v_version integer; v_supplier public.suppliers%ROWTYPE; v_path text; v_existing public.supplier_design_instructions%ROWTYPE;
BEGIN
 IF public.get_my_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
 IF p_privacy_confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Privacy review required' USING ERRCODE='22023'; END IF;
 IF p_version_id IS NULL OR nullif(btrim(p_paragraph),'') IS NULL OR length(p_paragraph)>12000 OR p_status IS NULL OR p_status NOT IN('experimental','approved','stopped') OR jsonb_typeof(p_files) IS DISTINCT FROM 'array' OR jsonb_array_length(p_files)>10 THEN RAISE EXCEPTION 'Valid paragraph, status and attachments required' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_supplier FROM public.suppliers WHERE id=p_supplier_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Supplier not found'; END IF;
 IF (length(v_supplier.name)>2 AND strpos(lower(p_paragraph),lower(v_supplier.name))>0) OR (length(coalesce(v_supplier.phone,''))>=7 AND strpos(p_paragraph,v_supplier.phone)>0) THEN RAISE EXCEPTION 'Remove supplier identity from shared paragraph' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_existing FROM public.supplier_design_instructions WHERE id=p_version_id;
 IF FOUND THEN
 IF v_existing.supplier_id IS DISTINCT FROM p_supplier_id OR v_existing.paragraph IS DISTINCT FROM btrim(p_paragraph) OR v_existing.source_reference IS DISTINCT FROM coalesce(p_source,'') OR v_existing.status IS DISTINCT FROM p_status OR v_existing.files IS DISTINCT FROM p_files THEN RAISE EXCEPTION 'Instruction retry mismatch'; END IF;
 RETURN p_version_id;
 END IF;
 FOR v_path IN SELECT jsonb_array_elements_text(p_files) LOOP
 IF v_path NOT LIKE p_supplier_id::text||'/'||p_version_id::text||'/%' OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='design-instructions' AND name=v_path AND (metadata->>'size')::bigint BETWEEN 1 AND 15728640) THEN RAISE EXCEPTION 'Immutable instruction attachment required'; END IF;
 END LOOP;
 SELECT coalesce(max(version_no),0)+1 INTO v_version FROM public.supplier_design_instructions WHERE supplier_id=p_supplier_id;
 INSERT INTO public.supplier_design_instructions(id,supplier_id,version_no,paragraph,source_reference,status,files,privacy_reviewed,created_by) VALUES(p_version_id,p_supplier_id,v_version,btrim(p_paragraph),coalesce(p_source,''),p_status,p_files,true,public.get_my_user_id());
 RETURN p_version_id;
END $$;
CREATE FUNCTION public.get_supplier_design_instructions(p_supplier_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY version_no DESC),'[]'::jsonb) FROM public.supplier_design_instructions i WHERE supplier_id=p_supplier_id AND public.get_my_role()='admin'
$$;
CREATE FUNCTION public.get_order_design_instruction(p_order_id uuid,p_revision_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE v public.supplier_design_instructions%ROWTYPE;
BEGIN
 IF NOT coalesce(public.design_qc_can_read(p_order_id),false) THEN RAISE EXCEPTION 'Design access denied' USING ERRCODE='42501'; END IF;
 IF p_revision_id IS NULL THEN
 SELECT i.* INTO v FROM public.supplier_design_instructions i JOIN public.orders o ON o.supplier_id=i.supplier_id WHERE o.id=p_order_id ORDER BY version_no DESC LIMIT 1;
 ELSE
 SELECT i.* INTO v FROM public.supplier_design_instructions i JOIN public.design_revisions r ON r.supplier_instruction_id=i.id WHERE r.id=p_revision_id AND r.order_id=p_order_id;
 END IF;
 IF v.id IS NULL THEN RETURN jsonb_build_object('status','missing','paragraph','','files','[]'::jsonb); END IF;
 RETURN jsonb_build_object('id',v.id,'version',v.version_no,'status',v.status,'paragraph',CASE WHEN v.status='stopped' THEN '' ELSE v.paragraph END,'files',CASE WHEN v.status='stopped' THEN '[]'::jsonb ELSE v.files END,'createdAt',v.created_at);
END $$;
CREATE FUNCTION public.can_read_design_instruction_file(p_path text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
 SELECT public.get_my_role()='admin' OR EXISTS(SELECT 1 FROM public.supplier_design_instructions i JOIN public.orders o ON public.design_qc_can_read(o.id) WHERE i.files ? p_path AND (EXISTS(SELECT 1 FROM public.design_revisions r WHERE r.order_id=o.id AND r.supplier_instruction_id=i.id) OR (o.supplier_id=i.supplier_id AND i.status<>'stopped' AND i.version_no=(SELECT max(x.version_no) FROM public.supplier_design_instructions x WHERE x.supplier_id=i.supplier_id))))
$$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('design-instructions','design-instructions',false,15728640,ARRAY['application/pdf','image/jpeg','image/png']);
CREATE POLICY instruction_read_limit ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING(bucket_id<>'design-instructions' OR public.can_read_design_instruction_file(name));
CREATE POLICY instruction_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='design-instructions' AND public.can_read_design_instruction_file(name));
CREATE POLICY instruction_insert_limit ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(bucket_id<>'design-instructions' OR (public.get_my_role()='admin' AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.](pdf|png|jpg)$'));
CREATE POLICY instruction_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='design-instructions' AND public.get_my_role()='admin' AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.](pdf|png|jpg)$');
CREATE POLICY instruction_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING(bucket_id<>'design-instructions') WITH CHECK(bucket_id<>'design-instructions');
CREATE POLICY instruction_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(bucket_id<>'design-instructions');
REVOKE ALL ON FUNCTION public.save_supplier_design_instruction(uuid,uuid,text,text,text,jsonb,boolean),public.get_supplier_design_instructions(uuid),public.get_order_design_instruction(uuid,uuid),public.can_read_design_instruction_file(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_supplier_design_instruction(uuid,uuid,text,text,text,jsonb,boolean),public.get_supplier_design_instructions(uuid),public.get_order_design_instruction(uuid,uuid),public.can_read_design_instruction_file(text) TO authenticated;
COMMIT;
