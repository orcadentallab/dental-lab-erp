BEGIN;

CREATE OR REPLACE FUNCTION public.mixed_try_in_doctor_action(p_run uuid,p_action text,p_notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    run public.production_stage_runs%ROWTYPE;
    case_order public.orders%ROWTYPE;
    action_note text:=nullif(btrim(p_notes),'');
    first_step integer;
    doctor_context text:=current_setting('app.mixed_try_in_doctor',true);
    order_context text:=current_setting('app.mixed_try_in_sync',true);
BEGIN
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','coordinator') THEN
        RAISE EXCEPTION 'رد الطبيب للأدمن والمنسق فقط' USING ERRCODE='42501';
    END IF;
    SELECT r.* INTO run FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id=r.job_id
    JOIN public.production_stages s ON s.id=r.stage_id WHERE r.id=p_run
      AND j.route_id='ba100000-0000-4000-8000-000000000001' AND s.code='doctor_review' FOR UPDATE OF r;
    IF NOT FOUND OR run.status<>'ready' THEN RAISE EXCEPTION 'الحالة ليست بانتظار رد الطبيب'; END IF;
    SELECT o.* INTO case_order FROM public.orders o JOIN public.production_jobs j ON j.order_id=o.id
    WHERE j.id=run.job_id FOR UPDATE OF o;
    IF NOT FOUND OR coalesce(case_order.is_deleted,false) OR coalesce(case_order.is_archived,false)
       OR case_order.issue_state<>'none' OR case_order.production_status<>'waiting_doctor'
       OR EXISTS (SELECT 1 FROM public.production_doctor_waits w WHERE w.order_id=case_order.id AND w.ended_at IS NULL) THEN
        RAISE EXCEPTION 'الحالة غير متاحة لاستكمال البروفة';
    END IF;
    IF p_action='approve' THEN
        IF run.doctor_approved_at IS NULL THEN
            UPDATE public.production_stage_runs SET doctor_approved_at=now(),doctor_approved_by=public.get_my_user_id(),
                notes=action_note WHERE id=p_run;
            INSERT INTO public.order_events(order_id,event_type,changed_by,actor_role,notes,severity)
            VALUES (case_order.id,'try_in_approved',public.get_my_user_id(),public.get_my_role(),action_note,'info');
        END IF;
        RETURN;
    END IF;

    IF p_action IN ('request_design_change','reprint') AND run.doctor_approved_at IS NULL THEN
        IF action_note IS NULL OR length(action_note)>1000 THEN RAISE EXCEPTION 'اكتب تفاصيل رد الطبيب'; END IF;
        first_step:=CASE WHEN p_action='request_design_change' THEN 10 ELSE 20 END;
        -- The original snapshot supplies the steps and roles for every new trial.
        INSERT INTO public.production_stage_runs (
            job_id,stage_id,seq,parallel_group,execution,advance_mode,allowed_roles,driven_by,variant_label,name_override,
            status,units_in,rework_of,notes
        )
        SELECT s.job_id,coalesce(legacy_qc.stage_id,s.stage_id),s.seq,s.parallel_group,s.execution,
            coalesce(legacy_qc.advance_mode,s.advance_mode),coalesce(legacy_qc.allowed_roles,s.allowed_roles),s.driven_by,s.variant_label,
            CASE s.seq WHEN 10 THEN 'تعديل التصميم حسب رد الطبيب' WHEN 20 THEN 'إعادة طباعة البروفة'
                WHEN 30 THEN 'فحص البروفة داخليًا' ELSE s.name_override END,
            'pending',run.units_in,p_run,action_note
        FROM public.production_stage_runs s
        LEFT JOIN public.production_stages original_stage ON original_stage.id=s.stage_id
        LEFT JOIN public.production_stage_runs legacy_qc
            ON s.seq=30 AND original_stage.code='packaging' AND legacy_qc.job_id=s.job_id
            AND legacy_qc.seq=70 AND legacy_qc.rework_of IS NULL
        WHERE s.job_id=run.job_id AND s.rework_of IS NULL AND s.seq BETWEEN first_step AND run.seq;

        IF p_action='request_design_change' THEN
            PERFORM set_config('app.mixed_try_in_sync',case_order.id::text,true);
            PERFORM public.return_design_revision(case_order.id,case_order.designer_id,action_note);
            PERFORM set_config('app.mixed_try_in_sync',coalesce(order_context,''),true);
        ELSE
            PERFORM public.set_mixed_try_in_status(case_order.id,'in_production');
        END IF;
        INSERT INTO public.order_events(order_id,event_type,changed_by,actor_role,notes,severity,metadata)
        VALUES (case_order.id,CASE p_action WHEN 'reprint' THEN 'try_in_reprint_requested' ELSE 'try_in_design_change_requested' END,
            public.get_my_user_id(),public.get_my_role(),action_note,'info',jsonb_build_object('run_id',p_run));
    ELSIF p_action IS DISTINCT FROM 'send_final' OR run.doctor_approved_at IS NULL THEN
        RAISE EXCEPTION 'إجراء البروفة غير متاح للحالة الحالية';
    END IF;

    PERFORM set_config('app.mixed_try_in_doctor',p_run::text,true);
    UPDATE public.production_stage_runs SET status='done',completed_at=now(),units_passed=units_in WHERE id=p_run;
    PERFORM set_config('app.mixed_try_in_doctor',coalesce(doctor_context,''),true);
    PERFORM public.advance_production_job(run.job_id);
END;
$$;

ALTER TABLE public.production_stage_runs ADD COLUMN is_supplier_replacement boolean NOT NULL DEFAULT false;
ALTER TABLE public.production_jobs ADD COLUMN active_supplier_quote_run_id uuid;

CREATE FUNCTION public.guard_direct_supplier_quote_assignment()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
    IF current_user IN ('anon','authenticated') AND (
        (TG_OP='INSERT' AND NEW.active_supplier_quote_run_id IS NOT NULL)
        OR (TG_OP='UPDATE' AND NEW.active_supplier_quote_run_id IS DISTINCT FROM OLD.active_supplier_quote_run_id)
    ) THEN RAISE EXCEPTION 'اختيار سعر المورد يتم من إرسال الشغل الخارجي' USING ERRCODE='42501'; END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_direct_supplier_quote_assignment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_direct_supplier_quote_assignment BEFORE INSERT OR UPDATE OF active_supplier_quote_run_id
ON public.production_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_direct_supplier_quote_assignment();

DO $$
DECLARE definition text; anchor text;
BEGIN
    definition:=pg_get_functiondef('public.mixed_physical_qc_action(uuid,text,text)'::regprocedure);
    anchor:='p_action IN (''retry'',''return_design'',''return_lab'')';
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected physical QC action list'; END IF;
    definition:=replace(definition,anchor,'p_action IN (''retry'',''return_design'',''return_lab'',''replace_lab'')');
    definition:=replace(definition,'p_action=''return_lab''','p_action IN (''return_lab'',''replace_lab'')');
    definition:=replace(definition,'m.rework_of IS NULL AND w.status=''returned''',
        'w.supplier_id=order_row.supplier_id AND w.status=''returned''');
    definition:=replace(definition,'assignee_id,supplier_id,rework_of,notes',
        'assignee_id,supplier_id,rework_of,notes,is_supplier_replacement');
    definition:=replace(definition,'CASE WHEN m.seq=60 THEN repair_supplier END,run.id,btrim(p_reason)',
        'CASE WHEN m.seq=60 AND p_action<>''replace_lab'' THEN repair_supplier END,run.id,btrim(p_reason),p_action=''replace_lab''');
    definition:=replace(definition,'ELSE ''physical_qc_returned_to_lab'' END',
        'WHEN ''replace_lab'' THEN ''physical_qc_alternate_lab_requested'' ELSE ''physical_qc_returned_to_lab'' END');
    anchor:='IF p_action=''return_design'' THEN';
    EXECUTE replace(definition,anchor,$quote$
        IF p_action='replace_lab' THEN
            INSERT INTO public.mixed_try_in_prices(stage_run_id,service_rates,catalog_total)
            SELECT new_run.id,quote.service_rates,quote.catalog_total
            FROM public.production_stage_runs new_run JOIN public.production_stage_runs original
              ON original.job_id=new_run.job_id AND original.seq=60 AND original.rework_of IS NULL
            JOIN public.mixed_try_in_prices quote ON quote.stage_run_id=original.id
            WHERE new_run.rework_of=run.id AND new_run.is_supplier_replacement;
            IF NOT FOUND THEN RAISE EXCEPTION 'سعر الخدمة الأصلي غير متاح'; END IF;
        END IF;
        $quote$||anchor);

    definition:=pg_get_functiondef('public.guard_mixed_try_in_external()'::regprocedure);
    anchor:='IF run.rework_of IS NOT NULL THEN';
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected external work guard'; END IF;
    definition:=replace(definition,anchor,'IF run.rework_of IS NOT NULL AND NOT run.is_supplier_replacement THEN');
    definition:=replace(definition,'IF run.status<>''ready'' THEN', $vendor$
        IF run.is_supplier_replacement AND EXISTS (SELECT 1 FROM public.orders WHERE id=target_order AND supplier_id=NEW.supplier_id) THEN
            RAISE EXCEPTION 'اختر معملًا مختلفًا عن المعمل الحالي';
        END IF;
        IF run.status<>'ready' THEN$vendor$);
    anchor:='IF NOT FOUND THEN RAISE EXCEPTION ''سجّل سعر الخراطة للخدمة أولًا''; END IF;';
    EXECUTE replace(definition,anchor,anchor||
        ' UPDATE public.production_jobs SET active_supplier_quote_run_id=run.id WHERE id=run.job_id;
          IF run.is_supplier_replacement THEN PERFORM public.set_mixed_try_in_status(target_order,''finalization''); END IF;');

    definition:=pg_get_functiondef('public.complete_mixed_try_in_shipment(uuid,uuid,timestamptz)'::regprocedure);
    anchor:='JOIN public.production_stage_runs m ON m.id=p.stage_run_id WHERE m.job_id=run.job_id';
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected final lab quote lookup'; END IF;
    EXECUTE replace(definition,anchor,anchor||$active$ AND m.id=coalesce(
        (SELECT active_supplier_quote_run_id FROM public.production_jobs WHERE id=run.job_id),
        (SELECT base.id FROM public.production_stage_runs base WHERE base.job_id=run.job_id AND base.seq=60 AND base.rework_of IS NULL)
    )$active$);

    definition:=pg_get_functiondef('public.update_mixed_try_in_price(uuid,numeric,text)'::regprocedure);
    anchor:='SELECT agreed_total INTO prior_amount';
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected quote revision lookup'; END IF;
    EXECUTE replace(definition,anchor,$active$
    IF EXISTS (SELECT 1 FROM public.production_jobs j JOIN public.production_stage_runs r ON r.job_id=j.id
               WHERE r.id=p_run AND j.active_supplier_quote_run_id IS NOT NULL AND j.active_supplier_quote_run_id<>p_run) THEN
        RAISE EXCEPTION 'السعر محفوظ للمعمل السابق. عدّل سعر المعمل الحالي';
    END IF;
    $active$||anchor);
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_route_for_order(p_order_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    case_order public.orders%ROWTYPE;
    selected_route uuid;
    service_routes uuid[];
BEGIN
    SELECT * INTO case_order FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF case_order.route_override_id IS NOT NULL THEN RETURN case_order.route_override_id; END IF;

    IF case_order.workflow_type = 'split' AND case_order.supplier_id IS NULL THEN
        SELECT j.route_id INTO selected_route
          FROM public.production_jobs j
         WHERE j.order_id = p_order_id AND NOT j.is_backfilled AND j.status <> 'cancelled'
         ORDER BY j.round_no DESC, j.created_at DESC, j.id
         LIMIT 1;
        IF selected_route IS NOT NULL THEN RETURN selected_route; END IF;

        SELECT array_agg(DISTINCT r.id) INTO service_routes
          FROM public.order_items oi
          JOIN public.services s ON s.name = oi.product_type
          LEFT JOIN public.service_families f ON f.id = s.family_id
          JOIN public.production_routes r ON r.id = COALESCE(s.route_id, f.default_route_id) AND r.is_active
         WHERE oi.order_id = p_order_id;
        IF cardinality(service_routes) > 1 THEN
            RAISE EXCEPTION 'الخدمات لها خرائط إنتاج مختلفة. حدّد خريطة الأوردر أولًا' USING ERRCODE = '23514';
        END IF;
        selected_route := service_routes[1];
    ELSE
        SELECT s.route_id INTO selected_route
          FROM public.order_items oi
          JOIN public.services s ON s.name = oi.product_type
         WHERE oi.order_id = p_order_id AND s.route_id IS NOT NULL
         ORDER BY s.sort_order NULLS LAST, s.name
         LIMIT 1;
    END IF;

    RETURN COALESCE(selected_route, (SELECT r.id FROM public.production_routes r WHERE r.is_fallback AND r.is_active LIMIT 1));
END;
$$;

COMMENT ON FUNCTION public.resolve_route_for_order(uuid) IS
'Internal split orders use their explicit override, existing job route, or unambiguous active service/family route. Legacy orders keep their direct service or fallback resolution.';

NOTIFY pgrst,'reload schema';
COMMIT;
