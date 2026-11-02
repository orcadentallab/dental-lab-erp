-- Owner decision: choose former designer's earned amount and default/override
-- replacement fee explicitly. No remake rule or cash/source switch changes.
BEGIN;
CREATE TABLE public.design_qc_assignments(id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES public.orders(id),old_designer_id uuid REFERENCES public.users(id),new_designer_id uuid NOT NULL REFERENCES public.users(id),old_amount numeric(12,2) NOT NULL CHECK(old_amount>=0),new_amount numeric(12,2) NOT NULL CHECK(new_amount>=0),reason text NOT NULL,actor_id uuid NOT NULL REFERENCES public.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.financial_obligations ADD COLUMN design_qc_assignment_id uuid REFERENCES public.design_qc_assignments(id);
ALTER TABLE public.financial_obligations ADD CONSTRAINT qc_settlement_shape CHECK(design_qc_assignment_id IS NULL OR (entity_type='designer' AND direction='payable' AND source='adjustment' AND trigger_type='manual_adjustment'));
DROP INDEX public.uq_financial_obligation_source_trigger;
CREATE UNIQUE INDEX uq_financial_obligation_source_trigger ON public.financial_obligations(order_id,entity_type,entity_id,direction,trigger_type,source) WHERE status<>'void' AND design_qc_assignment_id IS NULL;
DROP INDEX public.uq_financial_obligation_active_business_key;
CREATE UNIQUE INDEX uq_financial_obligation_active_business_key ON public.financial_obligations(order_id,entity_type,direction,trigger_type,source) WHERE status NOT IN('void','written_off') AND design_qc_assignment_id IS NULL;
CREATE UNIQUE INDEX uq_design_qc_assignment_obligation ON public.financial_obligations(design_qc_assignment_id) WHERE design_qc_assignment_id IS NOT NULL AND status NOT IN('void','written_off');

CREATE FUNCTION public.design_qc_default_price(p_order_id uuid,p_designer_id uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(sum(coalesce((u.designer_service_prices->>i.product_type)::numeric,s.designer_price,0)*greatest(coalesce(jsonb_array_length(i.teeth_numbers),0),1)),0)
 FROM public.order_items i CROSS JOIN public.users u LEFT JOIN public.services s ON s.name=i.product_type WHERE i.order_id=p_order_id AND u.id=p_designer_id
$$;
CREATE FUNCTION public.get_design_qc_designer_options(p_order_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'price',public.design_qc_default_price(p_order_id,id),'salaried',coalesce((custom_permissions->>'designer_fixed_salary')::boolean,false)) ORDER BY name),'[]'::jsonb) FROM public.users WHERE public.get_my_role() IN('admin','coordinator') AND coalesce(is_active,true) AND (role='designer' OR coalesce((custom_permissions->>'secondary_designer')::boolean,false))
$$;

CREATE FUNCTION public.reassign_design_revision(p_order_id uuid,p_designer_id uuid,p_note text,p_old_amount numeric,p_new_amount numeric,p_command_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE v_order public.orders%ROWTYPE; v_old public.financial_obligations%ROWTYPE; v_prior public.design_qc_assignments%ROWTYPE; v_new_amount numeric; v_old_settlement uuid; v_salaried boolean;
BEGIN
 IF public.get_my_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Admin role required' USING ERRCODE='42501'; END IF;
 IF p_command_id IS NULL OR p_old_amount IS NULL OR p_old_amount<0 OR p_new_amount<0 OR nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'Valid fees and reason required' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR v_order.design_qc_revision_id IS NULL OR v_order.issue_state<>'none' OR coalesce(v_order.is_deleted,false) THEN RAISE EXCEPTION 'Active design revision required'; END IF;
 SELECT * INTO v_prior FROM public.design_qc_assignments WHERE id=p_command_id;
 IF FOUND THEN
 IF v_prior.order_id<>p_order_id OR v_prior.new_designer_id<>p_designer_id OR v_prior.old_amount<>p_old_amount OR v_prior.reason<>btrim(p_note) OR (p_new_amount IS NOT NULL AND v_prior.new_amount<>p_new_amount) THEN RAISE EXCEPTION 'Handoff retry mismatch'; END IF;
 RETURN;
 END IF;
 IF p_designer_id=v_order.designer_id THEN RAISE EXCEPTION 'Use return action for the same designer'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_designer_id AND coalesce(is_active,true) AND (role='designer' OR coalesce((custom_permissions->>'secondary_designer')::boolean,false))) THEN RAISE EXCEPTION 'Active designer required'; END IF;
 IF p_old_amount>0 AND EXISTS(SELECT 1 FROM public.users WHERE id=v_order.designer_id AND coalesce((custom_permissions->>'designer_fixed_salary')::boolean,false)) THEN RAISE EXCEPTION 'Fixed-salary designer has no per-case settlement'; END IF;
 v_new_amount:=coalesce(p_new_amount,public.design_qc_default_price(p_order_id,p_designer_id));
 SELECT coalesce((custom_permissions->>'designer_fixed_salary')::boolean,false) INTO v_salaried FROM public.users WHERE id=p_designer_id;
 SELECT * INTO v_old FROM public.financial_obligations WHERE order_id=p_order_id AND entity_type='designer' AND trigger_type='designer_approved' AND source='order' AND status NOT IN('void','written_off') FOR UPDATE;
 INSERT INTO public.design_qc_assignments VALUES(p_command_id,p_order_id,v_order.designer_id,p_designer_id,p_old_amount,v_new_amount,btrim(p_note),public.get_my_user_id(),clock_timestamp());
 IF v_old.id IS NOT NULL THEN UPDATE public.financial_obligations SET status='void',notes='Explicit Design QC handoff settlement',metadata=metadata||jsonb_build_object('designQcHandoff',p_command_id) WHERE id=v_old.id; END IF;
 IF p_old_amount>0 THEN
 INSERT INTO public.financial_obligations(order_id,entity_type,entity_id,direction,trigger_type,trigger_date,due_date,gross_amount,net_amount,source,created_by,metadata,design_qc_assignment_id)
 VALUES(p_order_id,'designer',v_order.designer_id,'payable','manual_adjustment',coalesce(v_old.trigger_date,current_date),coalesce(v_old.due_date,public.calculate_financial_obligation_due_date('designer',v_order.designer_id,current_date)),p_old_amount,p_old_amount,'adjustment',public.get_my_user_id(),jsonb_build_object('designQcAssignment',p_command_id,'formerDesigner',true),p_command_id) RETURNING id INTO v_old_settlement;
 END IF;
 IF v_old.id IS NOT NULL THEN PERFORM public.reallocate_voided_obligation_allocations(v_old.id,v_old_settlement,public.get_my_user_id()); END IF;
 IF v_old_settlement IS NOT NULL THEN PERFORM public.apply_entity_credits_fifo('designer',v_order.designer_id,'payable',public.get_my_user_id()); END IF;
 INSERT INTO public.design_qc_events(id,order_id,revision_id,action,note,actor_id,actor_role) VALUES(p_command_id,p_order_id,v_order.design_qc_revision_id,'returned',btrim(p_note),public.get_my_user_id(),public.get_my_role());
 UPDATE public.orders SET designer_id=p_designer_id,production_status='designing',design_status='in_progress',design_price=v_new_amount,manual_design_price=p_new_amount,
 cost=coalesce(lab_cost,0)+CASE WHEN v_salaried THEN 0 ELSE v_new_amount END WHERE id=p_order_id;
END $$;

-- Unpriced returns never silently transfer an earned financial right.
CREATE OR REPLACE FUNCTION public.return_design_revision(p_order_id uuid,p_designer_id uuid,p_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE v_order public.orders%ROWTYPE;
BEGIN
 IF public.get_my_role() NOT IN('admin','coordinator') THEN RAISE EXCEPTION 'Return role required' USING ERRCODE='42501'; END IF;
 IF nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR v_order.design_qc_revision_id IS NULL THEN RAISE EXCEPTION 'Revision required'; END IF;
 IF p_designer_id IS DISTINCT FROM v_order.designer_id THEN RAISE EXCEPTION 'Use priced designer handoff' USING ERRCODE='23514'; END IF;
 INSERT INTO public.design_qc_events(order_id,revision_id,action,note,actor_id,actor_role) VALUES(p_order_id,v_order.design_qc_revision_id,'returned',btrim(p_note),public.get_my_user_id(),public.get_my_role());
 UPDATE public.orders SET production_status='designing' WHERE id=p_order_id;
END $$;

CREATE FUNCTION public.get_design_qc_compensations() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'orderId',o.id,'caseId',o.case_id,'designerId',f.entity_id,'amount',f.net_amount,'date',f.trigger_date) ORDER BY f.created_at),'[]'::jsonb)
 FROM public.financial_obligations f JOIN public.orders o ON o.id=f.order_id
 WHERE f.design_qc_assignment_id IS NOT NULL AND f.status NOT IN('void','written_off') AND (public.get_my_role() IN('admin','accountant','coordinator') OR (f.entity_id=public.get_my_user_id() AND public.get_my_role() IS NOT NULL))
$$;

-- Protect creation of execution state without files, not only existing revisions.
DO $$ DECLARE v text; BEGIN
 SELECT pg_get_functiondef('public.guard_design_qc_order()'::regprocedure) INTO v;
 v:=replace(v,'IF TG_OP=''INSERT'' THEN',
 'IF TG_OP=''INSERT'' THEN
 IF v_enabled AND NEW.workflow_type=''split'' AND NEW.designer_id IS NOT NULL AND NEW.production_status IN(''in_production'',''try_in_ready'',''waiting_doctor'',''finalization'',''final_ready'',''final_delivered'') THEN RAISE EXCEPTION ''Submit design files before execution'' USING ERRCODE=''23514''; END IF;');
 v:=replace(v,'v_enabled AND NEW.design_qc_required AND NEW.production_status',
 'v_enabled AND (NEW.design_qc_required OR (NEW.workflow_type=''split'' AND NEW.designer_id IS NOT NULL AND OLD.production_status IN(''not_started'',''designing'') AND OLD.design_submitted_at IS NULL)) AND NEW.production_status');
 EXECUTE v;
END $$;
DROP TRIGGER aac_design_qc_stage ON public.production_stage_runs;
CREATE TRIGGER aac_design_qc_stage BEFORE INSERT OR UPDATE ON public.production_stage_runs FOR EACH ROW EXECUTE FUNCTION public.guard_design_qc_execution();

CREATE FUNCTION public.design_qc_can_read_path(p_path text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN IF p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/(execution[.]zip|preview[.]html)$' THEN RETURN false; END IF; RETURN public.design_qc_can_read_files(split_part(p_path,'/',1)::uuid); EXCEPTION WHEN invalid_text_representation THEN RETURN false; END $$;
CREATE FUNCTION public.design_qc_can_write_path(p_path text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN IF p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/(execution[.]zip|preview[.]html)$' THEN RETURN false; END IF; RETURN public.design_qc_can_read(split_part(p_path,'/',1)::uuid); EXCEPTION WHEN invalid_text_representation THEN RETURN false; END $$;
DROP POLICY qc_file_insert_limit ON storage.objects;
DROP POLICY qc_file_insert ON storage.objects;
DROP POLICY qc_file_read_limit ON storage.objects;
DROP POLICY qc_file_read ON storage.objects;
CREATE POLICY qc_file_insert_limit ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(bucket_id<>'design-qc-files' OR public.design_qc_can_write_path(name));
CREATE POLICY qc_file_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='design-qc-files' AND public.design_qc_can_write_path(name));
CREATE POLICY qc_file_read_limit ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING(bucket_id<>'design-qc-files' OR public.design_qc_can_read_path(name));
CREATE POLICY qc_file_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='design-qc-files' AND public.design_qc_can_read_path(name));
ALTER TABLE public.design_qc_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.design_qc_assignments FROM anon,authenticated;
GRANT SELECT ON public.design_qc_assignments TO authenticated;
CREATE POLICY qc_assignment_read ON public.design_qc_assignments FOR SELECT TO authenticated USING(public.get_my_role() IN('admin','accountant','coordinator') OR old_designer_id=public.get_my_user_id() OR new_designer_id=public.get_my_user_id());
REVOKE ALL ON FUNCTION public.design_qc_default_price(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reassign_design_revision(uuid,uuid,text,numeric,numeric,uuid),public.get_design_qc_designer_options(uuid),public.get_design_qc_compensations(),public.design_qc_can_read_path(text),public.design_qc_can_write_path(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reassign_design_revision(uuid,uuid,text,numeric,numeric,uuid),public.get_design_qc_designer_options(uuid),public.get_design_qc_compensations(),public.design_qc_can_read_path(text),public.design_qc_can_write_path(text) TO authenticated;
COMMIT;
