-- A later audit-enabled complete_stage_run definition accidentally omitted the
-- analytical cost capture introduced in 20260822000000. Restore it at the
-- table boundary so every current and future completion path keeps the same
-- invariant without creating financial obligations or rewriting old rows.

CREATE OR REPLACE FUNCTION public.capture_stage_completion_cost()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_cost numeric;
    v_standard numeric;
BEGIN
    IF NEW.status IS DISTINCT FROM 'done'
       OR OLD.status IS NOT DISTINCT FROM 'done'
       OR NEW.cost_amount IS NOT NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.execution = 'external' THEN
        SELECT ewo.agreed_cost
        INTO v_cost
        FROM public.external_work_orders ewo
        WHERE ewo.stage_run_id = NEW.id
        ORDER BY ewo.created_at DESC
        LIMIT 1;

        IF v_cost IS NOT NULL THEN
            NEW.cost_amount := v_cost;
            NEW.cost_source := 'external_invoice';
        END IF;
        RETURN NEW;
    END IF;

    SELECT COALESCE(route_stage.standard_cost_per_unit, stage.standard_cost_per_unit)
    INTO v_standard
    FROM public.production_stages stage
    JOIN public.production_jobs job ON job.id = NEW.job_id
    LEFT JOIN public.production_route_stages route_stage
      ON route_stage.route_id = job.route_id
     AND route_stage.stage_id = stage.id
    WHERE stage.id = NEW.stage_id;

    IF v_standard IS NOT NULL THEN
        NEW.cost_amount := v_standard * GREATEST(COALESCE(NEW.units_in, 0), 0);
        NEW.cost_source := 'standard';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_stage_completion_cost ON public.production_stage_runs;
CREATE TRIGGER capture_stage_completion_cost
BEFORE UPDATE OF status ON public.production_stage_runs
FOR EACH ROW
EXECUTE FUNCTION public.capture_stage_completion_cost();

COMMENT ON FUNCTION public.capture_stage_completion_cost() IS
'Restores analytical stage cost attribution on completion; does not create financial obligations.';

REVOKE ALL ON FUNCTION public.capture_stage_completion_cost() FROM PUBLIC;
