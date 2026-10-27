BEGIN;
SET search_path=public,extensions;
SELECT plan(29);
-- All fixtures are rolled back. No hosted database or financial writes.
INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name,branches) VALUES
('91000000-0000-0000-0000-000000000001','طبيب رقم محلي','01098484811','العنوان القديم الأول','QA-PHONE-1','', '[{"id":"old-branch","name":"الفرع القديم","address":"عنوان الفرع القديم","phone":"01098484812"}]'),
('91000000-0000-0000-0000-000000000002','طبيب رقم دولي','+20 10 98484811','العنوان القديم الثاني','QA-PHONE-2','', '[]'),
('91000000-0000-0000-0000-000000000003','طبيب رقم اكسل','1098484811','العنوان القديم الثالث','QA-PHONE-3','', '[]');
SELECT is(jsonb_array_length(public.find_doctor_registration_matches('01098484811')->'matches'),3,'Local input matches local, spaced international and stripped-zero ERP records');
SELECT is(public.normalize_phone('+20 10 98484811'),'201098484811','Spaced international number has the same canonical form');
SELECT is(public.normalize_phone('1098484811'),'201098484811','Excel number has the same canonical form');
SELECT ok(NOT ((public.find_doctor_registration_matches('01098484811')->'matches'->0) ? 'custom_prices'),'Prefill excludes financial pricing');
SELECT is(public.find_doctor_registration_matches('01098484812')->'matches'->0->'branches'->0->>'address','عنوان الفرع القديم','Branch address is supplied for prefill');
CREATE TEMP TABLE contacts_profile AS SELECT '{"name":"أحمد حسن","address":"العنوان المكتوب للتسجيل","code_region":"cairo","contact_phones":[{"phone":"01098484811","ownerRole":"doctor","hasWhatsapp":true},{"phone":"01098484813","ownerRole":"secretary","ownerName":"سارة","hasWhatsapp":false},{"phone":"01098484814","ownerRole":"whatsapp_only","hasWhatsapp":false},{"phone":"01098484815","ownerRole":"other_doctor","ownerName":"د. محمد علي","hasWhatsapp":true}],"branches":[{"name":"الفرع الجديد","address":"عنوان الفرع الجديد","phone":"02 23456789","phoneOwnerRole":"secretary","phoneOwnerName":"سارة","phoneHasWhatsapp":false}],"address_change_requested":true,"requested_address":"عنوان جديد مطلوب اعتماده"}'::jsonb AS value;
SELECT ok(NOT (public.register_doctor_password_account('01098484811','short-contact@local.test','1234567',(SELECT value FROM contacts_profile),'existing','91000000-0000-0000-0000-000000000001')->>'success')::boolean,'Seven characters rejected');
SELECT throws_ok($q$ SELECT public.register_doctor_password_account('01098484811','bad-branch-contact@local.test','12345678',jsonb_set((SELECT value FROM contacts_profile),'{branches,0,phone}','""'),'existing','91000000-0000-0000-0000-000000000001') $q$,'P0001','راجع رقم التواصل','Every new branch requires a valid phone');
SELECT throws_ok($q$ SELECT public._clean_doctor_contact_phones('[{"phone":"01098484811"},{"phone":"+20 10 98484811"}]') $q$,'P0001','رقم التواصل مكرر','Duplicate phones detected after normalization');
SELECT throws_ok($q$ SELECT public._clean_doctor_contact_phones('[{"phone":"01098484811","ownerRole":"other_doctor","ownerName":"محمد"}]') $q$,'P0001','اسم الطبيب الآخر يجب أن يكون عربيًا وثنائيًا على الأقل','Other doctor requires a full Arabic name');
CREATE TEMP TABLE contacts_signup AS SELECT public.register_doctor_password_account('01098484811','contact-review@local.test','12345678',(SELECT value FROM contacts_profile),'existing','91000000-0000-0000-0000-000000000001') AS result;
SELECT is((SELECT result->>'status' FROM contacts_signup),'pending','Eight-character password is accepted for reviewed signup');
SELECT is((SELECT address FROM public.doctors WHERE id='91000000-0000-0000-0000-000000000001'),'العنوان القديم الأول','Unreviewed claim does not alter main address');
SELECT is((SELECT jsonb_array_length(branches) FROM public.doctors WHERE id='91000000-0000-0000-0000-000000000001'),1,'Unreviewed claim does not append branches');
SELECT ok(NOT has_table_privilege('anon','public.doctor_address_update_requests','SELECT'),'Address queue is private');
SELECT ok(NOT has_function_privilege('authenticated','public._apply_doctor_registration_contacts(uuid,jsonb,boolean)','EXECUTE'),'Contact helper cannot bypass approval');
SELECT throws_ok($q$ SELECT public.review_doctor_address_update((SELECT id FROM public.doctor_address_update_requests WHERE requested_address='عنوان جديد مطلوب اعتماده'),true) $q$,'P0001','غير مصرح بمراجعة العنوان','Anonymous review denied');
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at) VALUES('92000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','contact-admin@local.test',now(),now());
INSERT INTO public.users(id,auth_id,username,role,name,is_active) VALUES('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','contact_admin_qa','admin','مسؤول اختبار',true);
SELECT set_config('request.jwt.claim.sub','92000000-0000-0000-0000-000000000001',true);
SELECT ok((public.review_doctor_password_registration((SELECT id FROM public.doctor_password_registrations WHERE phone='201098484811'),true,'91000000-0000-0000-0000-000000000001')->>'success')::boolean,'Staff links the account without approving the address');
SELECT is((SELECT address FROM public.doctors WHERE id='91000000-0000-0000-0000-000000000001'),'العنوان القديم الأول','Link approval alone preserves main address');
SELECT is((SELECT jsonb_array_length(branches) FROM public.doctors WHERE id='91000000-0000-0000-0000-000000000001'),2,'Approved link appends a new branch');
SELECT is((SELECT branches->0->>'id' FROM public.doctors WHERE id='91000000-0000-0000-0000-000000000001'),'old-branch','Original branch identity retained');
SELECT is((SELECT branches->1->>'phone' FROM public.doctors WHERE id='91000000-0000-0000-0000-000000000001'),'20223456789','Branch landline is normalized and retained');
SELECT is((SELECT contact_phones->1->>'ownerName' FROM public.doctors WHERE id='91000000-0000-0000-0000-000000000001'),'سارة','Secretary name and role retained');
SELECT is((SELECT contact_phones->2->>'hasWhatsapp' FROM public.doctors WHERE id='91000000-0000-0000-0000-000000000001'),'true','WhatsApp-only number always marked WhatsApp');
SELECT is((SELECT contact_phones->3->>'ownerName' FROM public.doctors WHERE id='91000000-0000-0000-0000-000000000001'),'محمد علي','Other doctor name is normalized');
SELECT is(jsonb_array_length(public.find_doctor_registration_matches('01098484815')->'matches'),1,'Additional phone can find the linked clinic');
SELECT ok(EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_pending_doctor_password_registrations()) r WHERE (r->>'address_update')::boolean),'Address proposal stays visible in the staff queue after linking');
UPDATE public.doctors SET address='عنوان عدله المعمل بالفعل' WHERE id='91000000-0000-0000-0000-000000000001';
SELECT throws_ok($q$ SELECT public.review_doctor_address_update((SELECT id FROM public.doctor_address_update_requests WHERE requested_address='عنوان جديد مطلوب اعتماده'),true) $q$,'P0001','العنوان تغير منذ الطلب؛ راجعه قبل التعديل','Stale proposal cannot overwrite a later address edit');
UPDATE public.doctors SET address='العنوان القديم الأول' WHERE id='91000000-0000-0000-0000-000000000001';
SELECT ok((public.review_doctor_address_update((SELECT id FROM public.doctor_address_update_requests WHERE requested_address='عنوان جديد مطلوب اعتماده'),true)->>'success')::boolean,'Staff explicitly approves the address');
SELECT is((SELECT address FROM public.doctors WHERE id='91000000-0000-0000-0000-000000000001'),'عنوان جديد مطلوب اعتماده','Explicit approval applies only the requested address');
SELECT is((SELECT doctor_code FROM public.doctors WHERE id='91000000-0000-0000-0000-000000000001'),'QA-PHONE-1','Existing doctor code preserved');
SELECT * FROM finish();
ROLLBACK;
