-- Run only against the isolated, seeded QA database, after the notification migration.
BEGIN;
DO $$
DECLARE
    admin_auth uuid;
    coord_auth uuid;
    designer_auth uuid;
    designer_id uuid;
    coord_id uuid;
    clinic constant uuid := 'da510000-0000-4000-8000-000000000010';
    courier constant uuid := 'da510000-0000-4000-8000-000000000020';
    shipment constant uuid := 'da510000-0000-4000-8000-000000000030';
    route constant uuid := 'ba100000-0000-4000-8000-000000000001';
    order_id uuid;
    revision uuid;
    original_qc boolean;
    n integer;
BEGIN
    IF EXISTS (SELECT 1 FROM public.doctors WHERE id=clinic) THEN RETURN; END IF;
    SELECT auth_id INTO STRICT admin_auth FROM public.users WHERE username='day3_admin';
    SELECT auth_id,id INTO STRICT coord_auth,coord_id FROM public.users WHERE username='day3_coordinator';
    SELECT auth_id,id INTO STRICT designer_auth,designer_id FROM public.users WHERE username='day3_designer';
    SELECT enabled INTO STRICT original_qc FROM public.design_qc_control WHERE id FOR UPDATE;

    INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name)
    VALUES (clinic,'عيادة تجربة الإشعارات','01000000000','عنوان تجريبي','D5-NOTIFY','QA');
    INSERT INTO public.suppliers(id,name,phone,supplier_type)
    VALUES (courier,'شركة تجربة الإشعارات','01000000000','courier');
    INSERT INTO public.services(name,selling_price,cost_price,milling_price,designer_price)
    VALUES ('QA Notification Zirconia',900,290,150,100);

    PERFORM set_config('request.jwt.claim.sub',admin_auth::text,true);
    PERFORM public.set_design_qc_enabled(true,'Local notification fixture setup');
    FOR n IN 1..4 LOOP
        order_id := ('da510000-0000-4000-8000-' || lpad((100+n)::text,12,'0'))::uuid;
        revision := ('da510000-0000-4000-8000-' || lpad((200+n)::text,12,'0'))::uuid;
        PERFORM set_config('request.jwt.claim.sub',admin_auth::text,true);
        INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,production_status,delivery_date,delivery_type,workflow_type,designer_id,design_price,route_override_id)
        VALUES (order_id,'D5-NOTIFY-0'||n,clinic,'حالة اختبار الإشعارات','[]',900,400,'A1','designing',current_date,
            'TryIn','split',designer_id,100,CASE WHEN n IN (2,3) THEN route END);
        INSERT INTO public.order_items(order_id,product_type,teeth_numbers,price,shade,count)
        VALUES (order_id,'QA Notification Zirconia','["11"]',900,'A1',1);
        PERFORM set_config('request.jwt.claim.sub',designer_auth::text,true);
        PERFORM public.submit_design_delivery(order_id,revision,'link','https://example.test/qa-design-'||n,'ملف تجربة بدون معاينة');
        IF n IN (2,3,4) THEN
            PERFORM set_config('request.jwt.claim.sub',admin_auth::text,true);
            IF n=4 THEN
                PERFORM public.resolve_design_qc_review(revision,gen_random_uuid(),'changes','راجع حدود التصميم في الناحية اليسرى','current',NULL,NULL,NULL);
            ELSE
                PERFORM public.approve_and_release_design_revision(revision,gen_random_uuid(),'Local fixture');
            END IF;
        END IF;
    END LOOP;
    UPDATE public.production_stage_runs r SET assignee_id=coord_id
    FROM public.production_jobs j, public.production_stages s
    WHERE r.job_id=j.id AND r.stage_id=s.id AND s.code='printing'
      AND j.order_id='da510000-0000-4000-8000-000000000102';

    -- The other case advances from printing into Physical QC using the normal workflow.
    PERFORM public.complete_stage_run((SELECT r.id FROM public.production_stage_runs r
        JOIN public.production_jobs j ON j.id=r.job_id JOIN public.production_stages s ON s.id=r.stage_id
        WHERE s.code='printing' AND j.order_id='da510000-0000-4000-8000-000000000103'));
    PERFORM public.set_design_qc_enabled(original_qc,'Restore local QA Design QC switch');

    PERFORM set_config('request.jwt.claim.sub',coord_auth::text,true);
    INSERT INTO public.shipments(id,shipment_code,courier_id,doctor_id,status)
    VALUES (shipment,'D5-NOTIFY-SHP',courier,clinic,'dispatched');
    PERFORM public.close_shipping_attempt(shipment,'failed','العيادة كانت مغلقة');
    PERFORM public.save_courier_monthly_invoice(courier,date_trunc('month',current_date)::date,
        'D5-NOTIFY-INVOICE',7000,7000,'{}',false,0);
END;
$$;
COMMIT;
