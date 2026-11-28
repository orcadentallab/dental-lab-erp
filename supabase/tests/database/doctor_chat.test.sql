BEGIN;
SET search_path = public, extensions;
SELECT no_plan();

INSERT INTO auth.users(id, email)
SELECT ('da670000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, 'chat-check-' || n || '@example.test'
FROM generate_series(1, 7) n;
INSERT INTO public.doctors(id, name, phone, address, doctor_code, representative_name) VALUES
 ('da670000-0000-4000-8000-000000000004','Chat QA doctor','01050000674','QA','CHAT-QA-01','QA'),
 ('da670000-0000-4000-8000-000000000005','Chat QA sibling','01050000675','QA','CHAT-QA-02','QA');

INSERT INTO public.users(id, auth_id, username, role, name, entity_id, custom_permissions)
SELECT id, id, split_part(email, '@', 1),
    CASE right(id::text, 1) WHEN '1' THEN 'admin' WHEN '2' THEN 'designer'
        WHEN '3' THEN 'coordinator' WHEN '6' THEN 'representative' WHEN '7' THEN 'designer' ELSE 'doctor' END,
    split_part(email, '@', 1), CASE WHEN right(id::text, 1) IN ('4', '5') THEN id END,
    CASE WHEN right(id::text, 1) = '6' THEN '{"secondary_designer":true}'::jsonb ELSE '{}'::jsonb END
FROM auth.users WHERE id::text LIKE 'da670000-0000-4000-8000-%';

SELECT set_config('request.jwt.claim.sub','da670000-0000-4000-8000-000000000001',true);
UPDATE public.doctors SET requires_design_approval = true WHERE doctor_code = 'CHAT-QA-01';
SELECT public.set_design_qc_enabled(false, 'Chat test');

INSERT INTO public.orders(id, case_id, doctor_id, patient_name, items, total_price, cost, shade,
    production_status, delivery_date, delivery_type, workflow_type, designer_id, design_price)
VALUES
 ('da670000-0000-4000-8000-000000000021','CHAT-DESIGN','da670000-0000-4000-8000-000000000004',
  'QA design','[]',500,0,'A1','designing',current_date+2,'Final','split','da670000-0000-4000-8000-000000000002',50),
 ('da670000-0000-4000-8000-000000000022','CHAT-TRYIN','da670000-0000-4000-8000-000000000004',
  'QA trial','[]',500,0,'A1','waiting_doctor',current_date+2,'TryIn','full','da670000-0000-4000-8000-000000000006',0),
 ('da670000-0000-4000-8000-000000000023','CHAT-UNASSIGNED','da670000-0000-4000-8000-000000000004',
  'QA unassigned','[]',500,0,'A1','waiting_doctor',current_date+2,'TryIn','full',NULL,0);

CREATE TEMP TABLE doctor_chat_fixture(key text PRIMARY KEY, id uuid NOT NULL);
GRANT ALL ON doctor_chat_fixture TO authenticated;
CREATE TEMP VIEW chat_test_notifications AS
    SELECT n.*, m.context, m.body
    FROM public.in_app_notifications n JOIN public.doctor_support_posts m
      ON n.dedup_key = concat_ws(':', n.event_type, n.recipient_id, m.thread_id, m.id)
    WHERE n.event_type = 'doctor_chat_message';

SELECT set_config('request.jwt.claim.sub','da670000-0000-4000-8000-000000000002',true);
SELECT public.submit_design_delivery('da670000-0000-4000-8000-000000000021','da670000-0000-4000-8000-000000000031',
    'link','https://example.test/chat-design','Test fixture note');

INSERT INTO public.push_subscriptions(user_id, endpoint, p256dh, auth, preferred_language)
VALUES ('da670000-0000-4000-8000-000000000004','https://push.example.test/chat-test','qa-p256dh','qa-auth','ar');
SELECT set_config('app.settings.push_edge_url', 'http://127.0.0.1:56601/functions/v1/doctor-chat-test', true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','da670000-0000-4000-8000-000000000004',true);
INSERT INTO storage.objects(bucket_id, name, metadata)
VALUES ('doctor-chat-files','da670000-0000-4000-8000-000000000004/chat-test.pdf','{"mimetype":"application/pdf","size":64}');
INSERT INTO doctor_chat_fixture VALUES
    ('general', public.write_doctor_chat('start', p_body => 'QA General question')),
    ('case', public.write_doctor_chat('start', p_order => 'da670000-0000-4000-8000-000000000021', p_body => 'QA Case question',
        p_attachment => 'da670000-0000-4000-8000-000000000004/chat-test.pdf', p_attachment_name => 'chat-test.pdf'));
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id = 'doctor-chat-files'
    AND name = 'da670000-0000-4000-8000-000000000004/chat-test.pdf'), 1::bigint, 'Doctor can read their linked chat attachment');
SELECT is(public.get_doctor_chat(p_order => 'da670000-0000-4000-8000-000000000021')->0->>'case_id',
    'CHAT-DESIGN', 'A case thread round-trips to the treating doctor');
SELECT public.decide_doctor_design_review('da670000-0000-4000-8000-000000000031','changes','QA Design response');
SELECT public.respond_to_doctor_try_in('da670000-0000-4000-8000-000000000022',
    (SELECT order_version FROM public.get_my_doctor_try_in_requests() WHERE order_id='da670000-0000-4000-8000-000000000022'),
    'changes','QA Try-in response');
SELECT public.respond_to_doctor_try_in('da670000-0000-4000-8000-000000000023',
    (SELECT order_version FROM public.get_my_doctor_try_in_requests() WHERE order_id='da670000-0000-4000-8000-000000000023'),
    'approve','QA Unassigned response');

RESET ROLE;
SELECT is((SELECT array_agg(recipient_role ORDER BY recipient_role) FROM chat_test_notifications
    WHERE body = 'QA General question' AND recipient_id::text LIKE 'da670000-%'), ARRAY['admin','coordinator'],
    'General doctor message notifies the operations roles only');
SELECT is((SELECT array_agg(recipient_role ORDER BY recipient_role) FROM chat_test_notifications
    WHERE context = 'design' AND body LIKE '%QA Design response' AND recipient_id::text LIKE 'da670000-%'),
    ARRAY['admin','coordinator','designer'], 'Design decision also notifies the assigned designer');
SELECT is((SELECT array_agg(recipient_role ORDER BY recipient_role) FROM chat_test_notifications
    WHERE context = 'try_in' AND body LIKE '%QA Try-in response' AND recipient_id::text LIKE 'da670000-%'),
    ARRAY['admin','coordinator','representative'], 'Try-in decision also notifies the assigned secondary designer');
SELECT is((SELECT array_agg(recipient_role ORDER BY recipient_role) FROM chat_test_notifications
    WHERE body LIKE '%QA Unassigned response' AND recipient_id::text LIKE 'da670000-%'),
    ARRAY['admin','coordinator'], 'Unassigned cases fall back to the operations roles');
SELECT is((SELECT designer_missing FROM public.doctor_support_posts WHERE body LIKE '%QA Unassigned response'), true,
    'Unavailable designer is recorded with the incoming message');

SELECT set_config('request.jwt.claim.sub','da670000-0000-4000-8000-000000000001',true);
INSERT INTO public.order_comments(order_id, user_id, user_name, content)
VALUES ('da670000-0000-4000-8000-000000000021','da670000-0000-4000-8000-000000000001','QA admin','QA private note');
SELECT is((SELECT count(*) FROM chat_test_notifications WHERE body = 'QA private note'),0::bigint,
    'Internal notes create no doctor chat notifications');

SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.order_comments WHERE order_id='da670000-0000-4000-8000-000000000021'
    AND content = 'QA private note'), 1::bigint, 'Staff can read the original internal note');
SELECT set_config('request.jwt.claim.sub','da670000-0000-4000-8000-000000000004',true);
SELECT is((SELECT count(*) FROM public.order_comments WHERE order_id='da670000-0000-4000-8000-000000000021'),
    0::bigint, 'Doctor cannot read internal notes for their own case');
SELECT is((SELECT count(*) FROM public.get_in_app_notifications()), 0::bigint, 'Doctor cannot read staff notifications');
SELECT throws_ok($$ SELECT public.get_doctor_chat_log(current_date) $$, '42501', 'Admin required',
    'Doctor cannot read the end-of-day log');
SELECT set_config('request.jwt.claim.sub','da670000-0000-4000-8000-000000000005',true);
SELECT is(public.get_doctor_chat(p_thread => (SELECT id FROM doctor_chat_fixture WHERE key = 'case')), '[]'::jsonb,
    'Another doctor cannot read the case thread by id');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id = 'doctor-chat-files'
    AND name = 'da670000-0000-4000-8000-000000000004/chat-test.pdf'), 0::bigint, 'Another doctor cannot download the linked attachment');
SELECT throws_ok($$ SELECT public.write_doctor_chat('reply',
    p_thread => (SELECT id FROM doctor_chat_fixture WHERE key = 'case'), p_body => 'Other account') $$,
    '42501','Support access denied','Another doctor cannot write to the case thread');

SELECT set_config('request.jwt.claim.sub','da670000-0000-4000-8000-000000000007',true);
SELECT is(public.get_doctor_chat(p_thread => (SELECT id FROM doctor_chat_fixture WHERE key = 'case')), '[]'::jsonb,
    'Unassigned designer cannot view a case thread');
SELECT set_config('request.jwt.claim.sub','da670000-0000-4000-8000-000000000002',true);
SELECT is(public.get_doctor_chat(p_thread => (SELECT id FROM doctor_chat_fixture WHERE key = 'case'))->0->>'case_id',
    'CHAT-DESIGN', 'Assigned designer can follow the thread link');
SELECT is(public.get_doctor_chat(), '[]'::jsonb, 'Designer has no global inbox access');
SELECT lives_ok($$ SELECT public.write_doctor_chat('reply',
    p_thread => (SELECT id FROM doctor_chat_fixture WHERE key = 'case'), p_body => 'QA Lab reply') $$,
    'Assigned designer can reply to their case');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id = 'doctor-chat-files'
    AND name = 'da670000-0000-4000-8000-000000000004/chat-test.pdf'), 1::bigint, 'Assigned designer can read the same attachment');

SELECT set_config('request.jwt.claim.sub','da670000-0000-4000-8000-000000000003',true);
SELECT throws_ok($$ SELECT public.get_doctor_chat_log(current_date) $$, '42501', 'Admin required',
    'Coordinator cannot read the admin log');
SELECT throws_ok($$ SELECT public.review_doctor_chat_log(current_date) $$, '42501', 'Admin required',
    'Coordinator cannot mark the admin log');
SELECT ok(EXISTS (SELECT 1 FROM public.get_in_app_notifications()
    WHERE entity_id = (SELECT id FROM doctor_chat_fixture WHERE key = 'case') AND NOT is_read
      AND action_url = '/directory/doctor-chat?thread=' || entity_id),
    'Coordinator opens the exact unread conversation from the bell');
SELECT public.mark_doctor_chat_read((SELECT id FROM doctor_chat_fixture WHERE key = 'case'),
    (public.get_doctor_chat(p_thread => (SELECT id FROM doctor_chat_fixture WHERE key = 'case'))->0->'posts'->-1->>'id')::uuid);
SELECT ok(NOT EXISTS (SELECT 1 FROM public.get_in_app_notifications()
    WHERE entity_id = (SELECT id FROM doctor_chat_fixture WHERE key = 'case') AND NOT is_read),
    'Opening the thread marks its notifications read');
SELECT is(public.get_doctor_chat(p_thread => (SELECT id FROM doctor_chat_fixture WHERE key = 'case'))->0->>'unread','0',
    'Thread unread count clears for the reader');
SELECT ok((SELECT unread FROM public.get_case_doctor_chat_unread(ARRAY['da670000-0000-4000-8000-000000000022'::uuid])) > 0,
    'Case badges count incoming messages on other unread cases');

SELECT set_config('request.jwt.claim.sub','da670000-0000-4000-8000-000000000001',true);
SELECT ok(EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_doctor_chat_log((now() AT TIME ZONE 'Africa/Cairo')::date, 'design')) item
    WHERE item->>'case_id' = 'CHAT-DESIGN' AND item->>'first_reply_at' IS NOT NULL),
    'End-of-day log shows first lab reply for the design decision');
SELECT ok(EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_doctor_chat_log((now() AT TIME ZONE 'Africa/Cairo')::date, 'try_in')) item
    WHERE item->>'case_id' = 'CHAT-UNASSIGNED' AND item->>'first_reply_at' IS NULL),
    'Unanswered trial stays pending in the daily log');
INSERT INTO doctor_chat_fixture SELECT 'review', (item->>'id')::uuid
    FROM jsonb_array_elements(public.get_doctor_chat_log((now() AT TIME ZONE 'Africa/Cairo')::date, 'design')) item
    WHERE item->>'case_id' = 'CHAT-DESIGN';
SELECT is(public.review_doctor_chat_log((now() AT TIME ZONE 'Africa/Cairo')::date,
    (SELECT id FROM doctor_chat_fixture WHERE key = 'review')), 1, 'Admin can mark one message reviewed');
SELECT ok(EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_doctor_chat_log((now() AT TIME ZONE 'Africa/Cairo')::date, 'design')) item
    WHERE item->>'case_id' = 'CHAT-DESIGN' AND item->>'reviewed_by'='chat-check-1' AND item->>'reviewed_at' IS NOT NULL),
    'Review stores the actual user and timestamp');
SELECT ok(public.review_doctor_chat_log((now() AT TIME ZONE 'Africa/Cairo')::date) >= 4, 'Admin can mark the whole day');
SELECT is(public.review_doctor_chat_log((now() AT TIME ZONE 'Africa/Cairo')::date), 0, 'Repeated review preserves the first reviewer and time');

RESET ROLE;
SELECT ok(EXISTS (
    SELECT 1 FROM net.http_request_queue
    WHERE url = 'http://127.0.0.1:56601/functions/v1/doctor-chat-test'
      AND (convert_from(body, 'utf8')::jsonb)->>'event_type' = 'support_reply'
      AND (convert_from(body, 'utf8')::jsonb)->>'case_id' = 'CHAT-DESIGN'
), 'The case-linked lab reply passes case information to the Web Push dispatcher');
SELECT * FROM finish();
ROLLBACK;
