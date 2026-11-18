BEGIN;
SET search_path = public, extensions;
SELECT plan(14);

INSERT INTO auth.users(id,email) VALUES
    ('da520000-0000-4000-8000-000000000001','notify-admin@example.test'),
    ('da520000-0000-4000-8000-000000000002','notify-designer@example.test'),
    ('da520000-0000-4000-8000-000000000003','notify-replacement@example.test');
INSERT INTO public.users(id,auth_id,username,role,name) VALUES
    ('da520000-0000-4000-8000-000000000001','da520000-0000-4000-8000-000000000001','notify_test_admin','admin','QA admin'),
    ('da520000-0000-4000-8000-000000000002','da520000-0000-4000-8000-000000000002','notify_test_designer','designer','QA designer'),
    ('da520000-0000-4000-8000-000000000003','da520000-0000-4000-8000-000000000003','notify_test_replacement','designer','QA replacement');
INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name) VALUES
    ('da520000-0000-4000-8000-000000000010','QA clinic','01000000000','QA address','NOTIFY-TEST','QA');

SELECT set_config('request.jwt.claim.sub','da520000-0000-4000-8000-000000000001',true);
SELECT public.set_design_qc_enabled(true,'Isolated notification test');
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,production_status,delivery_date,workflow_type,designer_id)
VALUES ('da520000-0000-4000-8000-000000000011','NOTIFY-PGTAP','da520000-0000-4000-8000-000000000010','Synthetic','[]',900,300,'A1',
    'designing',current_date,'split','da520000-0000-4000-8000-000000000002');

SELECT set_config('request.jwt.claim.sub','da520000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT action_url FROM public.get_in_app_notifications() WHERE event_type='designer_assigned'),
    '/dashboard?order=da520000-0000-4000-8000-000000000011','Assignment yields a case-specific notification');
SELECT is(public.get_unread_notification_count(),1,'Unread count includes only visible rows');
SELECT ok((SELECT metadata='{}'::jsonb FROM public.get_in_app_notifications()),'No cost or supplier metadata is exposed');
SELECT ok(NOT has_table_privilege('authenticated','public.in_app_notifications','UPDATE'),'No direct notification updates');
SELECT ok(NOT has_function_privilege('authenticated','public.emit_workflow_notification(text,uuid,text,text,uuid,text,text,text,text)','EXECUTE'),
    'Emit helper is private');
SELECT ok(NOT has_function_privilege('anon','public.get_in_app_notifications(integer,boolean)','EXECUTE'),'Anonymous notification API is denied');
SELECT ok(public.mark_notification_read((SELECT id FROM public.get_in_app_notifications())),'A recipient can mark their own alert read');
SELECT is(public.get_unread_notification_count(),0,'The read state is reflected by the API');

SELECT public.submit_design_delivery('da520000-0000-4000-8000-000000000011','da520000-0000-4000-8000-000000000021',
    'link','https://example.test/notify-design','No preview in QA fixture');
SELECT is((SELECT count(*) FROM public.get_in_app_notifications() WHERE event_type='pending_design_qc'),0::bigint,
    'A designer does not see the administrator review alert');
RESET ROLE;
SELECT set_config('tests.notification_id',(SELECT id::text FROM public.in_app_notifications
    WHERE recipient_id='da520000-0000-4000-8000-000000000002'),true);

SELECT set_config('request.jwt.claim.sub','da520000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT action_url FROM public.get_in_app_notifications() WHERE event_type='pending_design_qc'),
    '/design-qc?order=da520000-0000-4000-8000-000000000011','A real submission routes to the administrator review');
SELECT ok(NOT public.mark_notification_read(current_setting('tests.notification_id')::uuid),'An admin does not mark another inbox read');
SELECT public.resolve_design_qc_review('da520000-0000-4000-8000-000000000021',gen_random_uuid(),'changes','Technical correction','current',NULL,NULL,NULL);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','da520000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.get_in_app_notifications() WHERE event_type='design_returned_notes'),1::bigint,'Returning a design emits exactly one alert');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','da520000-0000-4000-8000-000000000001',true);
UPDATE public.orders SET designer_id='da520000-0000-4000-8000-000000000003' WHERE case_id='NOTIFY-PGTAP';
SELECT set_config('request.jwt.claim.sub','da520000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.get_in_app_notifications()),0::bigint,'Former designer loses access to old alerts after reassignment');
SELECT ok(NOT public.mark_notification_read(current_setting('tests.notification_id')::uuid),'Former designer cannot update the hidden alert');

SELECT * FROM finish();
ROLLBACK;
