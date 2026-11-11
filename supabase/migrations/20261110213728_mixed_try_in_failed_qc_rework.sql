BEGIN;

ALTER TABLE public.production_stage_runs
    ADD COLUMN qc_followup_run_id uuid REFERENCES public.production_stage_runs(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.mixed_physical_qc_action(p_run uuid,p_action text,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    run public.production_stage_runs%ROWTYPE;
    job public.production_jobs%ROWTYPE;
    order_row public.orders%ROWTYPE;
    replacement uuid;
    repair_supplier uuid;
    work_seq integer;
    event_name text;
    bypass_prior text:=current_setting('app.mixed_physical_qc_bypass',true);
    order_prior text:=current_setting('app.mixed_try_in_sync',true);
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'إجراء الفحص للأدمن فقط' USING ERRCODE='42501'; END IF;
    IF nullif(btrim(p_reason),'') IS NULL OR length(btrim(p_reason))>1000 THEN RAISE EXCEPTION 'اكتب سبب الإجراء'; END IF;
    SELECT r.* INTO run FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id=r.job_id
    JOIN public.production_stages s ON s.id=r.stage_id
    WHERE r.id=p_run AND j.route_id='ba100000-0000-4000-8000-000000000001' AND s.code='qc' FOR UPDATE OF r;
    IF NOT FOUND THEN RAISE EXCEPTION 'الفحص غير موجود'; END IF;
    SELECT * INTO job FROM public.production_jobs WHERE id=run.job_id FOR UPDATE;
    SELECT * INTO order_row FROM public.orders WHERE id=job.order_id FOR UPDATE;
    IF order_row.is_deleted OR order_row.is_archived OR order_row.issue_state<>'none'
       OR order_row.production_status='final_delivered' OR EXISTS (
        SELECT 1 FROM public.production_doctor_waits WHERE order_id=order_row.id AND ended_at IS NULL
    ) THEN RAISE EXCEPTION 'الحالة غير متاحة لاستكمال الفحص'; END IF;

    IF p_action='bypass' AND run.status IN ('ready','in_progress') THEN
        PERFORM set_config('app.mixed_physical_qc_bypass',p_run::text,true);
        UPDATE public.production_stage_runs SET status='done',completed_at=now(),physical_qc_bypassed_at=now(),notes=btrim(p_reason)
        WHERE id=p_run;
        PERFORM set_config('app.mixed_physical_qc_bypass',coalesce(bypass_prior,''),true);
        PERFORM public.advance_production_job(run.job_id);
        event_name:='physical_qc_bypassed';
    ELSIF p_action IN ('retry','return_design','return_lab') AND run.status='done' AND run.units_passed=0
          AND run.failure_cause_code IS NOT NULL AND run.qc_followup_run_id IS NULL AND job.status='blocked' THEN
        work_seq:=CASE WHEN run.seq<50 THEN 20 ELSE 60 END;
        IF p_action='return_lab' AND work_seq<>60 THEN RAISE EXCEPTION 'البروفة لم تُنفذ في معمل خارجي'; END IF;
        IF work_seq=60 AND p_action<>'retry' THEN
            SELECT w.supplier_id INTO repair_supplier FROM public.external_work_orders w
            JOIN public.production_stage_runs m ON m.id=w.stage_run_id
            WHERE m.job_id=job.id AND m.seq=60 AND m.rework_of IS NULL AND w.status='returned';
            IF NOT FOUND THEN RAISE EXCEPTION 'لا يوجد استلام سابق من معمل لهذه الحالة'; END IF;
        END IF;
        IF p_action='return_design' AND (order_row.designer_id IS NULL OR order_row.design_qc_revision_id IS NULL) THEN
            RAISE EXCEPTION 'لا يوجد مصمم أو نسخة تصميم سابقة لهذه الحالة';
        END IF;

        INSERT INTO public.production_stage_runs (
            job_id,stage_id,seq,name_override,execution,advance_mode,allowed_roles,driven_by,status,
            queued_at,units_in,rework_of,notes
        ) VALUES (
            run.job_id,run.stage_id,run.seq,run.name_override,run.execution,run.advance_mode,run.allowed_roles,run.driven_by,
            CASE WHEN p_action='retry' THEN 'ready' ELSE 'pending' END,
            CASE WHEN p_action='retry' THEN now() END,run.units_in,run.id,btrim(p_reason)
        ) RETURNING id INTO replacement;
        UPDATE public.production_stage_runs SET qc_followup_run_id=replacement WHERE id=run.id;

        IF p_action<>'retry' THEN
            INSERT INTO public.production_stage_runs (
                job_id,stage_id,seq,name_override,variant_label,execution,advance_mode,allowed_roles,driven_by,
                status,queued_at,units_in,assignee_id,supplier_id,rework_of,notes
            )
            SELECT m.job_id,m.stage_id,m.seq,
                CASE WHEN m.seq=10 THEN 'تعديل التصميم بعد الفحص'
                     WHEN m.seq=60 THEN 'إعادة عمل عند المعمل الخارجي'
                     ELSE 'إعادة طباعة البروفة' END,
                m.variant_label,m.execution,m.advance_mode,m.allowed_roles,m.driven_by,
                CASE WHEN m.seq=10 OR p_action='return_lab' THEN 'ready' ELSE 'pending' END,
                CASE WHEN m.seq=10 OR p_action='return_lab' THEN now() END,run.units_in,
                CASE WHEN m.seq=10 THEN order_row.designer_id END,
                CASE WHEN m.seq=60 THEN repair_supplier END,run.id,btrim(p_reason)
            FROM public.production_stage_runs m WHERE m.job_id=run.job_id AND m.rework_of IS NULL
                AND (m.seq=work_seq OR (m.seq=10 AND p_action='return_design'));
        END IF;
        IF p_action='return_design' THEN
            PERFORM set_config('app.mixed_try_in_sync',order_row.id::text,true);
            PERFORM public.return_design_revision(order_row.id,order_row.designer_id,p_reason);
            PERFORM set_config('app.mixed_try_in_sync',coalesce(order_prior,''),true);
        END IF;
        UPDATE public.production_jobs SET status='active' WHERE id=run.job_id;
        event_name:=CASE p_action WHEN 'retry' THEN 'physical_qc_reopened' WHEN 'return_design' THEN 'physical_qc_returned_to_design'
                    ELSE 'physical_qc_returned_to_lab' END;
    ELSE
        RAISE EXCEPTION 'إجراء الفحص غير متاح للحالة الحالية';
    END IF;
    INSERT INTO public.order_events(order_id,event_type,changed_by,actor_role,notes,severity,metadata)
    VALUES (order_row.id,event_name,public.get_my_user_id(),'admin',btrim(p_reason),'info',
        jsonb_build_object('run_id',p_run,'followup_run_id',replacement,'previous_failure',run.failure_cause_code,'repair_supplier_id',repair_supplier));
END;
$$;

DO $$
DECLARE definition text; anchor text;
BEGIN
    definition:=pg_get_functiondef('public.guard_mixed_try_in_stage()'::regprocedure);
    anchor:='AND r.seq<NEW.seq AND s.code=''qc''';
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected shipping QC guard'; END IF;
    EXECUTE replace(definition,anchor,anchor||' AND r.qc_followup_run_id IS NULL');

    definition:=pg_get_functiondef('public.guard_mixed_try_in_external()'::regprocedure);
    anchor:='IF TG_OP=''INSERT'' THEN';
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected external work order guard'; END IF;
    EXECUTE replace(definition,anchor,$repair$
    IF run.rework_of IS NOT NULL THEN
        IF NEW.supplier_id IS DISTINCT FROM run.supplier_id OR
           (TG_OP='INSERT' AND (run.status<>'ready' OR NEW.agreed_cost IS NOT NULL)) THEN
            RAISE EXCEPTION 'إعادة العمل تُرسل للمعمل الأصلي على نفس حساب الحالة';
        END IF;
        IF TG_OP='INSERT' THEN PERFORM public.set_mixed_try_in_status(target_order,'finalization'); END IF;
        NEW.agreed_cost:=NULL;
        RETURN NEW;
    END IF;
    $repair$||anchor);

    definition:=pg_get_functiondef('public.sync_mixed_try_in_design()'::regprocedure);
    anchor:='FOR UPDATE OF r;';
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected design handoff'; END IF;
    EXECUTE replace(definition,anchor,
        'AND (r.rework_of IS NULL OR NEW.design_qc_revision_id IS DISTINCT FROM OLD.design_qc_revision_id OR
              (SELECT max(e.created_at) FROM public.design_qc_events e
               WHERE e.order_id=NEW.id AND e.revision_id=NEW.design_qc_revision_id AND e.action IN (''approved'',''bypassed''))>=r.queued_at)
         '||anchor);

    definition:=pg_get_functiondef('public.sync_mixed_try_in_stage()'::regprocedure);
    anchor:='ELSIF stage_code=''milling'' THEN';
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected route status synchronization'; END IF;
    -- Design QC release must finish in in_production. A rework changes to
    -- finalization when the external dispatch is actually recorded.
    EXECUTE replace(definition,anchor,'ELSIF stage_code=''milling'' AND NEW.rework_of IS NULL THEN');
END;
$$;

-- A design correction is design time even when it occurs after production.
CREATE OR REPLACE FUNCTION public.production_case_times(p_order uuid)
RETURNS TABLE(design_minutes integer,production_minutes integer,doctor_minutes integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
    WITH runs AS (
        SELECT r.queued_at,r.completed_at,r.doctor_approved_at,r.status,r.rework_of,s.code
        FROM public.production_jobs j JOIN public.production_stage_runs r ON r.job_id=j.id
        JOIN public.production_stages s ON s.id=r.stage_id WHERE j.order_id=p_order
    ), bounds AS (
        SELECT o.created_at AS opened,
            greatest(o.created_at,coalesce(o.first_delivered_at,now())) AS closed,
            CASE WHEN count(*) FILTER (WHERE r.code='design')=0 THEN o.created_at
                 ELSE min(r.completed_at) FILTER (WHERE r.code='design' AND r.status='done' AND r.rework_of IS NULL)
            END AS design_done
        FROM public.orders o LEFT JOIN runs r ON true
        WHERE o.id=p_order AND EXISTS (SELECT 1 FROM public.production_jobs WHERE order_id=p_order)
        GROUP BY o.id
    ), intervals AS (
        SELECT w.started_at AS since,coalesce(w.ended_at,now()) AS until
        FROM public.production_doctor_waits w WHERE w.order_id=p_order
        UNION ALL
        SELECT r.queued_at,coalesce(r.doctor_approved_at,r.completed_at,now())
        FROM runs r WHERE r.code='doctor_review' AND r.queued_at IS NOT NULL
    ), doctor AS (
        SELECT coalesce(range_agg(tstzrange(greatest(i.since,b.opened),least(i.until,b.closed))),'{}'::tstzmultirange) AS ranges
        FROM intervals i CROSS JOIN bounds b WHERE greatest(i.since,b.opened)<least(i.until,b.closed)
    ), design_intervals AS (
        SELECT tstzrange(b.opened,least(b.closed,greatest(b.opened,coalesce(b.design_done,b.closed)))) AS period
        FROM bounds b
        UNION ALL
        SELECT tstzrange(greatest(b.opened,r.queued_at),least(b.closed,coalesce(r.completed_at,now())))
        FROM bounds b CROSS JOIN runs r
        WHERE r.code='design' AND r.rework_of IS NOT NULL AND r.queued_at IS NOT NULL
          AND greatest(b.opened,r.queued_at)<least(b.closed,coalesce(r.completed_at,now()))
    ), design AS (
        SELECT coalesce(range_agg(period),'{}'::tstzmultirange) AS ranges FROM design_intervals
    ), phases AS (
        SELECT d.ranges AS design_range, tstzmultirange(tstzrange(b.opened,b.closed))-d.ranges AS production_range,
            dr.ranges AS doctor_range FROM bounds b CROSS JOIN design d CROSS JOIN doctor dr
    )
    SELECT (SELECT coalesce(floor(sum(extract(epoch FROM upper(x)-lower(x)))/60),0)::integer FROM unnest(design_range-doctor_range) x),
           (SELECT coalesce(floor(sum(extract(epoch FROM upper(x)-lower(x)))/60),0)::integer FROM unnest(production_range-doctor_range) x),
           (SELECT coalesce(floor(sum(extract(epoch FROM upper(x)-lower(x)))/60),0)::integer FROM unnest(doctor_range) x)
    FROM phases;
$$;

NOTIFY pgrst,'reload schema';
COMMIT;
