-- Reassign order route RPC (Phase B3)
-- Allows re-routing an order when the case changes technique or needs rework.
-- Updates orders.route_override_id, cancels unworked open jobs/stage runs,
-- and materializes a fresh job according to the new route.

BEGIN;

CREATE OR REPLACE FUNCTION public.reassign_order_route(
    p_order_id      UUID,
    p_new_route_id  UUID,
    p_notes         TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role      TEXT;
    v_order     public.orders;
    v_old_route UUID;
    v_new_job   UUID;
    v_actor     UUID;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'production_manager') THEN
        RAISE EXCEPTION 'forbidden: admin or production_manager role required' USING ERRCODE = '42501';
    END IF;

    v_actor := public.get_my_user_id();

    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'order % not found', p_order_id USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.production_routes WHERE id = p_new_route_id AND is_active) THEN
        RAISE EXCEPTION 'route % not found or inactive', p_new_route_id USING ERRCODE = '22023';
    END IF;

    v_old_route := v_order.route_override_id;
    IF v_old_route IS NULL THEN
        v_old_route := public.resolve_route_for_order(p_order_id);
    END IF;

    IF v_old_route = p_new_route_id THEN
        -- Route is already the same; return the current active job if one exists
        SELECT id INTO v_new_job
          FROM public.production_jobs
         WHERE order_id = p_order_id AND status IN ('queued', 'active')
         ORDER BY round_no DESC
         LIMIT 1;
        RETURN v_new_job;
    END IF;

    -- Update the order's route override
    UPDATE public.orders
       SET route_override_id = p_new_route_id,
           updated_at = NOW()
     WHERE id = p_order_id;

    -- Cancel any open unworked stage runs on previous jobs
    UPDATE public.production_stage_runs r
       SET status = 'cancelled'
      FROM public.production_jobs j
     WHERE r.job_id = j.id
       AND j.order_id = p_order_id
       AND r.status IN ('pending', 'ready', 'waiting_external');

    -- Mark previous open jobs as cancelled
    UPDATE public.production_jobs
       SET status = 'cancelled',
           completed_at = COALESCE(completed_at, NOW()),
           updated_at = NOW()
     WHERE order_id = p_order_id
       AND status IN ('queued', 'active', 'blocked');

    -- Materialize a fresh job from the new route
    v_new_job := public.materialize_job_from_route(
        p_order_id,
        p_new_route_id,
        NULL,
        COALESCE((SELECT MAX(round_no) + 1 FROM public.production_jobs WHERE order_id = p_order_id), 1)
    );

    RETURN v_new_job;
END;
$$;

COMMENT ON FUNCTION public.reassign_order_route(UUID, UUID, TEXT) IS
'Reassigns an order to a new route, cancels pending unworked runs on previous jobs, and materializes a new job.';

REVOKE ALL ON FUNCTION public.reassign_order_route(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_order_route(UUID, UUID, TEXT) TO authenticated;

COMMIT;
