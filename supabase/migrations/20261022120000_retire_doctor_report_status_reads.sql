-- Preserve doctor analytics/receivables/profitability/segmentation results,
-- deriving the old report classification from V2 axes.

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
        'public.get_doctors_activity_analytics(uuid)'::regprocedure,
        'public.get_doctor_receivables_breakdown_privileged_20260812()'::regprocedure,
        'public.get_doctor_service_profitability(date,date)'::regprocedure,
        'public.get_doctor_segmentation_inputs(date,date)'::regprocedure
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
            RAISE EXCEPTION 'Doctor-report status retirement did not fully apply to %', v_signature;
        END IF;
        EXECUTE v_patched;
    END LOOP;
END;
$$;

COMMIT;
