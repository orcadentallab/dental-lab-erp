-- Production has only the original Doctor Portal order-request function.
-- Patch that existing function to write V2 intake axes without creating portal
-- functions that are not deployed in this environment.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
    v_signature REGPROCEDURE :=
        'public.create_my_order_request_v2(text,jsonb,text,text,text,text,date,numeric)'::regprocedure;
    v_definition TEXT := pg_get_functiondef(v_signature);
    v_patched TEXT;
BEGIN
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

    IF v_patched = v_definition
       OR v_patched LIKE '%''Pending Review''%''not_started''%''none''%''Pending''%'
       OR v_patched LIKE '%status, production_status, issue_state, technician_status%'
    THEN
        RAISE EXCEPTION 'Existing Doctor Portal INSERT patch did not fully apply';
    END IF;

    EXECUTE v_patched;
END;
$$;

COMMIT;
