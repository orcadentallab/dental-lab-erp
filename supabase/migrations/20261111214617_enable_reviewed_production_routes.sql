BEGIN;

-- Reuse the explicit route lifecycle. Legacy orders still resolve their existing routes.
CREATE FUNCTION pg_temp.extend_route_function(signature regprocedure, anchor text, replacement text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE definition text := pg_get_functiondef(signature);
BEGIN
    IF strpos(definition,anchor)=0 OR strpos(substr(definition,strpos(definition,anchor)+length(anchor)),anchor)>0 THEN
        RAISE EXCEPTION 'Unexpected definition of % at %',signature,anchor;
    END IF;
    EXECUTE replace(definition,anchor,replacement);
END;
$$;

DO $$
DECLARE
    trial text := quote_literal('ba100000-0000-4000-8000-000000000001');
    printing text := quote_literal('ba500000-0000-4000-8000-000000000001');
    external text := quote_literal('ba500000-0000-4000-8000-000000000002');
    all_routes text := ' IN ('||trial||','||printing||','||external||')';
    lab_routes text := ' IN ('||trial||','||external||')';
    function_name text;
BEGIN
    FOREACH function_name IN ARRAY ARRAY['sync_production_from_order(uuid)','sync_design_stage_from_order()',
        'orders_role_field_guard()','link_mixed_try_in_shipment()'] LOOP
        PERFORM pg_temp.extend_route_function(('public.'||function_name)::regprocedure,
            'route_override_id='||trial,'route_override_id'||all_routes);
    END LOOP;

    FOREACH function_name IN ARRAY ARRAY['sync_mixed_try_in_stage()','guard_mixed_try_in_stage()',
        'mixed_physical_qc_action(uuid,text,text)'] LOOP
        PERFORM pg_temp.extend_route_function(('public.'||function_name)::regprocedure,
            'j.route_id='||trial,'j.route_id'||all_routes);
    END LOOP;

    FOREACH function_name IN ARRAY ARRAY['guard_mixed_try_in_external()','receive_external_work_order(uuid,timestamptz,numeric,text,integer)'] LOOP
        PERFORM pg_temp.extend_route_function(('public.'||function_name)::regprocedure,
            'j.route_id='||trial,'j.route_id'||lab_routes);
    END LOOP;

    PERFORM pg_temp.extend_route_function('public.sync_mixed_try_in_design()',
        'NEW.route_override_id IS DISTINCT FROM '||trial||'::uuid',
        'NOT coalesce(NEW.route_override_id'||all_routes||',false)');
    PERFORM pg_temp.extend_route_function('public.sync_mixed_try_in_stage()',
        'CASE WHEN is_final THEN', 'CASE WHEN is_final OR EXISTS (SELECT 1 FROM public.production_jobs j WHERE j.id=NEW.job_id AND j.route_id<>'||trial||') THEN');
    PERFORM pg_temp.extend_route_function('public.sync_mixed_try_in_stage()',
        'ELSIF stage_code=''milling'' AND NEW.rework_of IS NULL THEN',
        'ELSIF stage_code=''milling'' AND NEW.rework_of IS NULL AND EXISTS (SELECT 1 FROM public.production_jobs j WHERE j.id=NEW.job_id AND j.route_id='||trial||') THEN');
    PERFORM pg_temp.extend_route_function('public.complete_mixed_try_in_shipment(uuid,uuid,timestamptz)',
        'IF NOT is_final THEN RETURN ''trial''; END IF;',
        'IF NOT is_final AND EXISTS (SELECT 1 FROM public.production_jobs j WHERE j.id=run.job_id AND j.route_id='||trial||') THEN RETURN ''trial''; END IF;');
    PERFORM pg_temp.extend_route_function('public.write_mixed_try_in_final_cost(uuid,numeric)',
        'BEGIN', 'BEGIN
    IF EXISTS (SELECT 1 FROM public.orders WHERE id=p_order AND route_override_id='||printing||') THEN RETURN; END IF;');
    PERFORM pg_temp.extend_route_function('public.capture_mixed_try_in_price()','sv.milling_price',
        'CASE WHEN j.route_id='||external||' THEN sv.cost_price ELSE sv.milling_price END');
    PERFORM pg_temp.extend_route_function('public.resolve_mixed_try_in_price(uuid,uuid)',
        's.milling_prices->i.product_type','(CASE WHEN j.route_id='||external||' THEN s.custom_prices ELSE s.milling_prices END)->i.product_type');
    PERFORM pg_temp.extend_route_function('public.resolve_mixed_try_in_price(uuid,uuid)',
        's.milling_prices->>i.product_type','(CASE WHEN j.route_id='||external||' THEN s.custom_prices ELSE s.milling_prices END)->>i.product_type');
END;
$$;

CREATE FUNCTION public.initialize_reviewed_catalog_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    case_order public.orders%ROWTYPE;
    job uuid;
    quote numeric;
BEGIN
    FOR case_order IN SELECT o.* FROM public.orders o
        WHERE o.id IN (SELECT i.order_id FROM inserted_items i)
          AND o.route_override_id IN ('ba500000-0000-4000-8000-000000000001','ba500000-0000-4000-8000-000000000002')
        ORDER BY o.id FOR UPDATE
    LOOP
        IF EXISTS (SELECT 1 FROM public.production_jobs WHERE order_id=case_order.id) THEN CONTINUE; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.production_routes WHERE id=case_order.route_override_id AND is_active) THEN
            RAISE EXCEPTION 'خريطة الإنتاج غير مفعلة';
        END IF;
        job:=public.materialize_job_from_route(case_order.id,case_order.route_override_id);
        IF case_order.route_override_id='ba500000-0000-4000-8000-000000000002' THEN
            SELECT coalesce(sum(s.cost_price * greatest(coalesce(i.count,1),1)),0)
            INTO quote FROM public.order_items i JOIN public.services s ON s.name=i.product_type
            WHERE i.order_id=case_order.id;
            UPDATE public.production_stage_runs SET planned_external_cost=quote WHERE job_id=job AND seq=60;
        END IF;
    END LOOP;
    RETURN NULL;
END;
$$;
CREATE TRIGGER initialize_reviewed_catalog_job AFTER INSERT ON public.order_items
REFERENCING NEW TABLE AS inserted_items FOR EACH STATEMENT EXECUTE FUNCTION public.initialize_reviewed_catalog_job();

CREATE FUNCTION public.guard_reviewed_catalog_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE routes constant uuid[]:=ARRAY['ba500000-0000-4000-8000-000000000001','ba500000-0000-4000-8000-000000000002']::uuid[];
BEGIN
    IF TG_OP='INSERT' THEN
        IF NEW.route_override_id=ANY(routes) AND
           (NEW.production_status IS DISTINCT FROM 'designing' OR NEW.delivery_type IS DISTINCT FROM 'Final'
            OR NEW.workflow_type IS DISTINCT FROM 'split' OR NEW.designer_id IS NULL OR NEW.supplier_id IS NOT NULL) THEN
            RAISE EXCEPTION 'خريطة الإنتاج النهائي تبدأ بتصميم لمصمم محدد';
        END IF;
        RETURN NEW;
    END IF;
    IF NOT coalesce(OLD.route_override_id=ANY(routes),false) THEN
        IF NEW.route_override_id=ANY(routes) THEN RAISE EXCEPTION 'الخريطة تُحدد عند إنشاء الأوردر'; END IF;
        RETURN NEW;
    END IF;
    IF NEW.route_override_id IS DISTINCT FROM OLD.route_override_id OR NEW.delivery_type IS DISTINCT FROM OLD.delivery_type
       OR NEW.workflow_type IS DISTINCT FROM OLD.workflow_type THEN
        RAISE EXCEPTION 'خريطة الإنتاج محفوظة لهذه الحالة';
    END IF;
    IF current_setting('app.mixed_try_in_sync',true)=NEW.id::text THEN RETURN NEW; END IF;
    IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id THEN RAISE EXCEPTION 'اختر المعمل من الشغل الخارجي'; END IF;
    IF NEW.production_status IS NOT DISTINCT FROM OLD.production_status THEN RETURN NEW; END IF;
    IF OLD.production_status='designing' AND NEW.production_status='in_production' AND NEW.design_qc_revision_id IS NOT NULL
       AND (NOT (SELECT enabled FROM public.design_qc_control WHERE id) OR NOT NEW.design_qc_required
            OR public.design_qc_gate_passes(NEW.design_qc_revision_id)) THEN RETURN NEW; END IF;
    IF OLD.production_status='final_ready' AND NEW.production_status='final_delivered' AND EXISTS (
        SELECT 1 FROM public.shipment_orders l JOIN public.shipments h ON h.id=l.shipment_id
        JOIN public.production_stage_runs r ON r.id=l.production_stage_run_id
        WHERE l.order_id=OLD.id AND h.status='delivered' AND r.status='done') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'حرّك الحالة من المرحلة المفتوحة في خريطة الإنتاج' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER aab_guard_reviewed_catalog_order BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_reviewed_catalog_order();

REVOKE ALL ON FUNCTION public.initialize_reviewed_catalog_job(),public.guard_reviewed_catalog_order() FROM PUBLIC,anon,authenticated;

UPDATE public.production_route_stages r SET
    stage_id=CASE WHEN r.step_no=20 THEN (SELECT id FROM public.production_stages WHERE code='milling') ELSE r.stage_id END,
    step_no=CASE r.step_no WHEN 20 THEN 60 WHEN 30 THEN 80 WHEN 40 THEN 90 END
WHERE route_id='ba500000-0000-4000-8000-000000000002' AND r.step_no IN (20,30,40);

UPDATE public.production_routes SET is_active=true,notes='متاح عند اختيار خريطة الإنتاج صراحة في أوردر جديد'
WHERE id IN ('ba500000-0000-4000-8000-000000000001','ba500000-0000-4000-8000-000000000002');

DROP FUNCTION pg_temp.extend_route_function(regprocedure,text,text);
NOTIFY pgrst, 'reload schema';
COMMIT;
