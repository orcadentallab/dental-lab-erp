-- Owner-approved password accounts. Phone/email are unverified login identifiers;
-- they never authorize access to an existing doctor record. A staff-issued,
-- expiring, single-use invitation or a staff review authorizes that link.
CREATE TABLE public.doctor_portal_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id uuid NOT NULL REFERENCES public.doctors(id),
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '7 days',
    created_by uuid NOT NULL REFERENCES public.users(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    consumed_at timestamptz
);
CREATE TABLE public.doctor_password_registrations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id uuid NOT NULL UNIQUE REFERENCES auth.users(id),
    phone text NOT NULL UNIQUE,
    profile jsonb NOT NULL,
    intent text NOT NULL CHECK(intent IN ('new','existing','invited')),
    claimed_doctor_id uuid REFERENCES public.doctors(id),
    target_doctor_id uuid REFERENCES public.doctors(id),
    status text NOT NULL CHECK(status IN ('pending','approved','rejected')),
    reviewed_by uuid REFERENCES public.users(id),
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.doctor_portal_public_rate (
    action text NOT NULL,key_hash text NOT NULL,bucket timestamptz NOT NULL,hits integer NOT NULL,
    PRIMARY KEY(action,key_hash,bucket)
);
ALTER TABLE public.doctor_portal_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_password_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_portal_public_rate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_portal_invitations,public.doctor_password_registrations,public.doctor_portal_public_rate FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public._doctor_portal_take_rate(p_action text,p_key text,p_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_hits integer;
BEGIN
    INSERT INTO public.doctor_portal_public_rate(action,key_hash,bucket,hits)
    VALUES(p_action,encode(digest(p_key,'sha256'),'hex'),date_trunc('hour',clock_timestamp()),1)
    ON CONFLICT(action,key_hash,bucket) DO UPDATE SET hits=doctor_portal_public_rate.hits+1 RETURNING hits INTO v_hits;
    RETURN v_hits<=p_limit;
END;
$$;
REVOKE ALL ON FUNCTION public._doctor_portal_take_rate(text,text,integer) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public._doctor_portal_phone_matches(p_doctor public.doctors,p_phone text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT public.normalize_phone(p_doctor.phone)=p_phone OR public.normalize_phone(p_doctor.phone2)=p_phone
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_doctor.branches)='array' THEN p_doctor.branches ELSE '[]'::jsonb END) b
    WHERE public.normalize_phone(b->>'phone')=p_phone);
$$;
REVOKE ALL ON FUNCTION public._doctor_portal_phone_matches(public.doctors,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.find_doctor_registration_matches(p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_phone text := public.normalize_phone(p_phone);
BEGIN
    IF v_phone IS NULL THEN RETURN jsonb_build_object('success',false,'message','رقم الهاتف غير صالح'); END IF;
    IF NOT public._doctor_portal_take_rate('lookup',v_phone,10) OR NOT public._doctor_portal_take_rate('lookup-global','all',1000) THEN
        RETURN jsonb_build_object('success',false,'message','تم تجاوز عدد محاولات البحث. حاول لاحقًا أو تواصل مع المعمل.');
    END IF;
    -- Deliberately limited disclosure requested by the owner: name + selection
    -- ID only. No doctor code, phone list, address, cases, balances or pricing.
    RETURN jsonb_build_object('success',true,'matches',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.name))
        FROM public.doctors d WHERE public._doctor_portal_phone_matches(d,v_phone)),'[]'::jsonb));
END;
$$;

CREATE FUNCTION public.create_doctor_portal_invitation(p_doctor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_doc public.doctors; v_token text := encode(gen_random_bytes(32),'hex'); v_expiry timestamptz := clock_timestamp()+interval '7 days';
BEGIN
    SELECT * INTO v_doc FROM public.doctors WHERE id=p_doctor_id FOR UPDATE;
    IF v_doc.id IS NULL OR public.get_my_role() IS NULL OR NOT coalesce((
        public.get_my_role() IN ('admin','coordinator') OR (public.get_my_role()='representative' AND v_doc.representative_id=public.get_my_user_id())),false) THEN
        RAISE EXCEPTION 'غير مصرح بإصدار دعوة لهذا الطبيب';
    END IF;
    IF EXISTS(SELECT 1 FROM public.users WHERE entity_id=v_doc.id) THEN RAISE EXCEPTION 'الطبيب لديه حساب بالفعل؛ راجع إدارة المستخدمين'; END IF;
    -- Issuing a replacement invalidates earlier unconsumed invitations.
    UPDATE public.doctor_portal_invitations SET expires_at=clock_timestamp() WHERE doctor_id=v_doc.id AND consumed_at IS NULL;
    INSERT INTO public.doctor_portal_invitations(doctor_id,token_hash,expires_at,created_by)
    VALUES(v_doc.id,encode(digest(v_token,'sha256'),'hex'),v_expiry,public.get_my_user_id());
    RETURN jsonb_build_object('success',true,'token',v_token,'expires_at',v_expiry,'doctor_name',v_doc.name);
END;
$$;

CREATE FUNCTION public.inspect_doctor_portal_invitation(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_doc public.doctors;
BEGIN
    IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('success',false,'message','الدعوة غير صالحة أو انتهت'); END IF;
    IF NOT public._doctor_portal_take_rate('invite',p_token,30) THEN RETURN jsonb_build_object('success',false,'message','حاول مرة أخرى لاحقًا'); END IF;
    SELECT d.* INTO v_doc FROM public.doctor_portal_invitations i JOIN public.doctors d ON d.id=i.doctor_id
        WHERE i.token_hash=encode(digest(p_token,'sha256'),'hex') AND i.consumed_at IS NULL AND i.expires_at>clock_timestamp();
    IF v_doc.id IS NULL OR EXISTS(SELECT 1 FROM public.users WHERE entity_id=v_doc.id) THEN
        RETURN jsonb_build_object('success',false,'message','الدعوة غير صالحة أو الحساب مفعل بالفعل');
    END IF;
    RETURN jsonb_build_object('success',true,'doctor_name',v_doc.name,'phone',v_doc.phone,'address',v_doc.address,
        'code_region',v_doc.code_region,'is_center',v_doc.is_center);
END;
$$;

CREATE FUNCTION public.register_doctor_password_account(p_phone text,p_email text,p_password text,p_profile jsonb,
    p_intent text,p_claimed_doctor_id uuid DEFAULT NULL,p_invitation_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,extensions AS $$
DECLARE v_phone text := public.normalize_phone(p_phone); v_email text := lower(btrim(p_email));
    v_auth_id uuid := gen_random_uuid(); v_doc public.doctors; v_invite public.doctor_portal_invitations;
    v_profile jsonb; v_child jsonb; v_status text; v_name text;
BEGIN
    IF v_phone IS NULL OR v_email IS NULL OR length(v_email)>254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
        RETURN jsonb_build_object('success',false,'message','راجع رقم الموبايل والإيميل');
    END IF;
    IF p_password IS NULL OR length(p_password)<12 OR octet_length(p_password)>72 THEN
        RETURN jsonb_build_object('success',false,'message','كلمة المرور لا تقل عن 12 حرفًا ولا تتجاوز 72 بايت');
    END IF;
    IF p_profile IS NULL OR jsonb_typeof(p_profile)<>'object' OR octet_length(p_profile::text)>30000
        OR p_intent IS NULL OR p_intent NOT IN ('new','existing','invited') THEN
        RETURN jsonb_build_object('success',false,'message','بيانات التسجيل غير صالحة');
    END IF;
    IF NOT public._doctor_portal_take_rate('register',v_phone,3) OR NOT public._doctor_portal_take_rate('register-global','all',200) THEN
        RETURN jsonb_build_object('success',false,'message','تم تجاوز عدد طلبات التسجيل. حاول لاحقًا');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('password-phone:'||v_phone,0));
    PERFORM pg_advisory_xact_lock(hashtextextended('password-email:'||v_email,0));
    IF EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=v_email OR phone=v_phone)
       OR EXISTS(SELECT 1 FROM public.doctor_password_registrations WHERE phone=v_phone) THEN
        RETURN jsonb_build_object('success',false,'message','بيانات الدخول مستخدمة بالفعل. سجّل الدخول أو تواصل مع المعمل.');
    END IF;
    v_profile := jsonb_build_object('name',public.normalize_doctor_name(p_profile->>'name'),'address',btrim(p_profile->>'address'),
        'code_region',p_profile->>'code_region','is_center',coalesce(p_profile->'is_center','false'::jsonb),
        'branches',coalesce(p_profile->'branches','[]'::jsonb),'doctors',coalesce(p_profile->'doctors','[]'::jsonb));
    v_name := v_profile->>'name';
    IF coalesce(v_name,'') !~ '^[ء-ي]+( [ء-ي]+)+$' OR length(v_name)>150
      OR coalesce(length(v_profile->>'address'),0) NOT BETWEEN 5 AND 500
      OR jsonb_typeof(v_profile->'branches') IS DISTINCT FROM 'array' OR jsonb_typeof(v_profile->'doctors') IS DISTINCT FROM 'array' THEN
        RETURN jsonb_build_object('success',false,'message','الاسم العربي الثنائي وعنوان العيادة مطلوبان');
    END IF;
    IF jsonb_array_length(v_profile->'branches')>20 OR jsonb_array_length(v_profile->'doctors')>50 THEN RAISE EXCEPTION 'عدد الفروع أو الأطباء أكبر من المسموح'; END IF;
    IF p_intent='invited' THEN
        IF p_invitation_token IS NULL OR p_invitation_token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'الدعوة غير صالحة'; END IF;
        SELECT * INTO v_invite FROM public.doctor_portal_invitations WHERE token_hash=encode(digest(p_invitation_token,'sha256'),'hex') FOR UPDATE;
        IF v_invite.id IS NULL OR v_invite.consumed_at IS NOT NULL OR v_invite.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'الدعوة غير صالحة أو انتهت'; END IF;
        SELECT * INTO v_doc FROM public.doctors WHERE id=v_invite.doctor_id FOR UPDATE;
        IF EXISTS(SELECT 1 FROM public.users WHERE entity_id=v_doc.id) THEN RAISE EXCEPTION 'الحساب مفعل بالفعل؛ تواصل مع المعمل'; END IF;
        v_status := 'approved';
    ELSIF p_intent='new' THEN
        IF EXISTS(SELECT 1 FROM public.doctors d WHERE public._doctor_portal_phone_matches(d,v_phone)) THEN
            RETURN jsonb_build_object('success',false,'message','الرقم موجود لدينا؛ اختر سبق لي التعامل مع المعمل لربط السجل بدل تكراره.');
        END IF;
        v_doc := public._insert_doctor_profile(v_profile||jsonb_build_object('phone',v_phone));
        IF NOT coalesce((v_profile->>'is_center')::boolean,false) AND jsonb_array_length(v_profile->'doctors')>0 THEN RAISE EXCEPTION 'بيانات المركز غير صالحة'; END IF;
        FOR v_child IN SELECT value FROM jsonb_array_elements(v_profile->'doctors') LOOP
            PERFORM public._insert_doctor_profile(jsonb_build_object('name',v_child->>'name','phone',coalesce(v_child->>'phone',''),
                'address',v_doc.address,'parent_id',v_doc.id));
        END LOOP;
        v_status := 'approved';
    ELSE
        IF p_claimed_doctor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.doctors d WHERE id=p_claimed_doctor_id AND public._doctor_portal_phone_matches(d,v_phone)) THEN
            RETURN jsonb_build_object('success',false,'message','السجل المختار لا يطابق الرقم. ابحث مرة أخرى أو اطلب الربط يدويًا.');
        END IF;
        v_status := 'pending';
    END IF;
    -- Email auto-confirm means accepted for password login by current policy,
    -- NOT proof of mailbox ownership. Phone remains unconfirmed and is an alias.
    -- Store only the standard bcrypt hash, never the supplied password in profiles.
    INSERT INTO auth.users(id,instance_id,aud,role,email,phone,encrypted_password,email_confirmed_at,phone_confirmed_at,
        banned_until,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
    VALUES(v_auth_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_email,v_phone,crypt(p_password,gen_salt('bf',10)),
        clock_timestamp(),NULL,CASE WHEN v_status='pending' THEN '2100-01-01'::timestamptz END,
        '{"provider":"email","providers":["email","phone"],"doctor_verification":"unverified_password"}',
        jsonb_build_object('name',v_name),clock_timestamp(),clock_timestamp(),'','','','');
    INSERT INTO auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at) VALUES
      (v_auth_id::text,v_auth_id,jsonb_build_object('sub',v_auth_id::text,'email',v_email,'email_verified',false),'email',clock_timestamp(),clock_timestamp()),
      (v_auth_id::text,v_auth_id,jsonb_build_object('sub',v_auth_id::text,'phone',v_phone,'phone_verified',false),'phone',clock_timestamp(),clock_timestamp());
    INSERT INTO public.users(id,auth_id,username,email,role,name,entity_id,is_active)
    VALUES(gen_random_uuid(),v_auth_id,'doctor_'||replace(v_auth_id::text,'-',''),v_email,'doctor',coalesce(v_doc.name,v_name),v_doc.id,v_status='approved');
    INSERT INTO public.doctor_password_registrations(auth_id,phone,profile,intent,claimed_doctor_id,target_doctor_id,status,reviewed_by,reviewed_at)
    VALUES(v_auth_id,v_phone,v_profile,p_intent,CASE WHEN p_intent='existing' THEN p_claimed_doctor_id END,v_doc.id,v_status,
        CASE WHEN p_intent='invited' THEN v_invite.created_by END,CASE WHEN v_status='approved' THEN clock_timestamp() END);
    IF v_invite.id IS NOT NULL THEN UPDATE public.doctor_portal_invitations SET consumed_at=clock_timestamp() WHERE id=v_invite.id; END IF;
    RETURN jsonb_build_object('success',true,'status',v_status,'doctor_code',v_doc.doctor_code);
END;
$$;

-- Phone is a password-protected login alias, so no SMS provider is necessary.
-- Never expose a phone->email lookup before validating the password against the
-- current Auth hash; Supabase then performs its normal password/session exchange.
CREATE FUNCTION public.resolve_doctor_password_login(p_phone text,p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,extensions AS $$
DECLARE v_phone text := public.normalize_phone(p_phone); v_auth auth.users;
BEGIN
    IF v_phone IS NULL OR p_password IS NULL OR octet_length(p_password) NOT BETWEEN 1 AND 72 THEN
        RETURN jsonb_build_object('success',false,'message','بيانات الدخول غير صحيحة أو الحساب غير متاح');
    END IF;
    IF NOT public._doctor_portal_take_rate('phone-login',v_phone,10) OR NOT public._doctor_portal_take_rate('phone-login-global','all',1000) THEN
        RETURN jsonb_build_object('success',false,'message','تم تجاوز محاولات الدخول. حاول لاحقًا');
    END IF;
    SELECT * INTO v_auth FROM auth.users WHERE phone=v_phone;
    IF v_auth.id IS NULL OR v_auth.encrypted_password IS NULL OR v_auth.encrypted_password='' OR
       crypt(p_password,v_auth.encrypted_password) IS DISTINCT FROM v_auth.encrypted_password THEN
        RETURN jsonb_build_object('success',false,'message','بيانات الدخول غير صحيحة أو الحساب غير متاح');
    END IF;
    IF v_auth.banned_until>clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.users WHERE auth_id=v_auth.id AND role='doctor' AND is_active IS TRUE AND entity_id IS NOT NULL) THEN
        RETURN jsonb_build_object('success',false,'message','الحساب غير مفعل أو طلب الربط قيد مراجعة المعمل');
    END IF;
    RETURN jsonb_build_object('success',true,'email',v_auth.email);
END;
$$;

CREATE FUNCTION public.get_pending_doctor_password_registrations()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
    IF public.get_my_role() IS NULL OR public.get_my_role() NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'غير مصرح بمراجعة التسجيل'; END IF;
    RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'phone',r.phone,'normalized_phone',r.phone,
        'request_type','code_claim','status',r.status,'created_at',r.created_at,'password_registration',true,'profile',r.profile,'account_email',u.email,
        'target_doctor_name',d.name,'target_doctor_id',d.id,'matched_doctor_ids',CASE WHEN d.id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(d.id) END)
        ORDER BY r.created_at DESC) FROM public.doctor_password_registrations r LEFT JOIN public.doctors d ON d.id=r.claimed_doctor_id
        LEFT JOIN public.users u ON u.auth_id=r.auth_id
        WHERE r.status='pending'),'[]'::jsonb);
END;
$$;

CREATE FUNCTION public.review_doctor_password_registration(p_request_id uuid,p_approve boolean,p_doctor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_req public.doctor_password_registrations; v_doc public.doctors;
BEGIN
    IF public.get_my_role() IS NULL OR public.get_my_role() NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'غير مصرح بمراجعة التسجيل'; END IF;
    IF p_approve IS NULL THEN RAISE EXCEPTION 'قرار المراجعة مطلوب'; END IF;
    SELECT * INTO v_req FROM public.doctor_password_registrations WHERE id=p_request_id FOR UPDATE;
    IF v_req.id IS NULL OR v_req.status<>'pending' THEN RAISE EXCEPTION 'الطلب غير موجود أو تمت مراجعته'; END IF;
    IF p_approve THEN
        SELECT * INTO v_doc FROM public.doctors WHERE id=p_doctor_id FOR UPDATE;
        IF v_doc.id IS NULL THEN RAISE EXCEPTION 'اختر سجل الطبيب الصحيح بعد مراجعة الهوية'; END IF;
        IF EXISTS(SELECT 1 FROM public.users WHERE entity_id=v_doc.id AND auth_id<>v_req.auth_id) THEN RAISE EXCEPTION 'السجل مرتبط بحساب بالفعل؛ راجع إدارة المستخدمين'; END IF;
        UPDATE public.users SET entity_id=v_doc.id,name=v_doc.name,is_active=true WHERE auth_id=v_req.auth_id;
        UPDATE auth.users SET banned_until=NULL,updated_at=clock_timestamp() WHERE id=v_req.auth_id;
    END IF;
    UPDATE public.doctor_password_registrations SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        target_doctor_id=v_doc.id,reviewed_by=public.get_my_user_id(),reviewed_at=clock_timestamp() WHERE id=v_req.id;
    RETURN jsonb_build_object('success',true,'message',CASE WHEN p_approve THEN 'تم اعتماد الحساب؛ يدخل الطبيب بكلمة المرور التي اختارها' ELSE 'تم رفض الطلب' END);
END;
$$;

-- The existing Users UI already calls this RPC for password resets. Keep its
-- staff policy, enforce the doctor policy, and reject deactivated admins.
CREATE OR REPLACE FUNCTION public.admin_reset_password(target_user_id uuid,new_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,extensions AS $$
DECLARE v_auth_id uuid; v_role text;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'غير مصرح بإعادة تعيين كلمة المرور'; END IF;
    SELECT auth_id,role INTO v_auth_id,v_role FROM public.users WHERE id=target_user_id;
    IF v_auth_id IS NULL THEN RAISE EXCEPTION 'المستخدم لا يملك حساب دخول'; END IF;
    IF new_password IS NULL OR length(new_password)<(CASE WHEN v_role='doctor' THEN 12 ELSE 8 END) OR octet_length(new_password)>72 THEN
        RAISE EXCEPTION 'كلمة المرور للطبيب لا تقل عن 12 حرفًا، ولطاقم العمل 8، والحد الأقصى 72 بايت';
    END IF;
    UPDATE auth.users SET encrypted_password=crypt(new_password,gen_salt('bf',10)),updated_at=clock_timestamp() WHERE id=v_auth_id;
END;
$$;

-- Preserve the lab's Users screen when direct public Auth signup is disabled.
-- Orphan Auth accounts stay banned until an admin inserts their public profile.
CREATE FUNCTION public.admin_create_password_auth_user(p_email text,p_password text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,extensions AS $$
DECLARE v_id uuid := gen_random_uuid(); v_email text := lower(btrim(p_email));
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'غير مصرح بإضافة حساب'; END IF;
    IF v_email IS NULL OR length(v_email)>254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        OR p_password IS NULL OR length(p_password)<8 OR octet_length(p_password)>72 THEN RAISE EXCEPTION 'راجع الإيميل وكلمة المرور'; END IF;
    IF EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=v_email) THEN RAISE EXCEPTION 'User already registered'; END IF;
    INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,banned_until,raw_app_meta_data,
        raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
    VALUES(v_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_email,crypt(p_password,gen_salt('bf',10)),
        clock_timestamp(),'2100-01-01'::timestamptz,'{"provider":"email","providers":["email"]}','{}',clock_timestamp(),clock_timestamp(),'','','','');
    INSERT INTO auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
    VALUES(v_id::text,v_id,jsonb_build_object('sub',v_id::text,'email',v_email,'email_verified',false),'email',clock_timestamp(),clock_timestamp());
    RETURN v_id;
END;
$$;
CREATE FUNCTION public.admin_activate_password_auth_user(p_auth_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'غير مصرح بتفعيل حساب'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.users WHERE auth_id=p_auth_id AND is_active IS TRUE
        AND (role<>'doctor' OR entity_id IS NOT NULL)) THEN RAISE EXCEPTION 'أضف بيانات المستخدم واربط الطبيب أولًا'; END IF;
    IF EXISTS(SELECT 1 FROM public.doctor_password_registrations WHERE auth_id=p_auth_id AND status<>'approved') THEN
        RAISE EXCEPTION 'راجع واعتمد طلب ربط الطبيب أولًا';
    END IF;
    UPDATE auth.users SET banned_until=NULL,updated_at=clock_timestamp() WHERE id=p_auth_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_doctor_password_login(text,text),public.find_doctor_registration_matches(text),public.inspect_doctor_portal_invitation(text),
 public.register_doctor_password_account(text,text,text,jsonb,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_doctor_password_login(text,text),public.find_doctor_registration_matches(text),public.inspect_doctor_portal_invitation(text),
 public.register_doctor_password_account(text,text,text,jsonb,text,uuid,text) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.create_doctor_portal_invitation(uuid),public.get_pending_doctor_password_registrations(),
 public.review_doctor_password_registration(uuid,boolean,uuid),public.admin_create_password_auth_user(text,text),public.admin_activate_password_auth_user(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_doctor_portal_invitation(uuid),public.get_pending_doctor_password_registrations(),
 public.review_doctor_password_registration(uuid,boolean,uuid),public.admin_create_password_auth_user(text,text),public.admin_activate_password_auth_user(uuid) TO authenticated;
-- Retire the previous device-capability login from all browser clients. Existing
-- requests/records are preserved for audit; no password or financial row is reset.
REVOKE ALL ON FUNCTION public.submit_doctor_manual_access(text,text,text,text,jsonb),public.open_doctor_manual_access(uuid,text),
 public.review_doctor_manual_access(uuid,boolean,uuid) FROM PUBLIC,anon,authenticated;
