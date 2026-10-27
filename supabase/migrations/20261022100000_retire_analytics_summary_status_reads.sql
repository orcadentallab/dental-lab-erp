-- Keep analytics-summary outputs and financial classifications identical to
-- the legacy mirror while sourcing that classification from V2 axes.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.derive_order_legacy_compat_status_v2(
    p_production_status TEXT,
    p_issue_state TEXT,
    p_intake_state TEXT DEFAULT 'accepted'
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT CASE
        WHEN p_issue_state = 'redo' THEN 'Doctor Rejected'
        ELSE public.derive_order_display_status_v2(
            p_production_status,
            p_issue_state,
            p_intake_state
        )
    END;
$$;

REVOKE ALL ON FUNCTION public.derive_order_legacy_compat_status_v2(TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
    v_signature REGPROCEDURE := 'public.get_analytics_summary_privileged_20260801(date,date)'::regprocedure;
    v_definition TEXT := pg_get_functiondef(v_signature);
    v_expression TEXT := 'public.derive_order_legacy_compat_status_v2(o.production_status, o.issue_state, o.intake_state)';
    v_patched TEXT;
BEGIN
    v_patched := regexp_replace(
        v_definition,
        'SELECT([[:space:]]+)o[.]status,',
        'SELECT\1' || v_expression || ' AS status,',
        'g'
    );
    v_patched := replace(v_patched, 'o.status', v_expression);

    IF v_patched = v_definition OR v_patched LIKE '%o.status%' THEN
        RAISE EXCEPTION 'Analytics summary status retirement did not apply completely';
    END IF;
    EXECUTE v_patched;
END;
$$;

COMMIT;
