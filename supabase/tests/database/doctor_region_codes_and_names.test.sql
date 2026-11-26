BEGIN;
SET search_path=public,extensions;
SELECT plan(14);
DELETE FROM public.doctor_code_counters;
CREATE TEMP TABLE expected_region_codes AS
SELECT prefix,greatest(floor_number,coalesce((SELECT max(CASE WHEN doctor_code ~ '^[12356][0-9]{3}$' AND left(doctor_code,1)=prefix::text THEN doctor_code::integer END) FROM public.doctors),floor_number))+1 AS next_code
FROM (VALUES (1,1061),(2,2030),(3,3000),(5,5000),(6,6000)) ranges(prefix,floor_number);
SELECT is(public.normalize_doctor_name('دكتور د. أحمد علي'),'أحمد علي','Titles removed on the server');
SELECT is(public._allocate_doctor_region_code('cairo'),(SELECT next_code::text FROM expected_region_codes WHERE prefix=1),'Cairo continues beyond baseline and existing codes');
SELECT is(public._allocate_doctor_region_code('cairo'),(SELECT (next_code+1)::text FROM expected_region_codes WHERE prefix=1),'Successive allocations are sequential');
SELECT is(public._allocate_doctor_region_code('east_cairo'),(SELECT next_code::text FROM expected_region_codes WHERE prefix=2),'East Cairo continues beyond baseline and existing codes');
SELECT is(public._allocate_doctor_region_code('west_giza'),(SELECT next_code::text FROM expected_region_codes WHERE prefix=3),'October and Zayed use 3xxx');
SELECT is(public._allocate_doctor_region_code('damietta'),(SELECT next_code::text FROM expected_region_codes WHERE prefix=5),'Damietta uses 5xxx');
SELECT is(public._allocate_doctor_region_code('other'),(SELECT next_code::text FROM expected_region_codes WHERE prefix=6),'Other areas use 6xxx');
SELECT throws_ok($q$ SELECT public._allocate_doctor_region_code('unknown') $q$,'P0001','يرجى اختيار منطقة العيادة','Unknown region cannot allocate a code');
SELECT throws_ok($q$ SELECT public._insert_doctor_profile('{"name":"أحمد","phone":"01077200111","address":"عنوان الاختبار","code_region":"cairo"}') $q$,'P0001','اسم الطبيب يجب أن يكون عربيًا وثنائيًا على الأقل','Single-part name rejected');
SELECT throws_ok($q$ SELECT public._insert_doctor_profile('{"name":"Ahmed Ali","phone":"01077200111","address":"عنوان الاختبار","code_region":"cairo"}') $q$,'P0001','اسم الطبيب يجب أن يكون عربيًا وثنائيًا على الأقل','Latin name rejected');
CREATE TEMP TABLE identity_center AS SELECT d.* FROM public._insert_doctor_profile('{"name":"د. أحمد علي","phone":"01077200111","address":"عنوان الاختبار الرئيسي","code_region":"cairo","is_center":true}') AS d;
SELECT is((SELECT name FROM identity_center),'أحمد علي','Only the clean Arabic name is saved');
CREATE TEMP TABLE identity_children AS SELECT d.* FROM public._insert_doctor_profile(jsonb_build_object('name','محمد علي','phone','','address','عنوان الاختبار الرئيسي','parent_id',(SELECT id FROM identity_center))) AS d;
INSERT INTO identity_children SELECT d.* FROM public._insert_doctor_profile(jsonb_build_object('name','محمود حسن','phone','','address','عنوان الاختبار الرئيسي','parent_id',(SELECT id FROM identity_center))) AS d;
SELECT is((SELECT min(doctor_code) FROM identity_children),(SELECT doctor_code||'-001' FROM identity_center),'First center child gets suffix 001');
SELECT is((SELECT max(doctor_code) FROM identity_children),(SELECT doctor_code||'-002' FROM identity_center),'Second center child gets suffix 002');
SELECT throws_ok($q$ SELECT public.create_doctor_with_region_code('{"name":"محمد علي","phone":"01077200222","address":"عنوان الاختبار","code_region":"cairo"}') $q$,'P0001','غير مصرح بإضافة طبيب','Missing staff role cannot create accounts');
SELECT * FROM finish();
ROLLBACK;
