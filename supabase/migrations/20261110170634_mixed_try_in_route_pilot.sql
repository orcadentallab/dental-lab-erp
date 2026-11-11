BEGIN;

-- Explicit pilot route. Existing routes and orders keep their current driver.
INSERT INTO public.production_routes(id,name_ar,ignores_global_stages,notes)
VALUES ('ba100000-0000-4000-8000-000000000001','بروفة داخلية ثم خراطة وفينش خارجي',true,'مسار تجريبي للحالات الجديدة المختارة صراحة');

INSERT INTO public.production_route_stages(route_id,stage_id,mode,step_no,name_override,execution_override,driven_by,allowed_roles,advance_mode)
SELECT 'ba100000-0000-4000-8000-000000000001',s.id,'included',v.step,v.title,v.execution,v.driver,v.roles,v.advance
FROM (VALUES
    ('design',10,'التصميم','internal','designer_dashboard',ARRAY['designer','admin'],'auto'),
    ('printing',20,'طباعة البروفة داخليًا','internal','my_tasks',ARRAY['admin','production_manager','technician'],'auto'),
    ('packaging',30,'تغليف البروفة','internal','my_tasks',ARRAY['admin','production_manager','technician'],'auto'),
    ('shipping',40,'شحن البروفة','external','order_status',ARRAY[]::text[],'manual'),
    ('doctor_review',50,'انتظار رد الطبيب على البروفة','internal','order_status',ARRAY['admin','coordinator'],'manual'),
    ('milling',60,'خراطة وفينش خارجي','external','external_wo',ARRAY['admin','production_manager'],'auto'),
    ('qc',70,'الفحص الداخلي للنهائي','internal','my_tasks',ARRAY['admin'],'qc_gate'),
    ('packaging',80,'تغليف النهائي','internal','my_tasks',ARRAY['admin','production_manager','technician'],'auto'),
    ('shipping',90,'شحن النهائي','external','order_status',ARRAY[]::text[],'manual')
) v(code,step,title,execution,driver,roles,advance) JOIN public.production_stages s ON s.code=v.code;

ALTER TABLE public.production_stage_runs ADD COLUMN planned_external_cost numeric(12,2),
    ADD COLUMN doctor_approved_at timestamptz, ADD COLUMN doctor_approved_by uuid REFERENCES public.users(id);
-- The Services editor already reads and writes this field. Some baselines
-- never installed it, so keep the same field and leave missing prices blank.
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS milling_price numeric(12,2);
ALTER TABLE public.shipment_orders ADD COLUMN production_stage_run_id uuid REFERENCES public.production_stage_runs(id);

-- Materialize once after all line items have been saved. Retain the stage list and quote on the job.
CREATE FUNCTION public.initialize_mixed_try_in_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    item_order uuid;
    order_row public.orders%ROWTYPE;
    job uuid;
    quoted_cost numeric;
BEGIN
    FOR item_order IN SELECT DISTINCT i.order_id FROM inserted_items i LOOP
        SELECT * INTO order_row FROM public.orders WHERE id=item_order
          AND route_override_id='ba100000-0000-4000-8000-000000000001' FOR UPDATE;
        IF NOT FOUND OR EXISTS (SELECT 1 FROM public.production_jobs WHERE order_id=item_order) THEN CONTINUE; END IF;
        IF order_row.delivery_type IS DISTINCT FROM 'TryIn' OR order_row.workflow_type IS DISTINCT FROM 'split' OR order_row.designer_id IS NULL THEN
            RAISE EXCEPTION 'المسار المختلط يحتاج بروفة ومصمم محدد';
        END IF;
        SELECT CASE WHEN count(*) FILTER (WHERE s.milling_price IS NULL OR s.milling_price <= 0)=0
               THEN sum(s.milling_price * greatest(coalesce(i.count,1),1)) END
        INTO quoted_cost FROM public.order_items i LEFT JOIN public.services s ON s.name=i.product_type
        WHERE i.order_id=item_order;
        job:=public.materialize_job_from_route(item_order,order_row.route_override_id);
        UPDATE public.production_stage_runs r SET planned_external_cost=quoted_cost
        FROM public.production_stages s WHERE r.job_id=job AND s.id=r.stage_id AND s.code='milling';
    END LOOP;
    RETURN NULL;
END;
$$;
CREATE TRIGGER initialize_mixed_try_in_job AFTER INSERT ON public.order_items
REFERENCING NEW TABLE AS inserted_items FOR EACH STATEMENT EXECUTE FUNCTION public.initialize_mixed_try_in_job();

CREATE FUNCTION public.guard_mixed_try_in_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pilot constant uuid:='ba100000-0000-4000-8000-000000000001'; order_route uuid;
BEGIN
    SELECT route_override_id INTO order_route FROM public.orders WHERE id=NEW.order_id;
    IF NEW.route_id IS DISTINCT FROM order_route AND (NEW.route_id=pilot OR order_route=pilot) THEN
        RAISE EXCEPTION 'الخريطة المختلطة تُحدد عند إنشاء الأوردر';
    END IF;
    IF NEW.route_id=pilot AND NEW.round_no<>1 THEN RAISE EXCEPTION 'التجربة تستخدم خريطة واحدة للحالة'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER guard_mixed_try_in_job BEFORE INSERT OR UPDATE OF route_id,order_id,round_no ON public.production_jobs
FOR EACH ROW EXECUTE FUNCTION public.guard_mixed_try_in_job();

CREATE FUNCTION public.set_mixed_try_in_status(p_order uuid,p_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous text:=current_setting('app.mixed_try_in_sync',true);
BEGIN
    PERFORM set_config('app.mixed_try_in_sync',p_order::text,true);
    UPDATE public.orders SET production_status=p_status WHERE id=p_order AND production_status IS DISTINCT FROM p_status
      AND NOT coalesce(is_deleted,false) AND issue_state='none';
    PERFORM set_config('app.mixed_try_in_sync',coalesce(previous,''),true);
END;
$$;

CREATE FUNCTION public.sync_mixed_try_in_stage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE order_id uuid; stage_code text; is_final boolean;
BEGIN
    IF NEW.status<>'ready' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    SELECT j.order_id,s.code INTO order_id,stage_code FROM public.production_jobs j CROSS JOIN public.production_stages s
    WHERE j.id=NEW.job_id AND j.route_id='ba100000-0000-4000-8000-000000000001' AND s.id=NEW.stage_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
    IF stage_code='shipping' THEN
        SELECT EXISTS (SELECT 1 FROM public.production_stage_runs r JOIN public.production_stages s ON s.id=r.stage_id
            WHERE r.job_id=NEW.job_id AND r.seq<NEW.seq AND s.code='doctor_review') INTO is_final;
        PERFORM public.set_mixed_try_in_status(order_id,CASE WHEN is_final THEN 'final_ready' ELSE 'try_in_ready' END);
    ELSIF stage_code='doctor_review' THEN
        PERFORM public.set_mixed_try_in_status(order_id,'waiting_doctor');
    ELSIF stage_code='milling' THEN
        PERFORM public.set_mixed_try_in_status(order_id,'finalization');
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER sync_mixed_try_in_stage AFTER UPDATE OF status ON public.production_stage_runs
FOR EACH ROW EXECUTE FUNCTION public.sync_mixed_try_in_stage();

CREATE FUNCTION public.sync_mixed_try_in_design() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE run public.production_stage_runs%ROWTYPE; prior text:=current_setting('app.mixed_try_in_design',true);
BEGIN
    IF NEW.route_override_id IS DISTINCT FROM 'ba100000-0000-4000-8000-000000000001'::uuid
       OR NEW.production_status<>'in_production' OR NEW.design_qc_revision_id IS NULL
       OR NEW.issue_state<>'none' THEN RETURN NEW; END IF;
    IF (SELECT enabled FROM public.design_qc_control WHERE id) AND NEW.design_qc_required
       AND NOT coalesce(public.design_qc_gate_passes(NEW.design_qc_revision_id),false) THEN RETURN NEW; END IF;
    SELECT r.* INTO run FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id=r.job_id
    JOIN public.production_stages s ON s.id=r.stage_id
    WHERE j.order_id=NEW.id AND j.route_id=NEW.route_override_id AND s.code='design' AND r.status IN ('ready','in_progress') FOR UPDATE OF r;
    IF NOT FOUND THEN RETURN NEW; END IF;
    PERFORM set_config('app.mixed_try_in_design',run.id::text,true);
    UPDATE public.production_stage_runs SET status='done',completed_at=now(),units_passed=units_in,
        assignee_id=NEW.designer_id WHERE id=run.id;
    PERFORM set_config('app.mixed_try_in_design',coalesce(prior,''),true);
    PERFORM public.advance_production_job(run.job_id);
    RETURN NEW;
END;
$$;
CREATE TRIGGER sync_mixed_try_in_design AFTER UPDATE OF production_status,design_qc_revision_id ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.sync_mixed_try_in_design();

-- Normal actions cannot complete the pilot's doctor or shipping step, skip an
-- external receipt, or pass a QC run as a technician.
CREATE FUNCTION public.guard_mixed_try_in_stage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE stage_code text; actor text:=public.get_my_role();
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    SELECT s.code INTO stage_code FROM public.production_jobs j CROSS JOIN public.production_stages s
    WHERE j.id=NEW.job_id AND j.route_id='ba100000-0000-4000-8000-000000000001' AND s.id=NEW.stage_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
    IF stage_code='design' AND NEW.status='done' AND current_setting('app.mixed_try_in_design',true) IS DISTINCT FROM NEW.id::text THEN
        RAISE EXCEPTION 'التصميم يُسلّم من لوحة المصمم ويُفتح الإنتاج حسب قرار المراجعة' USING ERRCODE='23514';
    END IF;
    IF stage_code IN ('printing','packaging') AND NEW.status IN ('in_progress','done','failed')
       AND coalesce(actor,'') NOT IN ('admin','production_manager','technician') THEN
        RAISE EXCEPTION 'الطباعة والتغليف لفريق الإنتاج' USING ERRCODE='42501';
    END IF;
    IF stage_code='qc' AND NEW.status IN ('in_progress','done','failed') AND actor IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'الفحص النهائي للأدمن فقط' USING ERRCODE='42501';
    END IF;
    IF stage_code='qc' AND NEW.status='done' AND coalesce(NEW.units_passed,0)<>NEW.units_in
       AND NOT (coalesce(NEW.units_passed,0)=0 AND NEW.units_failed=NEW.units_in AND NEW.failure_cause_code IS NOT NULL) THEN
        RAISE EXCEPTION 'الفحص للحالة كاملة؛ لا يمكن تمرير جزء منها' USING ERRCODE='23514';
    END IF;
    IF stage_code IN ('packaging','shipping') AND NEW.status='ready'
       AND EXISTS (SELECT 1 FROM public.production_stage_runs r JOIN public.production_stages s ON s.id=r.stage_id
          WHERE r.job_id=NEW.job_id AND r.seq<NEW.seq AND s.code='qc'
            AND (r.status<>'done' OR coalesce(r.units_passed,0)<>r.units_in)) THEN
        RAISE EXCEPTION 'النهائي يحتاج اجتياز الفحص قبل التغليف والشحن' USING ERRCODE='23514';
    END IF;
    IF stage_code='doctor_review' AND NEW.status IN ('in_progress','done','failed') AND
       current_setting('app.mixed_try_in_doctor',true) IS DISTINCT FROM NEW.id::text THEN
        RAISE EXCEPTION 'استخدم إجراء رد الطبيب والإرسال النهائي' USING ERRCODE='23514';
    END IF;
    IF stage_code='shipping' AND NEW.status IN ('in_progress','done','waiting_external','failed') AND NOT EXISTS (
        SELECT 1 FROM public.shipment_orders l JOIN public.shipments h ON h.id=l.shipment_id
        WHERE l.production_stage_run_id=NEW.id AND h.status='delivered') THEN
        RAISE EXCEPTION 'أكّد استلام الشحنة من شاشة الشحن' USING ERRCODE='23514';
    END IF;
    IF stage_code='milling' AND NEW.status='done' AND NOT EXISTS (
        SELECT 1 FROM public.external_work_orders w WHERE w.stage_run_id=NEW.id AND w.status='returned') THEN
        RAISE EXCEPTION 'سجّل استلام الشغل الخارجي أولًا' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER guard_mixed_try_in_stage BEFORE UPDATE OF status ON public.production_stage_runs
FOR EACH ROW EXECUTE FUNCTION public.guard_mixed_try_in_stage();

CREATE FUNCTION public.mixed_try_in_doctor_action(p_run uuid,p_action text,p_notes text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE run public.production_stage_runs%ROWTYPE; order_id uuid; prior text;
BEGIN
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','coordinator') THEN
        RAISE EXCEPTION 'رد الطبيب للأدمن والمنسق فقط' USING ERRCODE='42501';
    END IF;
    SELECT r.* INTO run FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id=r.job_id
    JOIN public.production_stages s ON s.id=r.stage_id WHERE r.id=p_run
      AND j.route_id='ba100000-0000-4000-8000-000000000001' AND s.code='doctor_review' FOR UPDATE OF r;
    IF NOT FOUND OR run.status<>'ready' THEN RAISE EXCEPTION 'الحالة ليست بانتظار رد الطبيب'; END IF;
    SELECT j.order_id INTO order_id FROM public.production_jobs j WHERE j.id=run.job_id;
    IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id=order_id AND NOT coalesce(o.is_deleted,false) AND o.issue_state='none') THEN
        RAISE EXCEPTION 'الحالة غير متاحة لاستكمال البروفة';
    END IF;
    IF p_action='approve' THEN
        IF run.doctor_approved_at IS NULL THEN
            UPDATE public.production_stage_runs SET doctor_approved_at=now(),doctor_approved_by=public.get_my_user_id(),notes=nullif(btrim(p_notes),'') WHERE id=p_run;
            INSERT INTO public.order_events(order_id,event_type,changed_by,actor_role,notes,severity)
            VALUES (order_id,'try_in_approved',public.get_my_user_id(),public.get_my_role(),p_notes,'info');
        END IF;
    ELSIF p_action='send_final' AND run.doctor_approved_at IS NOT NULL THEN
        prior:=current_setting('app.mixed_try_in_doctor',true);
        PERFORM set_config('app.mixed_try_in_doctor',p_run::text,true);
        UPDATE public.production_stage_runs SET status='done',completed_at=now(),units_passed=units_in WHERE id=p_run;
        PERFORM set_config('app.mixed_try_in_doctor',coalesce(prior,''),true);
        PERFORM public.advance_production_job(run.job_id);
    ELSE
        RAISE EXCEPTION 'سجّل موافقة الطبيب قبل بدء التنفيذ النهائي';
    END IF;
END;
$$;

CREATE FUNCTION public.guard_mixed_try_in_external() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE run public.production_stage_runs%ROWTYPE; target_order_id uuid; stage_code text;
BEGIN
    SELECT r.* INTO run FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id=r.job_id
    WHERE r.id=NEW.stage_run_id AND j.route_id='ba100000-0000-4000-8000-000000000001';
    IF NOT FOUND THEN RETURN NEW; END IF;
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','production_manager') THEN
        RAISE EXCEPTION 'إرسال واستلام الخراطة للأدمن ومسؤول الإنتاج' USING ERRCODE='42501';
    END IF;
    SELECT j.order_id,s.code INTO target_order_id,stage_code FROM public.production_jobs j CROSS JOIN public.production_stages s
    WHERE j.id=run.job_id AND s.id=run.stage_id;
    IF stage_code<>'milling' THEN RAISE EXCEPTION 'الشحن له إجراء مستقل'; END IF;
    IF TG_OP='INSERT' THEN
        IF run.status<>'ready' OR run.planned_external_cost IS NULL THEN
            RAISE EXCEPTION 'الخراطة ليست جاهزة أو سعر الخراطة غير محدد للخدمة' USING ERRCODE='23514';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id=NEW.supplier_id AND is_active IS DISTINCT FROM false AND supplier_type='external_lab') THEN
            RAISE EXCEPTION 'اختر معملًا خارجيًا نشطًا';
        END IF;
        IF NEW.agreed_cost IS NOT NULL AND NEW.agreed_cost IS DISTINCT FROM run.planned_external_cost THEN
            RAISE EXCEPTION 'السعر المعتمد في التجربة هو سعر الخراطة المحفوظ من الخدمات';
        END IF;
        NEW.agreed_cost:=run.planned_external_cost;
        UPDATE public.orders SET supplier_id=NEW.supplier_id,cost=coalesce(designer_cost,0)+NEW.agreed_cost,
            manual_cost=NEW.agreed_cost WHERE id=target_order_id;
    ELSIF NEW.agreed_cost IS DISTINCT FROM OLD.agreed_cost OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id THEN
        RAISE EXCEPTION 'المعمل والسعر مثبتان عند الإرسال';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER guard_mixed_try_in_external BEFORE INSERT OR UPDATE ON public.external_work_orders
FOR EACH ROW EXECUTE FUNCTION public.guard_mixed_try_in_external();

CREATE FUNCTION public.link_mixed_try_in_shipment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE order_row public.orders%ROWTYPE;
BEGIN
    SELECT * INTO order_row FROM public.orders
    WHERE id=NEW.order_id AND route_override_id='ba100000-0000-4000-8000-000000000001' FOR UPDATE;
    IF NOT FOUND THEN
        IF NEW.production_stage_run_id IS NOT NULL THEN RAISE EXCEPTION 'ارتباط شحن غير صالح'; END IF;
        RETURN NEW;
    END IF;
    IF order_row.production_status NOT IN ('try_in_ready','final_ready') OR order_row.issue_state<>'none' OR coalesce(order_row.is_deleted,false) THEN
        RAISE EXCEPTION 'الحالة ليست جاهزة للشحن';
    END IF;
    SELECT r.id INTO NEW.production_stage_run_id FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id=r.job_id
      JOIN public.production_stages s ON s.id=r.stage_id WHERE j.order_id=NEW.order_id AND j.route_id=order_row.route_override_id
      AND s.code='shipping' AND r.status='ready' FOR UPDATE OF r;
    IF NEW.production_stage_run_id IS NULL OR EXISTS (
        SELECT 1 FROM public.shipment_orders l JOIN public.shipments h ON h.id=l.shipment_id
        WHERE l.production_stage_run_id=NEW.production_stage_run_id AND h.status NOT IN ('cancelled','returned')) THEN
        RAISE EXCEPTION 'لا توجد خطوة شحن مفتوحة أو أن الشحنة مسجلة بالفعل';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER link_mixed_try_in_shipment BEFORE INSERT ON public.shipment_orders
FOR EACH ROW EXECUTE FUNCTION public.link_mixed_try_in_shipment();

CREATE FUNCTION public.complete_mixed_try_in_shipment(p_shipment uuid,p_order uuid,p_at timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE run public.production_stage_runs%ROWTYPE; is_final boolean;
BEGIN
    SELECT r.* INTO run FROM public.shipment_orders l JOIN public.production_stage_runs r ON r.id=l.production_stage_run_id
    WHERE l.shipment_id=p_shipment AND l.order_id=p_order FOR UPDATE OF r;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF run.status<>'ready' OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id=p_order AND issue_state='none' AND NOT coalesce(is_deleted,false)) THEN
        RAISE EXCEPTION 'خطوة الشحن لم تعد متاحة للتأكيد';
    END IF;
    SELECT EXISTS (SELECT 1 FROM public.production_stage_runs earlier JOIN public.production_stages s ON s.id=earlier.stage_id
        WHERE earlier.job_id=run.job_id AND earlier.seq<run.seq AND s.code='doctor_review') INTO is_final;
    UPDATE public.production_stage_runs SET status='done',completed_at=p_at,units_passed=units_in WHERE id=run.id;
    PERFORM public.advance_production_job(run.job_id);
    IF NOT is_final THEN RETURN 'trial'; END IF;
    PERFORM public.record_order_final_delivery_v2(p_order,p_at,md5(p_shipment::text||':'||p_order::text)::uuid);
    RETURN 'final';
END;
$$;

CREATE FUNCTION public.guard_mixed_try_in_shipment_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF NEW.status='delivered' AND OLD.status NOT IN ('dispatched','delivered') AND EXISTS (
        SELECT 1 FROM public.shipment_orders WHERE shipment_id=OLD.id AND production_stage_run_id IS NOT NULL) THEN
        RAISE EXCEPTION 'سلّم الشحنة للمندوب قبل تأكيد وصولها';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER guard_mixed_try_in_shipment_status BEFORE UPDATE OF status ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.guard_mixed_try_in_shipment_status();

CREATE FUNCTION public.guard_mixed_try_in_order() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF TG_OP='INSERT' THEN
        IF NEW.route_override_id='ba100000-0000-4000-8000-000000000001' AND
           (NEW.production_status IS DISTINCT FROM 'designing' OR NEW.delivery_type IS DISTINCT FROM 'TryIn' OR NEW.workflow_type IS DISTINCT FROM 'split' OR NEW.designer_id IS NULL) THEN
            RAISE EXCEPTION 'المسار المختلط يبدأ بتصميم بروفة لمصمم محدد';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.route_override_id IS DISTINCT FROM 'ba100000-0000-4000-8000-000000000001'::uuid THEN
        IF NEW.route_override_id='ba100000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'المسار التجريبي للأوردرات الجديدة'; END IF;
        RETURN NEW;
    END IF;
    IF NEW.route_override_id IS DISTINCT FROM OLD.route_override_id OR NEW.delivery_type IS DISTINCT FROM OLD.delivery_type THEN
        RAISE EXCEPTION 'خريطة البروفة محفوظة لهذه الحالة';
    END IF;
    IF NEW.production_status IS NOT DISTINCT FROM OLD.production_status OR current_setting('app.mixed_try_in_sync',true)=NEW.id::text THEN RETURN NEW; END IF;
    IF OLD.production_status='designing' AND NEW.production_status='in_production' AND NEW.design_qc_revision_id IS NOT NULL
       AND (NOT (SELECT enabled FROM public.design_qc_control WHERE id) OR NOT NEW.design_qc_required OR public.design_qc_gate_passes(NEW.design_qc_revision_id)) THEN RETURN NEW; END IF;
    IF OLD.production_status='final_ready' AND NEW.production_status='final_delivered' AND EXISTS (
        SELECT 1 FROM public.shipment_orders l JOIN public.shipments h ON h.id=l.shipment_id JOIN public.production_stage_runs r ON r.id=l.production_stage_run_id
        WHERE l.order_id=OLD.id AND h.status='delivered' AND r.status='done' AND EXISTS (
            SELECT 1 FROM public.production_stage_runs earlier JOIN public.production_stages s ON s.id=earlier.stage_id
            WHERE earlier.job_id=r.job_id AND earlier.seq<r.seq AND s.code='doctor_review')) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'حرّك الحالة من المرحلة المفتوحة في خريطة الإنتاج' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER aab_guard_mixed_try_in_order BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_mixed_try_in_order();

-- Keep the existing paths for other routes. These anchors deliberately fail
-- the migration when the baseline differs instead of partially wiring a route.
DO $$
DECLARE d text; a text;
BEGIN
    d:=pg_get_functiondef('public.sync_production_from_order(uuid)'::regprocedure);
    a:='BEGIN';
    EXECUTE regexp_replace(d,a,$p$BEGIN
    IF EXISTS (SELECT 1 FROM public.orders WHERE id=p_order_id AND route_override_id='ba100000-0000-4000-8000-000000000001') THEN
        RETURN (SELECT id FROM public.production_jobs WHERE order_id=p_order_id ORDER BY created_at LIMIT 1);
    END IF;$p$);

    d:=pg_get_functiondef('public.sync_design_stage_from_order()'::regprocedure);
    EXECUTE regexp_replace(d,'BEGIN',$p$BEGIN
    IF NEW.route_override_id='ba100000-0000-4000-8000-000000000001' THEN RETURN NEW; END IF;$p$);

    d:=pg_get_functiondef('public.orders_role_field_guard()'::regprocedure);
    a:='IF v_role IS NULL OR v_role = ''admin'' THEN RETURN NEW; END IF;';
    IF position(a in d)=0 THEN RAISE EXCEPTION 'Unexpected order role guard baseline'; END IF;
    EXECUTE replace(d,a,a||$p$
    IF current_setting('app.mixed_try_in_sync',true)=NEW.id::text
       AND NEW.route_override_id='ba100000-0000-4000-8000-000000000001' THEN RETURN NEW; END IF;$p$);

    d:=pg_get_functiondef('public.receive_external_work_order(uuid,timestamptz,numeric,text,integer)'::regprocedure);
    a:='IF v_cost > 0 AND v_wo.supplier_id IS NOT NULL AND v_wo.stage_run_id IS NOT NULL THEN';
    IF position(a in d)=0 THEN RAISE EXCEPTION 'Unexpected external receipt baseline'; END IF;
    EXECUTE replace(d,a,$p$IF v_cost > 0 AND v_wo.supplier_id IS NOT NULL AND v_wo.stage_run_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id=r.job_id
        WHERE r.id=v_wo.stage_run_id AND j.route_id='ba100000-0000-4000-8000-000000000001') THEN$p$);

    d:=pg_get_functiondef('public.confirm_shipment_delivery(uuid,text,timestamptz,text)'::regprocedure);
    a:='v_order_count := v_order_count + 1;';
    IF position(a in d)=0 OR position('v_idem UUID;' in d)=0 OR position('''orders_delivered'', v_delivered_count,' in d)=0 THEN
        RAISE EXCEPTION 'Unexpected shipment confirmation baseline';
    END IF;
    d:=replace(d,'v_idem UUID;','v_idem UUID; v_mixed_result text; v_trial_count int := 0;');
    d:=replace(d,'''orders_delivered'', v_delivered_count,','''orders_delivered'', v_delivered_count, ''orders_trial_received'', v_trial_count,');
    EXECUTE replace(d,a,a||$p$
        v_mixed_result:=public.complete_mixed_try_in_shipment(p_shipment_id,v_order.order_id,v_delivered_time);
        IF v_mixed_result='trial' THEN v_trial_count:=v_trial_count+1; CONTINUE; END IF;
        IF v_mixed_result='final' THEN v_delivered_count:=v_delivered_count+1; CONTINUE; END IF;$p$);
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_mixed_try_in_job(),public.guard_mixed_try_in_job(),public.set_mixed_try_in_status(uuid,text),
    public.sync_mixed_try_in_stage(),public.sync_mixed_try_in_design(),public.guard_mixed_try_in_stage(),
    public.guard_mixed_try_in_external(),public.link_mixed_try_in_shipment(),public.complete_mixed_try_in_shipment(uuid,uuid,timestamptz),
    public.guard_mixed_try_in_shipment_status(),public.guard_mixed_try_in_order(),public.mixed_try_in_doctor_action(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mixed_try_in_doctor_action(uuid,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
