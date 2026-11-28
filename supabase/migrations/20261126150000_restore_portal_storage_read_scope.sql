BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'portal_storage_read_scope'
  ) THEN
    CREATE POLICY portal_storage_read_scope ON storage.objects
      AS RESTRICTIVE FOR SELECT TO authenticated
      USING (
        public.get_my_role() IS DISTINCT FROM 'doctor'
        OR (bucket_id IN ('case-files', 'case-scans') AND public.doctor_portal_owns_file(name))
      );
  END IF;
END
$$;

COMMIT;
