BEGIN;
DO $$ DECLARE v text; BEGIN
 SELECT pg_get_functiondef('public.reassign_design_revision(uuid,uuid,text,numeric,numeric,uuid)'::regprocedure) INTO v;
 EXECUTE replace(v,'p_old_amount<0 OR p_new_amount<0','p_old_amount NOT BETWEEN 0 AND 9999999999.99 OR (p_new_amount IS NOT NULL AND p_new_amount NOT BETWEEN 0 AND 9999999999.99)');
 SELECT pg_get_functiondef('public.get_design_qc_state(uuid)'::regprocedure) INTO v;
 v:=replace(v,'to_jsonb(e) ORDER BY created_at DESC','to_jsonb(e)||jsonb_build_object(''actor_name'',(SELECT name FROM public.users WHERE id=e.actor_id)) ORDER BY created_at DESC');
 EXECUTE v;
END $$;
DROP POLICY qc_assignment_read ON public.design_qc_assignments;
CREATE POLICY qc_assignment_read ON public.design_qc_assignments FOR SELECT TO authenticated USING(public.get_my_role() IN('admin','accountant','coordinator'));
COMMIT;
