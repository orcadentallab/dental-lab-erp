BEGIN;
SET search_path=public,extensions;
SELECT no_plan();

INSERT INTO auth.users(id,email) VALUES ('dc000000-0000-4000-8000-000000000001','doctor-area-admin@example.test');
INSERT INTO public.users(id,auth_id,username,role,name)
VALUES ('dc000000-0000-4000-8000-000000000001','dc000000-0000-4000-8000-000000000001','doctor-area-admin','admin','QA');
SELECT set_config('request.jwt.claim.sub','dc000000-0000-4000-8000-000000000001',true);

INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name,shipping_area,is_center)
VALUES
 ('dc000000-0000-4000-8000-000000000010','أكيابي تجريبي','01000000001','العاشر من رمضان','2003','QA','العاشر من رمضان',false),
 ('dc000000-0000-4000-8000-000000000011','مركز أكيابي تجريبي','01000000002','مستشفى الأكيابي مجاورة 10','2024','QA','العاشر من رمضان',true),
 ('dc000000-0000-4000-8000-000000000012','مركز أكواد تجريبي','01000000003','الشروق','','QA','الشروق',true),
 ('dc000000-0000-4000-8000-000000000013','طبيب أكواد تجريبي','01000000004','الشروق','','QA','الشروق',false);
SELECT matches((SELECT doctor_code FROM doctors WHERE id='dc000000-0000-4000-8000-000000000012'),
    '^2[0-9]{3}$','New center code uses the region');
SELECT is((SELECT doctor_code::integer FROM doctors WHERE id='dc000000-0000-4000-8000-000000000013'),
    (SELECT doctor_code::integer+1 FROM doctors WHERE id='dc000000-0000-4000-8000-000000000012'),'New codes are sequential');
INSERT INTO public.doctors(name,phone,address,doctor_code,representative_name,parent_id)
SELECT 'تابع بكود قديم','01000000009','الشروق',doctor_code||'-892','QA',id
FROM doctors WHERE id='dc000000-0000-4000-8000-000000000012';
INSERT INTO public.doctors(name,phone,address,doctor_code,representative_name,parent_id)
VALUES ('تابع تجريبي','01000000005','الشروق','','QA','dc000000-0000-4000-8000-000000000012');
SELECT is((SELECT doctor_code FROM doctors WHERE name='تابع تجريبي'),
    (SELECT doctor_code||'-01' FROM doctors WHERE id='dc000000-0000-4000-8000-000000000012'),'Old random suffix does not displace the sequential child code');
INSERT INTO public.doctors(name,phone,address,doctor_code,representative_name,parent_id)
VALUES ('تابع تجريبي ثاني','01000000010','الشروق','','QA','dc000000-0000-4000-8000-000000000012');
SELECT is((SELECT doctor_code FROM doctors WHERE name='تابع تجريبي ثاني'),
    (SELECT doctor_code||'-02' FROM doctors WHERE id='dc000000-0000-4000-8000-000000000012'),'Next child receives suffix 02');
SELECT throws_ok($$INSERT INTO public.doctors(name,phone,address,doctor_code,representative_name)
    VALUES ('بدون منطقة','01000000006','عنوان تجريبي','','QA')$$,'P0001','اختار منطقة لها نطاق كود معتمد','Missing scope does not allocate a code');

INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,delivery_date)
VALUES ('dc000000-0000-4000-8000-000000000020','QA-DOCTOR-MERGE-OLD','dc000000-0000-4000-8000-000000000011','QA','[]',750,0,'A1',current_date);
INSERT INTO public.transactions(id,type,amount,category,date,description,entity_type,entity_id,status,is_approved)
VALUES ('dc000000-0000-4000-8000-000000000021','income',250,'collection',current_date,'QA doctor receipt','doctor',
    'dc000000-0000-4000-8000-000000000011','approved',true);
CREATE TEMP TABLE merge_before AS
SELECT (SELECT to_jsonb(o) FROM orders o WHERE id='dc000000-0000-4000-8000-000000000020') AS original_order,
       (SELECT to_jsonb(t) FROM transactions t WHERE id='dc000000-0000-4000-8000-000000000021') AS original_receipt;

SELECT lives_ok($$SELECT public.merge_doctor_account('dc000000-0000-4000-8000-000000000011',
    'dc000000-0000-4000-8000-000000000010','مستشفى الأكيابي')$$,'Admin can link accounts');
SELECT lives_ok($$SELECT public.merge_doctor_account('dc000000-0000-4000-8000-000000000011',
    'dc000000-0000-4000-8000-000000000010','مستشفى الأكيابي')$$,'Repeating the merge is safe');
SELECT is((SELECT doctor_code FROM doctors WHERE id='dc000000-0000-4000-8000-000000000011'),'2024','Historical account code is unchanged');
SELECT is((SELECT to_jsonb(o) FROM orders o WHERE id='dc000000-0000-4000-8000-000000000020'),
    (SELECT original_order FROM merge_before),'Historical order belongs to the original doctor');
SELECT is((SELECT to_jsonb(t) FROM transactions t WHERE id='dc000000-0000-4000-8000-000000000021'),
    (SELECT original_receipt FROM merge_before),'Historical receipt belongs to the original doctor');
SELECT is((SELECT address FROM doctors WHERE id='dc000000-0000-4000-8000-000000000010'),
    'مستشفى الأكيابي مجاورة 10','Hospital is the main address of the retained account');
SELECT ok((SELECT NOT coalesce(has_branches,false) AND coalesce(jsonb_array_length(branches),0)=0
    FROM doctors WHERE id='dc000000-0000-4000-8000-000000000010'),'Merge does not create branches');
SELECT throws_ok($$INSERT INTO public.orders(case_id,doctor_id,patient_name,items,total_price,cost,shade,delivery_date)
    VALUES ('QA-DOCTOR-MERGE-NEW','dc000000-0000-4000-8000-000000000011','QA','[]',750,0,'A1',current_date)$$,
    'P0001','الحساب مدموج. اختار الحساب الحالي','New orders cannot use the old account');

INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name,custom_prices)
VALUES
 ('dc000000-0000-4000-8000-000000000014','مصدر بأسعار خاصة','01000000007','عنوان تجريبي','QA-PRICE-OLD','QA','{"fixture":100}'),
 ('dc000000-0000-4000-8000-000000000015','حساب بدون أسعار خاصة','01000000008','عنوان تجريبي','QA-PRICE-KEEP','QA','{}');
SELECT throws_ok($$SELECT public.merge_doctor_account('dc000000-0000-4000-8000-000000000014',
    'dc000000-0000-4000-8000-000000000015')$$,'P0001','راجع صلاحيات الدخول أو الأسعار الخاصة أو الفروع قبل الدمج',
    'Conflicting special pricing requires an explicit decision');
SELECT is((SELECT merged_into FROM doctors WHERE id='dc000000-0000-4000-8000-000000000014'),NULL::uuid,
    'Blocked merge does not change the account');
SELECT lives_ok($$SELECT public.merge_doctor_account('dc000000-0000-4000-8000-000000000014',
    'dc000000-0000-4000-8000-000000000015',NULL,true)$$,'Approved copy allows merge into a target without special prices');
SELECT is((SELECT custom_prices FROM doctors WHERE id='dc000000-0000-4000-8000-000000000015'),
    '{"fixture":100}'::jsonb,'Retained account receives special prices');
SELECT is((SELECT custom_prices FROM doctors WHERE id='dc000000-0000-4000-8000-000000000014'),
    '{"fixture":100}'::jsonb,'Original account retains its pricing data');

INSERT INTO public.released_doctor_codes(code,original_doctor_id)
VALUES ('2000','dc000000-0000-4000-8000-000000000010'),('2001','dc000000-0000-4000-8000-000000000010')
ON CONFLICT (code) DO UPDATE SET original_doctor_id=excluded.original_doctor_id;
WITH created AS (
    INSERT INTO public.doctors(name,phone,address,doctor_code,representative_name,shipping_area)
    VALUES ('اختبار أول النطاق','01000000011','الشروق','','QA','الشروق') RETURNING doctor_code
)
SELECT ok(doctor_code ~ '^2[0-9]{3}$' AND doctor_code <> '2000',
    'Released boundary 2000 is never allocated') FROM created;
SELECT * FROM finish();
ROLLBACK;
