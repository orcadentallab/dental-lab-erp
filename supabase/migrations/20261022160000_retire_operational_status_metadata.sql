-- Remove the remaining operational reads of orders.status. These changes
-- affect guards/audit metadata only; obligation amounts and transition axes
-- are unchanged.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION pg_temp.patch_runtime_literal(
    p_signature REGPROCEDURE,
    p_old TEXT,
    p_new TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_definition TEXT := pg_get_functiondef(p_signature);
    v_patched TEXT;
BEGIN
    v_patched := replace(v_definition, p_old, p_new);
    IF v_patched = v_definition THEN
        RAISE EXCEPTION 'Expected operational fragment was not found in %', p_signature;
    END IF;
    EXECUTE v_patched;
END;
$$;

SELECT pg_temp.patch_runtime_literal(
    'public.rep_update_order_fields_with_audit(uuid,jsonb,text,text)'::regprocedure,
    '(v_old.status IN (''Delivered'', ''Completed'') OR v_old.production_status = ''final_delivered'')',
    'v_old.production_status = ''final_delivered'''
);

SELECT pg_temp.patch_runtime_literal(
    'public.sync_preserved_external_lab_price_change()'::regprocedure,
    'NEW.status,',
    'public.derive_order_legacy_compat_status_v2(NEW.production_status, NEW.issue_state, NEW.intake_state),'
);

SELECT pg_temp.patch_runtime_literal(
    'public.admin_correct_order_issue_state_v2(uuid,text,text,uuid,text,numeric,text,text)'::regprocedure,
    '''previousLegacyStatus'', v_order.status',
    '''previousDisplayStatus'', public.derive_order_legacy_compat_status_v2(v_order.production_status, v_order.issue_state, v_order.intake_state)'
);

SELECT pg_temp.patch_runtime_literal(
    'public.confirm_shipment_delivery(uuid,text,timestamp with time zone,text)'::regprocedure,
    'SELECT so.order_id, o.case_id, o.status, o.production_status,',
    'SELECT so.order_id, o.case_id, o.production_status,'
);

COMMIT;
