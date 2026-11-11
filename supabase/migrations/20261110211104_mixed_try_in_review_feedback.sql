BEGIN;

-- Adjust the route template for new jobs.
UPDATE public.production_route_stages step SET
    stage_id=(SELECT id FROM public.production_stages WHERE code='qc'),
    name_override='فحص البروفة داخليًا', advance_mode='qc_gate', allowed_roles=ARRAY['admin']
WHERE route_id='ba100000-0000-4000-8000-000000000001' AND step_no=30;
DELETE FROM public.production_route_stages
WHERE route_id='ba100000-0000-4000-8000-000000000001' AND step_no=80;

CREATE TABLE public.production_doctor_waits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    started_at timestamptz NOT NULL DEFAULT now(),
    started_by uuid REFERENCES public.users(id),
    ended_at timestamptz,
    ended_by uuid REFERENCES public.users(id)
);
CREATE UNIQUE INDEX one_open_production_doctor_wait ON public.production_doctor_waits(order_id) WHERE ended_at IS NULL;
ALTER TABLE public.production_doctor_waits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.production_doctor_waits FROM anon,authenticated;
GRANT SELECT ON public.production_doctor_waits TO authenticated;
CREATE POLICY read_production_doctor_waits ON public.production_doctor_waits FOR SELECT TO authenticated
    USING ((SELECT public.get_my_role()) IN ('admin','coordinator','production_manager','technician','accountant'));

CREATE FUNCTION public.set_production_doctor_wait(p_order uuid, p_wait boolean, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    actor text:=public.get_my_role();
    order_row public.orders%ROWTYPE;
BEGIN
    IF actor IS NULL OR actor NOT IN ('admin','coordinator','production_manager') THEN
        RAISE EXCEPTION 'تعليق الحالة متاح للأدمن والمنسق ومسؤول الإنتاج' USING ERRCODE='42501';
    END IF;
    SELECT * INTO order_row FROM public.orders WHERE id=p_order FOR UPDATE;
    IF NOT FOUND OR order_row.is_deleted OR order_row.issue_state<>'none'
       OR order_row.production_status='final_delivered' THEN RAISE EXCEPTION 'الحالة غير متاحة للانتظار'; END IF;
    IF p_wait THEN
        IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'اكتب المطلوب من الطبيب'; END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.production_jobs j JOIN public.production_stage_runs r ON r.job_id=j.id
            WHERE j.order_id=p_order AND j.status IN ('active','queued')
              AND r.status IN ('ready','in_progress') AND r.execution='internal'
        ) THEN RAISE EXCEPTION 'علّق الحالة أثناء التصميم أو خطوة إنتاج داخلية مفتوحة'; END IF;
        INSERT INTO public.production_doctor_waits(order_id,reason,started_by)
        VALUES(p_order,btrim(p_reason),public.get_my_user_id());
    ELSE
        UPDATE public.production_doctor_waits SET ended_at=now(),ended_by=public.get_my_user_id()
        WHERE order_id=p_order AND ended_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'الحالة ليست منتظرة مدخلات من الطبيب'; END IF;
    END IF;
    INSERT INTO public.order_events(order_id,event_type,changed_by,actor_role,notes,severity)
    VALUES (p_order,CASE WHEN p_wait THEN 'production_doctor_wait_started' ELSE 'production_doctor_wait_ended' END,
        public.get_my_user_id(),actor,CASE WHEN p_wait THEN btrim(p_reason) ELSE 'وصل المطلوب من الطبيب' END,'info');
END;
$$;

CREATE FUNCTION public.guard_production_doctor_wait() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_order uuid;
BEGIN
    IF TG_TABLE_NAME='orders' THEN
        target_order:=NEW.id;
    ELSE
        IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
        SELECT order_id INTO target_order FROM public.production_jobs WHERE id=NEW.job_id;
        -- Serialize against an operator starting a hold on the same order.
        PERFORM 1 FROM public.orders WHERE id=target_order FOR NO KEY UPDATE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.production_doctor_waits WHERE order_id=target_order AND ended_at IS NULL) THEN
        RAISE EXCEPTION 'الحالة منتظرة مدخلات من الطبيب. سجّل وصول المطلوب قبل استكمالها' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER production_doctor_wait_stage_guard BEFORE UPDATE OF status ON public.production_stage_runs
FOR EACH ROW EXECUTE FUNCTION public.guard_production_doctor_wait();
CREATE TRIGGER production_doctor_wait_order_guard BEFORE UPDATE OF production_status,design_qc_revision_id ON public.orders
FOR EACH ROW WHEN (OLD.production_status IS DISTINCT FROM NEW.production_status OR OLD.design_qc_revision_id IS DISTINCT FROM NEW.design_qc_revision_id)
EXECUTE FUNCTION public.guard_production_doctor_wait();

-- A bypass has its own audit marker. It never records units as inspected.
ALTER TABLE public.production_stage_runs ADD COLUMN physical_qc_bypassed_at timestamptz;
CREATE FUNCTION public.mixed_physical_qc_action(p_run uuid,p_action text,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    run public.production_stage_runs%ROWTYPE;
    target_order uuid;
    previous text:=current_setting('app.mixed_physical_qc_bypass',true);
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'إجراء الفحص للأدمن فقط' USING ERRCODE='42501'; END IF;
    IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'اكتب سبب الإجراء'; END IF;
    SELECT r.* INTO run FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id=r.job_id
    JOIN public.production_stages s ON s.id=r.stage_id
    WHERE r.id=p_run AND j.route_id='ba100000-0000-4000-8000-000000000001' AND s.code='qc' FOR UPDATE OF r;
    IF NOT FOUND THEN RAISE EXCEPTION 'الفحص غير موجود'; END IF;
    SELECT order_id INTO target_order FROM public.production_jobs WHERE id=run.job_id;
    IF p_action='bypass' AND run.status IN ('ready','in_progress') THEN
        PERFORM set_config('app.mixed_physical_qc_bypass',p_run::text,true);
        UPDATE public.production_stage_runs SET status='done',completed_at=now(),physical_qc_bypassed_at=now(),notes=btrim(p_reason)
        WHERE id=p_run;
        PERFORM set_config('app.mixed_physical_qc_bypass',coalesce(previous,''),true);
        PERFORM public.advance_production_job(run.job_id);
    ELSIF p_action='retry' AND run.status='done' AND run.units_passed=0 AND run.failure_cause_code IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.production_jobs WHERE id=run.job_id AND status='blocked') THEN
        UPDATE public.production_stage_runs SET status='ready',queued_at=now(),started_at=NULL,completed_at=NULL,
            units_failed=0,failure_cause_code=NULL,assignee_id=NULL,notes=NULL WHERE id=p_run;
        UPDATE public.production_jobs SET status='active' WHERE id=run.job_id;
    ELSE
        RAISE EXCEPTION 'إجراء الفحص غير متاح للحالة الحالية';
    END IF;
    INSERT INTO public.order_events(order_id,event_type,changed_by,actor_role,notes,severity,metadata)
    VALUES (target_order,CASE WHEN p_action='bypass' THEN 'physical_qc_bypassed' ELSE 'physical_qc_reopened' END,
        public.get_my_user_id(),'admin',btrim(p_reason),'info',jsonb_build_object('run_id',p_run,'previous_failure',run.failure_cause_code));
END;
$$;

DO $$
DECLARE definition text:=pg_get_functiondef('public.guard_mixed_try_in_stage()'::regprocedure);
BEGIN
    definition:=replace(definition,'الفحص النهائي للأدمن فقط','الفحص الداخلي للأدمن فقط');
    definition:=replace(definition,$old$AND coalesce(NEW.units_passed,0)<>NEW.units_in$old$,
        $new$AND coalesce(NEW.units_passed,0)<>NEW.units_in
       AND current_setting('app.mixed_physical_qc_bypass',true) IS DISTINCT FROM NEW.id::text$new$);
    definition:=replace(definition,$old$(r.status<>'done' OR coalesce(r.units_passed,0)<>r.units_in)$old$,
        $new$(r.status<>'done' OR (coalesce(r.units_passed,0)<>r.units_in AND r.physical_qc_bypassed_at IS NULL))$new$);
    EXECUTE definition;
END;
$$;

REVOKE ALL ON FUNCTION public.set_production_doctor_wait(uuid,boolean,text),
    public.guard_production_doctor_wait(),public.mixed_physical_qc_action(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_production_doctor_wait(uuid,boolean,text),
    public.mixed_physical_qc_action(uuid,text,text) TO authenticated;

CREATE FUNCTION public.production_doctor_hold_work_minutes(p_job uuid,p_from timestamptz,p_to timestamptz)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT coalesce(sum(public.working_minutes_between(greatest(w.started_at,p_from),least(coalesce(w.ended_at,now()),p_to))),0)
    FROM public.production_doctor_waits w JOIN public.production_jobs j ON j.order_id=w.order_id
    WHERE j.id=p_job AND p_from IS NOT NULL AND p_to IS NOT NULL
      AND w.started_at<p_to AND coalesce(w.ended_at,now())>p_from;
$$;
CREATE FUNCTION public.exclude_doctor_holds_from_stage_time()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF NEW.execution='internal' THEN
        IF NEW.wait_minutes IS NOT NULL THEN NEW.wait_minutes:=greatest(0,NEW.wait_minutes-
            public.production_doctor_hold_work_minutes(NEW.job_id,NEW.queued_at,NEW.started_at)); END IF;
        IF NEW.touch_minutes IS NOT NULL THEN NEW.touch_minutes:=greatest(0,NEW.touch_minutes-
            public.production_doctor_hold_work_minutes(NEW.job_id,NEW.started_at,NEW.completed_at)); END IF;
        IF NEW.stage_minutes IS NOT NULL THEN NEW.stage_minutes:=greatest(0,NEW.stage_minutes-
            public.production_doctor_hold_work_minutes(NEW.job_id,NEW.queued_at,NEW.completed_at)); END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER zz_exclude_doctor_holds_from_stage_time
BEFORE INSERT OR UPDATE OF queued_at,started_at,completed_at,execution,machine_id ON public.production_stage_runs
FOR EACH ROW EXECUTE FUNCTION public.exclude_doctor_holds_from_stage_time();
REVOKE ALL ON FUNCTION public.production_doctor_hold_work_minutes(uuid,timestamptz,timestamptz),
    public.exclude_doctor_holds_from_stage_time() FROM PUBLIC,anon,authenticated;

-- Operational work orders carry no pilot price. Only the admin price API
-- can read the quote before final delivery.
CREATE TABLE public.mixed_try_in_prices (
    stage_run_id uuid PRIMARY KEY REFERENCES public.production_stage_runs(id) ON DELETE CASCADE,
    service_rates jsonb NOT NULL,
    catalog_total numeric(12,2),
    agreed_total numeric(12,2)
);
ALTER TABLE public.mixed_try_in_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mixed_try_in_prices FROM anon,authenticated;

CREATE FUNCTION public.capture_mixed_try_in_price() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rates jsonb;
BEGIN
    IF NEW.planned_external_cost IS NULL THEN RETURN NEW; END IF;
    SELECT coalesce(jsonb_object_agg(i.product_type,sv.milling_price),'{}') INTO rates
    FROM public.production_jobs j JOIN public.order_items i ON i.order_id=j.order_id
    JOIN public.services sv ON sv.name=i.product_type WHERE j.id=NEW.job_id;
    INSERT INTO public.mixed_try_in_prices(stage_run_id,service_rates,catalog_total)
    VALUES(NEW.id,rates,NEW.planned_external_cost) ON CONFLICT(stage_run_id) DO NOTHING;
    NEW.planned_external_cost:=NULL;
    RETURN NEW;
END;
$$;
CREATE TRIGGER capture_mixed_try_in_price BEFORE UPDATE OF planned_external_cost ON public.production_stage_runs
FOR EACH ROW EXECUTE FUNCTION public.capture_mixed_try_in_price();

CREATE FUNCTION public.resolve_mixed_try_in_price(p_run uuid,p_supplier uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT CASE WHEN p.agreed_total IS NOT NULL THEN p.agreed_total
        WHEN p_supplier IS NULL THEN p.catalog_total
        ELSE (SELECT sum(greatest(coalesce(i.count,1),1) *
            CASE WHEN jsonb_typeof(s.milling_prices->i.product_type)='number'
                 THEN (s.milling_prices->>i.product_type)::numeric
                 ELSE (p.service_rates->>i.product_type)::numeric END)
            FROM public.order_items i WHERE i.order_id=j.order_id)
        END
    FROM public.mixed_try_in_prices p
    JOIN public.production_stage_runs r ON r.id=p.stage_run_id
    JOIN public.production_jobs j ON j.id=r.job_id
    LEFT JOIN public.suppliers s ON s.id=p_supplier
    WHERE p.stage_run_id=p_run;
$$;

CREATE FUNCTION public.get_mixed_try_in_price(p_run uuid,p_supplier uuid DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'السعر للأدمن فقط' USING ERRCODE='42501'; END IF;
    RETURN public.resolve_mixed_try_in_price(p_run,p_supplier);
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_mixed_try_in_external() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE run public.production_stage_runs%ROWTYPE; target_order uuid; stage_code text; price numeric;
    prior text:=current_setting('app.mixed_try_in_sync',true);
BEGIN
    SELECT r.* INTO run FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id=r.job_id
    WHERE r.id=NEW.stage_run_id AND j.route_id='ba100000-0000-4000-8000-000000000001';
    IF NOT FOUND THEN RETURN NEW; END IF;
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','production_manager') THEN
        RAISE EXCEPTION 'إرسال واستلام الخراطة للأدمن ومسؤول الإنتاج' USING ERRCODE='42501';
    END IF;
    SELECT j.order_id,s.code INTO target_order,stage_code FROM public.production_jobs j CROSS JOIN public.production_stages s
    WHERE j.id=run.job_id AND s.id=run.stage_id;
    IF stage_code<>'milling' THEN RAISE EXCEPTION 'الشحن له إجراء مستقل'; END IF;
    IF TG_OP='INSERT' THEN
        IF run.status<>'ready' THEN RAISE EXCEPTION 'الخراطة ليست جاهزة للإرسال'; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id=NEW.supplier_id AND is_active IS DISTINCT FROM false AND supplier_type='external_lab') THEN
            RAISE EXCEPTION 'اختر معملًا خارجيًا نشطًا';
        END IF;
        IF NEW.agreed_cost IS NOT NULL AND public.get_my_role() IS DISTINCT FROM 'admin' THEN
            RAISE EXCEPTION 'تعديل السعر للأدمن فقط' USING ERRCODE='42501';
        END IF;
        price:=coalesce(NEW.agreed_cost,public.resolve_mixed_try_in_price(run.id,NEW.supplier_id));
        IF price IS NULL OR price<=0 OR price>=10000000000 THEN RAISE EXCEPTION 'سعر الخراطة يجب أن يكون أكبر من صفر'; END IF;
        UPDATE public.mixed_try_in_prices SET agreed_total=price WHERE stage_run_id=run.id;
        IF NOT FOUND THEN RAISE EXCEPTION 'سجّل سعر الخراطة للخدمة أولًا'; END IF;
        PERFORM set_config('app.mixed_try_in_sync',target_order::text,true);
        UPDATE public.orders SET supplier_id=NEW.supplier_id,manual_cost=NULL,cost=coalesce(designer_cost,0) WHERE id=target_order;
        PERFORM set_config('app.mixed_try_in_sync',coalesce(prior,''),true);
    ELSIF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id THEN
        RAISE EXCEPTION 'المعمل مثبت عند الإرسال';
    END IF;
    NEW.agreed_cost:=NULL;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.write_mixed_try_in_final_cost(p_order uuid,p_price numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior text:=current_setting('app.mixed_try_in_sync',true);
BEGIN
    PERFORM set_config('app.mixed_try_in_sync',p_order::text,true);
    UPDATE public.orders SET manual_cost=p_price,cost=coalesce(designer_cost,0)+p_price WHERE id=p_order;
    PERFORM set_config('app.mixed_try_in_sync',coalesce(prior,''),true);
END;
$$;

DO $$
DECLARE definition text:=pg_get_functiondef('public.complete_mixed_try_in_shipment(uuid,uuid,timestamptz)'::regprocedure);
    anchor text:='PERFORM public.record_order_final_delivery_v2';
BEGIN
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected pilot shipment confirmation definition'; END IF;
    EXECUTE replace(definition,anchor,
        'PERFORM public.write_mixed_try_in_final_cost(p_order,(SELECT p.agreed_total FROM public.mixed_try_in_prices p
            JOIN public.production_stage_runs m ON m.id=p.stage_run_id WHERE m.job_id=run.job_id));
         '||anchor);
END;
$$;

CREATE FUNCTION public.update_mixed_try_in_price(p_run uuid,p_amount numeric,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_order uuid; order_row public.orders%ROWTYPE; prior_amount numeric;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'تعديل السعر للأدمن فقط' USING ERRCODE='42501'; END IF;
    IF p_amount IS NULL OR p_amount<=0 OR p_amount>=10000000000 OR nullif(btrim(p_reason),'') IS NULL THEN
        RAISE EXCEPTION 'اكتب سعرًا صحيحًا وسبب التعديل';
    END IF;
    SELECT j.order_id INTO target_order FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id=r.job_id
    JOIN public.external_work_orders w ON w.stage_run_id=r.id WHERE r.id=p_run AND w.status IN ('sent','returned');
    SELECT * INTO order_row FROM public.orders WHERE id=target_order FOR UPDATE;
    IF NOT FOUND OR order_row.is_deleted OR order_row.issue_state<>'none' THEN RAISE EXCEPTION 'الحالة غير متاحة لتعديل السعر'; END IF;
    SELECT agreed_total INTO prior_amount FROM public.mixed_try_in_prices WHERE stage_run_id=p_run FOR UPDATE;
    IF NOT FOUND OR prior_amount IS NULL THEN RAISE EXCEPTION 'سعر الخراطة غير موجود'; END IF;
    IF prior_amount=round(p_amount,2) THEN RETURN; END IF;
    IF order_row.production_status='final_delivered' THEN
        PERFORM 1 FROM public.financial_obligations
        WHERE order_id=target_order AND entity_type='external_lab' AND status<>'void' FOR UPDATE;
        IF EXISTS (SELECT 1 FROM public.financial_obligations WHERE order_id=target_order AND entity_type='external_lab'
            AND status<>'void' AND allocated_amount>0) THEN
            RAISE EXCEPTION 'فيه سداد مخصص للاستحقاق. استخدم التسوية المحاسبية مع حفظ حركة السداد.';
        END IF;
        PERFORM public.write_mixed_try_in_final_cost(target_order,round(p_amount,2));
    END IF;
    UPDATE public.mixed_try_in_prices SET agreed_total=round(p_amount,2) WHERE stage_run_id=p_run;
    INSERT INTO public.order_events(order_id,event_type,changed_by,actor_role,notes,severity)
    VALUES(target_order,'external_work_price_updated',public.get_my_user_id(),'admin',btrim(p_reason),'info');
END;
$$;

REVOKE ALL ON FUNCTION public.capture_mixed_try_in_price(),public.resolve_mixed_try_in_price(uuid,uuid),
    public.get_mixed_try_in_price(uuid,uuid),public.write_mixed_try_in_final_cost(uuid,numeric),
    public.update_mixed_try_in_price(uuid,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_mixed_try_in_price(uuid,uuid),
    public.update_mixed_try_in_price(uuid,numeric,text) TO authenticated;

CREATE FUNCTION public.production_case_times(p_order uuid)
RETURNS TABLE(design_minutes integer,production_minutes integer,doctor_minutes integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
    WITH bounds AS (
        SELECT o.created_at AS opened,
            greatest(o.created_at,coalesce(o.first_delivered_at,now())) AS closed,
            CASE WHEN count(*) FILTER (WHERE s.code='design')=0 THEN o.created_at
                 ELSE min(r.completed_at) FILTER (WHERE s.code='design' AND r.status='done') END AS design_done
        FROM public.orders o JOIN public.production_jobs j ON j.order_id=o.id
        LEFT JOIN public.production_stage_runs r ON r.job_id=j.id
        LEFT JOIN public.production_stages s ON s.id=r.stage_id
        WHERE o.id=p_order GROUP BY o.id
    ), intervals AS (
        SELECT w.started_at AS since,coalesce(w.ended_at,now()) AS until
        FROM public.production_doctor_waits w WHERE w.order_id=p_order
        UNION ALL
        SELECT r.queued_at,coalesce(r.doctor_approved_at,r.completed_at,now())
        FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id=r.job_id
        JOIN public.production_stages s ON s.id=r.stage_id
        WHERE j.order_id=p_order AND s.code='doctor_review' AND r.queued_at IS NOT NULL
    ), doctor AS (
        SELECT coalesce(range_agg(tstzrange(greatest(i.since,b.opened),least(i.until,b.closed))),'{}'::tstzmultirange) AS ranges
        FROM intervals i CROSS JOIN bounds b WHERE greatest(i.since,b.opened)<least(i.until,b.closed)
    ), phases AS (
        SELECT tstzmultirange(tstzrange(b.opened,least(b.closed,greatest(b.opened,coalesce(b.design_done,b.closed))))) AS design_range,
            tstzmultirange(tstzrange(least(b.closed,greatest(b.opened,coalesce(b.design_done,b.closed))),b.closed)) AS production_range,
            d.ranges AS doctor_range FROM bounds b CROSS JOIN doctor d
    )
    SELECT (SELECT coalesce(floor(sum(extract(epoch FROM upper(x)-lower(x)))/60),0)::integer FROM unnest(design_range-doctor_range) x),
           (SELECT coalesce(floor(sum(extract(epoch FROM upper(x)-lower(x)))/60),0)::integer FROM unnest(production_range-doctor_range) x),
           (SELECT coalesce(floor(sum(extract(epoch FROM upper(x)-lower(x)))/60),0)::integer FROM unnest(doctor_range) x)
    FROM phases;
$$;
REVOKE ALL ON FUNCTION public.production_case_times(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.production_case_times(uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
