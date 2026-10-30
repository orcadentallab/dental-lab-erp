-- Production-only schema drift reconciliation discovered while deploying
-- 20261022040000. This patches function text only; it performs no table DML.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
    v_signature REGPROCEDURE := 'public.sync_production_from_order(uuid)'::regprocedure;
    v_definition TEXT := pg_get_functiondef(v_signature);
    v_patched TEXT;
BEGIN
    v_patched := v_definition;

    IF v_patched NOT LIKE '%o.intake_state = ''pending_review''%' THEN
        v_patched := replace(
            v_patched,
            '    SELECT id INTO v_job',
            E'    IF o.intake_state = ''pending_review'' THEN\n        RETURN NULL;\n    END IF;\n\n    SELECT id INTO v_job'
        );
    END IF;

    v_patched := replace(
        v_patched,
        'IF COALESCE(o.issue_state, ''none'') IN (''cancelled'', ''lab_rejected'') OR o.status IN (''Cancelled'', ''Lab Rejected'') THEN',
        'IF COALESCE(o.issue_state, ''none'') IN (''cancelled'', ''lab_rejected'') THEN'
    );

    v_patched := regexp_replace(
        v_patched,
        E'    -- Normalize status: if order is Delivered or Completed, it is final_delivered\\r?\\n    v_status := COALESCE\\(o[.]production_status, ''not_started''\\);\\r?\\n    IF o[.]status IN \\(\'Delivered\', \'Completed\'\\) THEN\\r?\\n        v_status := \'final_delivered\';\\r?\\n    END IF;',
        E'    v_status := COALESCE(o.production_status, ''not_started'');'
    );

    IF v_patched = v_definition THEN
        RAISE EXCEPTION 'Production drift reconciliation made no change';
    END IF;
    IF v_patched LIKE '%o.status%' THEN
        RAISE EXCEPTION 'Production drift reconciliation left a legacy status read';
    END IF;
    IF v_patched NOT LIKE '%o.intake_state = ''pending_review''%' THEN
        RAISE EXCEPTION 'Production drift reconciliation did not add the intake guard';
    END IF;

    EXECUTE v_patched;
END;
$$;

COMMIT;
