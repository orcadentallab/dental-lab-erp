-- Do not duplicate an existing doctor or silently reparent a financial entity.
-- Existing center membership is reviewed in the ERP, then invitation links Auth.
CREATE OR REPLACE FUNCTION public.register_doctor_password_account(p_phone text,p_email text,p_password text,p_profile jsonb,
    p_intent text,p_claimed_doctor_id uuid DEFAULT NULL,p_invitation_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,extensions AS $$
DECLARE v_phone text := public.normalize_phone(p_phone); v_email text := lower(btrim(p_email));
    v_auth_id uuid := gen_random_uuid(); v_doc public.doctors; v_invite public.doctor_portal_invitations;
    v_profile jsonb; v_child_doc public.doctors; v_child jsonb; v_status text; v_name text; v_registration_id uuid; v_baseline text;
BEGIN
    IF v_phone IS NULL OR v_email IS NULL OR length(v_email)>254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
        RETURN jsonb_build_object('success',false,'message','راجع رقم الموبايل والإيميل');
    END IF;
    IF p_password IS NULL OR length(p_password)<8 OR octet_length(p_password)>72 THEN
        RETURN jsonb_build_object('success',false,'message','كلمة المرور لا تقل عن 8 أحرف ولا تتجاوز 72 بايت');
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
        'branches',public._clean_doctor_registration_branches(coalesce(p_profile->'branches','[]'::jsonb)),'doctors',coalesce(p_profile->'doctors','[]'::jsonb),
        'contact_phones',public._clean_doctor_contact_phones(coalesce(nullif(p_profile->'contact_phones','null'::jsonb),jsonb_build_array(jsonb_build_object('phone',v_phone))),v_phone),
        'address_change_requested',coalesce(p_profile->'address_change_requested','false'::jsonb),'requested_address',btrim(coalesce(p_profile->>'requested_address','')));
    v_name := v_profile->>'name';
    IF coalesce(v_name,'') !~ '^[ء-ي]+( [ء-ي]+)+$' OR length(v_name)>150
      OR (p_intent='new' AND coalesce(length(v_profile->>'address'),0) NOT BETWEEN 5 AND 500)
      OR jsonb_typeof(v_profile->'branches') IS DISTINCT FROM 'array' OR jsonb_typeof(v_profile->'doctors') IS DISTINCT FROM 'array' THEN
        RETURN jsonb_build_object('success',false,'message','الاسم العربي الثنائي وعنوان العيادة مطلوبان');
    END IF;
    IF jsonb_typeof(v_profile->'address_change_requested')<>'boolean' THEN RAISE EXCEPTION 'بيانات تعديل العنوان غير صالحة'; END IF;
    IF (v_profile->>'address_change_requested')::boolean AND (p_intent='new' OR length(v_profile->>'requested_address') NOT BETWEEN 5 AND 500) THEN RAISE EXCEPTION 'اكتب العنوان المطلوب كاملًا'; END IF;
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
            IF nullif(btrim(v_child->>'phone'),'') IS NOT NULL AND EXISTS(SELECT 1 FROM public.doctors d WHERE public._doctor_portal_phone_matches(d,public.normalize_phone(v_child->>'phone'))) THEN
                RAISE EXCEPTION 'رقم طبيب المركز له سجل بالفعل؛ اطلب من المعمل ربط السجل القديم';
            END IF;
            SELECT child.* INTO v_child_doc FROM public._insert_doctor_profile(jsonb_build_object('name',v_child->>'name','phone',coalesce(v_child->>'phone',''),
                'address',v_doc.address,'parent_id',v_doc.id)) child;
            IF coalesce(v_child_doc.phone,'')<>'' THEN
                UPDATE public.doctors SET contact_phones=public._clean_doctor_contact_phones(jsonb_build_array(jsonb_build_object('phone',v_child_doc.phone,'ownerRole','doctor','ownerName',v_child_doc.name,'hasWhatsapp',coalesce(v_child->'phoneHasWhatsapp','false'::jsonb)))) WHERE id=v_child_doc.id;
            END IF;
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
        CASE WHEN p_intent='invited' THEN v_invite.created_by END,CASE WHEN v_status='approved' THEN clock_timestamp() END) RETURNING id INTO v_registration_id;
    IF v_status='approved' THEN PERFORM public._apply_doctor_registration_contacts(v_doc.id,v_profile,p_intent='new'); END IF;
    IF (v_profile->>'address_change_requested')::boolean THEN
        SELECT address INTO v_baseline FROM public.doctors WHERE id=coalesce(v_doc.id,p_claimed_doctor_id);
        INSERT INTO public.doctor_address_update_requests(registration_id,doctor_id,previous_address,requested_address)
        VALUES(v_registration_id,coalesce(v_doc.id,p_claimed_doctor_id),v_baseline,v_profile->>'requested_address');
    END IF;
    IF v_invite.id IS NOT NULL THEN UPDATE public.doctor_portal_invitations SET consumed_at=clock_timestamp() WHERE id=v_invite.id; END IF;
    RETURN jsonb_build_object('success',true,'status',v_status,'doctor_code',v_doc.doctor_code);
END;
$$;
