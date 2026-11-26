-- Remove the final legacy delivered-status fallback from the optional Doctor
-- Portal projection. V2 production_status is authoritative.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
    v_signature REGPROCEDURE := to_regprocedure('public.get_doctor_portal_cases()');
    v_definition TEXT;
    v_patched TEXT;
BEGIN
    IF v_signature IS NULL THEN
        RETURN;
    END IF;

    v_definition := pg_get_functiondef(v_signature);
    v_patched := replace(
        v_definition,
        'CASE WHEN o.status IN(''Delivered'',''Completed'') THEN ''final_delivered'' ELSE o.production_status END',
        'o.production_status'
    );
    IF v_patched = v_definition THEN
        RAISE EXCEPTION 'Expected delivered fallback was not found in get_doctor_portal_cases()';
    END IF;
    EXECUTE v_patched;
END;
$$;

COMMIT;
