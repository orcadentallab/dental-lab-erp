BEGIN;
SET search_path=public,extensions;
SELECT no_plan();

INSERT INTO auth.users(id,email) VALUES
 ('ba200000-0000-4000-8000-000000000001','mixed-admin@example.test'),
 ('ba200000-0000-4000-8000-000000000002','mixed-coord@example.test'),
 ('ba200000-0000-4000-8000-000000000003','mixed-design@example.test'),
 ('ba200000-0000-4000-8000-000000000004','mixed-tech@example.test'),
 ('ba200000-0000-4000-8000-000000000005','mixed-production@example.test');
INSERT INTO public.users(id,auth_id,username,role,name) VALUES
 ('ba200000-0000-4000-8000-000000000001','ba200000-0000-4000-8000-000000000001','mixed_test_admin','admin','Pilot admin'),
 ('ba200000-0000-4000-8000-000000000002','ba200000-0000-4000-8000-000000000002','mixed_test_coord','coordinator','Pilot coordinator'),
 ('ba200000-0000-4000-8000-000000000003','ba200000-0000-4000-8000-000000000003','mixed_test_design','designer','Pilot designer'),
 ('ba200000-0000-4000-8000-000000000004','ba200000-0000-4000-8000-000000000004','mixed_test_tech','technician','Pilot technician'),
 ('ba200000-0000-4000-8000-000000000005','ba200000-0000-4000-8000-000000000005','mixed_test_production','production_manager','Pilot production manager');
INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name)
 VALUES ('ba200000-0000-4000-8000-000000000010','Pilot clinic','01000000000','Pilot address','TRY-PILOT','Pilot');
INSERT INTO public.suppliers(id,name,phone,supplier_type) VALUES
 ('ba200000-0000-4000-8000-000000000012','Pilot finishing lab','01000000000','external_lab'),
 ('ba200000-0000-4000-8000-000000000013','Pilot courier','01000000000','courier'),
 ('ba200000-0000-4000-8000-000000000014','Pilot alternate lab','01000000000','external_lab');
INSERT INTO public.services(name,selling_price,cost_price,milling_price,designer_price)
VALUES ('Reviewed print fixture',900,290,150,100),('Reviewed lab fixture',900,290,150,100);
UPDATE public.suppliers SET custom_prices='{"Reviewed lab fixture":275}',milling_prices='{"Reviewed lab fixture":125}'
WHERE id='ba200000-0000-4000-8000-000000000012';
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000001',true);
SELECT public.set_design_qc_enabled(false,'Reviewed route test');

CREATE TEMP TABLE route_cases(id uuid, route uuid, service text, next_code text, expected_ap numeric);
INSERT INTO route_cases VALUES
 ('ba200000-0000-4000-8000-000000000011','ba500000-0000-4000-8000-000000000001','Reviewed print fixture','printing',NULL),
 ('ba200000-0000-4000-8000-000000000015','ba100000-0000-4000-8000-000000000001','Reviewed lab fixture','milling',275);
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,production_status,delivery_date,delivery_type,workflow_type,designer_id,design_price,route_override_id)
 SELECT id,'REVIEWED-'||next_code,'ba200000-0000-4000-8000-000000000010','Synthetic patient','[]',900,100,'A1','designing',current_date,'Final','split','ba200000-0000-4000-8000-000000000003',100,route FROM route_cases;
INSERT INTO public.order_items(order_id,product_type,teeth_numbers,price,shade,count)
 SELECT id,service,'["11"]',900,'A1',1 FROM route_cases;
CREATE TEMP VIEW reviewed_runs AS SELECT r.*,s.code,j.order_id FROM public.production_stage_runs r
 JOIN public.production_jobs j ON j.id=r.job_id JOIN public.production_stages s ON s.id=r.stage_id
 WHERE j.order_id IN (SELECT id FROM route_cases) AND r.qc_followup_run_id IS NULL;
SELECT is((SELECT count(*) FROM reviewed_runs WHERE code='design' AND status='ready'),2::bigint,'Both explicit routes start at design');
SELECT is((SELECT string_agg(code,',' ORDER BY seq) FROM reviewed_runs
    WHERE order_id=(SELECT id FROM route_cases WHERE next_code='milling')),
    'design,milling,qc,shipping','Final case uses the shared template without a trial round');
SELECT is((SELECT estimated FROM public.get_order_production_quote((SELECT id FROM route_cases WHERE next_code='milling'))),150::numeric,'Estimate uses the service milling price');
SELECT is((SELECT agreed FROM public.get_order_production_quote((SELECT id FROM route_cases WHERE next_code='milling'))),NULL::numeric,'Unassigned case has no agreed price');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000003',true);
SELECT throws_ok($$SELECT public.get_order_production_quote((SELECT id FROM route_cases WHERE next_code='milling'))$$,
    '42501','السعر للأدمن فقط','Designer cannot access the manufacturing quote');
SELECT public.submit_design_delivery(id,gen_random_uuid(),'link','https://example.test/design','No HTML in fixture') FROM route_cases;
SELECT is((SELECT count(*) FROM reviewed_runs r JOIN route_cases c ON c.id=r.order_id AND c.next_code=r.code WHERE r.status='ready'),2::bigint,'Each case advances to its mapped operation');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000001',true);
SELECT public.complete_stage_run(id) FROM reviewed_runs WHERE code='printing' AND status='ready';
SELECT is(public.get_mixed_try_in_price((SELECT id FROM reviewed_runs WHERE code='milling'),'ba200000-0000-4000-8000-000000000012'),275::numeric,'Lab quote uses full manufacturing supplier price');
SELECT public.send_external_work_order((SELECT id FROM reviewed_runs WHERE code='milling'),'ba200000-0000-4000-8000-000000000012');
SELECT is((SELECT agreed FROM public.get_order_production_quote((SELECT id FROM route_cases WHERE next_code='milling'))),275::numeric,'Order summary exposes the agreed quote after assignment');
SELECT public.receive_external_work_order((SELECT w.id FROM public.external_work_orders w JOIN reviewed_runs r ON r.id=w.stage_run_id));
SELECT is((SELECT count(*) FROM public.financial_obligations WHERE order_id IN (SELECT id FROM route_cases) AND entity_type='external_lab'),0::bigint,'Lab receipt creates no payable');
SELECT is((SELECT count(*) FROM reviewed_runs WHERE code='qc' AND status='ready'),2::bigint,'Both cases open physical QC');
SELECT public.complete_stage_run(id) FROM reviewed_runs WHERE code='qc' AND status='ready';
SELECT is((SELECT count(*) FROM public.orders WHERE id IN (SELECT id FROM route_cases) AND production_status='final_ready'),2::bigint,'Both cases are ready for final shipping');
CREATE TEMP TABLE reviewed_shipments AS SELECT (public.create_shipment('ba200000-0000-4000-8000-000000000013','ba200000-0000-4000-8000-000000000010',NULL,ARRAY[id])->>'shipment_id')::uuid AS id FROM route_cases;
SELECT public.dispatch_shipment(id) FROM reviewed_shipments;
SELECT is((SELECT count(*) FROM public.financial_obligations WHERE order_id IN (SELECT id FROM route_cases) AND entity_type='external_lab'),0::bigint,'Dispatch creates no payable');
SELECT public.confirm_shipment_delivery(id) FROM reviewed_shipments;
SELECT is((SELECT count(*) FROM public.orders WHERE id IN (SELECT id FROM route_cases) AND production_status='final_delivered'),2::bigint,'Both shipments close their cases');
SELECT is((SELECT count(*) FROM public.financial_obligations WHERE order_id IN (SELECT id FROM route_cases) AND entity_type='external_lab' AND status<>'void'),1::bigint,'Only external production creates a payable');
SELECT is((SELECT net_amount FROM public.financial_obligations WHERE order_id IN (SELECT id FROM route_cases) AND entity_type='external_lab' AND status<>'void'),275::numeric,'Final receipt accrues the agreed lab price');
SELECT * FROM finish();
ROLLBACK;
