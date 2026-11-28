-- Synthetic review accounts in the isolated QA database only.
BEGIN;
INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name,is_center,parent_id,branches) VALUES
 ('da570000-0000-4000-8000-000000000010','مركز تجربة اليوم السادس','01099069010','عنوان المركز','D6-CENTER','QA',true,NULL,'[{"id":"day6-branch","name":"الفرع التجريبي","address":"عنوان فرع اليوم السادس","phone":"01099069010"}]'),
 ('da570000-0000-4000-8000-000000000011','طبيب الفرع الأول','01099069011','عنوان المركز','D6-CENTER-01','QA',false,'da570000-0000-4000-8000-000000000010','[]'),
 ('da570000-0000-4000-8000-000000000012','طبيب الفرع الثاني','01099069012','عنوان المركز','D6-CENTER-02','QA',false,'da570000-0000-4000-8000-000000000010','[]'),
 ('da570000-0000-4000-8000-000000000013','طبيب مستقل للتجربة','01099069013','عنوان الطبيب المستقل','D6-SOLO','QA',false,NULL,'[]'),
 ('da570000-0000-4000-8000-000000000014','طبيب معطّل للتجربة','01099069014','عنوان تجريبي','D6-INACTIVE','QA',false,NULL,'[]')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
    confirmation_token,recovery_token,email_change,email_change_token_new,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('da570000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated',login||'@example.test',extensions.crypt('Day6-Local-QA-Only!',extensions.gen_salt('bf')),now(),
    '','','','','{"provider":"email","providers":["email"]}','{}',now(),now()
FROM (VALUES (1,'d6_admin'),(2,'d6_designer'),(10,'d6_center'),(11,'d6_child1'),(12,'d6_child2'),(13,'d6_solo'),(14,'d6_inactive')) roles(n,login)
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.identities(id,provider_id,user_id,identity_data,provider,created_at,updated_at)
SELECT gen_random_uuid(),id::text,id,jsonb_build_object('sub',id::text,'email',email),'email',now(),now()
FROM auth.users WHERE id::text LIKE 'da570000-0000-4000-8000-%' AND email LIKE 'd6\_%@example.test'
ON CONFLICT (provider_id,provider) DO NOTHING;
INSERT INTO public.users(id,auth_id,username,role,name,email,is_active,entity_id)
SELECT id,id,split_part(email,'@',1),
    CASE email WHEN 'd6_admin@example.test' THEN 'admin' WHEN 'd6_designer@example.test' THEN 'designer' ELSE 'doctor' END,
    split_part(email,'@',1),email,email<>'d6_inactive@example.test',
    CASE WHEN email NOT IN ('d6_admin@example.test','d6_designer@example.test') THEN id END
FROM auth.users WHERE id::text LIKE 'da570000-0000-4000-8000-%' AND email LIKE 'd6\_%@example.test'
ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claim.sub','da570000-0000-4000-8000-000000000001',true);
INSERT INTO public.suppliers(id,supplier_code,name,supplier_type,phone)
VALUES ('da570000-0000-4000-8000-000000000031','D6-COURIER','شركة شحن تجربة اليوم السادس','courier','01099069031')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,production_status,
    delivery_date,delivery_type,branch_name)
VALUES
 ('da570000-0000-4000-8000-000000000021','D6-CHILD-TRIAL','da570000-0000-4000-8000-000000000011','عينة بروفة','[]',650,0,'A1','waiting_doctor',current_date,'TryIn','الفرع التجريبي'),
 ('da570000-0000-4000-8000-000000000022','D6-CHILD-FINAL','da570000-0000-4000-8000-000000000012','عينة نهائي','[]',900,0,'A1','final_ready',current_date,'Final','الفرع التجريبي'),
 ('da570000-0000-4000-8000-000000000023','D6-SOLO-FINAL','da570000-0000-4000-8000-000000000013','عينة مستقلة','[]',740,0,'A1','final_ready',current_date,'Final',NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,status,production_status,
    delivery_date,delivery_type,branch_name)
VALUES ('da570000-0000-4000-8000-000000000024','D6-PACK-BRANCH','da570000-0000-4000-8000-000000000011',
    'عينة تغليف للفرع','[]',510,0,'A1','Ready','final_ready',current_date,'Final','الفرع التجريبي')
ON CONFLICT (id) DO NOTHING;
SELECT public.record_order_final_delivery_v2(id,now(),gen_random_uuid())
FROM public.orders WHERE case_id IN ('D6-CHILD-FINAL','D6-SOLO-FINAL') AND first_delivered_at IS NULL;
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,production_status,
    delivery_date,delivery_type,workflow_type,designer_id,design_price)
VALUES
 ('da570000-0000-4000-8000-000000000025','D6-DESIGN-HTML','da570000-0000-4000-8000-000000000013',
  'تجربة رفع ملف تصميم فعلي','[]',500,0,'A1','designing',current_date+2,'Final','split','da570000-0000-4000-8000-000000000002',50),
 ('da570000-0000-4000-8000-000000000026','D6-DESIGN-SMOKE','da570000-0000-4000-8000-000000000013',
  'اختبار معاينة HTML','[]',500,0,'A1','designing',current_date+2,'Final','split','da570000-0000-4000-8000-000000000002',50)
ON CONFLICT (id) DO NOTHING;
UPDATE public.doctors SET requires_design_approval = true
WHERE id = 'da570000-0000-4000-8000-000000000011';
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,production_status,
    delivery_date,delivery_type,workflow_type,designer_id,design_price)
VALUES
 ('da570000-0000-4000-8000-000000000027','D6-PORTAL-APPROVAL','da570000-0000-4000-8000-000000000011',
  'تجربة موافقة الطبيب على التصميم','[]',500,0,'A1','designing',current_date+2,'Final','split','da570000-0000-4000-8000-000000000002',50),
 ('da570000-0000-4000-8000-000000000028','D6-PORTAL-REVIEW','da570000-0000-4000-8000-000000000011',
  'حالة جاهزة لمراجعة الطبيب','[]',500,0,'A1','designing',current_date+2,'Final','split','da570000-0000-4000-8000-000000000002',50),
 ('da570000-0000-4000-8000-000000000029','D6-DESIGN-PENDING','da570000-0000-4000-8000-000000000011',
  'اختبار الموافقة من ملفات الحالة','[]',500,0,'A1','designing',current_date+2,'Final','split','da570000-0000-4000-8000-000000000002',50)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,
    production_status,delivery_date,delivery_type,workflow_type)
VALUES
 ('da570000-0000-4000-8000-000000000041','D6-TRYIN-APPROVE','da570000-0000-4000-8000-000000000011',
  'اختبار اعتماد البروفة','[]',500,0,'A1','waiting_doctor',current_date+2,'TryIn','full'),
 ('da570000-0000-4000-8000-000000000042','D6-TRYIN-CHANGES','da570000-0000-4000-8000-000000000011',
  'اختبار تعديل البروفة','[]',500,0,'A1','waiting_doctor',current_date+2,'TryIn','full'),
 ('da570000-0000-4000-8000-000000000043','D6-TRYIN-REVIEW','da570000-0000-4000-8000-000000000011',
  'بروفة جاهزة للتجربة','[]',500,0,'A1','waiting_doctor',current_date+2,'TryIn','full')
ON CONFLICT (id) DO NOTHING;
COMMIT;
