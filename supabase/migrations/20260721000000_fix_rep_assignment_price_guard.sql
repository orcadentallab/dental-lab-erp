-- Representative edits may legitimately recalculate costs when the assigned
-- supplier/designer changes. The strict trigger previously treated those
-- derived price changes as stand-alone financial edits unless `items` also
-- changed, so the audited RPC failed with HTTP 400.
--
-- Keep rejecting stand-alone price changes, but accept a recalculation when
-- its business driver changes in the same audited update.
DO $$
DECLARE
    v_definition TEXT;
    v_patched TEXT;
BEGIN
    SELECT pg_get_functiondef('public.orders_role_field_guard()'::regprocedure)
      INTO v_definition;

    v_patched := replace(
        v_definition,
        '(NEW.cost               IS DISTINCT FROM OLD.cost AND NEW.items IS NOT DISTINCT FROM OLD.items)',
        '(NEW.cost               IS DISTINCT FROM OLD.cost AND NEW.items IS NOT DISTINCT FROM OLD.items AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id)'
    );

    IF v_patched = v_definition THEN
        RAISE EXCEPTION 'orders_role_field_guard definition did not contain the expected cost guard';
    END IF;

    v_definition := v_patched;
    v_patched := replace(
        v_definition,
        '(NEW.design_price       IS DISTINCT FROM OLD.design_price AND NEW.items IS NOT DISTINCT FROM OLD.items)',
        '(NEW.design_price       IS DISTINCT FROM OLD.design_price AND NEW.items IS NOT DISTINCT FROM OLD.items AND NEW.designer_id IS NOT DISTINCT FROM OLD.designer_id)'
    );

    IF v_patched = v_definition THEN
        RAISE EXCEPTION 'orders_role_field_guard definition did not contain the expected design price guard';
    END IF;

    EXECUTE v_patched;
END;
$$;
