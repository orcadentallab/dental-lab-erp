-- Storage performs metadata writes as its service role. Bucket limits, rather
-- than metadata RLS checks, must enforce the image/scan size split.
UPDATE storage.buckets SET file_size_limit=10485760,allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf'] WHERE id='case-files';
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('case-scans','case-scans',false,52428800,ARRAY['application/octet-stream','model/stl','model/ply','application/sla'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
ALTER TABLE public.order_attachments ADD COLUMN storage_bucket text NOT NULL DEFAULT 'case-files' CHECK(storage_bucket IN('case-files','case-scans'));
ALTER POLICY portal_storage_read_scope ON storage.objects USING(public.get_my_role() IS DISTINCT FROM 'doctor' OR (bucket_id IN('case-files','case-scans') AND public.doctor_portal_owns_file(name)));
ALTER POLICY portal_storage_write_scope ON storage.objects WITH CHECK(public.get_my_role() IS DISTINCT FROM 'doctor' OR (public.doctor_portal_owns_file(name) AND ((bucket_id='case-files' AND lower(name)~'\.(jpg|jpeg|png|webp|heic|pdf)$') OR (bucket_id='case-scans' AND lower(name)~'\.(stl|ply)$'))));
ALTER POLICY portal_storage_cleanup ON storage.objects USING(bucket_id IN('case-files','case-scans') AND public.get_my_role()='doctor' AND public.doctor_portal_owns_file(name) AND NOT EXISTS(SELECT 1 FROM public.order_attachments WHERE storage_path=name AND storage_bucket=bucket_id));
CREATE POLICY case_scans_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='case-scans' AND public.get_my_role() IS NOT NULL);
CREATE POLICY case_scans_write ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='case-scans' AND (
 public.get_my_role() IN('admin','coordinator','production_manager','technician','designer','representative','lab')
 OR (public.get_my_role()='doctor' AND public.doctor_portal_owns_file(name) AND lower(name)~'\.(stl|ply)$')));
CREATE POLICY case_scans_admin_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='case-scans' AND public.get_my_role()='admin');
CREATE OR REPLACE FUNCTION public.audit_doctor_case_attachment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage AS $$
DECLARE v_metadata jsonb;
BEGIN
 IF public.get_my_role()='doctor' THEN
   IF NEW.kind<>'instruction' OR NOT public.doctor_portal_can_access_order(NEW.order_id) OR NEW.storage_path NOT LIKE NEW.order_id::text||'/instruction/%' THEN RAISE EXCEPTION 'المرفق لا يتبع حالتك'; END IF;
   SELECT metadata INTO v_metadata FROM storage.objects WHERE bucket_id=NEW.storage_bucket AND name=NEW.storage_path;
   IF NOT FOUND THEN RAISE EXCEPTION 'ارفع الملف قبل تسجيله'; END IF;
   NEW.uploaded_by := public.get_my_user_id(); NEW.size_bytes := (v_metadata->>'size')::integer;
   NEW.mime_type := coalesce(v_metadata->>'mimetype',NEW.mime_type);
 END IF;
 RETURN NEW;
END;
$$;
NOTIFY pgrst,'reload schema';
