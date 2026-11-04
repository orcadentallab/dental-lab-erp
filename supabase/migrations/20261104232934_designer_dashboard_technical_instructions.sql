BEGIN;
-- Extend the existing assignment-scoped projection instead of fetching a
-- supplier record or issuing one extra HTTP request for every dashboard row.
DO $$ DECLARE definition text; marker text:='''instructions'',replace('; BEGIN
 SELECT pg_get_functiondef('public.get_designer_workspace(uuid,boolean)'::regprocedure) INTO definition;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'Unexpected designer projection contract'; END IF;
 definition:=replace(definition,marker,'''supplier_design_instruction'',public.get_order_design_instruction(o.id,NULL),''instructions'',replace(');
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
