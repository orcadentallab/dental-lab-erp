-- The designer's existing page drives the design stage, and today's real
-- shape becomes the default route.
--
-- TWO PROBLEMS, ONE CAUSE: THE SYSTEM DID NOT MATCH WHAT THE LAB DOES TODAY.
--
-- 1. The default route was a single external step, so a `split` case -- our
--    designer designs, then it goes out -- had its design time swallowed
--    inside the vendor's window. That is the exact confusion the historical
--    backfill spent so much effort separating, reintroduced for new data.
--    The default route now has two steps, with the design step appearing only
--    for split cases. No service mapping needed: workflow_type is already on
--    the order.
--
-- 2. Designers already have a working dashboard they use every day. Asking
--    them to ALSO press start/finish in My Tasks would be double entry, and
--    double entry is how people stop using a system. So their existing actions
--    move the stage instead: accepting a case starts the design run,
--    submitting the design completes it and opens the next step.
--
-- EVERY STAGE HAS EXACTLY ONE THING THAT DRIVES IT
--   design          -> the designer dashboard (unchanged)
--   external steps  -> the external work order screen
--   everything else -> My Tasks
--   driven_by records which, so a stage can never be advanced from two places
--   and quietly counted twice.

BEGIN;

ALTER TABLE public.production_stages
    ADD COLUMN IF NOT EXISTS driven_by TEXT NOT NULL DEFAULT 'my_tasks'
        CHECK (driven_by IN ('my_tasks', 'designer_dashboard', 'external_wo'));

COMMENT ON COLUMN public.production_stages.driven_by IS
'Which screen advances this stage. Keeps a stage from being movable from two places at once.';

UPDATE public.production_stages SET driven_by = 'designer_dashboard' WHERE code = 'design';

-- ─────────────────────────────────────────────────────────────────────────
-- The designer's page moves the design stage
-- ─────────────────────────────────────────────────────────────────────────
-- Reads the columns their dashboard already writes. Nothing in their workflow
-- changes; the stage simply follows along.

CREATE OR REPLACE FUNCTION public.sync_design_stage_from_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_run public.production_stage_runs;
BEGIN
    SELECT r.* INTO v_run
      FROM public.production_stage_runs r
      JOIN public.production_jobs j ON j.id = r.job_id
      JOIN public.production_stages s ON s.id = r.stage_id
     WHERE j.order_id = NEW.id AND NOT j.is_backfilled
       AND s.code = 'design' AND r.status NOT IN ('done', 'skipped')
     ORDER BY r.seq
     LIMIT 1;

    IF v_run.id IS NULL THEN
        RETURN NEW;   -- case is not in the new pipeline; nothing to follow
    END IF;

    -- Picked up: the designer accepted or started work.
    IF NEW.design_status IN ('accepted', 'in_progress')
       AND v_run.status = 'ready' THEN
        UPDATE public.production_stage_runs
           SET status      = 'in_progress',
               started_at  = COALESCE(started_at, NOW()),
               assignee_id = COALESCE(assignee_id, NEW.designer_id)
         WHERE id = v_run.id;
        RETURN NEW;
    END IF;

    -- Submitted: the design file is up, so the stage is finished and the next
    -- step opens on its own.
    IF NEW.design_submitted_at IS NOT NULL
       AND OLD.design_submitted_at IS DISTINCT FROM NEW.design_submitted_at THEN
        UPDATE public.production_stage_runs
           SET status       = 'done',
               started_at   = COALESCE(started_at, queued_at, NEW.design_submitted_at),
               completed_at = NEW.design_submitted_at,
               assignee_id  = COALESCE(assignee_id, NEW.designer_id),
               units_passed = units_in
         WHERE id = v_run.id;

        PERFORM public.advance_production_job(v_run.job_id);
        PERFORM public.apply_production_status_from_stages(NEW.id);
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_design_stage ON public.orders;
CREATE TRIGGER trg_sync_design_stage
    AFTER UPDATE OF design_status, design_submitted_at ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.sync_design_stage_from_order();

-- ─────────────────────────────────────────────────────────────────────────
-- The default route: what actually happens today
-- ─────────────────────────────────────────────────────────────────────────
-- Split work already has one internal stage -- ours -- and measuring it apart
-- from the vendor is the whole reason the design step is here.

DO $$
DECLARE
    v_fallback UUID;
BEGIN
    SELECT id INTO v_fallback FROM public.production_routes
     WHERE is_fallback AND is_active LIMIT 1;

    IF v_fallback IS NOT NULL THEN
        UPDATE public.production_routes
           SET name_ar = 'الوضع الحالي — تصميم عندنا + معمل خارجي',
               notes = 'المسار الافتراضي لأي خدمة لسه متحددلهاش خريطة. خطوة التصميم '
                       || 'بتظهر بس في حالات split، وبتتحرك من صفحة المصمم نفسها.'
         WHERE id = v_fallback;

        PERFORM public.seed_route_steps(v_fallback, $json$[
            {"code":"design",        "condition":{"workflow_type":"split"},
             "roles":["designer","admin"]},
            {"code":"external_full"}
        ]$json$::jsonb);
    END IF;
END;
$$;

-- materialize_job_from_route already builds the context from the order, but it
-- did not pass workflow_type, so the new conditional step would never match.
CREATE OR REPLACE FUNCTION public.materialize_job_from_route(
    p_order_id   UUID,
    p_route_id   UUID DEFAULT NULL,
    p_unit_count INTEGER DEFAULT NULL,
    p_round_no   INTEGER DEFAULT 1,
    p_context    JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_route  UUID;
    v_order  public.orders;
    v_units  INTEGER;
    v_ctx    JSONB;
    v_job_id UUID;
    v_first  INTEGER;
    v_stages INTEGER := 0;
    r        RECORD;
BEGIN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'order % not found', p_order_id USING ERRCODE = '22023';
    END IF;

    v_route := COALESCE(p_route_id, public.resolve_route_for_order(p_order_id));
    IF v_route IS NULL THEN
        RAISE EXCEPTION 'no route resolved for order % and no fallback route exists', p_order_id
            USING ERRCODE = '22023';
    END IF;

    -- workflow_type is what separates "we designed it" from "it went straight
    -- out", and the default route now branches on it.
    v_ctx := COALESCE(p_context, jsonb_strip_nulls(jsonb_build_object(
                 'delivery_type', v_order.delivery_type,
                 'workflow_type', v_order.workflow_type,
                 'is_redo',       v_order.is_redo,
                 'priority',      v_order.priority)));

    v_units := COALESCE(p_unit_count,
                        NULLIF((SELECT SUM(COALESCE(oi.count, 1))::int
                                  FROM public.order_items oi
                                 WHERE oi.order_id = p_order_id), 0),
                        1);

    INSERT INTO public.production_jobs
        (order_id, route_id, round_no, unit_count, status, priority, due_at)
    VALUES
        (p_order_id, v_route, p_round_no, v_units, 'queued',
         COALESCE(v_order.priority, 'Normal'),
         v_order.delivery_date::timestamp AT TIME ZONE 'Africa/Cairo')
    RETURNING id INTO v_job_id;

    INSERT INTO public.production_job_items (job_id, order_item_id, units)
    SELECT v_job_id, oi.id, GREATEST(COALESCE(oi.count, 1), 1)
      FROM public.order_items oi
     WHERE oi.order_id = p_order_id;

    FOR r IN SELECT * FROM public.get_effective_route_stages(v_route, v_ctx) ORDER BY seq
    LOOP
        IF v_first IS NULL THEN
            v_first := r.seq;
        END IF;

        INSERT INTO public.production_stage_runs (
            job_id, stage_id, seq, parallel_group, execution, advance_mode,
            on_fail_goto_stage_id, supplier_id, status, queued_at, units_in)
        VALUES (
            v_job_id, r.stage_id, r.seq, r.parallel_group, r.execution,
            r.advance_mode, r.on_fail_goto_stage_id,
            CASE WHEN r.execution = 'external' THEN r.supplier_id END,
            CASE WHEN r.seq = v_first THEN 'ready' ELSE 'pending' END,
            CASE WHEN r.seq = v_first THEN NOW() END,
            v_units);

        v_stages := v_stages + 1;
    END LOOP;

    IF v_stages = 0 THEN
        RAISE EXCEPTION 'route % resolved to an empty stage chain', v_route
            USING ERRCODE = '22023';
    END IF;

    RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_design_stage_from_order() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.materialize_job_from_route(UUID, UUID, INTEGER, INTEGER, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.materialize_job_from_route(UUID, UUID, INTEGER, INTEGER, JSONB) TO authenticated;

COMMIT;
