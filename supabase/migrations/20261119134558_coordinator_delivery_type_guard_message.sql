BEGIN;

-- The generic coordinator guard can run before the order field guard.
-- Use the same error for a direct delivery-type write in either trigger order.
DO $$
DECLARE
    definition text := pg_get_functiondef('public.guard_coordinator_direct_order_edit()'::regprocedure);
    anchor constant text := 'IF (to_jsonb(NEW) - v_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed) THEN';
BEGIN
    IF strpos(definition, anchor) = 0 THEN
        RAISE EXCEPTION 'Unexpected coordinator order guard definition';
    END IF;
    EXECUTE replace(definition, anchor, anchor || $guard$
            IF NEW.delivery_type IS DISTINCT FROM OLD.delivery_type THEN
                RAISE EXCEPTION 'Delivery type changes require the audited representative RPC' USING ERRCODE = '42501';
            END IF;$guard$);
END $$;

COMMIT;
