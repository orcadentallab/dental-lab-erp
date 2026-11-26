-- Retire the remaining direct legacy-status UPDATEs in issue correction and
-- redo transitions. Replacement-order INSERT compatibility is intentionally
-- left for the intake/import slice because orders.status is still NOT NULL.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION pg_temp.patch_transition_function(
    p_signature REGPROCEDURE,
    p_old TEXT,
    p_new TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_definition TEXT;
    v_patched TEXT;
BEGIN
    v_definition := pg_get_functiondef(p_signature);
    v_patched := replace(v_definition, p_old, p_new);
    IF v_patched = v_definition THEN
        RAISE EXCEPTION 'Expected function fragment was not found in %', p_signature;
    END IF;
    EXECUTE v_patched;
END;
$$;

SELECT pg_temp.patch_transition_function(
    'public.admin_correct_order_issue_state_v2(uuid,text,text,uuid,text,numeric,text,text)'::regprocedure,
    E'            status                            = ''Delivered'',\n',
    ''
);

SELECT pg_temp.patch_transition_function(
    'public.admin_correct_order_issue_state_v2(uuid,text,text,uuid,text,numeric,text,text)'::regprocedure,
    E'        status                            = v_target_status,\n',
    ''
);

SELECT pg_temp.patch_transition_function(
    'public.create_redo_order_atomic(uuid,text,text,numeric,numeric)'::regprocedure,
    E'    SET status = ''Doctor Rejected'',\n        production_status = ''not_started'',',
    E'    SET production_status = ''not_started'','
);

SELECT pg_temp.patch_transition_function(
    'public.create_redo_order_atomic_v2(uuid,text,text,text,numeric,uuid,text,text)'::regprocedure,
    E'        status = ''Doctor Rejected'', production_status = ''final_delivered'', issue_state = ''redo'',',
    E'        production_status = ''final_delivered'', issue_state = ''redo'','
);

COMMIT;
