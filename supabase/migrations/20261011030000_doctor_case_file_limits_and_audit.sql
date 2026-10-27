-- Keep patient files private and retain the original image/PDF size limit.
CREATE POLICY portal_case_file_size ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
 USING(true) WITH CHECK (
 bucket_id<>'case-files' OR metadata IS NULL OR coalesce((metadata->>'size')::bigint,0)<=
 CASE WHEN lower(name) ~ '\.(stl|ply)$' THEN 52428800 ELSE 10485760 END
);
CREATE FUNCTION public.audit_doctor_case_attachment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage AS $$
DECLARE v_metadata jsonb;
BEGIN
 IF public.get_my_role()='doctor' THEN
   IF NEW.kind<>'instruction' OR NOT public.doctor_portal_can_access_order(NEW.order_id) OR NEW.storage_path NOT LIKE NEW.order_id::text||'/instruction/%' THEN RAISE EXCEPTION 'المرفق لا يتبع حالتك'; END IF;
   SELECT metadata INTO v_metadata FROM storage.objects WHERE bucket_id='case-files' AND name=NEW.storage_path;
   IF NOT FOUND THEN RAISE EXCEPTION 'ارفع الملف قبل تسجيله'; END IF;
   NEW.uploaded_by := public.get_my_user_id();
   NEW.size_bytes := (v_metadata->>'size')::integer;
   NEW.mime_type := coalesce(v_metadata->>'mimetype',NEW.mime_type);
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_doctor_case_attachment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER doctor_case_attachment_audit BEFORE INSERT ON public.order_attachments FOR EACH ROW EXECUTE FUNCTION public.audit_doctor_case_attachment();
