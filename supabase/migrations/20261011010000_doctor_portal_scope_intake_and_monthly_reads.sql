ALTER TABLE public.orders ADD COLUMN delivery_contact_phone text;
-- Read projections, center invitations, intake coordination and private files.
-- No financial backfill, balance update, allocation or production-state change.
CREATE FUNCTION public.doctor_portal_scope()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT d.id FROM public.users u JOIN public.doctors own ON own.id=u.entity_id
 JOIN public.doctors d ON d.id=own.id OR (own.is_center IS TRUE AND own.parent_id IS NULL AND d.parent_id=own.id)
 WHERE u.auth_id=auth.uid() AND u.is_active IS TRUE AND u.role='doctor';
$$;
CREATE FUNCTION public.doctor_portal_can_access_order(p_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.orders WHERE id=p_order_id AND doctor_id IN(SELECT public.doctor_portal_scope()) AND NOT coalesce(is_deleted,false));
$$;
REVOKE ALL ON FUNCTION public.doctor_portal_scope(),public.doctor_portal_can_access_order(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.doctor_portal_scope(),public.doctor_portal_can_access_order(uuid) TO authenticated;

-- A permissive legacy policy must not reopen raw financial/workflow rows.
CREATE POLICY doctor_portal_orders_projection_only ON public.orders AS RESTRICTIVE FOR SELECT TO authenticated USING(public.get_my_role() IS DISTINCT FROM 'doctor');
CREATE POLICY doctor_portal_transactions_projection_only ON public.transactions AS RESTRICTIVE FOR SELECT TO authenticated USING(public.get_my_role() IS DISTINCT FROM 'doctor');
CREATE POLICY doctor_portal_adjustments_projection_only ON public.adjustments AS RESTRICTIVE FOR SELECT TO authenticated USING(public.get_my_role() IS DISTINCT FROM 'doctor');
CREATE POLICY doctor_portal_obligations_projection_only ON public.financial_obligations AS RESTRICTIVE FOR SELECT TO authenticated USING(public.get_my_role() IS DISTINCT FROM 'doctor');
CREATE POLICY doctor_portal_allocations_projection_only ON public.payment_allocations AS RESTRICTIVE FOR SELECT TO authenticated USING(public.get_my_role() IS DISTINCT FROM 'doctor');
CREATE POLICY doctor_portal_items_projection_only ON public.order_items AS RESTRICTIVE FOR SELECT TO authenticated USING(public.get_my_role() IS DISTINCT FROM 'doctor');

CREATE OR REPLACE FUNCTION public.get_my_doctor_orders_v2()
RETURNS TABLE(id uuid,case_id text,patient_name text,delivery_date date,production_status text,issue_state text,total_price numeric,feedback jsonb,created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT o.id,o.case_id,o.patient_name,NULL::date,o.production_status,o.issue_state,0::numeric,
 (SELECT jsonb_build_object('rating',f.rating,'notes',f.notes,'createdAt',f.created_at) FROM public.doctor_order_feedback f WHERE f.order_id=o.id),o.created_at
 FROM public.orders o WHERE o.doctor_id IN(SELECT public.doctor_portal_scope()) AND NOT coalesce(o.is_deleted,false) ORDER BY o.created_at DESC;
$$;

CREATE FUNCTION public.get_doctor_portal_context()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_doc public.doctors; v_clinic public.doctors;
BEGIN
 IF public.get_my_role() IS DISTINCT FROM 'doctor' THEN RAISE EXCEPTION 'غير مصرح'; END IF;
 SELECT d.* INTO v_doc FROM public.doctors d WHERE d.id=public.get_my_entity_id();
 SELECT * INTO v_clinic FROM public.doctors WHERE id=coalesce(v_doc.parent_id,v_doc.id);
 RETURN jsonb_build_object('doctor_id',v_doc.id,'name',v_doc.name,'is_center',v_doc.is_center AND v_doc.parent_id IS NULL,
 'clinic_name',v_clinic.name,'contact_phone',coalesce(nullif(v_doc.phone,''),v_doc.contact_phones->0->>'phone',v_clinic.phone),'address',coalesce(nullif(v_doc.address,''),v_clinic.address),'branches',coalesce((SELECT jsonb_agg(branch) FROM(SELECT DISTINCT ON(b->>'id') b AS branch FROM jsonb_array_elements(coalesce(v_doc.branches,'[]'::jsonb)||CASE WHEN v_doc.id<>v_clinic.id THEN coalesce(v_clinic.branches,'[]'::jsonb) ELSE '[]'::jsonb END)WITH ORDINALITY AS entries(b,n) ORDER BY b->>'id',n) distinct_branches),'[]'::jsonb),
 'members',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'phone',d.phone,'doctor_code',d.doctor_code,
 'has_account',EXISTS(SELECT 1 FROM public.users WHERE entity_id=d.id))) FROM public.doctors d WHERE d.id IN(SELECT public.doctor_portal_scope())),'[]'::jsonb));
END;
$$;



CREATE TABLE public.doctor_pickup_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
 doctor_id uuid NOT NULL REFERENCES public.doctors(id),address text NOT NULL,branch_name text,
 contact_phone text NOT NULL,pickup_timing text,trays_details text,has_bite_record boolean NOT NULL DEFAULT false,
 scheduled_at timestamptz,collected_at timestamptz,received_at timestamptz,
status text NOT NULL DEFAULT 'requested' CHECK(status IN('requested','scheduled','collected','received','cancelled')),
 coordination_note text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.doctor_pickup_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_pickup_requests FROM PUBLIC,anon,authenticated;
-- Case RPC above references this table; defined after table via migration generator.

CREATE FUNCTION public.get_doctor_portal_cases()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'case_id',o.case_id,'patient_name',o.patient_name,
 'doctor_id',d.id,'doctor_name',d.name,'stl_url',o.stl_url,'images_url',o.images_url,'production_status',CASE WHEN o.status IN('Delivered','Completed') THEN 'final_delivered' ELSE o.production_status END,'issue_state',o.issue_state,'created_at',o.created_at,
 'stage_label',CASE WHEN o.status='Pending Review' THEN 'مراجعة واستلام الحالة' WHEN o.production_status='final_delivered' OR o.status IN('Delivered','Completed') THEN 'تم التسليم' WHEN o.production_status='final_ready' THEN 'جاهزة للتسليم'
 ELSE coalesce((SELECT string_agg(DISTINCT st.name_ar,'، ') FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id=r.job_id JOIN public.production_stages st ON st.id=r.stage_id
 WHERE j.order_id=o.id AND NOT j.is_backfilled AND j.status IN('queued','active','blocked') AND r.status IN('in_progress','waiting_external')),
 CASE o.production_status WHEN 'designing' THEN 'التصميم' WHEN 'not_started' THEN 'مراجعة واستلام الحالة' ELSE 'التصنيع' END) END,
 'shipment_status',(SELECT s.status FROM public.shipment_orders so JOIN public.shipments s ON s.id=so.shipment_id WHERE so.order_id=o.id AND s.status<>'cancelled' ORDER BY s.created_at DESC LIMIT 1),
 'pickup_status',(SELECT p.status FROM public.doctor_pickup_requests p WHERE p.order_id=o.id),
 'feedback',(SELECT jsonb_build_object('rating',f.rating,'notes',f.notes) FROM public.doctor_order_feedback f WHERE f.order_id=o.id)) ORDER BY o.created_at DESC),'[]'::jsonb)
 FROM public.orders o JOIN public.doctors d ON d.id=o.doctor_id WHERE d.id IN(SELECT public.doctor_portal_scope()) AND NOT coalesce(o.is_deleted,false);
$$;

CREATE TABLE public.doctor_portal_case_requests (
 request_key uuid PRIMARY KEY,doctor_id uuid NOT NULL REFERENCES public.doctors(id),order_id uuid NOT NULL REFERENCES public.orders(id),created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.doctor_portal_case_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_portal_case_requests FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.submit_doctor_portal_case(p_request_key uuid,p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_doc public.doctors; v_clinic public.doctors; v_existing public.doctor_portal_case_requests; v_id uuid; v_branch jsonb;
 v_item jsonb; v_service public.services; v_items jsonb := '[]'; v_price numeric; v_total numeric := 0; v_phone text; v_type text := p_payload->>'intake_type';
BEGIN
 IF public.get_my_role() IS DISTINCT FROM 'doctor' OR p_request_key IS NULL THEN RAISE EXCEPTION 'غير مصرح'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>50000 THEN RAISE EXCEPTION 'بيانات الحالة غير صالحة'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('doctor-case:'||p_request_key::text,0));
 SELECT * INTO v_existing FROM public.doctor_portal_case_requests WHERE request_key=p_request_key;
 IF FOUND THEN
   IF v_existing.doctor_id NOT IN(SELECT public.doctor_portal_scope()) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
   RETURN v_existing.order_id;
 END IF;
 SELECT * INTO v_doc FROM public.doctors WHERE id=coalesce(nullif(p_payload->>'doctor_id','')::uuid,public.get_my_entity_id()) AND id IN(SELECT public.doctor_portal_scope());
 IF v_doc.id IS NULL THEN RAISE EXCEPTION 'الطبيب لا يتبع حسابك'; END IF;
 SELECT * INTO v_clinic FROM public.doctors WHERE id=coalesce(v_doc.parent_id,v_doc.id);
 IF v_type IS NULL OR v_type NOT IN('pickup','digital') OR coalesce(length(btrim(p_payload->>'patient_name')),0) NOT BETWEEN 1 AND 150
 OR coalesce(length(btrim(p_payload->>'delivery_address')),0) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'راجع اسم الحالة وعنوان العيادة'; END IF;
 IF nullif(p_payload->>'branch_id','') IS NOT NULL THEN
   SELECT b INTO v_branch FROM jsonb_array_elements(coalesce(v_doc.branches,'[]'::jsonb)||coalesce(v_clinic.branches,'[]'::jsonb)) b WHERE b->>'id'=p_payload->>'branch_id' LIMIT 1;
   IF v_branch IS NULL THEN RAISE EXCEPTION 'الفرع لا يتبع العيادة'; END IF;
 END IF;
 v_phone := public._normalize_clinic_contact_phone(p_payload->>'contact_phone');
 IF v_phone IS NULL THEN RAISE EXCEPTION 'رقم التواصل للاستلام والشحن مطلوب'; END IF;
 IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'الخدمات مطلوبة'; END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
   SELECT * INTO v_service FROM public.services WHERE name=v_item->>'serviceType';
   IF v_service.id IS NULL OR jsonb_typeof(v_item->'teethNumbers') IS DISTINCT FROM 'array' OR jsonb_array_length(v_item->'teethNumbers') NOT BETWEEN 1 AND 32
   OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_item->'teethNumbers') tooth WHERE tooth !~ '^[1-8][1-8]$') THEN RAISE EXCEPTION 'اختر الخدمة وأرقام الأسنان الصحيحة'; END IF;
   v_price := coalesce((v_clinic.custom_prices->>(v_item->>'serviceType'))::numeric,v_service.selling_price,0);
   v_total := v_total+v_price*jsonb_array_length(v_item->'teethNumbers');
   v_items := v_items||jsonb_build_array(jsonb_build_object('serviceType',v_service.name,'teethNumbers',v_item->'teethNumbers','price',v_price));
 END LOOP;
 IF coalesce(p_payload->>'stl_url','')<>'' AND (p_payload->>'stl_url' !~ '^https?://[^[:space:]]+$' OR length(p_payload->>'stl_url')>2048)
 OR coalesce(p_payload->>'images_url','')<>'' AND (p_payload->>'images_url' !~ '^https?://[^[:space:]]+$' OR length(p_payload->>'images_url')>2048) THEN RAISE EXCEPTION 'اكتب رابطًا يبدأ بـ https:// أو http://'; END IF;
 INSERT INTO public.orders(case_id,doctor_id,patient_name,items,shade,instructions,stl_url,images_url,status,production_status,issue_state,technician_status,
 delivery_date,total_price,cost,discount,priority,comments,workflow_type,branch_name,delivery_address,delivery_contact_phone)
 VALUES('REQ-'||to_char(timezone('Africa/Cairo',now()),'YYMMDDHH24MISS')||'-'||substr(gen_random_uuid()::text,1,6),v_doc.id,btrim(p_payload->>'patient_name'),v_items,
 coalesce(p_payload->>'shade',''),nullif(p_payload->>'instructions',''),nullif(p_payload->>'stl_url',''),nullif(p_payload->>'images_url',''),
 'Pending Review','not_started','none','Pending',(timezone('Africa/Cairo',now())::date+3),v_total,0,0,'Normal','[]','full',v_branch->>'name',btrim(p_payload->>'delivery_address'),v_phone) RETURNING id INTO v_id;
 INSERT INTO public.doctor_portal_case_requests(request_key,doctor_id,order_id) VALUES(p_request_key,v_doc.id,v_id);
 IF v_type='pickup' THEN INSERT INTO public.doctor_pickup_requests(order_id,doctor_id,address,branch_name,contact_phone,pickup_timing,trays_details,has_bite_record)
 VALUES(v_id,v_doc.id,btrim(p_payload->>'delivery_address'),v_branch->>'name',v_phone,left(p_payload->>'pickup_timing',500),left(p_payload->>'trays_details',200),coalesce((p_payload->>'has_bite_record')::boolean,false)); END IF;
 RETURN v_id;
END;
$$;

CREATE FUNCTION public.get_my_doctor_month(p_previous boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_from date := date_trunc('month',timezone('Africa/Cairo',now()))::date; v_to date; v_cases jsonb; v_charge numeric; v_allocated numeric; v_receipts numeric; v_adjustments numeric; v_center boolean;
BEGIN
 IF public.get_my_role() IS DISTINCT FROM 'doctor' OR p_previous IS NULL THEN RAISE EXCEPTION 'غير مصرح'; END IF;
 IF p_previous THEN v_from := (v_from-interval '1 month')::date; END IF;
 v_to := (v_from+interval '1 month')::date;
 SELECT is_center AND parent_id IS NULL INTO v_center FROM public.doctors WHERE id=public.get_my_entity_id();
 SELECT coalesce(jsonb_agg(jsonb_build_object('case_id',o.case_id,'patient_name',o.patient_name,'doctor_name',d.name,'date',f.trigger_date,'amount',f.net_amount) ORDER BY f.trigger_date),'[]')
 INTO v_cases FROM public.financial_obligations f JOIN public.orders o ON o.id=f.order_id JOIN public.doctors d ON d.id=o.doctor_id
 WHERE o.doctor_id IN(SELECT public.doctor_portal_scope()) AND NOT coalesce(o.is_deleted,false) AND f.entity_type='doctor' AND f.direction='receivable' AND f.status NOT IN('void','written_off') AND f.trigger_date>=v_from AND f.trigger_date<v_to;
 SELECT coalesce(sum((c->>'amount')::numeric),0) INTO v_charge FROM jsonb_array_elements(v_cases) c;
 SELECT coalesce(sum(a.allocated_amount),0) INTO v_allocated FROM public.payment_allocations a JOIN public.financial_obligations f ON f.id=a.obligation_id JOIN public.orders o ON o.id=f.order_id JOIN public.transactions t ON t.id=a.payment_transaction_id
 WHERE o.doctor_id IN(SELECT public.doctor_portal_scope()) AND a.entity_type='doctor' AND a.direction='receivable' AND a.status='active' AND f.status NOT IN('void','written_off')
 AND t.type='income' AND (t.status='approved' OR t.is_approved IS TRUE) AND t.date>=v_from AND t.date<v_to;
 IF v_center OR NOT EXISTS(SELECT 1 FROM public.doctors WHERE id=public.get_my_entity_id() AND parent_id IS NOT NULL) THEN
   SELECT coalesce(sum(CASE WHEN type='income' THEN amount ELSE -amount END),0) INTO v_receipts FROM public.transactions WHERE entity_type='doctor' AND entity_id IN(SELECT public.doctor_portal_scope())
   AND (status='approved' OR is_approved IS TRUE) AND date>=v_from AND date<v_to;
   SELECT coalesce(sum(CASE WHEN type='charge' THEN abs(amount) ELSE -abs(amount) END),0) INTO v_adjustments FROM public.adjustments WHERE entity_type='doctor' AND entity_id IN(SELECT public.doctor_portal_scope()) AND date>=v_from AND date<v_to;
 ELSE v_receipts := v_allocated; v_adjustments := 0; END IF;
 RETURN jsonb_build_object('month',v_from,'is_center',v_center,'charges',v_charge,'payments',v_receipts,'adjustments',v_adjustments,'difference',v_charge+v_adjustments-v_receipts,'cases',v_cases,
 'by_doctor',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'amount',coalesce(b.amount,0),'paid',coalesce(p.paid,0)))
 FROM public.doctors d
 LEFT JOIN LATERAL(SELECT sum(f.net_amount) AS amount FROM public.financial_obligations f JOIN public.orders o ON o.id=f.order_id WHERE o.doctor_id=d.id AND NOT coalesce(o.is_deleted,false) AND f.entity_type='doctor' AND f.direction='receivable' AND f.status NOT IN('void','written_off') AND f.trigger_date>=v_from AND f.trigger_date<v_to)b ON true
 LEFT JOIN LATERAL(SELECT sum(a.allocated_amount) AS paid FROM public.payment_allocations a JOIN public.financial_obligations f ON f.id=a.obligation_id JOIN public.orders o ON o.id=f.order_id JOIN public.transactions t ON t.id=a.payment_transaction_id WHERE o.doctor_id=d.id AND a.entity_type='doctor' AND a.direction='receivable' AND a.status='active' AND f.status NOT IN('void','written_off') AND t.type='income' AND (t.status='approved' OR t.is_approved IS TRUE) AND t.date>=v_from AND t.date<v_to)p ON true
 WHERE d.id IN(SELECT public.doctor_portal_scope()) AND (coalesce(b.amount,0)<>0 OR coalesce(p.paid,0)<>0)),'[]'::jsonb));
END;
$$;

-- Restrictive policies narrow previous broad read/write grants for doctors only.
CREATE POLICY portal_attachment_read_scope ON public.order_attachments AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.get_my_role() IS DISTINCT FROM 'doctor' OR (kind='instruction' AND public.doctor_portal_can_access_order(order_id)));
CREATE POLICY portal_attachment_insert ON public.order_attachments FOR INSERT TO authenticated
 WITH CHECK(public.get_my_role()='doctor' AND kind='instruction' AND stage_run_id IS NULL AND public.doctor_portal_can_access_order(order_id) AND storage_path LIKE order_id::text||'/instruction/%');
CREATE POLICY portal_attachment_write_scope ON public.order_attachments AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(public.get_my_role() IS DISTINCT FROM 'doctor' OR (kind='instruction' AND stage_run_id IS NULL AND public.doctor_portal_can_access_order(order_id) AND storage_path LIKE order_id::text||'/instruction/%'));
CREATE FUNCTION public.doctor_portal_owns_file(p_path text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF split_part(p_path,'/',1) !~ '^[0-9a-f-]{36}$' OR split_part(p_path,'/',2)<>'instruction' THEN RETURN false; END IF;
 RETURN public.doctor_portal_can_access_order(split_part(p_path,'/',1)::uuid);
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.doctor_portal_owns_file(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.doctor_portal_owns_file(text) TO authenticated;
UPDATE storage.buckets SET file_size_limit=52428800,allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf','application/octet-stream','model/stl','model/ply','application/sla'] WHERE id='case-files';
CREATE POLICY portal_storage_read_scope ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.get_my_role() IS DISTINCT FROM 'doctor' OR (bucket_id='case-files' AND public.doctor_portal_owns_file(name)));
CREATE POLICY portal_storage_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='case-files' AND public.get_my_role()='doctor' AND public.doctor_portal_owns_file(name) AND lower(name) ~ '\.(stl|ply|jpg|jpeg|png|webp|heic|pdf)$');
CREATE POLICY portal_storage_write_scope ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(public.get_my_role() IS DISTINCT FROM 'doctor' OR (bucket_id='case-files' AND public.doctor_portal_owns_file(name) AND lower(name) ~ '\.(stl|ply|jpg|jpeg|png|webp|heic|pdf)$'));
CREATE POLICY portal_storage_cleanup ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='case-files' AND public.get_my_role()='doctor' AND public.doctor_portal_owns_file(name) AND NOT EXISTS(SELECT 1 FROM public.order_attachments WHERE storage_path=name));

REVOKE ALL ON FUNCTION public.get_doctor_portal_context(),public.get_doctor_portal_cases(),public.submit_doctor_portal_case(uuid,jsonb),public.get_my_doctor_month(boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_doctor_portal_context(),public.get_doctor_portal_cases(),public.submit_doctor_portal_case(uuid,jsonb),public.get_my_doctor_month(boolean) TO authenticated;

CREATE POLICY portal_orders_rpc_insert_only ON public.orders AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.get_my_role() IS DISTINCT FROM 'doctor');
CREATE POLICY portal_orders_rpc_update_only ON public.orders AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.get_my_role() IS DISTINCT FROM 'doctor');
CREATE POLICY portal_jobs_private ON public.production_jobs AS RESTRICTIVE FOR SELECT TO authenticated USING(public.get_my_role() IS DISTINCT FROM 'doctor');
CREATE POLICY portal_stage_runs_private ON public.production_stage_runs AS RESTRICTIVE FOR SELECT TO authenticated USING(public.get_my_role() IS DISTINCT FROM 'doctor');
CREATE POLICY portal_events_private ON public.order_events AS RESTRICTIVE FOR SELECT TO authenticated USING(public.get_my_role() IS DISTINCT FROM 'doctor');
CREATE POLICY portal_issues_private ON public.order_issues AS RESTRICTIVE FOR SELECT TO authenticated USING(public.get_my_role() IS DISTINCT FROM 'doctor');
REVOKE ALL ON FUNCTION public.create_my_order_request_with_destination(text,jsonb,text,text,text,text,date,numeric,text,text),public.create_my_order_request_v2(text,jsonb,text,text,text,text,date,numeric) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_doctor_portal_invitation(p_doctor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_doc public.doctors; v_token text := encode(gen_random_bytes(32),'hex'); v_expiry timestamptz := clock_timestamp()+interval '7 days';
BEGIN
    SELECT * INTO v_doc FROM public.doctors WHERE id=p_doctor_id FOR UPDATE;
    IF v_doc.id IS NULL OR public.get_my_role() IS NULL OR NOT coalesce((
        public.get_my_role() IN ('admin','coordinator') OR (public.get_my_role()='doctor' AND v_doc.parent_id=public.get_my_entity_id() AND EXISTS(SELECT 1 FROM public.doctors WHERE id=public.get_my_entity_id() AND is_center IS TRUE AND parent_id IS NULL)) OR (public.get_my_role()='representative' AND v_doc.representative_id=public.get_my_user_id())),false) THEN
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
NOTIFY pgrst,'reload schema';

CREATE TABLE public.doctor_portal_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),doctor_id uuid NOT NULL REFERENCES public.doctors(id),order_id uuid REFERENCES public.orders(id),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),reply text CHECK(length(reply) BETWEEN 1 AND 4000),
 created_at timestamptz NOT NULL DEFAULT now(),replied_at timestamptz,replied_by uuid REFERENCES public.users(id)
);
ALTER TABLE public.doctor_portal_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_portal_messages FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.send_doctor_portal_message(p_body text,p_order_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
 IF public.get_my_role() IS DISTINCT FROM 'doctor' OR coalesce(length(btrim(p_body)),0) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'اكتب رسالتك للمعمل'; END IF;
 IF p_order_id IS NOT NULL AND NOT public.doctor_portal_can_access_order(p_order_id) THEN RAISE EXCEPTION 'الحالة لا تتبع حسابك'; END IF;
 IF NOT public._doctor_portal_take_rate('doctor-message',auth.uid()::text,20) THEN RAISE EXCEPTION 'انتظر قليلًا قبل إرسال رسالة أخرى'; END IF;
 INSERT INTO public.doctor_portal_messages(doctor_id,order_id,body) VALUES(public.get_my_entity_id(),p_order_id,btrim(p_body)) RETURNING id INTO v_id;
 RETURN v_id;
END;
$$;
CREATE FUNCTION public.get_my_doctor_messages()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'body',m.body,'reply',m.reply,'created_at',m.created_at,'replied_at',m.replied_at,'case_id',o.case_id) ORDER BY m.created_at DESC),'[]'::jsonb)
 FROM public.doctor_portal_messages m LEFT JOIN public.orders o ON o.id=m.order_id WHERE m.doctor_id=public.get_my_entity_id() AND public.get_my_role()='doctor';
$$;
CREATE FUNCTION public.get_doctor_portal_staff_inbox()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF public.get_my_role() IS NULL OR public.get_my_role() NOT IN('admin','coordinator') THEN RAISE EXCEPTION 'غير مصرح'; END IF;
 RETURN jsonb_build_object('messages',coalesce((SELECT jsonb_agg(to_jsonb(m)||jsonb_build_object('doctor_name',d.name,'case_id',o.case_id) ORDER BY m.created_at DESC) FROM public.doctor_portal_messages m JOIN public.doctors d ON d.id=m.doctor_id LEFT JOIN public.orders o ON o.id=m.order_id WHERE m.reply IS NULL),'[]'::jsonb),
 'pickups',coalesce((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('doctor_name',d.name,'case_id',o.case_id) ORDER BY p.created_at) FROM public.doctor_pickup_requests p JOIN public.doctors d ON d.id=p.doctor_id JOIN public.orders o ON o.id=p.order_id WHERE p.status NOT IN('received','cancelled')),'[]'::jsonb));
END;
$$;
CREATE FUNCTION public.reply_doctor_portal_message(p_id uuid,p_reply text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF public.get_my_role() IS NULL OR public.get_my_role() NOT IN('admin','coordinator') THEN RAISE EXCEPTION 'غير مصرح'; END IF;
 IF coalesce(length(btrim(p_reply)),0) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'اكتب الرد'; END IF;
 UPDATE public.doctor_portal_messages SET reply=btrim(p_reply),replied_at=now(),replied_by=public.get_my_user_id() WHERE id=p_id AND reply IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'الرسالة غير موجودة أو تمت الإجابة عليها'; END IF;
END;
$$;
CREATE FUNCTION public.coordinate_doctor_pickup(p_id uuid,p_status text,p_expected_status text,p_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_request public.doctor_pickup_requests;
BEGIN
 IF public.get_my_role() IS NULL OR public.get_my_role() NOT IN('admin','coordinator') THEN RAISE EXCEPTION 'غير مصرح'; END IF;
 SELECT * INTO v_request FROM public.doctor_pickup_requests WHERE id=p_id FOR UPDATE;
 IF v_request.id IS NULL OR v_request.status IS DISTINCT FROM p_expected_status THEN RAISE EXCEPTION 'الطلب تغير؛ أعد تحميله'; END IF;
 IF NOT coalesce((p_status='scheduled' AND v_request.status='requested') OR (p_status='collected' AND v_request.status='scheduled') OR (p_status='received' AND v_request.status='collected') OR (p_status='cancelled' AND v_request.status NOT IN('received','cancelled')),false) THEN RAISE EXCEPTION 'حركة الاستلام غير صالحة'; END IF;
 UPDATE public.doctor_pickup_requests SET status=p_status,coordination_note=left(p_note,1000),updated_at=now(),scheduled_at=CASE WHEN p_status='scheduled' THEN now() ELSE scheduled_at END,collected_at=CASE WHEN p_status='collected' THEN now() ELSE collected_at END,received_at=CASE WHEN p_status='received' THEN now() ELSE received_at END WHERE id=p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.send_doctor_portal_message(text,uuid),public.get_my_doctor_messages(),public.get_doctor_portal_staff_inbox(),public.reply_doctor_portal_message(uuid,text),public.coordinate_doctor_pickup(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.send_doctor_portal_message(text,uuid),public.get_my_doctor_messages(),public.get_doctor_portal_staff_inbox(),public.reply_doctor_portal_message(uuid,text),public.coordinate_doctor_pickup(uuid,text,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.create_shipment(p_courier_id uuid, p_doctor_id uuid, p_tracking_ref text, p_order_ids uuid[], p_packing_proof_urls text[] DEFAULT '{}'::text[], p_recipient_name text DEFAULT NULL::text, p_recipient_phone text DEFAULT NULL::text, p_delivery_address text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := auth.uid();
    v_shipment_id UUID;
    v_shipment_code TEXT;
    v_order_id UUID;
    v_doc_name TEXT;
    v_doc_phone TEXT;
    v_doc_address TEXT;
    v_order_count INT := 0;
    v_conflict_code TEXT;
BEGIN
    IF v_role IS NULL OR v_role NOT IN ('admin', 'production_manager', 'accountant', 'coordinator', 'technician') THEN
        RAISE EXCEPTION 'غير مصرح بإنشاء شحنات';
    END IF;

    IF p_order_ids IS NULL OR array_length(p_order_ids, 1) = 0 THEN
        RAISE EXCEPTION 'يجب تحديد أوردر واحد على الأقل للشحنة';
    END IF;

    -- Check if any of the orders are already in an active non-delivered/non-cancelled shipment
    SELECT s.shipment_code INTO v_conflict_code
    FROM public.shipment_orders so
    JOIN public.shipments s ON s.id = so.shipment_id
    WHERE so.order_id = ANY(p_order_ids)
      AND s.status IN ('packing', 'ready_for_pickup', 'dispatched')
    LIMIT 1;

    IF v_conflict_code IS NOT NULL THEN
        RAISE EXCEPTION 'أحد الأوردرات مسجل بالفعل في الشحنة النشطة رقم %', v_conflict_code;
    END IF;

    -- A shipment is addressed to one doctor. Letting another doctor's case ride
    -- along would deliver it to the wrong clinic and, once delivery bills the
    -- doctor, invoice the wrong one too.
    IF p_doctor_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.orders o
         WHERE o.id = ANY(p_order_ids)
           AND o.doctor_id IS DISTINCT FROM p_doctor_id
    ) THEN
        RAISE EXCEPTION 'الشحنة فيها أوردرات لأطباء مختلفين — اعمل شحنة لكل طبيب';
    END IF;

    IF (SELECT count(*) FROM public.orders WHERE id=ANY(p_order_ids))<>cardinality(p_order_ids) THEN RAISE EXCEPTION 'قائمة الحالات غير صالحة أو مكررة'; END IF;
    PERFORM id FROM public.orders WHERE id=ANY(p_order_ids) ORDER BY id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.orders WHERE id=ANY(p_order_ids) AND coalesce(is_deleted,false)) THEN RAISE EXCEPTION 'الحالة محذوفة'; END IF;
    IF EXISTS(SELECT 1 FROM public.orders WHERE id=ANY(p_order_ids) AND production_status NOT IN('final_ready','try_in_ready') AND status<>'Ready') THEN RAISE EXCEPTION 'الحالة لم تصبح جاهزة للشحن'; END IF;
    IF (SELECT count(DISTINCT coalesce(nullif(o.delivery_address,''),d.address)) FROM public.orders o JOIN public.doctors d ON d.id=o.doctor_id WHERE o.id=ANY(p_order_ids))>1 THEN RAISE EXCEPTION 'الحالات لها عناوين شحن مختلفة؛ جهز شحنة لكل عنوان'; END IF;
    -- Resolve doctor info fallback if not explicitly provided
    IF p_doctor_id IS NOT NULL THEN
        SELECT name, phone, address
        INTO v_doc_name, v_doc_phone, v_doc_address
        FROM public.doctors
        WHERE id = p_doctor_id;
    END IF;

    SELECT coalesce(nullif(o.delivery_address,''),v_doc_address),coalesce(nullif(o.delivery_contact_phone,''),v_doc_phone)
    INTO v_doc_address,v_doc_phone FROM public.orders o WHERE o.id=p_order_ids[1];
    v_shipment_code := public.generate_shipment_code();

    INSERT INTO public.shipments (
        shipment_code,
        courier_id,
        doctor_id,
        tracking_ref,
        status,
        packed_by,
        packed_at,
        packing_proof_urls,
        requested_at,
        recipient_name,
        recipient_phone,
        delivery_address,
        notes,
        created_by
    ) VALUES (
        v_shipment_code,
        p_courier_id,
        p_doctor_id,
        NULLIF(btrim(p_tracking_ref), ''),
        'ready_for_pickup',
        v_user_id,
        now(),
        COALESCE(p_packing_proof_urls, '{}'::TEXT[]),
        now(),
        COALESCE(NULLIF(btrim(p_recipient_name), ''), v_doc_name),
        COALESCE(NULLIF(btrim(p_recipient_phone), ''), v_doc_phone),
        COALESCE(NULLIF(btrim(p_delivery_address), ''), v_doc_address),
        NULLIF(btrim(p_notes), ''),
        v_user_id
    ) RETURNING id INTO v_shipment_id;

    FOREACH v_order_id IN ARRAY p_order_ids LOOP
        INSERT INTO public.shipment_orders (shipment_id, order_id)
        VALUES (v_shipment_id, v_order_id);
        v_order_count := v_order_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', TRUE,
        'shipment_id', v_shipment_id,
        'shipment_code', v_shipment_code,
        'order_count', v_order_count
    );
END;
$function$;
