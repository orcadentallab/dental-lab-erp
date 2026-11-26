-- Cost/quality reports keep their existing classifications, derived from V2.

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
        'public.get_cost_of_quality_report(date,date)'::regprocedure,
        'public.get_internal_vs_external_benchmark(date,date)'::regprocedure,
        'public.capture_cutover_baseline(date,date,text)'::regprocedure
    ] LOOP
        v_definition := pg_get_functiondef(v_signature);
        v_patched := replace(v_definition, 'o.status', v_expression);
        IF v_patched = v_definition OR v_patched LIKE '%o.status%' THEN
            RAISE EXCEPTION 'Cost/quality status retirement did not fully apply to %', v_signature;
        END IF;
        EXECUTE v_patched;
    END LOOP;
END;
$$;

DO $$
DECLARE
    v_signature REGPROCEDURE := 'public.get_order_cost_breakdown(uuid)'::regprocedure;
    v_definition TEXT := pg_get_functiondef(v_signature);
    v_patched TEXT;
BEGIN
    v_patched := regexp_replace(
        v_definition,
        '[[:space:]]+AND COALESCE\(v_order[.]status, ''''\) NOT IN \(''Cancelled'', ''Lab Rejected''\)',
        '',
        'g'
    );
    IF v_patched = v_definition OR v_patched LIKE '%v_order.status%' THEN
        RAISE EXCEPTION 'Order cost breakdown status retirement did not fully apply';
    END IF;
    EXECUTE v_patched;
END;
$$;

COMMIT;
