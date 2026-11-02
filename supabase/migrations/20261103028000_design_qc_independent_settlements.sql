-- Explicit former-designer earnings are independent manual settlements. Keep
-- the existing current-order Remake/Reject/Return/zero-impact rules unchanged.
-- Forward writers only: no historical obligation, allocation or cash updates.
BEGIN;
ALTER TABLE public.financial_obligations ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE public.financial_obligations ADD CONSTRAINT obligation_order_or_qc_settlement
 CHECK(order_id IS NOT NULL OR design_qc_assignment_id IS NOT NULL);

DO $$ DECLARE v text; BEGIN
 SELECT pg_get_functiondef('public.reassign_design_revision(uuid,uuid,text,numeric,numeric,uuid)'::regprocedure) INTO v;
 IF strpos(v,'VALUES(p_order_id,''designer'',v_order.designer_id')=0 THEN RAISE EXCEPTION 'Unexpected Design QC settlement writer'; END IF;
 EXECUTE replace(v,'VALUES(p_order_id,''designer'',v_order.designer_id','VALUES(NULL,''designer'',v_order.designer_id');
 SELECT pg_get_functiondef('public.assert_zero_issue_has_no_active_obligations()'::regprocedure) INTO v;
 EXECUTE replace(v,' AND obligation.design_qc_assignment_id IS NULL','');
END $$;

CREATE OR REPLACE FUNCTION public.get_design_qc_compensations() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'orderId',o.id,'caseId',o.case_id,'designerId',f.entity_id,'amount',f.net_amount,'date',f.trigger_date) ORDER BY f.created_at),'[]'::jsonb)
 FROM public.financial_obligations f
 JOIN public.design_qc_assignments a ON a.id=f.design_qc_assignment_id
 JOIN public.orders o ON o.id=a.order_id
 WHERE f.status NOT IN('void','written_off')
 AND (public.get_my_role() IN('admin','accountant','coordinator') OR (f.entity_id=public.get_my_user_id() AND public.get_my_role() IS NOT NULL))
$$;
COMMIT;
