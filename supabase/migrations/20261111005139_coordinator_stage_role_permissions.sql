BEGIN;

-- Keep existing custom assignments. Extend the pilot's default bench roles.
UPDATE public.production_route_stages step
SET allowed_roles=array_append(step.allowed_roles,'coordinator')
FROM public.production_stages stage
WHERE step.stage_id=stage.id AND step.route_id='ba100000-0000-4000-8000-000000000001'
  AND stage.code IN ('printing','packaging') AND step.driven_by='my_tasks'
  AND step.allowed_roles @> ARRAY['admin','production_manager','technician']
  AND step.allowed_roles <@ ARRAY['admin','production_manager','technician'];

CREATE FUNCTION public.can_execute_stage_task(p_run public.production_stage_runs)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
    SELECT CASE WHEN public.get_my_role()='coordinator' THEN
        p_run.execution='internal' AND p_run.driven_by='my_tasks' AND 'coordinator'=ANY(p_run.allowed_roles)
    WHEN public.can_work_production() THEN
        p_run.driven_by IS DISTINCT FROM 'my_tasks' OR cardinality(p_run.allowed_roles)=0
        OR public.get_my_role()=ANY(p_run.allowed_roles)
    ELSE false END;
$$;
REVOKE ALL ON FUNCTION public.can_execute_stage_task(public.production_stage_runs) FROM PUBLIC,anon,authenticated;

DO $$
DECLARE
    signature regprocedure;
    definition text;
    lookup_anchor text:='SELECT * INTO v_run FROM public.production_stage_runs WHERE id = p_run_id FOR UPDATE;';
    role_anchor text:='IF NOT public.can_work_production() THEN';
    pilot_anchor text:=$anchor$IF stage_code IN ('printing','packaging') AND NEW.status IN ('in_progress','done','failed')
       AND coalesce(actor,'') NOT IN ('admin','production_manager','technician') THEN
        RAISE EXCEPTION 'الطباعة والتغليف لفريق الإنتاج' USING ERRCODE='42501';
    END IF;$anchor$;
    qc_anchor text:=$anchor$IF stage_code='qc' AND NEW.status IN ('in_progress','done','failed') AND actor IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'الفحص الداخلي للأدمن فقط' USING ERRCODE='42501';
    END IF;$anchor$;
BEGIN
    FOREACH signature IN ARRAY ARRAY[
        'public.start_stage_run(uuid,uuid)'::regprocedure,
        'public.complete_stage_run(uuid,integer,integer,text,text,uuid)'::regprocedure,
        'public.block_stage_run(uuid,text,text)'::regprocedure
    ] LOOP
        definition:=pg_get_functiondef(signature);
        IF strpos(definition,lookup_anchor)=0 OR strpos(definition,role_anchor)=0 THEN
            RAISE EXCEPTION 'Unexpected production task definition: %',signature;
        END IF;
        definition:=replace(definition,role_anchor,
            'IF NOT public.can_work_production() AND public.get_my_role() IS DISTINCT FROM ''coordinator'' THEN');
        EXECUTE replace(definition,lookup_anchor,lookup_anchor||$check$
    IF v_run.id IS NOT NULL AND NOT coalesce(public.can_execute_stage_task(v_run),false) THEN
        RAISE EXCEPTION 'دورك غير مسموح له بتنفيذ هذه المرحلة' USING ERRCODE='42501';
    END IF;$check$);
    END LOOP;
    definition:=pg_get_functiondef('public.guard_mixed_try_in_stage()'::regprocedure);
    IF strpos(definition,pilot_anchor)=0 OR strpos(definition,qc_anchor)=0 THEN RAISE EXCEPTION 'Unexpected pilot bench role guard'; END IF;
    EXECUTE replace(replace(definition,pilot_anchor,''),qc_anchor,'');
END;
$$;

-- Client task transitions must pass through the RPCs so role assignments
-- cannot be changed or bypassed by writing the stage row directly.
CREATE FUNCTION public.guard_direct_stage_task_write()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
    IF current_user IN ('authenticated','anon') AND (
        (TG_OP<>'INSERT' AND OLD.driven_by='my_tasks')
        OR (TG_OP<>'DELETE' AND NEW.driven_by='my_tasks')
    ) THEN
        RAISE EXCEPTION 'استخدم إجراء المهمة لتحديث المرحلة' USING ERRCODE='42501';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_direct_stage_task_write() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_direct_stage_task_write BEFORE INSERT OR UPDATE OR DELETE ON public.production_stage_runs
FOR EACH ROW EXECUTE FUNCTION public.guard_direct_stage_task_write();

COMMIT;
