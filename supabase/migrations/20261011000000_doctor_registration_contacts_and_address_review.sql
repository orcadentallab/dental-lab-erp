-- Clinic contact details only. Financial records and existing codes are untouched.
ALTER TABLE public.doctors ADD COLUMN contact_phones jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE public.doctor_address_update_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id uuid NOT NULL UNIQUE REFERENCES public.doctor_password_registrations(id),
    doctor_id uuid REFERENCES public.doctors(id),
    previous_address text,
    requested_address text NOT NULL CHECK(length(requested_address) BETWEEN 5 AND 500),
    status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    reviewed_at timestamptz,
    reviewed_by uuid REFERENCES public.users(id)
);
ALTER TABLE public.doctor_address_update_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_address_update_requests FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public._normalize_clinic_contact_phone(p_phone text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE v_phone text := public.normalize_phone(p_phone); v_digits text;
BEGIN
    IF v_phone IS NOT NULL THEN RETURN v_phone; END IF;
    v_digits := regexp_replace(translate(coalesce(p_phone,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g');
    IF left(v_digits,2)='00' THEN v_digits := substr(v_digits,3); END IF;
    IF v_digits ~ '^0[2-9][0-9]{7,8}$' THEN RETURN '20'||substr(v_digits,2); END IF;
    IF v_digits ~ '^20[2-9][0-9]{7,8}$' THEN RETURN v_digits; END IF;
    RETURN NULL;
END;
$$;
CREATE FUNCTION public._clean_doctor_contact_phones(p_contacts jsonb,p_primary text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_result jsonb := '[]'; v_item jsonb; v_phone text; v_role text; v_name text; v_whatsapp boolean;
BEGIN
    IF jsonb_typeof(p_contacts) IS DISTINCT FROM 'array' OR jsonb_array_length(p_contacts) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'أضف من رقم إلى 10 أرقام للتواصل'; END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_contacts) LOOP
        v_phone := public._normalize_clinic_contact_phone(v_item->>'phone');
        v_role := coalesce(v_item->>'ownerRole','doctor');
        v_name := btrim(coalesce(v_item->>'ownerName',''));
        IF v_phone IS NULL THEN RAISE EXCEPTION 'راجع رقم التواصل'; END IF;
        IF v_role NOT IN ('doctor','secretary','whatsapp_only','other_doctor') THEN RAISE EXCEPTION 'اختر صاحب رقم التواصل'; END IF;
        IF v_role='other_doctor' THEN v_name := public.normalize_doctor_name(v_name); END IF;
        IF length(v_name)>150 OR (v_role='other_doctor' AND v_name !~ '^[ء-ي]+( [ء-ي]+)+$') THEN RAISE EXCEPTION 'اسم الطبيب الآخر يجب أن يكون عربيًا وثنائيًا على الأقل'; END IF;
        IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_result) c WHERE c->>'phone'=v_phone) THEN RAISE EXCEPTION 'رقم التواصل مكرر'; END IF;
        IF v_item ? 'hasWhatsapp' AND jsonb_typeof(v_item->'hasWhatsapp')<>'boolean' THEN RAISE EXCEPTION 'حدد وجود واتساب على الرقم'; END IF;
        v_whatsapp := v_role='whatsapp_only' OR coalesce((v_item->>'hasWhatsapp')::boolean,false);
        v_result := v_result||jsonb_build_array(jsonb_build_object('phone',v_phone,'ownerRole',v_role,'ownerName',v_name,'hasWhatsapp',v_whatsapp));
    END LOOP;
    IF p_primary IS NOT NULL AND v_result->0->>'phone' IS DISTINCT FROM public.normalize_phone(p_primary) THEN RAISE EXCEPTION 'رقم الدخول يجب أن يكون أول رقم للتواصل'; END IF;
    RETURN v_result;
END;
$$;
CREATE FUNCTION public._clean_doctor_registration_branches(p_branches jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_result jsonb := '[]'; v_item jsonb; v_contact jsonb; v_name text; v_address text;
BEGIN
    IF jsonb_typeof(p_branches) IS DISTINCT FROM 'array' OR jsonb_array_length(p_branches)>20 THEN RAISE EXCEPTION 'بيانات الفروع غير صالحة'; END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_branches) LOOP
        v_name := btrim(v_item->>'name'); v_address := btrim(v_item->>'address');
        IF coalesce(length(v_name),0) NOT BETWEEN 2 AND 150 OR coalesce(length(v_address),0) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'اسم وعنوان كل فرع مطلوبان'; END IF;
        v_contact := public._clean_doctor_contact_phones(jsonb_build_array(jsonb_build_object('phone',v_item->>'phone',
            'ownerRole',coalesce(v_item->>'phoneOwnerRole','doctor'),'ownerName',coalesce(v_item->>'phoneOwnerName',''),
            'hasWhatsapp',coalesce(v_item->'phoneHasWhatsapp','false'::jsonb))))->0;
        IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_result) b WHERE b->>'name'=v_name) THEN RAISE EXCEPTION 'اسم الفرع مكرر'; END IF;
        v_result := v_result||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name',v_name,'address',v_address,
            'phone',v_contact->>'phone','phoneOwnerRole',v_contact->>'ownerRole','phoneOwnerName',v_contact->>'ownerName','phoneHasWhatsapp',v_contact->'hasWhatsapp'));
    END LOOP;
    RETURN v_result;
END;
$$;

CREATE FUNCTION public._apply_doctor_registration_contacts(p_doctor_id uuid,p_profile jsonb,p_new boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_doc public.doctors; v_branches jsonb; v_contacts jsonb;
BEGIN
    SELECT * INTO v_doc FROM public.doctors WHERE id=p_doctor_id FOR UPDATE;
    IF v_doc.id IS NULL THEN RAISE EXCEPTION 'سجل الطبيب غير موجود'; END IF;
    v_branches := coalesce(p_profile->'branches','[]'::jsonb);
    IF NOT p_new THEN
        IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_branches) n JOIN jsonb_array_elements(coalesce(v_doc.branches,'[]'::jsonb)) b ON n->>'name'=b->>'name') THEN RAISE EXCEPTION 'يوجد فرع مسجل بنفس الاسم؛ راجع بيانات الفرع'; END IF;
        v_branches := coalesce(v_doc.branches,'[]'::jsonb)||v_branches;
    END IF;
    IF jsonb_array_length(v_branches)>20 THEN RAISE EXCEPTION 'الحد الأقصى 20 فرعًا'; END IF;
    -- Merge by normalized number. Never remove old phone/phone2 or old branches.
    SELECT coalesce(jsonb_agg(c),'[]'::jsonb) INTO v_contacts FROM jsonb_array_elements(v_doc.contact_phones) c
        WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_profile->'contact_phones') n WHERE n->>'phone'=c->>'phone');
    UPDATE public.doctors SET contact_phones=v_contacts||coalesce(p_profile->'contact_phones','[]'::jsonb),
        branches=v_branches,has_branches=jsonb_array_length(v_branches)>0 WHERE id=p_doctor_id;
END;
$$;

CREATE OR REPLACE FUNCTION public._doctor_portal_phone_matches(p_doctor public.doctors,p_phone text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT public.normalize_phone(p_doctor.phone)=p_phone OR public.normalize_phone(p_doctor.phone2)=p_phone
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_doctor.branches)='array' THEN p_doctor.branches ELSE '[]'::jsonb END) b WHERE public.normalize_phone(b->>'phone')=p_phone)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_doctor.contact_phones) c WHERE public.normalize_phone(c->>'phone')=p_phone);
$$;

CREATE FUNCTION public.review_doctor_address_update(p_request_id uuid,p_approve boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_req public.doctor_address_update_requests; v_address text;
BEGIN
    IF public.get_my_role() IS NULL OR public.get_my_role() NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'غير مصرح بمراجعة العنوان'; END IF;
    IF p_approve IS NULL THEN RAISE EXCEPTION 'قرار المراجعة مطلوب'; END IF;
    SELECT * INTO v_req FROM public.doctor_address_update_requests WHERE id=p_request_id FOR UPDATE;
    IF v_req.id IS NULL OR v_req.status<>'pending' OR NOT EXISTS(SELECT 1 FROM public.doctor_password_registrations WHERE id=v_req.registration_id AND status='approved' AND target_doctor_id=v_req.doctor_id) THEN RAISE EXCEPTION 'الطلب غير موجود أو الربط لم يعتمد بعد'; END IF;
    SELECT address INTO v_address FROM public.doctors WHERE id=v_req.doctor_id FOR UPDATE;
    IF p_approve THEN
        IF v_address IS DISTINCT FROM v_req.previous_address THEN RAISE EXCEPTION 'العنوان تغير منذ الطلب؛ راجعه قبل التعديل'; END IF;
        UPDATE public.doctors SET address=v_req.requested_address WHERE id=v_req.doctor_id;
    END IF;
    UPDATE public.doctor_address_update_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,reviewed_at=clock_timestamp(),reviewed_by=public.get_my_user_id() WHERE id=v_req.id;
    RETURN jsonb_build_object('success',true,'message',CASE WHEN p_approve THEN 'تم اعتماد العنوان' ELSE 'تم رفض تعديل العنوان' END);
END;
$$;

REVOKE ALL ON FUNCTION public._normalize_clinic_contact_phone(text),public._clean_doctor_contact_phones(jsonb,text),
 public._clean_doctor_registration_branches(jsonb),public._apply_doctor_registration_contacts(uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.review_doctor_address_update(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_doctor_address_update(uuid,boolean) TO authenticated;


CREATE OR REPLACE FUNCTION public.find_doctor_registration_matches(p_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_phone text := public.normalize_phone(p_phone);
BEGIN
    IF v_phone IS NULL THEN RETURN jsonb_build_object('success',false,'message','رقم الهاتف غير صالح'); END IF;
    IF NOT public._doctor_portal_take_rate('lookup',v_phone,10) OR NOT public._doctor_portal_take_rate('lookup-global','all',1000) THEN
        RETURN jsonb_build_object('success',false,'message','تم تجاوز عدد محاولات البحث. حاول لاحقًا أو تواصل مع المعمل.');
    END IF;
    -- Owner-approved clinic address/branch prefill. No cases, balances or pricing.
    RETURN jsonb_build_object('success',true,'matches',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'address',d.address,'code_region',d.code_region,'is_center',d.is_center,'branches',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b->>'id','name',b->>'name','address',b->>'address','phone',b->>'phone')) FROM jsonb_array_elements(coalesce(d.branches,'[]'::jsonb)) b),'[]'::jsonb)))
        FROM public.doctors d WHERE public._doctor_portal_phone_matches(d,v_phone)),'[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.inspect_doctor_portal_invitation(p_token text)
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
        'code_region',v_doc.code_region,'is_center',v_doc.is_center,'branches',coalesce(v_doc.branches,'[]'::jsonb));
END;
$$;

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

DROP FUNCTION public.review_doctor_password_registration(uuid,boolean,uuid);
CREATE OR REPLACE FUNCTION public.review_doctor_password_registration(p_request_id uuid,p_approve boolean,p_doctor_id uuid DEFAULT NULL,p_approve_address boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_req public.doctor_password_registrations; v_doc public.doctors; v_address_id uuid;
BEGIN
    IF public.get_my_role() IS NULL OR public.get_my_role() NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'غير مصرح بمراجعة التسجيل'; END IF;
    IF p_approve IS NULL THEN RAISE EXCEPTION 'قرار المراجعة مطلوب'; END IF;
    SELECT * INTO v_req FROM public.doctor_password_registrations WHERE id=p_request_id FOR UPDATE;
    IF v_req.id IS NULL OR v_req.status<>'pending' THEN RAISE EXCEPTION 'الطلب غير موجود أو تمت مراجعته'; END IF;
    IF p_approve THEN
        SELECT * INTO v_doc FROM public.doctors WHERE id=p_doctor_id FOR UPDATE;
        IF v_doc.id IS NULL THEN RAISE EXCEPTION 'اختر سجل الطبيب الصحيح بعد مراجعة الهوية'; END IF;
        IF EXISTS(SELECT 1 FROM public.users WHERE entity_id=v_doc.id AND auth_id<>v_req.auth_id) THEN RAISE EXCEPTION 'السجل مرتبط بحساب بالفعل؛ راجع إدارة المستخدمين'; END IF;
        PERFORM public._apply_doctor_registration_contacts(v_doc.id,v_req.profile,false);
        UPDATE public.users SET entity_id=v_doc.id,name=v_doc.name,is_active=true WHERE auth_id=v_req.auth_id;
        UPDATE auth.users SET banned_until=NULL,updated_at=clock_timestamp() WHERE id=v_req.auth_id;
    END IF;
    UPDATE public.doctor_password_registrations SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        target_doctor_id=v_doc.id,reviewed_by=public.get_my_user_id(),reviewed_at=clock_timestamp() WHERE id=v_req.id;
    IF p_approve THEN
        UPDATE public.doctor_address_update_requests SET doctor_id=v_doc.id,
            previous_address=CASE WHEN doctor_id IS DISTINCT FROM v_doc.id THEN v_doc.address ELSE previous_address END
            WHERE registration_id=v_req.id RETURNING id INTO v_address_id;
        IF coalesce(p_approve_address,false) AND v_address_id IS NOT NULL THEN PERFORM public.review_doctor_address_update(v_address_id,true); END IF;
    ELSE
        UPDATE public.doctor_address_update_requests SET status='rejected',reviewed_at=clock_timestamp(),reviewed_by=public.get_my_user_id() WHERE registration_id=v_req.id;
    END IF;
    RETURN jsonb_build_object('success',true,'message',CASE WHEN p_approve THEN 'تم اعتماد الحساب؛ يدخل الطبيب بكلمة المرور التي اختارها' ELSE 'تم رفض الطلب' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_doctor_password_registrations()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
    IF public.get_my_role() IS NULL OR public.get_my_role() NOT IN ('admin','coordinator') THEN RAISE EXCEPTION 'غير مصرح بمراجعة التسجيل'; END IF;
    RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'phone',r.phone,'normalized_phone',r.phone,
        'request_type','code_claim','status',r.status,'created_at',r.created_at,'password_registration',true,'profile',r.profile||CASE WHEN d.id IS NOT NULL THEN jsonb_build_object('address',d.address) ELSE '{}'::jsonb END,'account_email',u.email,
        'target_doctor_name',d.name,'target_doctor_id',d.id,'matched_doctor_ids',CASE WHEN d.id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(d.id) END)
        ORDER BY r.created_at DESC) FROM public.doctor_password_registrations r LEFT JOIN public.doctors d ON d.id=r.claimed_doctor_id
        LEFT JOIN public.users u ON u.auth_id=r.auth_id
        WHERE r.status='pending'),'[]'::jsonb) || coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id',a.id,'address_update',true,'request_type','code_claim','phone',r.phone,'created_at',a.created_at,'status',a.status,
        'target_doctor_id',d.id,'target_doctor_name',d.name,'matched_doctor_ids',jsonb_build_array(d.id),
        'profile',jsonb_build_object('name',d.name,'address',a.previous_address,'requested_address',a.requested_address,'address_change_requested',true)))
        FROM public.doctor_address_update_requests a JOIN public.doctor_password_registrations r ON r.id=a.registration_id
        JOIN public.doctors d ON d.id=a.doctor_id WHERE a.status='pending' AND r.status='approved'),'[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reset_password(target_user_id uuid,new_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,extensions AS $$
DECLARE v_auth_id uuid; v_role text;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'غير مصرح بإعادة تعيين كلمة المرور'; END IF;
    SELECT auth_id,role INTO v_auth_id,v_role FROM public.users WHERE id=target_user_id;
    IF v_auth_id IS NULL THEN RAISE EXCEPTION 'المستخدم لا يملك حساب دخول'; END IF;
    IF new_password IS NULL OR length(new_password)<8 OR octet_length(new_password)>72 THEN
        RAISE EXCEPTION 'كلمة المرور لا تقل عن 8 أحرف، والحد الأقصى 72 بايت';
    END IF;
    UPDATE auth.users SET encrypted_password=crypt(new_password,gen_salt('bf',10)),updated_at=clock_timestamp() WHERE id=v_auth_id;
END;
$$;

REVOKE ALL ON FUNCTION public.review_doctor_password_registration(uuid,boolean,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_doctor_password_registration(uuid,boolean,uuid,boolean) TO authenticated;
NOTIFY pgrst,'reload schema';
