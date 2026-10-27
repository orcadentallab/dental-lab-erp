-- Doctor Portal inserts write the V2 intake axis directly. The INSERT mirror
-- remains the sole temporary writer of the NOT NULL legacy status column.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION pg_temp.patch_portal_insert(
    p_signature REGPROCEDURE,
    p_spaced BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_definition TEXT := pg_get_functiondef(p_signature);
    v_patched TEXT;
BEGIN
    IF p_spaced THEN
        v_patched := replace(
            v_definition,
            'status, production_status, issue_state, technician_status',
            'production_status, issue_state, intake_state, technician_status'
        );
        v_patched := replace(
            v_patched,
            '''Pending Review'', ''not_started'', ''none'', ''Pending''',
            '''not_started'', ''none'', ''pending_review'', ''Pending'''
        );
    ELSE
        v_patched := replace(
            v_definition,
            'status,production_status,issue_state,technician_status',
            'production_status,issue_state,intake_state,technician_status'
        );
        v_patched := replace(
            v_patched,
            '''Pending Review'',''not_started'',''none'',''Pending''',
            '''not_started'',''none'',''pending_review'',''Pending'''
        );
    END IF;

    IF v_patched = v_definition OR v_patched LIKE '%''Pending Review''%''not_started''%''none''%''Pending''%' THEN
        RAISE EXCEPTION 'Doctor Portal INSERT patch did not fully apply to %', p_signature;
    END IF;
    EXECUTE v_patched;
END;
$$;

SELECT pg_temp.patch_portal_insert(
    'public.create_my_order_request_v2(text,jsonb,text,text,text,text,date,numeric)'::regprocedure,
    TRUE
);
SELECT pg_temp.patch_portal_insert(
    'public.create_my_order_request_with_destination(text,jsonb,text,text,text,text,date,numeric,text,text)'::regprocedure,
    FALSE
);
SELECT pg_temp.patch_portal_insert(
    'public.submit_doctor_portal_case(uuid,jsonb)'::regprocedure,
    FALSE
);

COMMIT;
