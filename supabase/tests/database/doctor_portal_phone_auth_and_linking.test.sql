BEGIN;

SET search_path TO public, extensions;

SELECT plan(33);
SELECT set_config('app.doctor_otp_mock_enabled', 'on', true);
SELECT set_config('app.doctor_otp_hmac_key', 'local-test-key-never-use-in-production', true);

-- ============================================================================
-- 1. TEST PHONE NORMALIZATION
-- ============================================================================

SELECT is(
    public.normalize_phone('01012345678'),
    '201012345678',
    'Standard 11-digit Egyptian mobile normalized with country code'
);

SELECT is(
    public.normalize_phone('1012345678'),
    '201012345678',
    'Excel-stripped 10-digit mobile automatically prepended with country code'
);

SELECT is(
    public.normalize_phone('201012345678'),
    '201012345678',
    '12-digit mobile already containing 20 is preserved'
);

SELECT is(
    public.normalize_phone('+20 12 3456-7890'),
    '201234567890',
    'Formatted mobile with symbols and spaces is cleaned and normalized'
);

SELECT is(
    public.normalize_phone('٠١١٩٨٧٦٥٤٣٢'),
    '201198765432',
    'Arabic-Indic numerals converted to standard ASCII and normalized'
);

SELECT is(
    public.normalize_phone('00966501234567'),
    '966501234567',
    'International Saudi number normalized'
);

SELECT is(
    public.normalize_phone('0000'),
    NULL,
    'Dummy phone 0000 returns NULL'
);

SELECT is(
    public.normalize_phone('مركز بيبودنت'),
    NULL,
    'Text in phone field returns NULL'
);

-- ============================================================================
-- 2. SETUP TEST DOCTORS & ADMIN
-- ============================================================================

DELETE FROM public.phone_verifications WHERE normalized_phone IN ('201011112222', '201033334444', '201055556666', '201099998888');
DELETE FROM public.doctor_link_requests WHERE normalized_phone IN ('201011112222', '201033334444', '201055556666', '201099998888');
DELETE FROM public.users WHERE entity_id IN ('81000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000003', '81000000-0000-0000-0000-000000000004', '81000000-0000-0000-0000-000000000005');
DELETE FROM public.doctors WHERE id IN ('81000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000003', '81000000-0000-0000-0000-000000000004', '81000000-0000-0000-0000-000000000005');

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name, is_center, parent_id)
VALUES 
    ('81000000-0000-0000-0000-000000000001', 'د. أحمد محمود المستقل', '01011112222', 'المعادي', 'DOC-8101', 'مندوب 1', false, NULL),
    ('81000000-0000-0000-0000-000000000002', 'مركز النور لطب الأسنان', '01033334444', 'مدينة نصر', 'DOC-8102', 'مندوب 1', true, NULL),
    ('81000000-0000-0000-0000-000000000003', 'د. فريد فرع المركز', '01033334444', 'مدينة نصر', 'DOC-8103', 'مندوب 1', false, '81000000-0000-0000-0000-000000000002'),
    ('81000000-0000-0000-0000-000000000004', 'د. كمال مشترك 1', '01055556666', 'التجمع', 'DOC-8104', 'مندوب 2', false, NULL),
    ('81000000-0000-0000-0000-000000000005', 'د. سارة مشترك 2', '01055556666', 'التجمع', 'DOC-8105', 'مندوب 2', false, NULL);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
VALUES ('82000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin_coord@orca.test', '', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, auth_id, username, role, name, is_active)
VALUES ('83000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', 'test_coordinator', 'coordinator', 'Coordinator Test', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 3. TEST OTP REQUEST
-- ============================================================================

SELECT is(
    (public.request_doctor_phone_otp('01011112222', 'mock')->>'success')::boolean,
    true,
    'Request OTP succeeds for valid Egyptian phone'
);

SELECT ok(
    (public.request_doctor_phone_otp('01011112222', 'mock')->>'otp_code') IS NOT NULL,
    'Mock OTP returns generated 6-digit code in development mode'
);

SELECT is(
    (public.request_doctor_phone_otp('invalid_phone', 'mock')->>'success')::boolean,
    false,
    'Request OTP fails for invalid phone'
);

-- ============================================================================
-- 4. TEST VERIFY AND LINK DOCTOR
-- ============================================================================

-- Wrong code rejected
SELECT is(
    (public.verify_and_link_doctor('01011112222', '000000')->>'success')::boolean,
    false,
    'Wrong OTP is rejected'
);

-- Correct code -> Auto-link single independent doctor
WITH otp AS (
    SELECT public.request_doctor_phone_otp('01011112222', 'mock') AS res
)
SELECT is(
    (SELECT public.verify_and_link_doctor('01011112222', otp.res->>'otp_code')->>'status' FROM otp),
    'auto_linked',
    'Single independent doctor is automatically linked'
);

-- Center / branch phone -> pending_approval
WITH otp AS (
    SELECT public.request_doctor_phone_otp('01033334444', 'mock') AS res
)
SELECT is(
    (SELECT public.verify_and_link_doctor('01033334444', otp.res->>'otp_code')->>'status' FROM otp),
    'pending_approval',
    'Center or branch phone is routed to pending approval queue'
);

-- Shared phone between multiple doctors -> pending_approval
WITH otp AS (
    SELECT public.request_doctor_phone_otp('01055556666', 'mock') AS res
)
SELECT is(
    (SELECT public.verify_and_link_doctor('01055556666', otp.res->>'otp_code')->>'status' FROM otp),
    'pending_approval',
    'Shared phone between multiple doctors is routed to pending approval'
);

CREATE TEMP TABLE claim_proof (response jsonb);
-- Unregistered phone -> not_found
WITH otp AS (
    SELECT public.request_doctor_phone_otp('01099998888', 'mock') AS res
)
 , verified AS (
    INSERT INTO claim_proof SELECT public.verify_and_link_doctor('01099998888', otp.res->>'otp_code') FROM otp RETURNING response
)
SELECT is(
    (SELECT response->>'status' FROM verified),
    'not_found',
    'Unregistered phone returns not_found status'
);

-- ============================================================================
-- 5. TEST DOCTOR CODE CLAIM (Zero Data Exposure)
-- ============================================================================

SELECT is(
    (public.claim_doctor_code('01099998888', 'DOC-8101', (SELECT response->>'claim_token' FROM claim_proof))->>'success')::boolean,
    true,
    'Doctor code claim succeeds without exposing data'
);

SELECT is(
    (SELECT count(*)::int FROM public.doctor_link_requests WHERE normalized_phone = '201099998888' AND request_type = 'code_claim'),
    1,
    'Doctor link request was created in doctor_link_requests table'
);

-- ============================================================================
-- 6. TEST COORDINATOR APPROVAL
-- ============================================================================

SELECT is(
    (
        SELECT (public.approve_doctor_link_request(
            (SELECT id FROM public.doctor_link_requests WHERE normalized_phone = '201099998888' LIMIT 1),
            '81000000-0000-0000-0000-000000000001'
        )->>'success')::boolean
        FROM (SELECT set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000001', true),
                     set_config('request.jwt.claim.role', 'authenticated', true)) auth_ctx
    ),
    true,
    'Coordinator successfully approves link request'
);

SELECT is(public.normalize_phone('1334567890'), NULL, 'Unrecognized phone prefix is rejected');
SELECT is((public.verify_and_link_doctor('01055556666', NULL)->>'success')::boolean, false, 'NULL OTP never verifies');
SELECT is((public.claim_doctor_code('01099998888', 'DOC-8101', 'guessed-proof')->>'success')::boolean, false, 'Knowing a verified phone is not proof of possession');
WITH otp AS (SELECT public.request_doctor_phone_otp('01099998888', 'mock') AS res)
SELECT is((SELECT public.verify_and_link_doctor('01099998888', res->>'otp_code')->>'status' FROM otp), 'auto_linked', 'Approved new phone logs into original account');
SELECT is(public.normalize_phone('010165256893'), NULL, 'Malformed Egyptian mobile is rejected');
SELECT is((public.claim_doctor_code('01099998888', 'DOC-8101', (SELECT response->>'claim_token' FROM claim_proof))->>'success')::boolean, false, 'Claim proof cannot be reused');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_ok('SELECT public.get_pending_doctor_link_requests()', 'P0001', 'Unauthorized: only admin or coordinator can view pending link requests', 'Missing role cannot read the approval queue');
CREATE TEMP TABLE attempt_challenge AS SELECT public.request_doctor_phone_otp('01088887777', 'mock') AS response;
SELECT is((public.verify_and_link_doctor('01088887777', '000000')->>'attempts_left')::int, 2, 'First failure consumes one attempt');
SELECT is((public.verify_and_link_doctor('01088887777', '000000')->>'attempts_left')::int, 1, 'Second failure consumes one attempt');
SELECT is((public.verify_and_link_doctor('01088887777', '000000')->>'attempts_left')::int, 0, 'Third failure exhausts the challenge');
SELECT is(public.verify_and_link_doctor('01088887777', (SELECT response->>'otp_code' FROM attempt_challenge))->>'status', 'max_attempts_exceeded', 'Exhausted challenge rejects correct OTP');
SELECT is((public.request_doctor_phone_otp('01011112222', 'mock')->>'success')::boolean, false, 'Fourth request is rate limited');
WITH otp AS (SELECT public.request_doctor_phone_otp('01077776666', 'mock') AS response), verified AS (
 SELECT public.verify_and_link_doctor('01077776666', response->>'otp_code') AS result, response FROM otp
) SELECT is(public.verify_and_link_doctor('01077776666', response->>'otp_code')->>'status', 'expired_code', 'Verified OTP cannot be replayed') FROM verified WHERE result->>'status' = 'not_found';
SELECT set_config('app.doctor_otp_mock_enabled', 'off', true);
SELECT is((public.request_doctor_phone_otp('01011112222', 'mock')->>'success')::boolean, false, 'Mock authentication is disabled by default');
SELECT * FROM finish();

ROLLBACK;
