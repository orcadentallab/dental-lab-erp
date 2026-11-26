BEGIN;
SET search_path=public,extensions;
SELECT plan(20);
DELETE FROM public.doctor_manual_access_requests WHERE phone IN ('201077211111','201077222222','201077233333');
CREATE TEMP TABLE manual_fixture AS SELECT public.submit_doctor_manual_access('01077211111',repeat('a',64),'existing','2003') AS result;
SELECT is((SELECT result->>'status' FROM manual_fixture),'pending','Existing doctors always wait for staff review');
SELECT is((public.open_doctor_manual_access((SELECT (result->>'request_id')::uuid FROM manual_fixture),repeat('a',64))->>'status'),'pending','Own pending status is available');
SELECT ok(NOT (public.open_doctor_manual_access((SELECT (result->>'request_id')::uuid FROM manual_fixture),repeat('b',64))->>'success')::boolean,'Another device cannot view status');
SELECT ok(NOT (public.open_doctor_manual_access((SELECT (result->>'request_id')::uuid FROM manual_fixture),NULL)->>'success')::boolean,'NULL secret rejected');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.doctor_manual_access_requests WHERE id=(SELECT (result->>'request_id')::uuid FROM manual_fixture) AND auth_id IS NOT NULL),'Pending request has no Auth identity');
SELECT throws_ok($q$ SELECT public.review_doctor_manual_access((SELECT (result->>'request_id')::uuid FROM manual_fixture),true,NULL) $q$,'P0001','غير مصرح بمراجعة التسجيل','Public callers cannot approve themselves');
SELECT ok(NOT has_table_privilege('anon','public.doctor_manual_access_requests','SELECT'),'Anonymous table read denied');
SELECT ok(NOT has_table_privilege('authenticated','public.doctor_manual_access_requests','SELECT'),'Authenticated direct table read denied');
SELECT throws_ok($q$ SELECT public.submit_doctor_manual_access('01077211111','short','new') $q$,'P0001','بيانات طلب التسجيل غير صالحة','Short capability rejected');
SELECT throws_ok($q$ SELECT public.submit_doctor_manual_access('01077211111',repeat('b',64),'new',NULL,'{"name":"Ahmed","address":"address","code_region":"cairo"}') $q$,'P0001','راجع الاسم العربي الثنائي والعنوان ومنطقة العيادة','Invalid new profile rejected');
INSERT INTO auth.users(id,instance_id,aud,role,email,created_at,updated_at)
VALUES('82000000-0000-0000-0000-000000000077','00000000-0000-0000-0000-000000000000','authenticated','authenticated','manual-review-qa@local.test',now(),now());
INSERT INTO public.users(id,auth_id,username,role,name,is_active)
VALUES('83000000-0000-0000-0000-000000000077','82000000-0000-0000-0000-000000000077','manual_review_qa','coordinator','مراجعة تجريبية',true);
SELECT set_config('request.jwt.claim.sub','82000000-0000-0000-0000-000000000077',true);
CREATE TEMP TABLE manual_new AS SELECT public.submit_doctor_manual_access('01077222222',repeat('c',64),'new',NULL,
 '{"name":"د. أحمد علي","address":"عنوان تجربة محلية","code_region":"cairo","is_center":true,"branches":[{"name":"التجمع","address":"عنوان فرع التجربة"}],"doctors":[{"name":"محمد حسن","phone":""}],"doctor_code":"9999","custom_prices":{"secret":1}}') AS result;
SELECT ok((public.review_doctor_manual_access((SELECT (result->>'request_id')::uuid FROM manual_new),true,NULL)->>'success')::boolean,'Staff approves a new center');
SELECT is((SELECT d.name FROM public.doctors d JOIN public.doctor_manual_access_requests r ON r.target_doctor_id=d.id WHERE r.id=(SELECT (result->>'request_id')::uuid FROM manual_new)),'أحمد علي','New center has normalized name');
SELECT ok((SELECT d.doctor_code ~ '^1[0-9]{3}$' AND d.custom_prices='{}'::jsonb FROM public.doctors d JOIN public.doctor_manual_access_requests r ON r.target_doctor_id=d.id WHERE r.id=(SELECT (result->>'request_id')::uuid FROM manual_new)),'Code and prices cannot be injected');
SELECT ok((public.open_doctor_manual_access((SELECT (result->>'request_id')::uuid FROM manual_new),repeat('c',64))->>'session_token') IS NOT NULL,'Approved device receives its own session credentials');
SELECT ok(EXISTS(SELECT 1 FROM public.users u JOIN public.doctor_manual_access_requests r ON r.auth_id=u.auth_id WHERE r.id=(SELECT (result->>'request_id')::uuid FROM manual_new) AND u.role='doctor' AND u.entity_id=r.target_doctor_id),'Provisioned account is scoped to the approved doctor');
CREATE TEMP TABLE manual_other_device AS SELECT public.submit_doctor_manual_access('01077222222',repeat('d',64),'existing') AS result;
SELECT ok((public.review_doctor_manual_access((SELECT (result->>'request_id')::uuid FROM manual_other_device),true,
    (SELECT target_doctor_id FROM public.doctor_manual_access_requests WHERE id=(SELECT (result->>'request_id')::uuid FROM manual_new)))->>'success')::boolean,'Another device requires its own staff approval');
UPDATE public.users SET is_active=false WHERE auth_id=(SELECT auth_id FROM public.doctor_manual_access_requests WHERE id=(SELECT (result->>'request_id')::uuid FROM manual_new));
SELECT ok(NOT (public.open_doctor_manual_access((SELECT (result->>'request_id')::uuid FROM manual_new),repeat('c',64))->>'success')::boolean,'Deactivated account cannot reopen through device capability');
SELECT ok(NOT (public.open_doctor_manual_access((SELECT (result->>'request_id')::uuid FROM manual_other_device),repeat('d',64))->>'success')::boolean,'Deactivation between approval and first login cannot be bypassed');
SELECT ok((public.review_doctor_manual_access((SELECT (result->>'request_id')::uuid FROM manual_fixture),false,NULL)->>'success')::boolean,'Staff rejects an existing account claim');
SELECT is(public.open_doctor_manual_access((SELECT (result->>'request_id')::uuid FROM manual_fixture),repeat('a',64))->>'status','rejected','Rejected request remains outside portal');
SELECT * FROM finish();
ROLLBACK;
