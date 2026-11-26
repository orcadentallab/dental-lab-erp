-- Admin Announcements (Promotional Push) pgTAP tests:
--   (a) Promotional preview skips promotional_enabled = false while case_update still delivers
--   (b) Non-admin cannot read/insert announcement_sends or call get_promotional_push_preview
--   (c) push_subscriptions RLS remains strictly own-row-only for doctors
BEGIN;
SET search_path TO public, extensions;
SELECT plan(12);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
    ('94000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'promo-admin@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('94000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'promo-coord@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('94000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'promo-doc-a@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('94000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'promo-doc-b@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name) VALUES
    ('14000000-0000-0000-0000-00000000000a', 'Promo Doctor A', '01000000201', 'Test', 'PROMO-A', 'Rep'),
    ('14000000-0000-0000-0000-00000000000b', 'Promo Doctor B', '01000000202', 'Test', 'PROMO-B', 'Rep');

INSERT INTO public.users (id, auth_id, username, role, name, entity_id, is_active) VALUES
    ('34000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001', 'promo_admin', 'admin', 'Promo Admin', NULL, true),
    ('34000000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000002', 'promo_coord', 'coordinator', 'Promo Coord', NULL, true),
    ('34000000-0000-0000-0000-000000000003', '94000000-0000-0000-0000-000000000003', 'promo_doc_a', 'doctor', 'Promo Doctor A', '14000000-0000-0000-0000-00000000000a', true),
    ('34000000-0000-0000-0000-000000000004', '94000000-0000-0000-0000-000000000004', 'promo_doc_b', 'doctor', 'Promo Doctor B', '14000000-0000-0000-0000-00000000000b', true);

-- Doctor A subscribes and opts OUT of promotional messages
SELECT set_config('request.jwt.claim.sub', '94000000-0000-0000-0000-000000000003', TRUE);
SET LOCAL ROLE authenticated;

INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, preferred_language)
VALUES ('94000000-0000-0000-0000-000000000003', 'https://push.example.test/promo-a', 'p-a', 'a-a', 'en');

UPDATE public.push_subscriptions SET promotional_enabled = false WHERE user_id = '94000000-0000-0000-0000-000000000003';
SELECT is((SELECT promotional_enabled FROM public.push_subscriptions WHERE endpoint = 'https://push.example.test/promo-a'), false, 'doctor A can opt out of promotional messages');

-- Doctor B subscribes with default promotional_enabled = true and cannot see Doctor A's row
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '94000000-0000-0000-0000-000000000004', TRUE);
SET LOCAL ROLE authenticated;

INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, preferred_language)
VALUES ('94000000-0000-0000-0000-000000000004', 'https://push.example.test/promo-b', 'p-b', 'a-b', 'ar');

SELECT is((SELECT count(*)::int FROM public.push_subscriptions), 1, 'doctor B still sees only own push_subscriptions row');

-- Doctor cannot insert or read announcement_sends, or call preview RPC
SELECT throws_ok(
    $$INSERT INTO public.announcement_sends (sent_by, title_en, title_ar, body_en, body_ar, audience_kind, audience_summary)
      VALUES ('94000000-0000-0000-0000-000000000004', 'T', 'ع', 'B', 'ن', 'all', 'all')$$,
    '42501',
    NULL,
    'doctor cannot insert into announcement_sends'
);
SELECT throws_ok(
    $$SELECT public.get_promotional_push_preview('all', NULL)$$,
    'غير مصرح',
    'doctor cannot call get_promotional_push_preview'
);

-- Non-admin staff (coordinator) cannot insert into announcement_sends or call preview RPC
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '94000000-0000-0000-0000-000000000002', TRUE);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
    $$INSERT INTO public.announcement_sends (sent_by, title_en, title_ar, body_en, body_ar, audience_kind, audience_summary)
      VALUES ('94000000-0000-0000-0000-000000000002', 'T', 'ع', 'B', 'ن', 'all', 'all')$$,
    '42501',
    NULL,
    'non-admin staff cannot insert into announcement_sends'
);
SELECT throws_ok(
    $$SELECT public.get_promotional_push_preview('all', NULL)$$,
    'غير مصرح',
    'non-admin staff cannot call get_promotional_push_preview'
);

-- Admin previews 'selection' of Doctor A + Doctor B: Doctor A (opted out) is skipped, only Doctor B counts!
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '94000000-0000-0000-0000-000000000001', TRUE);
SET LOCAL ROLE authenticated;

SELECT is(
    (public.get_promotional_push_preview('selection', ARRAY['14000000-0000-0000-0000-00000000000a'::uuid, '14000000-0000-0000-0000-00000000000b'::uuid])->>'recipient_count')::int,
    1,
    'promotional preview skips opted-out doctor A and counts only doctor B'
);
SELECT is(
    (public.get_promotional_push_preview('single', ARRAY['14000000-0000-0000-0000-00000000000a'::uuid])->>'recipient_count')::int,
    0,
    'promotional preview returns 0 when selected doctor opted out'
);

-- Admin can insert into announcement_sends and preview detects recent 'all' send within 24h
INSERT INTO public.announcement_sends (sent_by, title_en, title_ar, body_en, body_ar, audience_kind, audience_summary, recipient_count, delivered_count, failed_count)
VALUES ('94000000-0000-0000-0000-000000000001', 'All Offer', 'عرض للجميع', 'Details', 'تفاصيل', 'all', 'كل الأطباء', 1, 1, 0);

SELECT is(
    (SELECT count(*)::int FROM public.announcement_sends WHERE title_en = 'All Offer'),
    1,
    'admin can insert and read announcement_sends'
);
SELECT isnt(
    (public.get_promotional_push_preview('all', NULL)->'recent_all_send'),
    'null'::jsonb,
    '24-hour sanity guard detects recent all-audience send'
);

-- Non-admin staff cannot read announcement_sends either
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '94000000-0000-0000-0000-000000000002', TRUE);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.announcement_sends), 0, 'non-admin staff cannot read announcement_sends');

-- Hard Rule: case_update trigger STILL enqueues push for Doctor A even though promotional_enabled = false!
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', TRUE);
SELECT set_config('app.settings.push_edge_url', 'http://127.0.0.1:56501/functions/v1/send-push', TRUE);

INSERT INTO public.orders (id, case_id, doctor_id, patient_name, items, total_price, shade, status, delivery_date, cost, production_status, issue_state)
VALUES ('44000000-0000-0000-0000-000000000001', 'PROMO-OPT-1', '14000000-0000-0000-0000-00000000000a', 'OptOut Patient', '[]', 100, 'A1', 'New Case', CURRENT_DATE, 0, 'not_started', 'none');

SELECT is(
    (SELECT count(*)::int FROM net.http_request_queue WHERE url = 'http://127.0.0.1:56501/functions/v1/send-push' AND convert_from(body, 'utf8') LIKE '%PROMO-OPT-1%'),
    1,
    'case_update still dispatches to doctor A despite promotional_enabled = false'
);

SELECT * FROM finish();
ROLLBACK;
