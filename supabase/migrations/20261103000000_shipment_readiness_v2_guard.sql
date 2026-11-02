-- Local regression: NULL legacy status bypassed the old NOT IN/<> predicate.
-- Keep permissions, destination checks and shipment mutations unchanged.
BEGIN;
DO $$
DECLARE
    v_signature regprocedure := 'public.create_shipment(uuid,uuid,text,uuid[],text[],text,text,text,text)'::regprocedure;
    v_definition text := pg_get_functiondef(v_signature);
    v_old text := 'production_status NOT IN(''final_ready'',''try_in_ready'') AND status<>''Ready''';
    v_new text := '(COALESCE(production_status, '''') NOT IN(''final_ready'',''try_in_ready'') OR intake_state IS DISTINCT FROM ''accepted'')';
BEGIN
    IF strpos(v_definition, v_old) = 0 THEN
        RAISE EXCEPTION 'Unexpected create_shipment definition; readiness patch not applied';
    END IF;
    EXECUTE replace(v_definition, v_old, v_new);
END;
$$;
COMMIT;
