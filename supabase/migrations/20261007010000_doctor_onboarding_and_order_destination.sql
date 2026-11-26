-- New-account creation is paused until the owner approves the doctor code policy.
-- Existing account linking and order destinations remain available.
CREATE OR REPLACE FUNCTION public.register_verified_doctor(
    p_phone text, p_claim_token text, p_profile jsonb
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object('success',false,'status','invalid_phone',
        'message','تسجيل الحسابات الجديدة غير متاح مؤقتًا. يرجى التواصل مع المعمل.');
$$;
REVOKE ALL ON FUNCTION public.register_verified_doctor(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_verified_doctor(text,text,jsonb) TO anon, authenticated;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_address text;
CREATE OR REPLACE FUNCTION public.create_my_order_request_with_destination(
    p_patient_name text, p_items jsonb, p_shade text, p_instructions text,
    p_stl_url text, p_images_url text, p_delivery_date date, p_total_price numeric,
    p_branch_id text, p_delivery_address text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_doctor public.doctors; v_order_id uuid; v_branch_name text;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'doctor' THEN RAISE EXCEPTION 'Only doctor can create an order request'; END IF;
    SELECT d.* INTO v_doctor FROM public.doctors d JOIN public.users u ON u.entity_id=d.id
    WHERE u.auth_id=auth.uid() AND u.is_active;
    IF v_doctor.id IS NULL OR coalesce(length(btrim(p_delivery_address)),0) NOT BETWEEN 5 AND 500 THEN
        RAISE EXCEPTION 'عنوان الشحن مطلوب';
    END IF;
    IF nullif(p_branch_id,'') IS NOT NULL THEN
        SELECT b->>'name' INTO v_branch_name FROM jsonb_array_elements(coalesce(v_doctor.branches,'[]')) b
        WHERE b->>'id'=p_branch_id;
        IF v_branch_name IS NULL THEN RAISE EXCEPTION 'الفرع لا يتبع حسابك'; END IF;
    END IF;
    IF jsonb_array_length(coalesce(p_items,'[]'))=0 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) i WHERE NOT EXISTS (SELECT 1 FROM public.services s WHERE s.name=i->>'serviceType')
    ) THEN RAISE EXCEPTION 'يرجى اختيار خدمة متاحة'; END IF;
    IF nullif(btrim(p_patient_name),'') IS NULL OR p_total_price IS NULL OR p_total_price < 0 THEN
        RAISE EXCEPTION 'Patient and a valid order total are required';
    END IF;
    -- Same Pending Review intake as v2, with destination in the initial insert.
    -- Doctor updates are deliberately forbidden by the existing field guard.
    INSERT INTO public.orders(case_id,doctor_id,patient_name,items,shade,instructions,stl_url,images_url,
        status,production_status,issue_state,technician_status,delivery_date,total_price,cost,discount,
        priority,comments,workflow_type,design_submitted_at,first_delivered_at,actual_delivery_date,branch_name,delivery_address)
    VALUES('REQ-'||to_char(timezone('Africa/Cairo',now()),'YYMMDDHH24MISS')||'-'||substr(gen_random_uuid()::text,1,4),
        v_doctor.id,btrim(p_patient_name),p_items,coalesce(p_shade,''),nullif(btrim(p_instructions),''),
        nullif(btrim(p_stl_url),''),nullif(btrim(p_images_url),''),'Pending Review','not_started','none','Pending',
        p_delivery_date,p_total_price,0,0,'Normal','[]'::jsonb,'full',NULL,NULL,NULL,v_branch_name,btrim(p_delivery_address))
    RETURNING id INTO v_order_id;
    RETURN v_order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_my_order_request_with_destination(text,jsonb,text,text,text,text,date,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_order_request_with_destination(text,jsonb,text,text,text,text,date,numeric,text,text) TO authenticated;
