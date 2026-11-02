BEGIN;
DO $$ DECLARE v text; BEGIN
 SELECT pg_get_functiondef('public.guard_design_qc_execution()'::regprocedure) INTO v;
 IF strpos(v,'IF TG_OP=''UPDATE'' AND NEW.design_revision_id')=0 THEN RAISE EXCEPTION 'Unexpected snapshot guard'; END IF;
 EXECUTE replace(v,'IF TG_OP=''UPDATE'' AND NEW.design_revision_id',
 'IF TG_OP=''INSERT'' AND NEW.design_revision_id IS NOT NULL THEN RAISE EXCEPTION ''Execution revision is captured at start'' USING ERRCODE=''23514''; END IF;
 IF TG_OP=''UPDATE'' AND NEW.design_revision_id');
END $$;
COMMIT;
