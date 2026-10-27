BEGIN;
SET search_path=public,extensions;
SELECT plan(52);
INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name,is_center,custom_prices,branches) VALUES
('a1000000-0000-0000-0000-000000000001','مركز اختبار النطاق','01099111111','عنوان المركز الأصلي','QA-SCOPE-1','',true,'{"خدمة اختبار البوابة":80}','[{"id":"qa-branch","name":"فرع الاختبار","address":"عنوان الفرع الاختباري","phone":"01099111115"}]'),
('a1000000-0000-0000-0000-000000000002','طبيب اختبار أول','01099111112','عنوان المركز الأصلي','QA-SCOPE-2','',false,'{}','[]'),
('a1000000-0000-0000-0000-000000000003','طبيب اختبار ثاني','01099111113','عنوان المركز الأصلي','QA-SCOPE-3','',false,'{}','[]'),
('a1000000-0000-0000-0000-000000000004','طبيب اختبار دعوة','01099111114','عنوان المركز الأصلي','QA-SCOPE-4','',false,'{}','[]'),
('a1000000-0000-0000-0000-000000000005','طبيب مستقل اختبار','01099111116','عنوان العيادة المستقلة','QA-SCOPE-5','',false,'{}','[]');
UPDATE public.doctors SET parent_id='a1000000-0000-0000-0000-000000000001' WHERE id IN('a1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000004');
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at) VALUES
('a2000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','scope-center@local.test',now(),now()),
('a2000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','scope-child@local.test',now(),now()),
('a2000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','scope-staff@local.test',now(),now());
INSERT INTO public.users(id,auth_id,username,role,name,entity_id,is_active) VALUES
('a3000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','scope_center','doctor','مركز اختبار النطاق','a1000000-0000-0000-0000-000000000001',true),
('a3000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000002','scope_child','doctor','طبيب اختبار أول','a1000000-0000-0000-0000-000000000002',true),
('a3000000-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000003','scope_staff','admin','مسؤول اختبار',NULL,true);
INSERT INTO public.services(id,name,selling_price,cost_price) VALUES('a4000000-0000-0000-0000-000000000001','خدمة اختبار البوابة',100,0);
SELECT set_config('request.jwt.claim.sub','a2000000-0000-0000-0000-000000000001',true);
SELECT is((SELECT count(*) FROM public.doctor_portal_scope()),4::bigint,'Center scope contains itself and only registered children');
SELECT ok((public.create_doctor_portal_invitation('a1000000-0000-0000-0000-000000000004')->>'success')::boolean,'Center can invite its existing unlinked child');
SELECT throws_ok($q$ SELECT public.create_doctor_portal_invitation('a1000000-0000-0000-0000-000000000005') $q$,'P0001','غير مصرح بإصدار دعوة لهذا الطبيب','Center cannot invite an unrelated doctor');
SELECT throws_ok($q$ SELECT public.register_doctor_password_account('01099111999','duplicate-center-child@local.test','PortalQA8','{"name":"مركز جديد اختبار","address":"عنوان مركز جديد اختبار","code_region":"other","is_center":true,"doctors":[{"name":"طبيب قديم اختبار","phone":"01099111116"}]}','new') $q$,'P0001','رقم طبيب المركز له سجل بالفعل؛ اطلب من المعمل ربط السجل القديم','New center cannot duplicate or reparent an old doctor by phone');
CREATE TEMP TABLE portal_payload AS SELECT '{"doctor_id":"a1000000-0000-0000-0000-000000000002","patient_name":"حالة اختبار أولى","intake_type":"pickup","delivery_address":"عنوان الفرع الاختباري","branch_id":"qa-branch","contact_phone":"01099111115","pickup_timing":"بعد الخامسة","trays_details":"مقاس واحد","items":[{"serviceType":"خدمة اختبار البوابة","teethNumbers":["11","12"],"price":999}],"total_price":999,"shade":"A1"}'::jsonb AS value;
CREATE TEMP TABLE portal_orders AS SELECT public.submit_doctor_portal_case('a5000000-0000-0000-0000-000000000001',(SELECT value FROM portal_payload)) AS first;
ALTER TABLE portal_orders ADD COLUMN second uuid;
UPDATE portal_orders SET second=public.submit_doctor_portal_case('a5000000-0000-0000-0000-000000000002',jsonb_set((SELECT value FROM portal_payload),'{doctor_id}','"a1000000-0000-0000-0000-000000000003"'));
SELECT is(public.submit_doctor_portal_case('a5000000-0000-0000-0000-000000000001',(SELECT value FROM portal_payload)),(SELECT first FROM portal_orders),'Retry returns the same case');
SELECT is((SELECT total_price FROM public.orders WHERE id=(SELECT first FROM portal_orders)),160::numeric,'Server prices the case using center prices, ignoring injected prices');
SELECT is((SELECT delivery_date FROM public.orders WHERE id=(SELECT first FROM portal_orders)),(timezone('Africa/Cairo',now())::date+3),'Legacy internal scheduling default is kept out of doctor projections');
SELECT is((SELECT count(*) FROM public.production_jobs WHERE order_id=(SELECT first FROM portal_orders)),0::bigint,'Unreviewed portal intake does not start a production clock');
SELECT is((SELECT branch_name FROM public.orders WHERE id=(SELECT first FROM portal_orders)),'فرع الاختبار','Center branch is available for child intake');
SELECT is((SELECT delivery_contact_phone FROM public.orders WHERE id=(SELECT first FROM portal_orders)),'201099111115','Destination phone is normalized');
SELECT is((SELECT pickup_timing FROM public.doctor_pickup_requests WHERE order_id=(SELECT first FROM portal_orders)),'بعد الخامسة','Structured pickup request records availability');
SELECT throws_ok($q$ SELECT public.submit_doctor_portal_case(gen_random_uuid(),jsonb_set((SELECT value FROM portal_payload),'{doctor_id}','"a1000000-0000-0000-0000-000000000005"')) $q$,'P0001','الطبيب لا يتبع حسابك','Center cannot submit an unrelated doctor case');
SELECT throws_ok($q$ SELECT public.submit_doctor_portal_case(gen_random_uuid(),jsonb_set((SELECT value FROM portal_payload),'{branch_id}','"foreign-branch"')) $q$,'P0001','الفرع لا يتبع العيادة','Foreign destination branch denied');
SELECT is(jsonb_array_length(public.get_doctor_portal_cases()),2,'Center sees both child cases');
SELECT ok(NOT (public.get_doctor_portal_cases()->0 ? 'delivery_date') AND NOT (public.get_doctor_portal_cases()->0 ? 'total_price'),'Case projection exposes neither ETA nor financial fields');
SELECT set_config('request.jwt.claim.sub','a2000000-0000-0000-0000-000000000002',true);
SELECT is((SELECT count(*) FROM public.doctor_portal_scope()),1::bigint,'Child scope excludes center and siblings');
SELECT is(jsonb_array_length(public.get_doctor_portal_cases()),1,'Child sees only its case');
SELECT ok(public.doctor_portal_can_access_order((SELECT first FROM portal_orders)),'Child can access its attachment scope');
SELECT ok(NOT public.doctor_portal_can_access_order((SELECT second FROM portal_orders)),'Sibling attachment scope is denied');
SELECT ok(public.doctor_portal_owns_file((SELECT first::text FROM portal_orders)||'/instruction/scan.stl'),'Owned scan path allowed');
SELECT ok(NOT public.doctor_portal_owns_file((SELECT second::text FROM portal_orders)||'/instruction/scan.stl'),'Sibling scan path denied');
SELECT ok(NOT public.doctor_portal_owns_file((SELECT first::text FROM portal_orders)||'/qc/staff-only.png'),'Internal QC attachment path denied');
SELECT throws_ok($q$ SELECT public.send_doctor_portal_message('استفسار',(SELECT second FROM portal_orders)) $q$,'P0001','الحالة لا تتبع حسابك','Child cannot ask on a sibling case');
CREATE TEMP TABLE portal_message AS SELECT public.send_doctor_portal_message('أحتاج استفسارًا عن حالتي',(SELECT first FROM portal_orders)) AS id;
SELECT is(jsonb_array_length(public.get_my_doctor_messages()),1,'Doctor sees its submitted question');
SELECT throws_ok($q$ SELECT public.get_doctor_portal_staff_inbox() $q$,'P0001','غير مصرح','Doctor cannot open staff inbox');
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.financial_obligations(order_id,entity_type,entity_id,direction,trigger_type,trigger_date,due_date,gross_amount,net_amount) SELECT first,'doctor','a1000000-0000-0000-0000-000000000001','receivable','doctor_delivered',date_trunc('month',timezone('Africa/Cairo',now()))::date,current_date,160,160 FROM portal_orders;
INSERT INTO public.financial_obligations(order_id,entity_type,entity_id,direction,trigger_type,trigger_date,due_date,gross_amount,net_amount) SELECT second,'doctor','a1000000-0000-0000-0000-000000000001','receivable','doctor_delivered',(date_trunc('month',timezone('Africa/Cairo',now()))-interval '1 month')::date,current_date,90,90 FROM portal_orders;
SELECT set_config('request.jwt.claim.sub','a2000000-0000-0000-0000-000000000002',true);
SELECT is(public.get_my_doctor_month(false)->>'charges','160.00','Child monthly charges are based on its cases, despite center-owned obligation');
SELECT is(public.get_my_doctor_month(true)->>'charges','0','Child previous month excludes sibling accounting');
SELECT set_config('request.jwt.claim.sub','a2000000-0000-0000-0000-000000000001',true);
SELECT is(public.get_my_doctor_month(true)->>'charges','90.00','Center previous month aggregates registered child charges separately');
SELECT set_config('request.jwt.claim.sub','a2000000-0000-0000-0000-000000000003',true);
SELECT lives_ok($q$ SELECT public.reply_doctor_portal_message((SELECT id FROM portal_message),'الحالة حاليًا في المراجعة') $q$,'Staff replies without changing the order');
SELECT lives_ok($q$ SELECT public.coordinate_doctor_pickup((SELECT id FROM public.doctor_pickup_requests WHERE order_id=(SELECT first FROM portal_orders)),'scheduled','requested','الاستلام مساءً') $q$,'Coordinator schedules pickup');
SELECT throws_ok($q$ SELECT public.coordinate_doctor_pickup((SELECT id FROM public.doctor_pickup_requests WHERE order_id=(SELECT first FROM portal_orders)),'received','scheduled','') $q$,'P0001','حركة الاستلام غير صالحة','Pickup cannot jump to received');
SELECT lives_ok($q$ SELECT public.coordinate_doctor_pickup((SELECT id FROM public.doctor_pickup_requests WHERE order_id=(SELECT first FROM portal_orders)),'collected','scheduled','') $q$,'Coordinator marks collected');
SELECT lives_ok($q$ SELECT public.coordinate_doctor_pickup((SELECT id FROM public.doctor_pickup_requests WHERE order_id=(SELECT first FROM portal_orders)),'received','collected','') $q$,'Coordinator confirms actual receipt');
SELECT set_config('request.jwt.claim.sub','a2000000-0000-0000-0000-000000000002',true);
SELECT is(public.get_my_doctor_messages()->0->>'reply','الحالة حاليًا في المراجعة','Reply appears in the doctor account');
SELECT is(public.get_doctor_portal_cases()->0->>'pickup_status','received','Doctor sees confirmed pickup progress');
SELECT ok(jsonb_array_length(public.get_doctor_portal_catalog())>0 AND NOT(public.get_doctor_portal_catalog()->0 ? 'cost_price'),'Doctor catalogue provides choices without internal cost columns');
SELECT set_config('request.jwt.claim.sub','a2000000-0000-0000-0000-000000000003',true);
SELECT throws_ok($q$ SELECT public.create_shipment(NULL,'a1000000-0000-0000-0000-000000000002',NULL,ARRAY[(SELECT first FROM portal_orders)]) $q$,'P0001','الحالة لم تصبح جاهزة للشحن','Unreviewed case cannot be shipped');
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,status,production_status,delivery_date,delivery_address,delivery_contact_phone) VALUES
('a6000000-0000-0000-0000-000000000001','QA-PORTAL-SHIP-1','a1000000-0000-0000-0000-000000000002','حالة شحن أولى','[]',0,0,'A1','Ready','final_ready',current_date,'عنوان فرع الشحن','201099111115'),
('a6000000-0000-0000-0000-000000000002','QA-PORTAL-SHIP-2','a1000000-0000-0000-0000-000000000002','حالة شحن ثانية','[]',0,0,'A1','Ready','final_ready',current_date,'عنوان فرع آخر','201099111116');
SELECT throws_ok($q$ SELECT public.create_shipment(NULL,'a1000000-0000-0000-0000-000000000002',NULL,ARRAY['a6000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000002']::uuid[]) $q$,'P0001','الحالات لها عناوين شحن مختلفة؛ جهز شحنة لكل عنوان','Different branch destinations cannot be merged');
CREATE TEMP TABLE portal_shipment AS SELECT public.create_shipment(NULL,'a1000000-0000-0000-0000-000000000002',NULL,ARRAY['a6000000-0000-0000-0000-000000000001']::uuid[]) AS result;
SELECT is((SELECT delivery_address FROM public.shipments WHERE id=(SELECT (result->>'shipment_id')::uuid FROM portal_shipment)),'عنوان فرع الشحن','Shipment inherits the case branch address, not root clinic address');
SELECT is((SELECT recipient_phone FROM public.shipments WHERE id=(SELECT (result->>'shipment_id')::uuid FROM portal_shipment)),'201099111115','Shipment inherits the case contact number');
SELECT lives_ok($q$ SELECT public.dispatch_shipment((SELECT (result->>'shipment_id')::uuid FROM portal_shipment)) $q$,'Staff records actual dispatch');
SELECT set_config('request.jwt.claim.sub','a2000000-0000-0000-0000-000000000002',true);
SELECT is((SELECT c->>'shipment_status' FROM jsonb_array_elements(public.get_doctor_portal_cases())c WHERE c->>'case_id'='QA-PORTAL-SHIP-1'),'dispatched','Doctor sees actual shipment dispatch');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.orders),0::bigint,'Raw order rows do not bypass ETA or financial projection');
SELECT is((SELECT count(*) FROM public.financial_obligations),0::bigint,'Raw financial obligations are blocked');
SELECT is((SELECT count(*) FROM public.transactions),0::bigint,'Raw transactions cannot expose older months');
SELECT is((SELECT count(*) FROM public.adjustments),0::bigint,'Raw adjustments cannot expose lifetime or sibling balances');
SELECT is((SELECT count(*) FROM public.production_stage_runs),0::bigint,'Raw stage timing and throughput stay internal');
SELECT is((SELECT count(*) FROM public.order_events),0::bigint,'Staff workflow and financial audit details stay internal');
SELECT is((SELECT count(*) FROM public.services),0::bigint,'Raw service costs are private; doctors use the safe catalogue');
SELECT is((SELECT count(*) FROM public.production_routes),0::bigint,'Route estimates remain internal');
SELECT is((SELECT count(*) FROM public.production_stages),0::bigint,'Stage duration estimates remain internal');
SELECT is((SELECT count(*) FROM public.production_route_stages),0::bigint,'Route-stage timing data remain internal');
SELECT * FROM finish();
ROLLBACK;
