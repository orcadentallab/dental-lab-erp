-- Replace active Pending Review and workflow decisions in database projections
-- with the V2 intake/production/issue axes. No table data is modified.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION pg_temp.patch_optional_runtime_function(
    p_signature TEXT,
    p_old TEXT,
    p_new TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_regprocedure REGPROCEDURE;
    v_definition TEXT;
    v_patched TEXT;
BEGIN
    v_regprocedure := to_regprocedure(p_signature);
    IF v_regprocedure IS NULL THEN
        RETURN;
    END IF;

    v_definition := pg_get_functiondef(v_regprocedure);
    v_patched := replace(v_definition, p_old, p_new);
    IF v_patched = v_definition THEN
        RAISE EXCEPTION 'Expected function fragment was not found in %', p_signature;
    END IF;
    EXECUTE v_patched;
END;
$$;

SELECT pg_temp.patch_optional_runtime_function(
    'public.sync_production_from_order(uuid)',
    '    IF o.status=''Pending Review'' THEN RETURN NULL; END IF;',
    '    IF o.intake_state = ''pending_review'' THEN RETURN NULL; END IF;'
);

SELECT pg_temp.patch_optional_runtime_function(
    'public.sync_production_from_order(uuid)',
    '    IF COALESCE(o.issue_state, ''none'') IN (''cancelled'', ''lab_rejected'') OR o.status IN (''Cancelled'', ''Lab Rejected'') THEN',
    '    IF COALESCE(o.issue_state, ''none'') IN (''cancelled'', ''lab_rejected'') THEN'
);

SELECT pg_temp.patch_optional_runtime_function(
    'public.sync_production_from_order(uuid)',
    E'    IF o.status IN (''Delivered'', ''Completed'') THEN\r\n        v_status := ''final_delivered'';\r\n    END IF;\r\n',
    ''
);

SELECT pg_temp.patch_optional_runtime_function(
    'public.get_doctor_portal_cases()',
    'CASE WHEN o.status=''Pending Review'' THEN ''مراجعة واستلام الحالة'' WHEN o.production_status=''final_delivered'' OR o.status IN(''Delivered'',''Completed'') THEN ''تم التسليم''',
    'CASE WHEN o.intake_state=''pending_review'' THEN ''مراجعة واستلام الحالة'' WHEN o.production_status=''final_delivered'' THEN ''تم التسليم'''
);

COMMIT;
