BEGIN;

CREATE FUNCTION pg_temp.patch_route(signature regprocedure, anchor text, replacement text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE definition text:=pg_get_functiondef(signature);
BEGIN
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected definition of % at %',signature,anchor; END IF;
    EXECUTE replace(definition,anchor,replacement);
END;
$$;

DO $$
BEGIN
    PERFORM pg_temp.patch_route('public.initialize_mixed_try_in_job()',
        $q$order_row.delivery_type IS DISTINCT FROM 'TryIn'$q$,
        $q$coalesce(order_row.delivery_type,'') NOT IN ('TryIn','Final')$q$);
    PERFORM pg_temp.patch_route('public.initialize_mixed_try_in_job()',
        'SET planned_external_cost=quoted_cost',
        $q$SET planned_external_cost=CASE WHEN order_row.delivery_type='Final' THEN coalesce(quoted_cost,0) ELSE quoted_cost END$q$);

    PERFORM pg_temp.patch_route('public.guard_mixed_try_in_order()',
        $q$NEW.delivery_type IS DISTINCT FROM 'TryIn'$q$,
        $q$coalesce(NEW.delivery_type,'') NOT IN ('TryIn','Final') OR (NEW.delivery_type='Final' AND NEW.supplier_id IS NOT NULL)$q$);
    PERFORM pg_temp.patch_route('public.guard_mixed_try_in_order()',
        $q$'المسار المختلط يبدأ بتصميم بروفة لمصمم محدد'$q$,
        $q$'خريطة الإنتاج تبدأ بتصميم لمصمم محدد'$q$);
    PERFORM pg_temp.patch_route('public.guard_mixed_try_in_order()',
        $q$IF NEW.production_status IS NOT DISTINCT FROM OLD.production_status$q$,
        $q$IF OLD.delivery_type='Final' AND NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
       AND current_setting('app.mixed_try_in_sync',true) IS DISTINCT FROM NEW.id::text THEN
        RAISE EXCEPTION 'اختر المعمل من الشغل الخارجي';
    END IF;
    IF NEW.production_status IS NOT DISTINCT FROM OLD.production_status$q$);
    PERFORM pg_temp.patch_route('public.guard_mixed_try_in_order()',
        $q$AND r.status='done' AND EXISTS (
            SELECT 1 FROM public.production_stage_runs earlier JOIN public.production_stages s ON s.id=earlier.stage_id
            WHERE earlier.job_id=r.job_id AND earlier.seq<r.seq AND s.code='doctor_review'))$q$,
        $q$AND r.status='done' AND (OLD.delivery_type='Final' OR EXISTS (
            SELECT 1 FROM public.production_stage_runs earlier JOIN public.production_stages s ON s.id=earlier.stage_id
            WHERE earlier.job_id=r.job_id AND earlier.seq<r.seq AND s.code='doctor_review')))$q$);

    PERFORM pg_temp.patch_route('public.sync_mixed_try_in_stage()',
        'CASE WHEN is_final OR EXISTS',
        $q$CASE WHEN is_final OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id=order_id AND o.delivery_type='Final') OR EXISTS$q$);
    PERFORM pg_temp.patch_route('public.complete_mixed_try_in_shipment(uuid,uuid,timestamptz)',
        'IF NOT is_final AND EXISTS',
        $q$IF NOT is_final AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id=p_order AND o.delivery_type='Final') AND EXISTS$q$);
    PERFORM pg_temp.patch_route('public.resolve_mixed_try_in_price(uuid,uuid)',
        $q$WHEN j.route_id='ba500000-0000-4000-8000-000000000002' THEN ($q$,
        $q$WHEN j.route_id='ba500000-0000-4000-8000-000000000002'
          OR (j.route_id='ba100000-0000-4000-8000-000000000001' AND EXISTS (
              SELECT 1 FROM public.orders o WHERE o.id=j.order_id AND o.delivery_type='Final')) THEN ($q$);
END;
$$;

-- The old template stays available to saved orders that reference it.
UPDATE public.services
SET catalog_route_id='ba100000-0000-4000-8000-000000000001'
WHERE catalog_route_id='ba500000-0000-4000-8000-000000000002';

UPDATE public.production_routes SET name_ar='تصنيع وتشطيب خارجي',
    notes='خطوات البروفة تظهر في حالات Try-in فقط'
WHERE id='ba100000-0000-4000-8000-000000000001';

UPDATE public.production_route_stages SET name_override='التصنيع والتشطيب عند المعمل الخارجي'
WHERE route_id='ba100000-0000-4000-8000-000000000001' AND step_no=60;

DROP FUNCTION pg_temp.patch_route(regprocedure,text,text);
NOTIFY pgrst, 'reload schema';
COMMIT;
