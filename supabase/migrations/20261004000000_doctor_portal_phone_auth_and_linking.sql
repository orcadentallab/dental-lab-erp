-- Migration: 20261004000000_doctor_portal_phone_auth_and_linking.sql
-- Description: Core database foundations for Doctor Portal (Sprint 1)
--   1. Comprehensive normalize_phone(text) function handling Egypt, Excel 10-digit, and international numbers.
--   2. Functional indexes on doctors(phone, phone2).
--   3. phone_verifications table for OTP cryptographic verification with rate-limiting.
--   4. doctor_link_requests table for pending approvals (multi-match, centers, code claims).
--   5. Atomic RPCs:
--      - request_doctor_phone_otp
--      - verify_and_link_doctor
--      - claim_doctor_code
--      - get_pending_doctor_link_requests
--      - approve_doctor_link_request
--      - reject_doctor_link_request

-- ============================================================================
-- 1. PHONE NORMALIZATION FUNCTION (E.164 + Excel Edge Cases)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone TEXT)
RETURNS TEXT
IMMUTABLE
LANGUAGE plpgsql
AS $$
DECLARE
    v_clean TEXT := '';
    v_char CHAR;
    v_code INT;
    i INT;
    v_len INT;
BEGIN
    IF p_phone IS NULL OR btrim(p_phone) = '' THEN
        RETURN NULL;
    END IF;

    -- Strip leading and trailing whitespace
    p_phone := btrim(p_phone);

    -- Convert Arabic-Indic numerals (٠-٩) and extract ASCII digits
    FOR i IN 1..length(p_phone) LOOP
        v_char := substr(p_phone, i, 1);
        v_code := ascii(v_char);
        
        -- Arabic-Indic digits ٠-٩ (Unicode 1632 - 1641)
        IF v_code BETWEEN 1632 AND 1641 THEN
            v_clean := v_clean || (v_code - 1632)::text;
        -- ASCII digits 0-9
        ELSIF v_code BETWEEN 48 AND 57 THEN
            v_clean := v_clean || v_char;
        END IF;
    END LOOP;

    -- Strip leading double zero (00) international prefix
    IF v_clean LIKE '00%' THEN
        v_clean := substr(v_clean, 3);
    END IF;

    v_len := length(v_clean);

    -- Egyptian Mobile Cases (E.164 country code: 20):
    -- Case 1: Standard 11 digits starting with 01[0125]
    IF v_len = 11 AND v_clean ~ '^01[0125]' THEN
        RETURN '20' || substr(v_clean, 2);
    END IF;

    -- Case 2: Excel stripped leading zero (10 digits starting with 1[0125])
    IF v_len = 10 AND v_clean ~ '^1[0125]' THEN
        RETURN '20' || v_clean;
    END IF;

    -- Case 3: Already standard 12 digits with Egypt country code 201[0125]
    IF v_len = 12 AND v_clean ~ '^201[0125]' THEN
        RETURN v_clean;
    END IF;

    -- International recognized prefixes: Saudi (966), Syria (963), Yemen (967), UAE (971), Kuwait (965), etc.
    IF v_len BETWEEN 11 AND 14 AND v_clean ~ '^(966|963|967|971|965|962|218|968|974|973)' THEN
        RETURN v_clean;
    END IF;

    -- Unknown prefixes and malformed local numbers must not be guessed.
    -- Invalid / Dummy / Text / Malformed
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.normalize_phone(TEXT) IS 
'Normalizes phone numbers to standard E.164 format, automatically recovering Excel-stripped 10-digit numbers and converting Arabic-Indic numerals.';

-- Add functional indexes on doctors table for lightning-fast matching
CREATE INDEX IF NOT EXISTS idx_doctors_norm_phone 
ON public.doctors (public.normalize_phone(phone));

CREATE INDEX IF NOT EXISTS idx_doctors_norm_phone2 
ON public.doctors (public.normalize_phone(phone2)) 
WHERE phone2 IS NOT NULL;


-- ============================================================================
-- 2. PHONE VERIFICATIONS TABLE (OTP Storage & Rate Limiting)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.phone_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL,
    normalized_phone TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    claim_token_hash TEXT,
    channel TEXT NOT NULL DEFAULT 'mock' CHECK (channel IN ('whatsapp', 'sms', 'mock')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.phone_verifications ADD COLUMN IF NOT EXISTS claim_token_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_phone_verifications_norm_phone 
ON public.phone_verifications (normalized_phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_phone_verifications_active 
ON public.phone_verifications (normalized_phone, expires_at) 
WHERE verified_at IS NULL;

ALTER TABLE public.phone_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_verifications FROM PUBLIC, anon;
GRANT SELECT ON public.phone_verifications TO authenticated;


-- ============================================================================
-- 3. DOCTOR LINK REQUESTS TABLE (Pending Approvals Queue)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.doctor_link_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL,
    normalized_phone TEXT NOT NULL,
    claimed_doctor_code TEXT,
    matched_doctor_ids JSONB DEFAULT '[]'::jsonb,
    target_doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL,
    request_type TEXT NOT NULL CHECK (request_type IN ('multi_match', 'center_shared', 'code_claim', 'new_doctor')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    notes TEXT,
    admin_notes TEXT,
    reviewed_by UUID REFERENCES public.users(id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_doctor_link_requests_status 
ON public.doctor_link_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_doctor_link_requests_phone 
ON public.doctor_link_requests(normalized_phone);

ALTER TABLE public.doctor_link_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_link_requests FROM PUBLIC, anon;
GRANT SELECT ON public.doctor_link_requests TO authenticated;

DROP POLICY IF EXISTS "Admins and coordinators view link requests" ON public.doctor_link_requests;
CREATE POLICY "Admins and coordinators view link requests" 
ON public.doctor_link_requests FOR SELECT TO authenticated
USING (public.get_my_role() IN ('admin', 'coordinator'));

DROP POLICY IF EXISTS "Admins and coordinators update link requests" ON public.doctor_link_requests;


-- ============================================================================
-- 4. ATOMIC RPC: request_doctor_phone_otp
-- ============================================================================

CREATE OR REPLACE FUNCTION public.request_doctor_phone_otp(
    p_phone TEXT,
    p_channel TEXT DEFAULT 'mock',
    p_ip TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    v_norm TEXT;
    v_recent_count INT;
    v_code TEXT;
    v_hash TEXT;
    v_expires_at TIMESTAMPTZ;
BEGIN
    -- Mock authentication is explicitly opt-in on LOCAL databases only.
    -- A browser-controlled channel must never enable mock authentication.
    IF current_setting('app.doctor_otp_mock_enabled', true) IS DISTINCT FROM 'on' THEN
        RETURN jsonb_build_object('success', false, 'status', 'invalid_phone',
            'message', 'تسجيل الدخول بالهاتف غير متاح حالياً. يرجى التواصل مع المعمل.');
    END IF;
    IF p_channel IS DISTINCT FROM 'mock' THEN
        RETURN jsonb_build_object('success', false, 'message', 'مزود إرسال رمز التحقق غير مهيأ.');
    END IF;
    v_norm := public.normalize_phone(p_phone);
    IF v_norm IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_PHONE',
            'message', 'رقم الهاتف غير صالح. يرجى إدخال رقم هاتف صحيح.'
        );
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(v_norm, 0));
    -- Rate Limiting: Max 3 OTP requests per hour for this phone
    SELECT count(*) INTO v_recent_count
    FROM public.phone_verifications
    WHERE normalized_phone = v_norm
      AND created_at > clock_timestamp() - INTERVAL '1 hour';

    IF v_recent_count >= 3 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'RATE_LIMIT_EXCEEDED',
            'message', 'تم تجاوز الحد المسموح به لإرسال كود التحقق. يرجى المحاولة بعد ساعة.'
        );
    END IF;

    -- Generate secure 6-digit OTP code (between 100000 and 999999)
    v_code := lpad(((('x' || encode(gen_random_bytes(3), 'hex'))::bit(24)::bigint % 900000) + 100000)::text, 6, '0');
    IF nullif(current_setting('app.doctor_otp_hmac_key', true), '') IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'مفتاح التحقق غير مهيأ على الخادم.');
    END IF;
    v_hash := encode(hmac(v_norm || ':' || v_code, current_setting('app.doctor_otp_hmac_key'), 'sha256'), 'hex');
    v_expires_at := clock_timestamp() + INTERVAL '5 minutes';

    -- Invalidate previous unused codes for this phone
    UPDATE public.phone_verifications
    SET expires_at = clock_timestamp() - INTERVAL '1 second'
    WHERE normalized_phone = v_norm
      AND verified_at IS NULL
      AND expires_at > clock_timestamp();

    INSERT INTO public.phone_verifications (
        phone, normalized_phone, otp_hash, channel,
        attempts, max_attempts, expires_at, ip_address, user_agent, created_at
    ) VALUES (
        btrim(p_phone), v_norm, v_hash, COALESCE(p_channel, 'mock'),
        0, 3, v_expires_at, p_ip, p_user_agent, clock_timestamp()
    );

    RETURN jsonb_build_object(
        'success', true,
        'normalized_phone', v_norm,
        'channel', COALESCE(p_channel, 'mock'),
        'expires_in_seconds', 300,
        -- Expose otp_code ONLY when channel is mock/development for local testing
        'otp_code', CASE WHEN p_channel = 'mock' THEN v_code ELSE NULL END,
        'message', 'تم إرسال كود التحقق بنجاح.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.request_doctor_phone_otp(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_doctor_phone_otp(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;


-- ============================================================================
-- 5. ATOMIC RPC: verify_and_link_doctor
-- ============================================================================

CREATE OR REPLACE FUNCTION public.verify_and_link_doctor(
    p_phone TEXT,
    p_otp_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    v_norm TEXT;
    v_rec RECORD;
    v_match_count INT;
    v_doc RECORD;
    v_matched_ids JSONB;
    v_existing_user RECORD;
    v_auth_id UUID;
    v_existing_auth_id UUID;
    v_session_token TEXT;
    v_email TEXT;
    v_claim_token TEXT;
BEGIN
    v_norm := public.normalize_phone(p_phone);
    IF v_norm IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'status', 'invalid_phone',
            'message', 'رقم الهاتف غير صالح'
        );
    END IF;

    IF current_setting('app.doctor_otp_mock_enabled', true) IS DISTINCT FROM 'on' THEN
        RETURN jsonb_build_object('success', false, 'status', 'invalid_phone', 'message', 'تسجيل الدخول بالهاتف غير متاح حالياً.');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_norm, 0));
    -- 1. Find latest active verification record
    SELECT * INTO v_rec
    FROM public.phone_verifications
    WHERE normalized_phone = v_norm
      AND verified_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1 FOR UPDATE;

    IF v_rec.id IS NULL OR v_rec.expires_at <= clock_timestamp() THEN
        RETURN jsonb_build_object(
            'success', false,
            'status', 'expired_code',
            'message', 'رمز التحقق منتهي الصلاحية أو غير موجود. يرجى طلب رمز جديد.'
        );
    END IF;

    IF v_rec.attempts >= v_rec.max_attempts THEN
        RETURN jsonb_build_object(
            'success', false,
            'status', 'max_attempts_exceeded',
            'message', 'تم تجاوز الحد الأقصى للمحاولات الخاطئة لهذا الرمز. يرجى طلب رمز جديد.'
        );
    END IF;

    -- 2. Verify OTP cryptographically
    IF p_otp_code IS NULL OR btrim(p_otp_code) !~ '^[0-9]{6}$' OR v_rec.otp_hash IS DISTINCT FROM encode(hmac(v_norm || ':' || btrim(p_otp_code), nullif(current_setting('app.doctor_otp_hmac_key', true), ''), 'sha256'), 'hex') THEN
        UPDATE public.phone_verifications
        SET attempts = attempts + 1
        WHERE id = v_rec.id;

        RETURN jsonb_build_object(
            'success', false,
            'status', 'wrong_code',
            'attempts_left', GREATEST(0, v_rec.max_attempts - (v_rec.attempts + 1)),
            'message', 'رمز التحقق غير صحيح.'
        );
    END IF;

    v_claim_token := encode(gen_random_bytes(32), 'hex');
    -- Mark verified
    UPDATE public.phone_verifications
    SET verified_at = clock_timestamp(),
        claim_token_hash = encode(digest(v_claim_token, 'sha256'), 'hex')
    WHERE id = v_rec.id;

    -- Approved mappings take precedence over the original directory phone.
    SELECT target_doctor_id INTO v_auth_id FROM public.doctor_link_requests
    WHERE normalized_phone = v_norm AND status = 'approved'
    ORDER BY reviewed_at DESC LIMIT 1;
    -- 3. Search doctors table for matching phone numbers
    SELECT count(*), jsonb_agg(id)
    INTO v_match_count, v_matched_ids
    FROM public.doctors
    WHERE (v_auth_id IS NOT NULL AND id = v_auth_id)
       OR (v_auth_id IS NULL AND (public.normalize_phone(phone) = v_norm
       OR (phone2 IS NOT NULL AND public.normalize_phone(phone2) = v_norm)));

    -- CASE A: Exactly 1 matching doctor
    IF v_match_count = 1 THEN
        SELECT * INTO v_doc
        FROM public.doctors
        WHERE (v_auth_id IS NOT NULL AND id = v_auth_id)
       OR (v_auth_id IS NULL AND (public.normalize_phone(phone) = v_norm
       OR (phone2 IS NOT NULL AND public.normalize_phone(phone2) = v_norm)))
        LIMIT 1;

        -- Sub-case A1: Center or Child Branch -> Requires Manual Approval
        IF v_auth_id IS NULL AND (COALESCE(v_doc.is_center, false) = true OR v_doc.parent_id IS NOT NULL) THEN
            INSERT INTO public.doctor_link_requests (
                phone, normalized_phone, target_doctor_id, matched_doctor_ids,
                request_type, status, notes
            ) VALUES (
                btrim(p_phone), v_norm, v_doc.id, v_matched_ids,
                'center_shared', 'pending',
                CASE WHEN COALESCE(v_doc.is_center, false) THEN 'رقم مركز طبي' ELSE 'طبيب تابع لفرع/مركز' END
            );

            RETURN jsonb_build_object(
                'success', true,
                'status', 'pending_approval',
                'reason', 'center_or_branch',
                'message', 'تم استلام طلب ربط حسابك، وسيتم مراجعته وتحديد الفرع المناسب من قبل إدارة المعمل للحفاظ على سرية الحسابات.'
            );
        END IF;

        PERFORM pg_advisory_xact_lock(hashtextextended(v_doc.id::text, 0));
        -- Sub-case A2: Standard Independent Doctor -> Auto-Link
        -- Check if a user account already exists in public.users
        SELECT * INTO v_existing_user
        FROM public.users
        WHERE entity_id = v_doc.id AND role = 'doctor'
        LIMIT 1;

        IF EXISTS (SELECT 1 FROM public.users WHERE entity_id = v_doc.id AND role <> 'doctor')
            OR (SELECT count(*) FROM public.users WHERE entity_id = v_doc.id AND role = 'doctor') > 1 THEN
            RETURN jsonb_build_object('success', false, 'status', 'invalid_phone', 'message', 'الحساب يحتاج مراجعة الإدارة.');
        END IF;
        -- Generate a high-entropy 48-character hex session token
        v_session_token := encode(gen_random_bytes(24), 'hex');
        v_email := 'doc_' || replace(v_doc.id::text, '-', '') || '@orcadentallab.internal';

        IF v_existing_user.id IS NOT NULL THEN
            -- Account exists: check active status
            IF v_existing_user.is_active = false THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'status', 'deactivated',
                    'message', 'حساب الطبيب موقوف حالياً. يرجى التواصل مع إدارة المعمل.'
                );
            END IF;

            SELECT email INTO v_email FROM auth.users WHERE id = v_existing_user.auth_id;
            IF v_email IS NULL THEN
                RETURN jsonb_build_object('success', false, 'status', 'invalid_phone', 'message', 'تعذر فتح الحساب. يرجى التواصل مع الإدارة.');
            END IF;
            -- Update password in auth.users to the newly generated session token
            UPDATE auth.users
            SET encrypted_password = crypt(v_session_token, gen_salt('bf')),
                updated_at = clock_timestamp()
            WHERE id = v_existing_user.auth_id;

            RETURN jsonb_build_object(
                'success', true,
                'status', 'auto_linked',
                'doctor_id', v_doc.id,
                'doctor_name', v_doc.name,
                'doctor_code', v_doc.doctor_code,
                'email', v_email,
                'session_token', v_session_token,
                'message', 'تم تسجيل الدخول بنجاح.'
            );
        ELSE
            -- First time portal user: Create auth.users and public.users rows
            SELECT id INTO v_existing_auth_id FROM auth.users WHERE email = v_email;

            IF v_existing_auth_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.users WHERE auth_id = v_existing_auth_id) THEN
                RAISE EXCEPTION 'Authentication identity already assigned';
            END IF;
            IF v_existing_auth_id IS NOT NULL THEN
                v_auth_id := v_existing_auth_id;
                UPDATE auth.users
                SET encrypted_password = crypt(v_session_token, gen_salt('bf')),
                    updated_at = clock_timestamp()
                WHERE id = v_auth_id;
            ELSE
                v_auth_id := gen_random_uuid();
                INSERT INTO auth.users (
                    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                    confirmation_token, recovery_token, email_change_token_new, email_change
                ) VALUES (
                    v_auth_id,
                    '00000000-0000-0000-0000-000000000000',
                    'authenticated',
                    'authenticated',
                    v_email,
                    crypt(v_session_token, gen_salt('bf')),
                    clock_timestamp(),
                    '{"provider":"email","providers":["email"]}'::jsonb,
                    jsonb_build_object('name', v_doc.name, 'phone', v_norm, 'doctor_code', v_doc.doctor_code),
                    clock_timestamp(),
                    clock_timestamp(), '', '', '', ''
                );
            END IF;

            INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
            VALUES (v_auth_id::text, v_auth_id,
                jsonb_build_object('sub', v_auth_id::text, 'email', v_email, 'email_verified', true),
                'email', clock_timestamp(), clock_timestamp())
            ON CONFLICT (provider_id, provider) DO NOTHING;

            INSERT INTO public.users (
                id, auth_id, username, role, name, entity_id, is_active
            ) VALUES (
                gen_random_uuid(),
                v_auth_id,
                'doc_' || v_doc.doctor_code,
                'doctor',
                v_doc.name,
                v_doc.id,
                true
            );

            RETURN jsonb_build_object(
                'success', true,
                'status', 'auto_linked',
                'doctor_id', v_doc.id,
                'doctor_name', v_doc.name,
                'doctor_code', v_doc.doctor_code,
                'email', v_email,
                'session_token', v_session_token,
                'message', 'تم ربط حسابك وتسجيل الدخول بنجاح.'
            );
        END IF;

    -- CASE B: Multiple matching doctors share this phone
    ELSIF v_match_count > 1 THEN
        INSERT INTO public.doctor_link_requests (
            phone, normalized_phone, matched_doctor_ids,
            request_type, status, notes
        ) VALUES (
            btrim(p_phone), v_norm, v_matched_ids,
            'multi_match', 'pending',
            'اشتراك أكثر من طبيب في نفس رقم الهاتف'
        );

        RETURN jsonb_build_object(
            'success', true,
            'status', 'pending_approval',
            'reason', 'multi_match',
            'message', 'تم التحقق من رقم هاتفك بنجاح. نظراً لوجود أكثر من حساب مرتبط بهذا الرقم، تم توجيه الطلب لإدارة المعمل لتحديد الحساب المطلوب.'
        );

    -- CASE C: Not found in database
    ELSE
        RETURN jsonb_build_object(
            'success', true,
            'status', 'not_found',
            'claim_token', v_claim_token,
            'normalized_phone', v_norm,
            'message', 'هذا الرقم غير مسجل في سجلات أطباء المعمل حالياً. إذا كنت عميلاً مسجلاً، يمكنك إدخال كود الطبيب (Doctor Code) للربط الفوري.'
        );
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_and_link_doctor(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_and_link_doctor(TEXT, TEXT) TO anon, authenticated;


-- ============================================================================
-- 6. ATOMIC RPC: claim_doctor_code (Zero Data Exposure)
-- ============================================================================

-- Retire the earlier unsafe overload if this scaffold was tested previously.
DROP FUNCTION IF EXISTS public.claim_doctor_code(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.claim_doctor_code(
    p_phone TEXT,
    p_doctor_code TEXT,
    p_claim_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    v_norm TEXT;
    v_recent_verif RECORD;
    v_recent_claims INT;
    v_target_doc RECORD;
BEGIN
    v_norm := public.normalize_phone(p_phone);
    IF v_norm IS NULL OR p_doctor_code IS NULL OR btrim(p_doctor_code) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'بيانات غير صالحة. يرجى التأكد من رقم الهاتف وكود الطبيب.'
        );
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(v_norm, 0));
    -- 1. Ensure phone was verified in the last 30 minutes
    SELECT * INTO v_recent_verif
    FROM public.phone_verifications
    WHERE normalized_phone = v_norm
      AND claim_token_hash = encode(digest(p_claim_token, 'sha256'), 'hex')
      AND verified_at IS NOT NULL
      AND verified_at > clock_timestamp() - INTERVAL '30 minutes'
    ORDER BY verified_at DESC
    LIMIT 1 FOR UPDATE;

    IF v_recent_verif.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'يرجى التحقق من رقم الهاتف أولاً عبر كود التحقق قبل المطالبة بالكود.'
        );
    END IF;

    -- 2. Anti-Brute-Force Rate Limit: Max 3 code claims per phone in 24 hours
    SELECT count(*) INTO v_recent_claims
    FROM public.doctor_link_requests
    WHERE normalized_phone = v_norm
      AND request_type = 'code_claim'
      AND created_at > clock_timestamp() - INTERVAL '24 hours';

    IF v_recent_claims >= 3 THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'تم تجاوز الحد الأقصى لمحاولات المطالبة بالكود لهذا الرقم. يرجى التواصل مع إدارة المعمل.'
        );
    END IF;

    -- 3. Lookup doctor by code (without exposing any info to caller)
    SELECT id, name, doctor_code INTO v_target_doc
    FROM public.doctors
    WHERE btrim(doctor_code) = btrim(p_doctor_code)
    LIMIT 1;

    -- Record claim request
    INSERT INTO public.doctor_link_requests (
        phone, normalized_phone, claimed_doctor_code,
        target_doctor_id, request_type, status, notes
    ) VALUES (
        btrim(p_phone), v_norm, btrim(p_doctor_code),
        v_target_doc.id, 'code_claim', 'pending',
        CASE WHEN v_target_doc.id IS NOT NULL THEN 'الكود موجود في قاعدة البيانات' ELSE 'كود غير موجود' END
    );

    UPDATE public.phone_verifications SET claim_token_hash = NULL WHERE id = v_recent_verif.id;
    -- Zero Data Exposure response
    RETURN jsonb_build_object(
        'success', true,
        'status', 'pending_approval',
        'message', 'تم استلام طلب ربط حسابك برقم الكود بنجاح، وجاري مراجعته واعتماده من إدارة المعمل لحماية سرية حسابك.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_doctor_code(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_doctor_code(TEXT, TEXT, TEXT) TO anon, authenticated;


-- ============================================================================
-- 7. ATOMIC RPCS: Coordinator & Admin Approval Queue
-- ============================================================================

-- List pending link requests
CREATE OR REPLACE FUNCTION public.get_pending_doctor_link_requests()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    v_role TEXT;
    v_result JSONB;
BEGIN
    v_role := public.get_my_role();
    IF v_role IS NULL OR v_role NOT IN ('admin', 'coordinator') THEN
        RAISE EXCEPTION 'Unauthorized: only admin or coordinator can view pending link requests';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', r.id,
            'phone', r.phone,
            'normalized_phone', r.normalized_phone,
            'claimed_doctor_code', r.claimed_doctor_code,
            'request_type', r.request_type,
            'status', r.status,
            'notes', r.notes,
            'target_doctor_id', r.target_doctor_id,
            'target_doctor_name', d.name,
            'target_doctor_code', d.doctor_code,
            'matched_doctor_ids', r.matched_doctor_ids,
            'created_at', r.created_at
        ) ORDER BY r.created_at DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM public.doctor_link_requests r
    LEFT JOIN public.doctors d ON d.id = r.target_doctor_id
    WHERE r.status = 'pending';

    RETURN v_result;
END;
$$;

-- Approve link request
CREATE OR REPLACE FUNCTION public.approve_doctor_link_request(
    p_request_id UUID,
    p_doctor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    v_role TEXT;
    v_caller_id UUID;
    v_req RECORD;
    v_doc RECORD;
    v_existing_user RECORD;
    v_auth_id UUID;
    v_existing_auth_id UUID;
    v_email TEXT;
BEGIN
    v_role := public.get_my_role();
    IF v_role IS NULL OR v_role NOT IN ('admin', 'coordinator') THEN
        RAISE EXCEPTION 'Unauthorized: only admin or coordinator can approve doctor link requests';
    END IF;

    SELECT id INTO v_caller_id FROM public.users WHERE auth_id = auth.uid() LIMIT 1;

    SELECT * INTO v_req FROM public.doctor_link_requests WHERE id = p_request_id FOR UPDATE;
    IF v_req.id IS NULL THEN
        RAISE EXCEPTION 'Request not found';
    END IF;
    IF v_req.status != 'pending' THEN
        RAISE EXCEPTION 'Request has already been processed';
    END IF;

    SELECT * INTO v_doc FROM public.doctors WHERE id = p_doctor_id;
    IF v_doc.id IS NULL THEN
        RAISE EXCEPTION 'Selected doctor not found';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(v_req.normalized_phone, 0));
    -- Record the approved phone mapping. Credentials are provisioned only
    -- after the requester proves possession with a fresh OTP.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_doc.id::text, 0));
    IF EXISTS (SELECT 1 FROM public.users WHERE entity_id = v_doc.id
        AND (role <> 'doctor' OR is_active IS FALSE)) THEN
        RAISE EXCEPTION 'Selected account is unavailable; resolve it in user management';
    END IF;
    IF EXISTS (SELECT 1 FROM public.doctor_link_requests WHERE normalized_phone = v_req.normalized_phone
        AND status = 'approved') THEN
        RAISE EXCEPTION 'Phone already has an approved account';
    END IF;

    -- Mark request approved
    UPDATE public.doctor_link_requests
    SET status = 'approved',
        target_doctor_id = v_doc.id,
        reviewed_by = v_caller_id,
        reviewed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE id = p_request_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'تم اعتماد طلب الربط بنجاح، وأصبح حساب الطبيب مفعل وجاهز للدخول.'
    );
END;
$$;

-- Reject link request
CREATE OR REPLACE FUNCTION public.reject_doctor_link_request(
    p_request_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    v_role TEXT;
    v_caller_id UUID;
    v_req RECORD;
BEGIN
    v_role := public.get_my_role();
    IF v_role IS NULL OR v_role NOT IN ('admin', 'coordinator') THEN
        RAISE EXCEPTION 'Unauthorized: only admin or coordinator can reject doctor link requests';
    END IF;

    SELECT id INTO v_caller_id FROM public.users WHERE auth_id = auth.uid() LIMIT 1;

    SELECT * INTO v_req FROM public.doctor_link_requests WHERE id = p_request_id FOR UPDATE;
    IF v_req.id IS NULL THEN
        RAISE EXCEPTION 'Request not found';
    END IF;
    IF v_req.status != 'pending' THEN
        RAISE EXCEPTION 'Request has already been processed';
    END IF;

    UPDATE public.doctor_link_requests
    SET status = 'rejected',
        admin_notes = p_notes,
        reviewed_by = v_caller_id,
        reviewed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE id = p_request_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'تم رفض طلب الربط.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_doctor_link_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_doctor_link_requests() TO authenticated;

REVOKE ALL ON FUNCTION public.approve_doctor_link_request(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_doctor_link_request(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.reject_doctor_link_request(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_doctor_link_request(UUID, TEXT) TO authenticated;
