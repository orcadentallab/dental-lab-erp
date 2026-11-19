BEGIN;

DO $$
DECLARE
    definition text := pg_get_functiondef('public.trg_attribute_material_usage_on_stage_complete()'::regprocedure);
    anchor constant text := 'v_passed_units NUMERIC := COALESCE(NEW.units_passed, NEW.units_in, 1);';
BEGIN
    IF strpos(definition, anchor) = 0 THEN
        RAISE EXCEPTION 'Unexpected stage material attribution definition';
    END IF;
    EXECUTE replace(definition, anchor, $body$
    v_passed_units NUMERIC := CASE
        WHEN NEW.execution = 'internal' AND EXISTS (
            SELECT 1 FROM public.production_stages s
            WHERE s.id = NEW.stage_id AND s.code IN ('printing', 'cast_print')
        ) THEN COALESCE(NEW.units_passed, 0) + COALESCE(NEW.units_failed, 0)
        ELSE COALESCE(NEW.units_passed, NEW.units_in, 1)
    END;$body$);
END $$;

DO $$
DECLARE
    definition text := pg_get_functiondef('public.get_order_cost_breakdown(uuid)'::regprocedure);
    anchor constant text := '''materials_are_estimated'', v_estimated_materials,';
BEGIN
    IF strpos(definition, anchor) = 0 THEN
        RAISE EXCEPTION 'Unexpected order costing definition';
    END IF;
    EXECUTE replace(definition, anchor, $body$
        'print_materials_missing', EXISTS (
            SELECT 1
            FROM public.production_jobs job
            JOIN public.production_stage_runs run ON run.job_id = job.id
            JOIN public.production_stages stage ON stage.id = run.stage_id
            WHERE job.order_id = p_order_id AND NOT job.is_backfilled
              AND run.execution = 'internal' AND run.status = 'done'
              AND stage.code IN ('printing', 'cast_print')
              AND (
                NOT EXISTS (
                    SELECT 1 FROM public.material_batch_usage usage
                    WHERE usage.stage_run_id = run.id AND usage.units_attributed > 0
                )
                OR EXISTS (
                    SELECT 1 FROM public.stage_material_bindings binding
                    WHERE binding.stage_id = run.stage_id AND binding.is_required
                      AND NOT EXISTS (
                          SELECT 1 FROM public.material_batch_usage usage
                          JOIN public.material_batches batch ON batch.id = usage.batch_id
                          WHERE usage.stage_run_id = run.id
                            AND usage.units_attributed > 0 AND batch.material_id = binding.material_id
                      )
                )
              )
        ),
        'materials_are_estimated', v_estimated_materials,$body$);
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
