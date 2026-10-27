-- Preserve the existing top-doctor/service/family report behavior while
-- sourcing its legacy-compatible classification from V2 axes.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
    v_signature REGPROCEDURE;
    v_definition TEXT;
    v_patched TEXT;
    v_expression TEXT := 'public.derive_order_legacy_compat_status_v2(o.production_status, o.issue_state, o.intake_state)';
BEGIN
    FOREACH v_signature IN ARRAY ARRAY[
        'public.get_top_doctors_privileged_20260801(date,date,integer)'::regprocedure,
        'public.get_top_services_privileged_20260801(date,date,integer)'::regprocedure,
        'public.get_top_families_privileged_20260826(date,date,integer)'::regprocedure
    ] LOOP
        v_definition := pg_get_functiondef(v_signature);
        v_patched := regexp_replace(
            v_definition,
            'SELECT([[:space:]]+)o[.]status,',
            'SELECT\1' || v_expression || ' AS status,',
            'g'
        );
        v_patched := replace(v_patched, 'o.status', v_expression);

        IF v_patched = v_definition OR v_patched LIKE '%o.status%' THEN
            RAISE EXCEPTION 'Top-report status retirement did not fully apply to %', v_signature;
        END IF;
        EXECUTE v_patched;
    END LOOP;
END;
$$;

COMMIT;
