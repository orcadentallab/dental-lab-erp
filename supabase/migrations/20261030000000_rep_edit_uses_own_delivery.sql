-- Representative edit approval belongs to the edited case, including remakes.
-- Never consult original_order_id, the legacy display status, or planned dates.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.order_edit_requires_admin_approval(p_order public.orders)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT COALESCE((p_order).production_status = 'final_delivered', FALSE)
        OR (p_order).first_delivered_at IS NOT NULL
        OR (p_order).actual_delivery_date IS NOT NULL
        OR COALESCE((p_order).legacy_delivery_confirmed, FALSE);
$$;

-- Preserve the RPC's role checks, row lock, allow-list, audit and proposal
-- upsert. Replace only the delivery predicate on the locked edited row.
DO $$
DECLARE
    v_definition text := pg_get_functiondef(
        'public.rep_update_order_fields_with_audit(uuid,jsonb,text,text)'::regprocedure);
    v_old text := 'IF v_role = ANY (ARRAY[''representative'', ''coordinator'']) AND v_old.production_status = ''final_delivered'' THEN';
    v_legacy text := 'IF v_role = ANY (ARRAY[''representative'', ''coordinator'']) AND (v_old.status IN (''Delivered'', ''Completed'') OR v_old.production_status = ''final_delivered'') THEN';
    v_new text := 'IF v_role = ANY (ARRAY[''representative'', ''coordinator'']) AND public.order_edit_requires_admin_approval(v_old) THEN';
BEGIN
    -- Production may still use the pre-retirement predicate. Support that
    -- version without deploying any unrelated status-retirement migrations.
    IF strpos(v_definition, v_legacy) > 0 THEN
        EXECUTE replace(v_definition, v_legacy, v_new);
        RETURN;
    END IF;
    IF strpos(v_definition, v_old) = 0 THEN
        RAISE EXCEPTION 'Expected representative edit approval predicate not found';
    END IF;
    EXECUTE replace(v_definition, v_old, v_new);
END;
$$;

COMMIT;
