-- Owner-approved clinic region codes. Existing doctor codes/names and financial rows are untouched.
ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS code_region text;
CREATE TABLE IF NOT EXISTS public.doctor_code_counters (
    region text PRIMARY KEY CHECK (region IN ('cairo','east_cairo','west_giza','damietta','other')),
    last_number integer NOT NULL
);
ALTER TABLE public.doctor_code_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_code_counters FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.normalize_doctor_name(p_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE v_name text := btrim(regexp_replace(coalesce(p_name,''),'[ً-ٰٟـ]','','g')); v_previous text;
BEGIN
    LOOP
        v_previous := v_name;
        v_name := btrim(regexp_replace(v_name,'^((الدكتور|الدكتورة|الدكتوره|دكتور|دكتورة|دكتوره)[[:space:]]+|د[[:space:]]*[./][[:space:]]*|د[[:space:]]+)',''));
        EXIT WHEN v_name=v_previous;
    END LOOP;
    RETURN regexp_replace(v_name,'[[:space:]]+',' ','g');
END;
$$;

CREATE OR REPLACE FUNCTION public._allocate_doctor_region_code(p_region text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_base integer; v_floor integer; v_last integer; v_existing integer;
BEGIN
    v_base := CASE p_region WHEN 'cairo' THEN 1000 WHEN 'east_cairo' THEN 2000 WHEN 'west_giza' THEN 3000 WHEN 'damietta' THEN 5000 WHEN 'other' THEN 6000 END;
    IF v_base IS NULL THEN RAISE EXCEPTION 'يرجى اختيار منطقة العيادة'; END IF;
    -- Latest numbers explicitly provided by the owner; higher existing codes take precedence.
    v_floor := CASE p_region WHEN 'cairo' THEN 1061 WHEN 'east_cairo' THEN 2030 ELSE v_base END;
    INSERT INTO public.doctor_code_counters(region,last_number) VALUES(p_region,v_floor) ON CONFLICT DO NOTHING;
    SELECT last_number INTO v_last FROM public.doctor_code_counters WHERE region=p_region FOR UPDATE;
    SELECT max(CASE WHEN doctor_code ~ '^[12356][0-9]{3}$' AND left(doctor_code,1)=(v_base/1000)::text THEN doctor_code::integer END) INTO v_existing FROM public.doctors;
    v_last := greatest(v_last,v_floor,coalesce(v_existing,v_base))+1;
    IF v_last > v_base+999 THEN RAISE EXCEPTION 'نطاق أكواد المنطقة اكتمل؛ يرجى مراجعة الإدارة'; END IF;
    UPDATE public.doctor_code_counters SET last_number=v_last WHERE region=p_region;
    RETURN v_last::text;
END;
$$;
REVOKE ALL ON FUNCTION public._allocate_doctor_region_code(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._insert_doctor_profile(p_profile jsonb)
RETURNS public.doctors LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_name text := public.normalize_doctor_name(p_profile->>'name'); v_phone text; v_parent public.doctors;
    v_region text := p_profile->>'code_region'; v_code text; v_result public.doctors;
    v_branches jsonb := coalesce(nullif(p_profile->'branches','null'::jsonb),'[]'::jsonb); v_branch jsonb;
    v_clean jsonb := '[]'::jsonb; v_suffix integer;
BEGIN
    IF length(v_name)>150 OR v_name !~ '^[ء-ي]+( [ء-ي]+)+$' THEN RAISE EXCEPTION 'اسم الطبيب يجب أن يكون عربيًا وثنائيًا على الأقل'; END IF;
    IF coalesce(length(btrim(p_profile->>'address')),0) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'عنوان العيادة مطلوب'; END IF;
    IF jsonb_typeof(v_branches)<>'array' OR jsonb_array_length(v_branches)>20 THEN RAISE EXCEPTION 'بيانات الفروع غير صالحة'; END IF;
    FOR v_branch IN SELECT value FROM jsonb_array_elements(v_branches) LOOP
        IF coalesce(length(btrim(v_branch->>'name')),0) NOT BETWEEN 2 AND 150 OR coalesce(length(btrim(v_branch->>'address')),0) NOT BETWEEN 5 AND 500 THEN
            RAISE EXCEPTION 'اسم وعنوان كل فرع مطلوبان';
        END IF;
        v_clean := v_clean || jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name',btrim(v_branch->>'name'),
            'address',btrim(v_branch->>'address'),'phone',coalesce(v_branch->>'phone','')));
    END LOOP;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_clean) b GROUP BY b->>'name' HAVING count(*)>1) THEN RAISE EXCEPTION 'أسماء الفروع يجب أن تكون مختلفة'; END IF;
    v_phone := public.normalize_phone(p_profile->>'phone');
    IF nullif(p_profile->>'parent_id','') IS NOT NULL THEN
        SELECT * INTO v_parent FROM public.doctors WHERE id=(p_profile->>'parent_id')::uuid FOR UPDATE;
        IF v_parent.id IS NULL OR NOT coalesce(v_parent.is_center,false) THEN RAISE EXCEPTION 'المركز غير صالح'; END IF;
        IF nullif(btrim(p_profile->>'phone'),'') IS NOT NULL AND v_phone IS NULL THEN RAISE EXCEPTION 'رقم الهاتف غير صالح'; END IF;
        -- Owner-approved sequential suffix; lock the center row and continue beyond existing suffixes.
        SELECT coalesce(max(CASE WHEN left(doctor_code,length(v_parent.doctor_code)+1)=v_parent.doctor_code||'-'
            AND substr(doctor_code,length(v_parent.doctor_code)+2) ~ '^[0-9]{1,3}$'
            THEN substr(doctor_code,length(v_parent.doctor_code)+2)::integer END),0)+1 INTO v_suffix FROM public.doctors;
        IF v_suffix>999 THEN RAISE EXCEPTION 'نطاق أكواد الأطباء التابعين للمركز اكتمل'; END IF;
        v_code := v_parent.doctor_code||'-'||lpad(v_suffix::text,3,'0');
        v_region := v_parent.code_region;
    ELSE
        IF v_phone IS NULL THEN RAISE EXCEPTION 'رقم الهاتف غير صالح'; END IF;
        v_code := public._allocate_doctor_region_code(v_region);
    END IF;
    INSERT INTO public.doctors(name,phone,phone2,address,doctor_code,representative_name,representative_id,is_center,parent_id,
        has_branches,branches,custom_prices,lab_instructions,code_region)
    VALUES(v_name,coalesce(v_phone,''),nullif(p_profile->>'phone2',''),btrim(p_profile->>'address'),v_code,
        coalesce(p_profile->>'representative_name',''),nullif(p_profile->>'representative_id','')::uuid,
        coalesce((p_profile->>'is_center')::boolean,false),v_parent.id,jsonb_array_length(v_clean)>0,v_clean,
        coalesce(p_profile->'custom_prices','{}'::jsonb),nullif(p_profile->>'lab_instructions',''),v_region)
    RETURNING * INTO v_result;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public._insert_doctor_profile(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_doctor_with_region_code(p_profile jsonb)
RETURNS public.doctors LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
    IF public.get_my_role() IS NULL OR public.get_my_role() NOT IN ('admin','coordinator','representative') THEN RAISE EXCEPTION 'غير مصرح بإضافة طبيب'; END IF;
    RETURN public._insert_doctor_profile(p_profile);
END;
$$;
REVOKE ALL ON FUNCTION public.create_doctor_with_region_code(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_doctor_with_region_code(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_verified_doctor(p_phone text,p_claim_token text,p_profile jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,extensions AS $$
DECLARE v_norm text := public.normalize_phone(p_phone); v_verification uuid; v_doc public.doctors;
    v_child jsonb; v_children jsonb := coalesce(p_profile->'doctors','[]'::jsonb);
    v_auth_id uuid := gen_random_uuid(); v_email text; v_password text := encode(gen_random_bytes(24),'hex');
BEGIN
    IF current_setting('app.doctor_otp_mock_enabled',true) IS DISTINCT FROM 'on' THEN
        RETURN jsonb_build_object('success',false,'status','invalid_phone','message','تسجيل الهاتف غير متاح حالياً.');
    END IF;
    IF v_norm IS NULL THEN RAISE EXCEPTION 'رقم الهاتف غير صالح'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_norm,0));
    SELECT id INTO v_verification FROM public.phone_verifications WHERE normalized_phone=v_norm
      AND verified_at>clock_timestamp()-interval '30 minutes' AND claim_token_hash=encode(digest(p_claim_token,'sha256'),'hex')
    ORDER BY verified_at DESC LIMIT 1 FOR UPDATE;
    IF v_verification IS NULL THEN RETURN jsonb_build_object('success',false,'status','invalid_phone','message','يرجى التحقق من الهاتف قبل التسجيل.'); END IF;
    IF EXISTS(SELECT 1 FROM public.doctors WHERE public.normalize_phone(phone)=v_norm OR public.normalize_phone(phone2)=v_norm)
       OR EXISTS(SELECT 1 FROM public.doctor_link_requests WHERE normalized_phone=v_norm AND status IN ('pending','approved')) THEN
        RETURN jsonb_build_object('success',false,'status','pending_approval','message','الرقم مرتبط بسجل أو طلب سابق. استخدم مسار ربط الحساب.');
    END IF;
    IF jsonb_typeof(v_children)<>'array' OR jsonb_array_length(v_children)>50 OR
        (NOT coalesce((p_profile->>'is_center')::boolean,false) AND jsonb_array_length(v_children)>0) THEN RAISE EXCEPTION 'بيانات المركز غير صالحة'; END IF;
    v_doc := public._insert_doctor_profile((p_profile - 'parent_id' - 'doctor_code' - 'representative_id' - 'custom_prices') || jsonb_build_object('phone',v_norm));
    FOR v_child IN SELECT value FROM jsonb_array_elements(v_children) LOOP
        PERFORM public._insert_doctor_profile(jsonb_build_object('name',v_child->>'name','phone',coalesce(v_child->>'phone',''),
            'address',v_doc.address,'parent_id',v_doc.id));
    END LOOP;
    v_email := 'doc_'||replace(v_doc.id::text,'-','')||'@orcadentallab.internal';
    INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
        created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
    VALUES(v_auth_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_email,crypt(v_password,gen_salt('bf')),
        clock_timestamp(),'{"provider":"email","providers":["email"]}',jsonb_build_object('name',v_doc.name),clock_timestamp(),clock_timestamp(),'','','','');
    INSERT INTO auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
    VALUES(v_auth_id::text,v_auth_id,jsonb_build_object('sub',v_auth_id::text,'email',v_email,'email_verified',true),'email',clock_timestamp(),clock_timestamp());
    INSERT INTO public.users(id,auth_id,username,role,name,entity_id,is_active) VALUES(gen_random_uuid(),v_auth_id,'doc_'||v_doc.doctor_code,'doctor',v_doc.name,v_doc.id,true);
    INSERT INTO public.doctor_link_requests(phone,normalized_phone,target_doctor_id,request_type,status,reviewed_at)
    VALUES(v_norm,v_norm,v_doc.id,'new_doctor','approved',clock_timestamp());
    UPDATE public.phone_verifications SET claim_token_hash=NULL WHERE id=v_verification;
    RETURN jsonb_build_object('success',true,'status','auto_linked','doctor_id',v_doc.id,'doctor_name',v_doc.name,'doctor_code',v_doc.doctor_code,
        'email',v_email,'session_token',v_password,'message','تم تسجيل حسابك بنجاح.');
END;
$$;
REVOKE ALL ON FUNCTION public.register_verified_doctor(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_verified_doctor(text,text,jsonb) TO anon,authenticated;
