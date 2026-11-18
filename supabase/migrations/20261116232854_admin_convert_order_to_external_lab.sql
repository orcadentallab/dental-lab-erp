BEGIN;

-- Allow the admin RPC to detach a saved route after it closes the production job.
DO $$
DECLARE
    signature regprocedure;
    definition text;
    anchor constant text := 'IF NEW.route_override_id IS DISTINCT FROM OLD.route_override_id OR NEW.delivery_type';
BEGIN
    FOREACH signature IN ARRAY ARRAY[
        'public.guard_reviewed_catalog_order()'::regprocedure,
        'public.guard_mixed_try_in_order()'::regprocedure
    ] LOOP
        definition := pg_get_functiondef(signature);
        IF strpos(definition, anchor) = 0 THEN
            RAISE EXCEPTION 'Unexpected order route guard: %', signature;
        END IF;
        EXECUTE replace(definition, anchor, $guard$
    IF current_setting('app.admin_external_lab_conversion', true) = OLD.id::text
       AND public.get_my_role() = 'admin'
       AND NEW.route_override_id IS NULL AND NEW.supplier_id IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM public.order_events e
           WHERE e.order_id = OLD.id AND e.event_type = 'converted_to_external_lab'
             AND e.old_value = OLD.route_override_id::text AND e.new_value = NEW.supplier_id::text
       ) THEN
        RETURN NEW;
    END IF;
    $guard$ || anchor);
    END LOOP;

    definition := pg_get_functiondef('public.sync_production_from_order(uuid)'::regprocedure);
    EXECUTE regexp_replace(definition, 'BEGIN', $sync$BEGIN
    IF EXISTS (
        SELECT 1 FROM public.orders converted_order
        JOIN public.order_events e ON e.order_id = converted_order.id
        WHERE converted_order.id = p_order_id AND converted_order.route_override_id IS NULL
          AND e.event_type = 'converted_to_external_lab'
    ) THEN
        RETURN NULL;
    END IF;$sync$);
END;
$$;

CREATE FUNCTION public.admin_convert_order_to_external_lab(
    p_order_id uuid, p_supplier_id uuid, p_lab_cost numeric, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    o public.orders%ROWTYPE;
    design_completed boolean;
    actor uuid := public.get_my_user_id();
    prior_setting text := current_setting('app.admin_external_lab_conversion', true);
BEGIN
    IF auth.uid() IS NULL OR actor IS NULL OR public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'هذا الإجراء للأدمن فقط' USING ERRCODE = '42501';
    END IF;
    IF nullif(btrim(p_reason), '') IS NULL THEN
        RAISE EXCEPTION 'اكتب سبب تحويل الحالة' USING ERRCODE = '22023';
    END IF;
    IF p_lab_cost IS NULL OR NOT (p_lab_cost BETWEEN 0 AND 9999999999.99)
       OR p_lab_cost <> round(p_lab_cost, 2) THEN
        RAISE EXCEPTION 'أدخل تكلفة المعمل بالجنيه حتى منزلتين عشريتين' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR coalesce(o.is_deleted, false) OR o.supplier_id IS NOT NULL
       OR o.route_override_id IS NULL OR o.route_override_id NOT IN (
           'ba100000-0000-4000-8000-000000000001',
           'ba500000-0000-4000-8000-000000000001',
           'ba500000-0000-4000-8000-000000000002'
       ) OR o.issue_state IS DISTINCT FROM 'none'
       OR o.production_status NOT IN ('designing', 'in_production', 'not_started') THEN
        RAISE EXCEPTION 'الحالة غير متاحة للتحويل إلى معمل خارجي' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.suppliers
    WHERE id = p_supplier_id AND is_active IS DISTINCT FROM false
      AND coalesce(supplier_type, 'external_lab') = 'external_lab'
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'اختر معملًا خارجيًا نشطًا' USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM public.production_jobs WHERE order_id = o.id ORDER BY id FOR UPDATE;
    PERFORM 1 FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id = r.job_id
    WHERE j.order_id = o.id ORDER BY r.id FOR UPDATE OF r;
    IF EXISTS (
        SELECT 1 FROM public.production_stage_runs r
        JOIN public.production_jobs j ON j.id = r.job_id
        JOIN public.production_stages s ON s.id = r.stage_id
        WHERE j.order_id = o.id
          AND (r.status NOT IN ('pending', 'ready', 'skipped')
               OR r.started_at IS NOT NULL)
          AND NOT (s.code = 'design' AND r.status = 'done')
    ) OR EXISTS (
        SELECT 1 FROM public.external_work_orders w
        JOIN public.production_stage_runs r ON r.id = w.stage_run_id
        JOIN public.production_jobs j ON j.id = r.job_id
        WHERE j.order_id = o.id AND w.status <> 'cancelled'
    ) OR EXISTS (
        SELECT 1 FROM public.shipment_orders WHERE order_id = o.id
    ) THEN
        RAISE EXCEPTION 'بدأ العمل بالفعل في مرحلة مفتوحة أو ارتبطت الحالة بأمر خارجي أو شحنة'
            USING ERRCODE = '23514';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.production_stage_runs r
        JOIN public.production_jobs j ON j.id = r.job_id
        JOIN public.production_stages s ON s.id = r.stage_id
        WHERE j.order_id = o.id AND s.code = 'design' AND r.status = 'done'
    ) INTO design_completed;
    IF NOT design_completed AND (o.design_qc_revision_id IS NOT NULL OR o.design_submitted_at IS NOT NULL) THEN
        RAISE EXCEPTION 'أكمل مراجعة التصميم قبل تحويل الحالة' USING ERRCODE = '23514';
    END IF;

    UPDATE public.production_stage_runs r SET status = 'skipped'
    FROM public.production_jobs j
    WHERE r.job_id = j.id AND j.order_id = o.id AND r.status IN ('pending', 'ready');
    UPDATE public.production_jobs SET status = 'cancelled', completed_at = coalesce(completed_at, now())
    WHERE order_id = o.id AND status IN ('queued', 'active', 'blocked');

    INSERT INTO public.order_events (
        order_id, event_type, old_value, new_value, changed_by, actor_role, reason, metadata
    ) VALUES (
        o.id, 'converted_to_external_lab', o.route_override_id::text, p_supplier_id::text, actor, 'admin',
        btrim(p_reason), jsonb_build_object('design_retained', design_completed, 'lab_cost', p_lab_cost)
    );

    PERFORM set_config('app.admin_external_lab_conversion', o.id::text, true);
    UPDATE public.orders
    SET route_override_id = NULL,
        supplier_id = p_supplier_id,
        workflow_type = CASE WHEN design_completed THEN 'split' ELSE 'full' END,
        production_status = CASE WHEN design_completed THEN 'in_production' ELSE 'not_started' END,
        designer_id = CASE WHEN design_completed THEN o.designer_id END,
        design_status = CASE WHEN design_completed THEN o.design_status END,
        design_price = CASE WHEN design_completed THEN o.design_price ELSE 0 END,
        designer_cost = CASE WHEN design_completed THEN o.designer_cost ELSE 0 END,
        manual_design_price = CASE WHEN design_completed THEN o.manual_design_price END,
        lab_cost = p_lab_cost,
        manual_cost = p_lab_cost,
        updated_at = now()
    WHERE id = o.id;
    PERFORM set_config('app.admin_external_lab_conversion', coalesce(prior_setting, ''), true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_convert_order_to_external_lab(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_convert_order_to_external_lab(uuid, uuid, numeric, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
