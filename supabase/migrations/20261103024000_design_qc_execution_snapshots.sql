BEGIN;
ALTER TABLE public.production_stage_runs ADD COLUMN design_revision_id uuid REFERENCES public.design_revisions(id);
ALTER TABLE public.external_work_orders ADD COLUMN design_revision_id uuid REFERENCES public.design_revisions(id);
CREATE OR REPLACE FUNCTION public.guard_design_qc_execution() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order_id uuid; v_required boolean; v_revision uuid; v_saved uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.design_revision_id IS DISTINCT FROM OLD.design_revision_id THEN RAISE EXCEPTION 'Execution revision is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='production_stage_runs' THEN
 IF NEW.status NOT IN('in_progress','waiting_external','done') OR (TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status) THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM public.production_stages WHERE id=NEW.stage_id AND code='design') THEN RETURN NEW; END IF;
 SELECT order_id INTO v_order_id FROM public.production_jobs WHERE id=NEW.job_id;
 ELSE
 IF NEW.status NOT IN('sent','returned') OR (TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status) THEN RETURN NEW; END IF;
 SELECT j.order_id,r.design_revision_id INTO v_order_id,v_saved FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id=r.job_id WHERE r.id=NEW.stage_run_id;
 END IF;
 SELECT design_qc_required OR (workflow_type='split' AND designer_id IS NOT NULL AND design_submitted_at IS NULL AND production_status IN('not_started','designing')),design_qc_revision_id INTO v_required,v_revision FROM public.orders WHERE id=v_order_id;
 v_revision:=coalesce(NEW.design_revision_id,v_saved,v_revision);
 IF (SELECT enabled FROM public.design_qc_control WHERE id) AND v_required AND NOT coalesce(public.design_qc_gate_passes(v_revision),false) THEN RAISE EXCEPTION 'Design QC approval or permitted bypass required' USING ERRCODE='23514'; END IF;
 NEW.design_revision_id:=v_revision;
 RETURN NEW;
END $$;
CREATE FUNCTION public.get_stage_design_execution_path(p_stage_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE v_order uuid;v_revision uuid;
BEGIN
 SELECT j.order_id,r.design_revision_id INTO v_order,v_revision FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id=r.job_id WHERE r.id=p_stage_id;
 IF NOT FOUND OR NOT coalesce(public.design_qc_can_read_files(v_order),false) THEN RAISE EXCEPTION 'Design access denied' USING ERRCODE='42501'; END IF;
 IF v_revision IS NULL THEN RETURN public.get_design_execution_path(v_order); END IF;
 RETURN (SELECT execution_path FROM public.design_revisions WHERE id=v_revision AND order_id=v_order);
END $$;
REVOKE ALL ON FUNCTION public.get_stage_design_execution_path(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_stage_design_execution_path(uuid) TO authenticated;
COMMIT;
