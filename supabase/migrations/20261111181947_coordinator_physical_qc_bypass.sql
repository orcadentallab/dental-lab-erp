BEGIN;

-- Keep the existing QC workflow and extend only the documented bypass permission.
DO $$
DECLARE
    definition text := pg_get_functiondef('public.mixed_physical_qc_action(uuid,text,text)'::regprocedure);
    role_check text := $anchor$IF public.get_my_role() IS DISTINCT FROM 'admin' THEN$anchor$;
    audit_actor text := $anchor$public.get_my_user_id(),'admin',btrim(p_reason)$anchor$;
BEGIN
    IF strpos(definition, role_check) = 0 OR strpos(definition, audit_actor) = 0 THEN
        RAISE EXCEPTION 'Unexpected physical QC authorization or audit definition';
    END IF;

    definition := replace(definition, role_check, $replacement$IF public.get_my_role() IS DISTINCT FROM 'admin'
       AND (public.get_my_role() IS DISTINCT FROM 'coordinator' OR p_action IS DISTINCT FROM 'bypass') THEN$replacement$);
    EXECUTE replace(definition, audit_actor,
        $replacement$public.get_my_user_id(),public.get_my_role(),btrim(p_reason)$replacement$);
END;
$$;

COMMIT;
