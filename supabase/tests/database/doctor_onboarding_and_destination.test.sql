BEGIN;
SET search_path TO public, extensions;
SELECT plan(7);
CREATE TEMP TABLE doctor_count_before AS SELECT count(*) AS n FROM public.doctors;
SELECT is((public.register_verified_doctor('01077100111','proof','{"name":"Doctor","address":"Clinic address"}')->>'success')::boolean,false,'Registration without verified possession proof is rejected');
SELECT is((SELECT count(*) FROM public.doctors),(SELECT n FROM doctor_count_before),'Unverified registration creates no doctor or code');
INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name,is_center,has_branches,branches)
VALUES('81000000-0000-0000-0000-000000000071','Destination Test Center','01077100111','Test center address','DOC-DESTINATION-FIXTURE','',true,true,
'[{"id":"branch-one-fixture","name":"Branch One","address":"Branch One address","phone":""},{"id":"branch-two-fixture","name":"Branch Two","address":"Branch Two address","phone":""}]');
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
VALUES('82000000-0000-0000-0000-000000000071','00000000-0000-0000-0000-000000000000','authenticated','authenticated','destination-fixture@local.test',now(),now());
INSERT INTO public.users(id,auth_id,username,role,name,entity_id,is_active)
VALUES('83000000-0000-0000-0000-000000000071','82000000-0000-0000-0000-000000000071','destination-fixture','doctor','Test Center','81000000-0000-0000-0000-000000000071',true);
SELECT is((SELECT jsonb_array_length(branches) FROM public.doctors WHERE id='81000000-0000-0000-0000-000000000071'),2,'Existing named branch addresses are preserved');
INSERT INTO public.services(id,name,selling_price,cost_price) VALUES('91000000-0000-0000-0000-000000000071','Destination Test Service',100,0);
SELECT set_config('request.jwt.claim.sub','82000000-0000-0000-0000-000000000071',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
CREATE TEMP TABLE destination_order(id uuid);
INSERT INTO destination_order SELECT public.create_my_order_request_with_destination('Test Patient','[{"serviceType":"Destination Test Service","teethNumbers":["11"],"price":100}]','A1',NULL,'https://example.test/scan',NULL,current_date+3,100,'branch-one-fixture','Edited shipping address');
SELECT is((SELECT branch_name FROM public.orders WHERE id=(SELECT id FROM destination_order)),'Branch One','Digital order keeps the selected branch');
SELECT is((SELECT delivery_address FROM public.orders WHERE id=(SELECT id FROM destination_order)),'Edited shipping address','Edited shipping address is persisted');
SELECT is((SELECT branches->0->>'address' FROM public.doctors WHERE id='81000000-0000-0000-0000-000000000071'),'Branch One address','Order address edit does not overwrite doctor profile');
SELECT throws_ok($test$ SELECT public.create_my_order_request_with_destination('Patient','[{"serviceType":"Destination Test Service","teethNumbers":["11"],"price":100}]','A1',NULL,NULL,NULL,current_date+3,100,'another-doctors-branch','Clinic address') $test$,'P0001','الفرع لا يتبع حسابك','Another account branch is rejected');
SELECT * FROM finish();
ROLLBACK;
