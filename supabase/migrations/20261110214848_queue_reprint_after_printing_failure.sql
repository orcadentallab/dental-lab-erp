BEGIN;

CREATE FUNCTION public.queue_failed_print_units(p_run uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    failed public.production_stage_runs%ROWTYPE;
    retry_id uuid;
BEGIN
    SELECT r.* INTO failed
    FROM public.production_stage_runs r JOIN public.production_stages s ON s.id=r.stage_id
    WHERE r.id=p_run AND s.code='printing' AND r.execution='internal'
        AND r.on_fail_goto_stage_id IS NULL AND r.status='done' AND r.units_failed>0
    FOR UPDATE OF r;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT id INTO retry_id FROM public.production_stage_runs
    WHERE rework_of=failed.id AND stage_id=failed.stage_id AND job_id=failed.job_id;
    IF FOUND THEN RETURN retry_id; END IF;

    INSERT INTO public.production_stage_runs (
        job_id,stage_id,seq,parallel_group,execution,advance_mode,allowed_roles,driven_by,variant_label,name_override,
        status,queued_at,units_in,rework_of,failure_cause_code
    ) VALUES (
        failed.job_id,failed.stage_id,failed.seq,failed.parallel_group,failed.execution,failed.advance_mode,
        failed.allowed_roles,failed.driven_by,failed.variant_label,'إعادة الطباعة',
        'ready',now(),failed.units_failed,failed.id,failed.failure_cause_code
    ) RETURNING id INTO retry_id;
    RETURN retry_id;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_failed_print_units(uuid) FROM PUBLIC,anon,authenticated;

DO $$
DECLARE
    definition text:=pg_get_functiondef('public.complete_stage_run(uuid,integer,integer,text,text,uuid)'::regprocedure);
    rework_anchor text:='IF v_failed > 0 AND v_run.on_fail_goto_stage_id IS NOT NULL THEN';
    quantity_anchor text:='IF v_failed > 0 AND p_cause_code IS NULL THEN';
BEGIN
    IF strpos(definition,rework_anchor)=0 OR strpos(definition,quantity_anchor)=0 THEN
        RAISE EXCEPTION 'Unexpected stage completion definition';
    END IF;
    definition:=replace(definition,quantity_anchor,$quantity$
    IF v_run.execution='internal' AND v_run.on_fail_goto_stage_id IS NULL
       AND v_passed+v_failed<>v_run.units_in
       AND EXISTS (SELECT 1 FROM public.production_stages WHERE id=v_run.stage_id AND code='printing') THEN
        RAISE EXCEPTION 'سجّل نتيجة كل وحدات الطباعة قبل إنهاء المحاولة' USING ERRCODE='23514';
    END IF;

    $quantity$||quantity_anchor);
    EXECUTE replace(definition,rework_anchor,$retry$
    IF v_failed>0 AND v_run.on_fail_goto_stage_id IS NULL THEN
        v_rework:=public.queue_failed_print_units(p_run_id);
    END IF;

    $retry$||rework_anchor);
END;
$$;

COMMIT;
