-- Temporary, owner-approved onboarding without phone OTP. A phone is a claim,
-- never a login credential. Only a reviewed request's random device secret
-- can open its independently provisioned account. No existing account is reset.
CREATE TABLE public.doctor_manual_access_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone text NOT NULL,
    token_hash text NOT NULL,
    intent text NOT NULL CHECK (intent IN ('existing','new')),
    claimed_doctor_code text,
    profile jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    target_doctor_id uuid REFERENCES public.doctors(id),
    auth_id uuid REFERENCES auth.users(id),
    reviewed_by uuid REFERENCES public.users(id),
    reviewed_at timestamptz,
    last_session_issued_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX doctor_manual_access_phone_created ON public.doctor_manual_access_requests(phone,created_at);
CREATE INDEX doctor_manual_access_created ON public.doctor_manual_access_requests(created_at);
ALTER TABLE public.doctor_manual_access_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_manual_access_requests FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.submit_doctor_manual_access(p_phone text,p_token text,p_intent text,p_code text DEFAULT NULL,p_profile jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_phone text := public.normalize_phone(p_phone); v_id uuid; v_profile jsonb;
BEGIN
    IF v_phone IS NULL OR p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' OR p_intent IS NULL OR p_intent NOT IN ('existing','new') THEN
        RAISE EXCEPTION 'بيانات طلب التسجيل غير صالحة';
    END IF;
    IF p_profile IS NULL OR jsonb_typeof(p_profile)<>'object' OR octet_length(p_profile::text)>30000 OR length(coalesce(p_code,''))>50 THEN
        RAISE EXCEPTION 'بيانات طلب التسجيل غير صالحة';
    END IF;
    -- Ignore every caller-supplied identity, code, representative and price field.
    v_profile := jsonb_build_object('name',public.normalize_doctor_name(p_profile->>'name'),'address',p_profile->>'address',
        'code_region',p_profile->>'code_region','is_center',coalesce(p_profile->'is_center','false'::jsonb),
        'branches',coalesce(p_profile->'branches','[]'::jsonb),'doctors',coalesce(p_profile->'doctors','[]'::jsonb));
    IF p_intent='new' THEN
        IF coalesce(v_profile->>'name','') !~ '^[ء-ي]+( [ء-ي]+)+$' OR length(v_profile->>'name')>150
            OR coalesce(length(btrim(v_profile->>'address')),0) NOT BETWEEN 5 AND 500
            OR coalesce(v_profile->>'code_region','') NOT IN ('cairo','east_cairo','west_giza','damietta','other')
            OR jsonb_typeof(v_profile->'branches') IS DISTINCT FROM 'array' OR jsonb_typeof(v_profile->'doctors') IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'راجع الاسم العربي الثنائي والعنوان ومنطقة العيادة';
        END IF;
        IF jsonb_array_length(v_profile->'branches')>20 OR jsonb_array_length(v_profile->'doctors')>50 THEN RAISE EXCEPTION 'عدد الفروع أو الأطباء أكبر من المسموح'; END IF;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('manual-access-submissions',0));
    SELECT id INTO v_id FROM public.doctor_manual_access_requests
      WHERE phone=v_phone AND token_hash=encode(digest(p_token,'sha256'),'hex') AND status='pending';
    IF v_id IS NOT NULL THEN RETURN jsonb_build_object('success',true,'request_id',v_id,'status','pending'); END IF;
    IF (SELECT count(*) FROM public.doctor_manual_access_requests WHERE phone=v_phone AND created_at>clock_timestamp()-interval '1 hour')>=3
       OR (SELECT count(*) FROM public.doctor_manual_access_requests WHERE created_at>clock_timestamp()-interval '1 hour')>=200 THEN
        RETURN jsonb_build_object('success',false,'message','تم تجاوز عدد الطلبات المسموح. حاول لاحقًا أو تواصل مع المعمل.');
    END IF;
    INSERT INTO public.doctor_manual_access_requests(phone,token_hash,intent,claimed_doctor_code,profile)
    VALUES(v_phone,encode(digest(p_token,'sha256'),'hex'),p_intent,nullif(btrim(p_code),''),v_profile) RETURNING id INTO v_id;
    RETURN jsonb_build_object('success',true,'request_id',v_id,'status','pending');
END;
$$;

CREATE FUNCTION public.get_pending_doctor_manual_access()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
    IF public.get_my_role() IS NULL OR public.get_my_role() NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'غير مصرح بمراجعة التسجيل'; END IF;
    RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'phone',phone,'normalized_phone',phone,
        'claimed_doctor_code',claimed_doctor_code,'request_type',CASE WHEN intent='new' THEN 'new_doctor' ELSE 'code_claim' END,
        'status',status,'created_at',created_at,'matched_doctor_ids','[]'::jsonb,'manual_access',true,'profile',profile)
        ORDER BY created_at DESC) FROM public.doctor_manual_access_requests WHERE status='pending'),'[]'::jsonb);
END;
$$;

CREATE FUNCTION public.review_doctor_manual_access(p_request_id uuid,p_approve boolean,p_doctor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_req public.doctor_manual_access_requests; v_doc public.doctors; v_child jsonb; v_children jsonb;
BEGIN
    IF public.get_my_role() IS NULL OR public.get_my_role() NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'غير مصرح بمراجعة التسجيل'; END IF;
    IF p_approve IS NULL THEN RAISE EXCEPTION 'قرار المراجعة مطلوب'; END IF;
    SELECT * INTO v_req FROM public.doctor_manual_access_requests WHERE id=p_request_id FOR UPDATE;
    IF v_req.id IS NULL OR v_req.status<>'pending' THEN RAISE EXCEPTION 'الطلب غير موجود أو تمت مراجعته'; END IF;
    IF p_approve THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(v_req.phone,0));
        IF p_doctor_id IS NOT NULL THEN
            SELECT * INTO v_doc FROM public.doctors WHERE id=p_doctor_id FOR UPDATE;
            IF v_doc.id IS NULL THEN RAISE EXCEPTION 'اختر سجل طبيب صحيح'; END IF;
        ELSIF v_req.intent='new' THEN
            IF EXISTS (SELECT 1 FROM public.doctors WHERE public.normalize_phone(phone)=v_req.phone OR public.normalize_phone(phone2)=v_req.phone) THEN
                RAISE EXCEPTION 'الرقم موجود بالفعل؛ اختر السجل الصحيح للربط بعد مراجعة الهوية';
            END IF;
            v_doc := public._insert_doctor_profile(v_req.profile || jsonb_build_object('phone',v_req.phone));
            v_children := v_req.profile->'doctors';
            IF NOT coalesce((v_req.profile->>'is_center')::boolean,false) AND jsonb_array_length(v_children)>0 THEN RAISE EXCEPTION 'أطباء المركز يحتاجون تسجيل مركز'; END IF;
            FOR v_child IN SELECT value FROM jsonb_array_elements(v_children) LOOP
                PERFORM public._insert_doctor_profile(jsonb_build_object('name',v_child->>'name','phone',coalesce(v_child->>'phone',''),
                    'address',v_doc.address,'parent_id',v_doc.id));
            END LOOP;
        ELSE RAISE EXCEPTION 'اختر سجل الطبيب بعد مراجعة الهوية';
        END IF;
        IF EXISTS (SELECT 1 FROM public.users WHERE entity_id=v_doc.id AND (role<>'doctor' OR is_active IS FALSE)) THEN
            RAISE EXCEPTION 'الحساب غير متاح؛ راجع إدارة المستخدمين';
        END IF;
    END IF;
    UPDATE public.doctor_manual_access_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        target_doctor_id=v_doc.id,reviewed_by=public.get_my_user_id(),reviewed_at=clock_timestamp() WHERE id=p_request_id;
    RETURN jsonb_build_object('success',true,'message',CASE WHEN p_approve THEN 'تم اعتماد الطلب' ELSE 'تم رفض الطلب' END);
END;
$$;

-- The browser holds a 256-bit device capability, not a verified phone identity.
-- Pending/rejected requests never receive an Auth identity or doctor data.
CREATE FUNCTION public.open_doctor_manual_access(p_request_id uuid,p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,extensions AS $$
DECLARE v_req public.doctor_manual_access_requests; v_auth_id uuid; v_email text; v_password text; v_doc public.doctors;
BEGIN
    IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('success',false,'message','طلب غير صالح'); END IF;
    SELECT * INTO v_req FROM public.doctor_manual_access_requests WHERE id=p_request_id
        AND token_hash=encode(digest(p_token,'sha256'),'hex') FOR UPDATE;
    IF v_req.id IS NULL THEN RETURN jsonb_build_object('success',false,'message','طلب غير صالح'); END IF;
    IF v_req.status<>'approved' THEN RETURN jsonb_build_object('success',true,'status',v_req.status); END IF;
    SELECT * INTO v_doc FROM public.doctors WHERE id=v_req.target_doctor_id;
    IF v_doc.id IS NULL THEN RETURN jsonb_build_object('success',false,'message','الحساب غير متاح'); END IF;
    IF v_req.auth_id IS NULL AND EXISTS(SELECT 1 FROM public.users WHERE entity_id=v_doc.id AND (role<>'doctor' OR is_active IS FALSE)) THEN
        RETURN jsonb_build_object('success',false,'message','الحساب غير متاح؛ تواصل مع المعمل');
    END IF;
    IF v_req.auth_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.users WHERE auth_id=v_req.auth_id
        AND role='doctor' AND entity_id=v_doc.id AND is_active IS TRUE) THEN
        RETURN jsonb_build_object('success',false,'message','الحساب غير متاح؛ تواصل مع المعمل');
    END IF;
    IF v_req.last_session_issued_at>clock_timestamp()-interval '10 seconds' THEN
        RETURN jsonb_build_object('success',false,'message','انتظر ثواني قليلة ثم حاول مرة أخرى.');
    END IF;
    v_password := encode(gen_random_bytes(32),'hex');
    v_email := 'manual_'||replace(v_req.id::text,'-','')||'@orcadentallab.internal';
    IF v_req.auth_id IS NULL THEN
        v_auth_id := gen_random_uuid();
        INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
            created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
        VALUES(v_auth_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_email,crypt(v_password,gen_salt('bf')),
            clock_timestamp(),'{"provider":"email","providers":["email"]}',jsonb_build_object('name',v_doc.name),clock_timestamp(),clock_timestamp(),'','','','');
        INSERT INTO auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
        VALUES(v_auth_id::text,v_auth_id,jsonb_build_object('sub',v_auth_id::text,'email',v_email,'email_verified',true),'email',clock_timestamp(),clock_timestamp());
        INSERT INTO public.users(id,auth_id,username,role,name,entity_id,is_active)
        VALUES(gen_random_uuid(),v_auth_id,'manual_'||replace(v_req.id::text,'-',''),'doctor',v_doc.name,v_doc.id,true);
        UPDATE public.doctor_manual_access_requests SET auth_id=v_auth_id WHERE id=v_req.id;
    ELSE
        UPDATE auth.users SET encrypted_password=crypt(v_password,gen_salt('bf')),updated_at=clock_timestamp() WHERE id=v_req.auth_id;
    END IF;
    UPDATE public.doctor_manual_access_requests SET last_session_issued_at=clock_timestamp() WHERE id=v_req.id;
    RETURN jsonb_build_object('success',true,'status','approved','email',v_email,'session_token',v_password);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_doctor_manual_access(text,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_doctor_manual_access(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pending_doctor_manual_access() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.review_doctor_manual_access(uuid,boolean,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_doctor_manual_access(text,text,text,text,jsonb),public.open_doctor_manual_access(uuid,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_doctor_manual_access(),public.review_doctor_manual_access(uuid,boolean,uuid) TO authenticated;
