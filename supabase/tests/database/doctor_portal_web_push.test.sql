-- Doctor Portal Web Push: push_subscriptions RLS and notification trigger tests.
BEGIN;
SET search_path TO public, extensions;
SELECT plan(17);

-- Fixtures: two doctors + auth.users + public.users
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
    ('93000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'push-doc-a@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('93000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'push-doc-b@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name) VALUES
    ('13000000-0000-0000-0000-00000000000a', 'Push Doctor A', '01000000101', 'Test', 'PUSH-A', 'Rep'),
    ('13000000-0000-0000-0000-00000000000b', 'Push Doctor B', '01000000102', 'Test', 'PUSH-B', 'Rep');

INSERT INTO public.users (id, auth_id, username, role, name, entity_id, is_active) VALUES
    ('33000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', 'push_doc_a', 'doctor', 'Push Doctor A', '13000000-0000-0000-0000-00000000000a', true),
    ('33000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000002', 'push_doc_b', 'doctor', 'Push Doctor B', '13000000-0000-0000-0000-00000000000b', true);

-- 1. Doctor A inserts and reads own push subscription
SELECT set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, preferred_language)
VALUES ('93000000-0000-0000-0000-000000000001', 'https://push.example.test/sub-a', 'p256dh-a', 'auth-a', 'en');

SELECT is((SELECT count(*)::int FROM public.push_subscriptions), 1, 'doctor A sees own push subscription');

-- 2. Doctor B cannot see, spoof, update, or delete Doctor A's subscription
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000002', TRUE);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*)::int FROM public.push_subscriptions), 0, 'doctor B cannot see doctor A push subscriptions');

SELECT throws_ok(
    $$INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
      VALUES ('93000000-0000-0000-0000-000000000001', 'https://push.example.test/spoof', 'p', 'a')$$,
    '42501',
    NULL,
    'doctor B cannot insert a subscription for doctor A'
);

DELETE FROM public.push_subscriptions WHERE endpoint = 'https://push.example.test/sub-a';
UPDATE public.push_subscriptions SET preferred_language = 'ar' WHERE endpoint = 'https://push.example.test/sub-a';

RESET ROLE;
SELECT is((SELECT preferred_language FROM public.push_subscriptions WHERE endpoint = 'https://push.example.test/sub-a'), 'en', 'doctor B delete/update did not affect doctor A row');

-- 3. Doctor A can update and delete own subscription
SELECT set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

UPDATE public.push_subscriptions SET last_seen_at = now() WHERE endpoint = 'https://push.example.test/sub-a';
SELECT is((SELECT count(*)::int FROM public.push_subscriptions WHERE endpoint = 'https://push.example.test/sub-a'), 1, 'doctor A can update own subscription');

DELETE FROM public.push_subscriptions WHERE endpoint = 'https://push.example.test/sub-a';
SELECT is((SELECT count(*)::int FROM public.push_subscriptions), 0, 'doctor A can delete own subscription');

-- 4. Doctor-level stage mapping helper
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', TRUE);
SELECT is(public._doctor_portal_stage('not_started'), 'received', 'not_started maps to received');
SELECT is(public._doctor_portal_stage('designing'), 'design', 'designing maps to design');
SELECT is(public._doctor_portal_stage('in_production'), 'production', 'in_production maps to production');
SELECT is(public._doctor_portal_stage('try_in_ready'), 'production', 'try_in_ready maps to production');
SELECT is(public._doctor_portal_stage('finalization'), 'production', 'finalization maps to production');
SELECT is(public._doctor_portal_stage('final_ready'), 'ready', 'final_ready maps to ready');
SELECT is(public._doctor_portal_stage('final_delivered'), 'delivered', 'final_delivered maps to delivered');

-- 5. Triggers enqueue pg_net HTTP requests on stage changes and support replies
INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, preferred_language)
VALUES ('93000000-0000-0000-0000-000000000001', 'https://push.example.test/sub-a-2', 'p256dh-a2', 'auth-a2', 'ar');

SELECT set_config('app.settings.push_edge_url', 'http://127.0.0.1:56501/functions/v1/send-push', TRUE);

INSERT INTO public.orders (id, case_id, doctor_id, patient_name, items, total_price, shade, status, delivery_date, cost, production_status, issue_state)
VALUES ('43000000-0000-0000-0000-000000000001', 'PUSH-CASE-1', '13000000-0000-0000-0000-00000000000a', 'Push Patient', '[]', 100, 'A1', 'New Case', CURRENT_DATE, 0, 'not_started', 'none');

SELECT is(
    (SELECT count(*)::int FROM net.http_request_queue WHERE url = 'http://127.0.0.1:56501/functions/v1/send-push'),
    1,
    'inserting a case enqueues a received push notification'
);

UPDATE public.orders SET production_status = 'designing' WHERE id = '43000000-0000-0000-0000-000000000001';
UPDATE public.orders SET production_status = 'in_production' WHERE id = '43000000-0000-0000-0000-000000000001';
-- Same doctor-level stage ('production') should NOT enqueue a duplicate push
UPDATE public.orders SET production_status = 'finalization' WHERE id = '43000000-0000-0000-0000-000000000001';
UPDATE public.orders SET production_status = 'final_ready' WHERE id = '43000000-0000-0000-0000-000000000001';
UPDATE public.orders SET production_status = 'final_delivered' WHERE id = '43000000-0000-0000-0000-000000000001';

SELECT is(
    (SELECT count(*)::int FROM net.http_request_queue WHERE url = 'http://127.0.0.1:56501/functions/v1/send-push'),
    5,
    'all 5 doctor-level stage transitions enqueue once per doctor-level stage'
);

INSERT INTO public.doctor_portal_messages (id, doctor_id, order_id, body)
VALUES ('63000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-00000000000a', '43000000-0000-0000-0000-000000000001', 'Any update on shade?');

UPDATE public.doctor_portal_messages
SET reply = 'Shade confirmed and ready.', replied_at = now()
WHERE id = '63000000-0000-0000-0000-000000000001';

SELECT is(
    (SELECT count(*)::int FROM net.http_request_queue WHERE url = 'http://127.0.0.1:56501/functions/v1/send-push'),
    6,
    'support reply trigger enqueues a push notification'
);

SELECT is(
    (SELECT (convert_from(body, 'utf8')::jsonb)->>'event_type' FROM net.http_request_queue WHERE url = 'http://127.0.0.1:56501/functions/v1/send-push' ORDER BY id DESC LIMIT 1),
    'support_reply',
    'latest enqueued push event_type is support_reply'
);

SELECT * FROM finish();
ROLLBACK;
