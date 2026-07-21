-- In split workflows the total order cost contains both milling and design
-- costs. Reassigning the designer can therefore change `cost` as well as
-- `design_price`. Allow that derived cost change through the audited RPC while
-- continuing to reject a stand-alone cost edit.
DO $$
DECLARE
    v_definition TEXT;
    v_patched TEXT;
BEGIN
    SELECT pg_get_functiondef('public.orders_role_field_guard()'::regprocedure)
      INTO v_definition;

    v_patched := replace(
        v_definition,
        '(NEW.cost               IS DISTINCT FROM OLD.cost AND NEW.items IS NOT DISTINCT FROM OLD.items AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id)',
        '(NEW.cost               IS DISTINCT FROM OLD.cost AND NEW.items IS NOT DISTINCT FROM OLD.items AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id AND NEW.designer_id IS NOT DISTINCT FROM OLD.designer_id)'
    );

    IF v_patched = v_definition THEN
        RAISE EXCEPTION 'orders_role_field_guard definition did not contain the expected assignment cost guard';
    END IF;

    EXECUTE v_patched;
END;
$$;
