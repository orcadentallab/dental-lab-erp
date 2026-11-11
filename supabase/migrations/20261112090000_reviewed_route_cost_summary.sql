BEGIN;

DO $$
DECLARE definition text; anchor text;
BEGIN
    definition:=pg_get_functiondef('public.initialize_reviewed_catalog_job()'::regprocedure);
    anchor:='sum(s.cost_price * greatest(coalesce(i.count,1),1))';
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected catalog quote initialization'; END IF;
    EXECUTE replace(definition,'coalesce('||anchor||',0)', $quote$CASE WHEN bool_or(
        s.catalog_route_kind IS DISTINCT FROM 'add_on' AND coalesce(s.milling_price,0)<=0
    ) THEN 0 ELSE coalesce(sum(s.milling_price * greatest(coalesce(i.count,1),1)),0) END$quote$);

    definition:=pg_get_functiondef('public.capture_mixed_try_in_price()'::regprocedure);
    anchor:=$anchor$CASE WHEN j.route_id='ba500000-0000-4000-8000-000000000002' THEN sv.cost_price ELSE sv.milling_price END$anchor$;
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected catalog quote rate'; END IF;
    EXECUTE replace(definition,anchor,'sv.milling_price');

    definition:=pg_get_functiondef('public.resolve_mixed_try_in_price(uuid,uuid)'::regprocedure);
    anchor:='WHEN p_supplier IS NULL THEN p.catalog_total';
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected supplier quote resolution'; END IF;
    EXECUTE replace(definition,anchor,anchor||$quote$
        WHEN j.route_id='ba500000-0000-4000-8000-000000000002' THEN (
            SELECT CASE WHEN bool_or(svc.catalog_route_kind IS DISTINCT FROM 'add_on' AND coalesce(rate.amount,0)<=0)
                THEN NULL ELSE sum(greatest(coalesce(i.count,1),1)*rate.amount) END
            FROM public.order_items i
            LEFT JOIN public.services svc ON svc.name=i.product_type
            CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(s.custom_prices->i.product_type)='number'
                THEN (s.custom_prices->>i.product_type)::numeric ELSE (p.service_rates->>i.product_type)::numeric END AS amount) rate
            WHERE i.order_id=j.order_id)
    $quote$);
END;
$$;

CREATE FUNCTION public.get_order_production_quote(p_order uuid)
RETURNS TABLE (estimated numeric, agreed numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'السعر للأدمن فقط' USING ERRCODE='42501';
    END IF;
    RETURN QUERY
        SELECT nullif(q.catalog_total,0), q.agreed_total
        FROM public.orders o
        JOIN public.production_jobs j ON j.order_id=o.id AND j.route_id=o.route_override_id
        JOIN public.production_stage_runs r ON r.job_id=j.id AND r.id=coalesce(j.active_supplier_quote_run_id,
            (SELECT base.id FROM public.production_stage_runs base
             WHERE base.job_id=j.id AND base.seq=60 AND base.rework_of IS NULL))
        JOIN public.mixed_try_in_prices q ON q.stage_run_id=r.id
        WHERE o.id=p_order AND NOT coalesce(o.is_deleted,false)
          AND j.route_id IN ('ba100000-0000-4000-8000-000000000001','ba500000-0000-4000-8000-000000000002')
        ORDER BY j.round_no DESC, j.id
        LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION public.get_order_production_quote(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_order_production_quote(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
