BEGIN;
SET search_path=public,extensions;
SELECT plan(21);
INSERT INTO auth.users(id,email) VALUES('fa000000-0000-0000-0000-000000000001','supplier-timing@local.test');
INSERT INTO public.users(id,auth_id,username,role,name) VALUES
('fa000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-000000000001','supplier_timing_admin','admin','Timing admin'),
('fa000000-0000-0000-0000-000000000002',NULL,'supplier_timing_designer','designer','Timing designer');
INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name)
VALUES('fa000000-0000-0000-0000-000000000003','Timing doctor','01000000000','Local','TIMING','Test');
INSERT INTO public.suppliers(id,name,phone) VALUES('fa000000-0000-0000-0000-000000000004','Timing supplier','01000000000');
SELECT set_config('request.jwt.claim.sub','fa000000-0000-0000-0000-000000000001',true);
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,status,production_status,issue_state,delivery_date,supplier_id,designer_id,workflow_type,design_status,design_price)
VALUES('fa000000-0000-0000-0000-000000000005','TIMING-NEW','fa000000-0000-0000-0000-000000000003','Timing case','[]',1000,400,'A1','Ready','final_ready','none',current_date-10,'fa000000-0000-0000-0000-000000000004','fa000000-0000-0000-0000-000000000002','split','completed',100);
CREATE TEMP VIEW timing_ap AS SELECT * FROM public.financial_obligations WHERE order_id='fa000000-0000-0000-0000-000000000005' AND trigger_type='external_lab_ready' AND status<>'void';
CREATE TEMP TABLE designer_before AS SELECT * FROM public.financial_obligations WHERE order_id='fa000000-0000-0000-0000-000000000005' AND trigger_type='designer_approved';
SELECT is((SELECT count(*) FROM timing_ap),0::bigint,'Ready creates no normal supplier AP');
SELECT is((SELECT gross_amount FROM designer_before),100::numeric,'Completed design earns per-case designer payable before delivery');
UPDATE public.orders SET production_status='try_in_ready' WHERE case_id='TIMING-NEW';
SELECT is((SELECT count(*) FROM timing_ap),0::bigint,'Try-In Ready creates no normal supplier AP');
UPDATE public.orders SET production_status='waiting_doctor' WHERE case_id='TIMING-NEW';
SELECT is((SELECT count(*) FROM timing_ap),0::bigint,'Try-In receipt/waiting doctor is not final receipt');
UPDATE public.orders SET production_status='final_ready' WHERE case_id='TIMING-NEW';
SELECT is((SELECT count(*) FROM timing_ap),0::bigint,'Returning to final Ready still creates no supplier AP');
-- An actual pre-delivery supplier payment is still real cash, not a liability trigger.
INSERT INTO public.transactions(id,type,amount,category,date,description,entity_id,entity_type,status,is_approved)
VALUES('fa000000-0000-0000-0000-000000000006','expense',50,'Supplier payment',current_date-2,'Actual advance','fa000000-0000-0000-0000-000000000004','supplier','approved',true);
CREATE TEMP TABLE cash_before AS SELECT * FROM public.transactions WHERE id='fa000000-0000-0000-0000-000000000006';
CREATE TEMP TABLE cash_count AS SELECT count(*) AS n FROM public.transactions;
SELECT is((SELECT count(*) FROM timing_ap),0::bigint,'Actual advance does not earn supplier AP at Ready');
SELECT public.record_order_final_delivery_v2('fa000000-0000-0000-0000-000000000005',now(), 'fa000000-0000-0000-0000-000000000007');
SELECT is((SELECT gross_amount FROM timing_ap),300::numeric,'Final receipt earns only supplier component, preserving designer split');
SELECT is((SELECT trigger_date FROM timing_ap),(SELECT actual_delivery_date FROM public.orders WHERE case_id='TIMING-NEW'),'Supplier earning date is actual doctor receipt, not scheduled Ready date');
SELECT is((SELECT due_date FROM timing_ap),(SELECT actual_delivery_date+7 FROM public.orders WHERE case_id='TIMING-NEW'),'Existing supplier due-date terms start at actual receipt');
CREATE TEMP TABLE ap_before_retry AS SELECT id FROM timing_ap;
SELECT public.record_order_final_delivery_v2('fa000000-0000-0000-0000-000000000005',now(), 'fa000000-0000-0000-0000-000000000007');
UPDATE public.orders SET cost=cost WHERE case_id='TIMING-NEW';
SELECT is((SELECT count(*) FROM timing_ap),1::bigint,'Retry and repeated sync retain exactly one supplier obligation');
SELECT is((SELECT id FROM timing_ap),(SELECT id FROM ap_before_retry),'Repeated sync preserves obligation identity');
SELECT is((SELECT to_jsonb(f) FROM public.financial_obligations f WHERE id=(SELECT id FROM designer_before)),(SELECT to_jsonb(d) FROM designer_before d),'Final receipt does not replace/redate designer liability');
SELECT is((SELECT to_jsonb(t) FROM public.transactions t WHERE id='fa000000-0000-0000-0000-000000000006'),(SELECT to_jsonb(t) FROM cash_before t),'Cash date, approved status and amount remain byte-for-byte unchanged');
SELECT is((SELECT count(*) FROM public.transactions),(SELECT n FROM cash_count),'Accrual creates no cash transaction');
-- Simulate an existing legacy Ready obligation. Never repair/reallocate it implicitly.
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,production_status,delivery_date,supplier_id)
VALUES('fa000000-0000-0000-0000-000000000008','TIMING-LEGACY','fa000000-0000-0000-0000-000000000003','Legacy case','[]',0,200,'A1','final_ready',current_date-20,'fa000000-0000-0000-0000-000000000004');
INSERT INTO public.financial_obligations(order_id,entity_type,entity_id,direction,trigger_type,trigger_date,due_date,gross_amount,net_amount,source)
SELECT 'fa000000-0000-0000-0000-000000000008','external_lab','fa000000-0000-0000-0000-000000000004','payable','external_lab_ready',current_date-20,current_date-13,200,200,'order'
WHERE NOT EXISTS(SELECT 1 FROM public.financial_obligations WHERE order_id='fa000000-0000-0000-0000-000000000008' AND status<>'void');
CREATE TEMP TABLE legacy_before AS SELECT * FROM public.financial_obligations WHERE order_id='fa000000-0000-0000-0000-000000000008';
UPDATE public.orders SET cost=cost WHERE case_id='TIMING-LEGACY';
SELECT is((SELECT count(*) FROM public.financial_obligations WHERE order_id='fa000000-0000-0000-0000-000000000008'),(SELECT count(*) FROM legacy_before),'Existing Ready obligation is not replaced or backfilled');
SELECT results_eq('SELECT to_jsonb(f) FROM public.financial_obligations f WHERE order_id=''fa000000-0000-0000-0000-000000000008'' ORDER BY id','SELECT to_jsonb(f) FROM legacy_before f ORDER BY id','Existing Ready obligation retains every field on unrelated sync');
INSERT INTO public.users(id,username,role,name,custom_permissions)
VALUES('fa000000-0000-0000-0000-000000000009','timing_salary','designer','Salary designer','{"designer_fixed_salary":true}');
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,production_status,delivery_date,supplier_id,designer_id,workflow_type,design_status,design_price)
VALUES('fa000000-0000-0000-0000-000000000010','TIMING-SALARY','fa000000-0000-0000-0000-000000000003','Salary case','[]',900,400,'A1','final_ready',current_date,'fa000000-0000-0000-0000-000000000004','fa000000-0000-0000-0000-000000000009','split','completed',100);
SELECT is((SELECT gross_amount FROM public.financial_obligations WHERE order_id='fa000000-0000-0000-0000-000000000010' AND trigger_type='designer_approved' AND status<>'void'),0::numeric,'Fixed salary has no per-case designer earning at design completion');
SELECT is((SELECT count(*) FROM public.financial_obligations WHERE order_id='fa000000-0000-0000-0000-000000000010' AND trigger_type='external_lab_ready' AND status<>'void'),0::bigint,'Fixed-salary split still earns no supplier AP at Ready');
SELECT public.record_order_final_delivery_v2('fa000000-0000-0000-0000-000000000010',now(),gen_random_uuid());
SELECT is((SELECT gross_amount FROM public.financial_obligations WHERE order_id='fa000000-0000-0000-0000-000000000010' AND trigger_type='external_lab_ready' AND status<>'void'),400::numeric,'Fixed-salary supplier retains full existing cost formula at final receipt');
SELECT is((SELECT gross_amount FROM public.financial_obligations WHERE order_id='fa000000-0000-0000-0000-000000000010' AND trigger_type='designer_approved' AND status<>'void'),0::numeric,'Final receipt leaves fixed-salary per-case earning at zero');
SELECT is((SELECT count(*) FROM public.transactions),(SELECT n FROM cash_count),'Fixed salary final receipt also creates no cash');
SELECT * FROM finish();
ROLLBACK;
