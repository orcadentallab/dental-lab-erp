-- Normal order supplier AP accrues at final doctor receipt. No data repair.
-- Keep the established trigger key, cash, designer and issue-settlement paths.
BEGIN;
DO $$
DECLARE
    v_signature regprocedure := 'public.sync_order_financial_obligations()'::regprocedure;
    v_definition text := pg_get_functiondef(v_signature);
    v_old text := 'AND NEW.production_status IN (''final_ready'', ''final_delivered'')';
    v_guard text := $guard$
    -- Existing unmarked pre-delivery payables belong to the historical review
    -- gate. Unrelated future sync must not void, redate or reallocate them.
    IF NOT v_is_deleted AND v_issue_state = 'none'
       AND NEW.production_status IS DISTINCT FROM 'final_delivered'
       AND EXISTS (
           SELECT 1 FROM public.financial_obligations f
           WHERE f.order_id=NEW.id AND f.entity_type='external_lab'
             AND f.direction='payable' AND f.trigger_type='external_lab_ready'
             AND f.source='order' AND f.status<>'void'
             AND f.metadata->>'normalSupplierAccrual' IS DISTINCT FROM 'final_delivered'
       ) THEN
        v_preserve_external_lab := TRUE;
    END IF;

    $guard$;
BEGIN
    IF strpos(v_definition,v_old)=0
       OR strpos(v_definition,'''normalExternalLabPayable'', TRUE')=0 THEN
        RAISE EXCEPTION 'Unexpected supplier synchronization definition; manual compatibility review required';
    END IF;
    v_definition := replace(v_definition,v_old,'AND NEW.production_status = ''final_delivered''');
    v_definition := regexp_replace(v_definition,
        '([[:space:]]+IF NOT v_is_deleted AND NOT v_restored_from_delete[[:space:]]+AND NOT v_preserve_external_lab)',
        v_guard || '\1');
    IF strpos(v_definition,'Existing unmarked pre-delivery payables')=0 THEN
        RAISE EXCEPTION 'Historical Ready protection did not apply';
    END IF;
    v_definition := replace(v_definition,'''normalExternalLabPayable'', TRUE',
        '''normalExternalLabPayable'', TRUE, ''normalSupplierAccrual'', ''final_delivered''');
    EXECUTE v_definition;
END;
$$;
COMMIT;
