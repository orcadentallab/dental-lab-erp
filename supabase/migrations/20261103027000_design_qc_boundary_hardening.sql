BEGIN;
DO $$ DECLARE v text; BEGIN
 SELECT pg_get_functiondef('public.return_design_revision(uuid,uuid,text)'::regprocedure) INTO v;
 EXECUTE replace(v,'IF public.get_my_role() NOT IN', 'IF public.get_my_role() IS NULL OR public.get_my_role() NOT IN');
 SELECT pg_get_functiondef('public.design_qc_can_read_files(uuid)'::regprocedure) INTO v;
 EXECUTE replace(v,'r.assignee_id=public.get_my_user_id()',
 '(r.assignee_id=public.get_my_user_id() AND r.status IN(''pending'',''ready'',''in_progress'',''waiting_external'') AND j.status IN(''queued'',''active'',''blocked''))');
END $$;
COMMIT;
