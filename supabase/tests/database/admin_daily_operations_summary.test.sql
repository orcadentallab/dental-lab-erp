BEGIN;
SET search_path = public, extensions;
SELECT plan(7);

INSERT INTO auth.users(id,email) VALUES
 ('da560000-0000-4000-8000-000000000001','daily-summary-admin@example.test'),
 ('da560000-0000-4000-8000-000000000002','daily-summary-coord@example.test');
INSERT INTO public.users(id,auth_id,username,role,name) VALUES
 ('da560000-0000-4000-8000-000000000001','da560000-0000-4000-8000-000000000001','daily_summary_admin','admin','Report admin'),
 ('da560000-0000-4000-8000-000000000002','da560000-0000-4000-8000-000000000002','daily_summary_coord','coordinator','Report coordinator');
INSERT INTO public.users(id,username,role,name,is_active) VALUES
 ('da560000-0000-4000-8000-000000000003','daily_summary_inactive','admin','Inactive admin',false);
INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name)
VALUES ('da560000-0000-4000-8000-000000000010','Report clinic','01000000000','QA address','SUMMARY-QA','QA');
SELECT set_config('request.jwt.claim.sub','da560000-0000-4000-8000-000000000001',true);
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,production_status,delivery_date,created_at)
VALUES
 ('da560000-0000-4000-8000-000000000011','SUMMARY-QA-01','da560000-0000-4000-8000-000000000010','Synthetic','[]',500,0,'A1','final_ready','2001-07-12',
  timestamp '2001-07-11 23:00' AT TIME ZONE 'Africa/Cairo'),
 ('da560000-0000-4000-8000-000000000012','SUMMARY-QA-02','da560000-0000-4000-8000-000000000010','Synthetic','[]',500,0,'A1','not_started','2001-07-12',
  timestamp '2001-07-12 23:00' AT TIME ZONE 'Africa/Cairo');
SELECT public.record_order_final_delivery_v2('da560000-0000-4000-8000-000000000011',
    timestamp '2001-07-12 21:00' AT TIME ZONE 'Africa/Cairo',gen_random_uuid());

INSERT INTO public.order_events(order_id,event_type,changed_by,actor_role,changed_at) VALUES
 ('da560000-0000-4000-8000-000000000011','stage_completed','da560000-0000-4000-8000-000000000002','coordinator',timestamp '2001-07-12 20:00' AT TIME ZONE 'Africa/Cairo'),
 ('da560000-0000-4000-8000-000000000011','stage_completed',NULL,'system',timestamp '2001-07-12 20:00' AT TIME ZONE 'Africa/Cairo'),
 ('da560000-0000-4000-8000-000000000011','stage_completed','da560000-0000-4000-8000-000000000002','coordinator',timestamp '2001-07-12 23:00' AT TIME ZONE 'Africa/Cairo');

SELECT public.send_admin_daily_operations_summary('2001-07-12');
SELECT public.send_admin_daily_operations_summary('2001-07-12');
SELECT is((SELECT summary FROM public.in_app_notifications
    WHERE recipient_id='da560000-0000-4000-8000-000000000001' AND event_type='daily_operations_summary'),
    '1 حالة جديدة · 1 تسليم نهائي · 1 حركة مسجّلة للموظفين',
    'The first cutoff is included, the next cutoff and automated entries are excluded');
SELECT is((SELECT count(*) FROM public.in_app_notifications
    WHERE recipient_id='da560000-0000-4000-8000-000000000001' AND event_type='daily_operations_summary'),
    1::bigint,'Repeated jobs send only one summary per admin and date');
SELECT is((SELECT count(*) FROM public.in_app_notifications
    WHERE recipient_id IN ('da560000-0000-4000-8000-000000000002','da560000-0000-4000-8000-000000000003')
      AND event_type='daily_operations_summary'),0::bigint,'Coordinators and inactive accounts get no digest');
SELECT ok(NOT has_function_privilege('authenticated','public.send_admin_daily_operations_summary(date)','EXECUTE'),'Staff cannot invoke the job');
SELECT ok(NOT has_function_privilege('anon','public.send_admin_daily_operations_summary(date)','EXECUTE'),'Anonymous callers cannot invoke the job');
SELECT ok(EXISTS(SELECT 1 FROM cron.job WHERE jobname='erp-admin-daily-operations-summary' AND active AND schedule='0 * * * *'
    AND command LIKE '%Africa/Cairo%'),'The active schedule checks Cairo time');
SELECT set_config('request.jwt.claim.sub','da560000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT action_url FROM public.get_in_app_notifications() WHERE event_type='daily_operations_summary'),
    '/dashboard','The administrator sees the digest in the bell with a dashboard link');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
