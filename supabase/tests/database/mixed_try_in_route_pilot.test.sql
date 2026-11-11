BEGIN;
SET search_path=public,extensions;
SELECT no_plan();

SELECT is(
    (SELECT count(*) FROM public.get_effective_route_stages(
        'ba100000-0000-4000-8000-000000000001', '{"delivery_type":"TryIn","workflow_type":"split"}')
        WHERE seq IN (20, 30, 40, 50)),
    4::bigint, 'Try-in preview includes printing, inspection, shipment and doctor review');
SELECT is(
    (SELECT count(*) FROM public.get_effective_route_stages(
        'ba100000-0000-4000-8000-000000000001', '{"delivery_type":"Final","workflow_type":"split"}')
        WHERE seq IN (20, 30, 40, 50)),
    0::bigint, 'Final preview omits all try-in steps');

INSERT INTO auth.users(id,email) VALUES
 ('ba200000-0000-4000-8000-000000000001','mixed-admin@example.test'),
 ('ba200000-0000-4000-8000-000000000002','mixed-coord@example.test'),
 ('ba200000-0000-4000-8000-000000000003','mixed-design@example.test'),
 ('ba200000-0000-4000-8000-000000000004','mixed-tech@example.test'),
 ('ba200000-0000-4000-8000-000000000005','mixed-production@example.test');
INSERT INTO public.users(id,auth_id,username,role,name) VALUES
 ('ba200000-0000-4000-8000-000000000001','ba200000-0000-4000-8000-000000000001','mixed_test_admin','admin','Pilot admin'),
 ('ba200000-0000-4000-8000-000000000002','ba200000-0000-4000-8000-000000000002','mixed_test_coord','coordinator','Pilot coordinator'),
 ('ba200000-0000-4000-8000-000000000003','ba200000-0000-4000-8000-000000000003','mixed_test_design','designer','Pilot designer'),
 ('ba200000-0000-4000-8000-000000000004','ba200000-0000-4000-8000-000000000004','mixed_test_tech','technician','Pilot technician'),
 ('ba200000-0000-4000-8000-000000000005','ba200000-0000-4000-8000-000000000005','mixed_test_production','production_manager','Pilot production manager');
INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name)
 VALUES ('ba200000-0000-4000-8000-000000000010','Pilot clinic','01000000000','Pilot address','TRY-PILOT','Pilot');
INSERT INTO public.suppliers(id,name,phone,supplier_type) VALUES
 ('ba200000-0000-4000-8000-000000000012','Pilot finishing lab','01000000000','external_lab'),
 ('ba200000-0000-4000-8000-000000000013','Pilot courier','01000000000','courier'),
 ('ba200000-0000-4000-8000-000000000014','Pilot alternate lab','01000000000','external_lab');
INSERT INTO public.services(name,selling_price,cost_price,milling_price,designer_price)
 VALUES ('Pilot zirconia',900,290,150,100);
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000001',true);
SELECT public.set_design_qc_enabled(true,'Trial pilot test');
UPDATE public.production_route_stages SET supplier_override='ba200000-0000-4000-8000-000000000012'
WHERE route_id='ba100000-0000-4000-8000-000000000001' AND step_no=60;
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,production_status,delivery_date,delivery_type,workflow_type,designer_id,design_price,route_override_id)
 VALUES ('ba200000-0000-4000-8000-000000000011','MIXED-TRY-PILOT','ba200000-0000-4000-8000-000000000010','Synthetic patient','[]',1800,400,'A1','designing',current_date,'TryIn','split','ba200000-0000-4000-8000-000000000003',100,'ba100000-0000-4000-8000-000000000001');
INSERT INTO public.order_items(order_id,product_type,teeth_numbers,price,shade,count)
 VALUES ('ba200000-0000-4000-8000-000000000011','Pilot zirconia','["11","12"]',900,'A1',2);
CREATE TEMP VIEW runs AS SELECT r.*,s.code FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id=r.job_id
 JOIN public.production_stages s ON s.id=r.stage_id WHERE j.order_id='ba200000-0000-4000-8000-000000000011'
 AND r.qc_followup_run_id IS NULL;
CREATE TEMP VIEW pilot_order AS SELECT * FROM public.orders WHERE id='ba200000-0000-4000-8000-000000000011';
CREATE TEMP TABLE pilot_shipments(purpose text,id uuid);

SELECT is((SELECT string_agg(code,',' ORDER BY seq) FROM runs),'design,printing,qc,shipping,doctor_review,milling,qc,shipping','Snapshots two physical inspections and one packing interface per shipment');
UPDATE public.production_route_stages SET supplier_override='ba200000-0000-4000-8000-000000000014'
WHERE route_id='ba100000-0000-4000-8000-000000000001' AND step_no=60;
SELECT is((SELECT supplier_id FROM runs WHERE code='milling'),'ba200000-0000-4000-8000-000000000012'::uuid,
    'Editing the route template leaves the open order’s default supplier intact');
SELECT is(public.get_mixed_try_in_price((SELECT id FROM runs WHERE code='milling')),300::numeric,'Uses service milling price for both units');
SELECT is((SELECT planned_external_cost FROM runs WHERE code='milling'),NULL::numeric,'Operational stage rows do not contain the quote');
SELECT ok(NOT has_table_privilege('authenticated','public.mixed_try_in_prices','SELECT'),'Authenticated sessions cannot read the private price table');
UPDATE public.services SET milling_price=999 WHERE name='Pilot zirconia';
SELECT is(public.get_mixed_try_in_price((SELECT id FROM runs WHERE code='milling'),'ba200000-0000-4000-8000-000000000012'),300::numeric,'Catalog updates do not reprice the case');
UPDATE public.suppliers SET milling_prices='{"Pilot zirconia":125}' WHERE id='ba200000-0000-4000-8000-000000000012';
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000003',true);
SELECT public.set_production_doctor_wait((SELECT id FROM pilot_order),true,'Designer requests updated scan');
SELECT is(public.get_designer_workspace((SELECT id FROM pilot_order),false)->0->>'doctor_wait_reason',
    'Designer requests updated scan','Designer can place an assigned case on hold from the case card');
SELECT throws_ok($$SELECT public.set_production_doctor_wait((SELECT id FROM pilot_order),false)$$,'42501',
    'طلب التفاصيل متاح للمصمم المكلّف أثناء التصميم','Designer cannot resume a doctor hold');
SELECT throws_ok($$SELECT public.submit_design_delivery((SELECT id FROM pilot_order),gen_random_uuid(),'link','https://example.test/held','No HTML')$$,
    '23514','الحالة On Hold. استأنفها بعد وصول التفاصيل قبل رفع التصميم','A held design cannot be submitted');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000002',true);
SELECT public.set_production_doctor_wait((SELECT id FROM pilot_order),false);
DELETE FROM public.production_doctor_waits WHERE order_id=(SELECT id FROM pilot_order);
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000003',true);
SELECT public.submit_design_delivery('ba200000-0000-4000-8000-000000000011','ba200000-0000-4000-8000-000000000021','link','https://example.test/mixed-design','No HTML in fixture');
SELECT is((SELECT technician_status FROM pilot_order),'Approved','Submitting a design also accepts the case');
SELECT is((SELECT status FROM runs WHERE code='printing'),'pending','Printing waits for Design QC');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000001',true);
SELECT throws_ok($$SELECT public.complete_stage_run((SELECT id FROM runs WHERE code='design'))$$,'23514',
 'التصميم يُسلّم من لوحة المصمم ويُفتح الإنتاج حسب قرار المراجعة','Generic production action cannot skip Design QC');
SELECT public.approve_and_release_design_revision('ba200000-0000-4000-8000-000000000021',gen_random_uuid(),'Approved test');
SELECT is((SELECT status FROM runs WHERE code='printing'),'ready','Approval opens internal printing');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000002',true);
SELECT throws_ok($$SELECT public.set_production_doctor_wait((SELECT id FROM pilot_order),true,'  ')$$,'P0001','اكتب المطلوب من الطبيب','A doctor hold requires a reason');
SELECT public.set_production_doctor_wait((SELECT id FROM pilot_order),true,'Waiting for a new scan');
SELECT is((SELECT reason FROM public.production_doctor_waits WHERE order_id=(SELECT id FROM pilot_order) AND ended_at IS NULL),'Waiting for a new scan','Doctor input reason is stored separately');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000001',true);
SELECT throws_ok($$SELECT public.complete_stage_run((SELECT id FROM runs WHERE code='printing'))$$,'23514','الحالة منتظرة مدخلات من الطبيب. سجّل وصول المطلوب قبل استكمالها','Printing cannot advance while waiting for doctor input');
SELECT public.set_production_doctor_wait((SELECT id FROM pilot_order),false);
SELECT is((SELECT count(*) FROM public.production_doctor_waits WHERE order_id=(SELECT id FROM pilot_order) AND ended_at IS NOT NULL),1::bigint,'Resume closes the wait and preserves its record');
UPDATE public.orders SET created_at=now()-interval '2 hours' WHERE id=(SELECT id FROM pilot_order);
UPDATE public.production_doctor_waits SET started_at=now()-interval '1 hour' WHERE order_id=(SELECT id FROM pilot_order);
SELECT is((SELECT doctor_minutes FROM public.production_case_times((SELECT id FROM pilot_order))),60,'Doctor wait has its own clock');
SELECT is((SELECT design_minutes FROM public.production_case_times((SELECT id FROM pilot_order))),60,'Doctor wait is not charged to design time');
SELECT throws_ok($$SELECT public.complete_stage_run((SELECT id FROM runs WHERE code='printing'),1,0)$$,'23514',
    'سجّل نتيجة كل وحدات الطباعة قبل إنهاء المحاولة','Printing cannot advance with unaccounted units');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000002',true);
SELECT lives_ok($$SELECT public.start_stage_run((SELECT id FROM runs WHERE code='printing'))$$,
    'Coordinator can start a printing step assigned to their role');
SELECT public.complete_stage_run((SELECT id FROM runs WHERE code='printing'),1,1,'crack');
SELECT ok((SELECT 'coordinator'=ANY(allowed_roles) FROM runs WHERE code='printing' AND status='ready'),
    'A reprint retains the route role assignment');
SELECT is((SELECT units_in FROM runs WHERE code='printing' AND status='ready'),1,'Partial print failure queues only the failed units');
SELECT is((SELECT status FROM runs WHERE seq=30),'pending','QC waits for the reprint');
SELECT public.complete_stage_run((SELECT id FROM runs WHERE code='printing' AND rework_of IS NULL),1,1,'crack');
SELECT is((SELECT count(*) FROM runs WHERE code='printing' AND status='ready'),1::bigint,'Retrying the failure submission does not duplicate the print task');
SELECT public.complete_stage_run((SELECT id FROM runs WHERE code='printing' AND status='ready'),0,1,'crack');
SELECT is((SELECT units_in FROM runs WHERE code='printing' AND status='ready'),1,'A failed single-unit reprint stays in the print queue');
SELECT is((SELECT j.status FROM public.production_jobs j JOIN pilot_order o ON o.id=j.order_id),'active','A whole-run print failure does not strand the case');
SELECT is((SELECT name_override FROM runs WHERE code='printing' AND status='ready'),'إعادة الطباعة','The new attempt is visibly labelled as a reprint');
SELECT public.complete_stage_run((SELECT id FROM runs WHERE code='printing' AND status='ready'));
SELECT is((SELECT status FROM runs WHERE seq=30),'ready','Printing opens trial physical QC');
SELECT throws_ok($$SELECT public.start_stage_run((SELECT id FROM runs WHERE seq=30))$$,
    '42501','دورك غير مسموح له بتنفيذ هذه المرحلة','Coordinator cannot start an unassigned QC step');
SELECT throws_ok($$SELECT public.block_stage_run((SELECT id FROM runs WHERE seq=30),'other')$$,
    '42501','دورك غير مسموح له بتنفيذ هذه المرحلة','Coordinator cannot block an unassigned QC step');
SELECT throws_ok($$SELECT public.mixed_physical_qc_action((SELECT id FROM runs WHERE seq=30),'bypass',' ')$$,'P0001','اكتب سبب الإجراء','Bypass needs a reason');
SELECT throws_ok($$SELECT public.mixed_physical_qc_action((SELECT id FROM runs WHERE seq=30),'retry','test')$$,
    '42501','إجراء الفحص للأدمن فقط','Coordinator cannot take an admin-only QC action');
SELECT lives_ok($$SELECT public.mixed_physical_qc_action((SELECT id FROM runs WHERE seq=30),'bypass','Trial approved for expedited shipping')$$,
    'Coordinator can bypass pending physical QC with a reason');
SELECT is((SELECT units_passed FROM runs WHERE seq=30),0,'Bypass does not claim any inspected units');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000001',true);
SELECT is((SELECT count(*) FROM public.order_events WHERE order_id=(SELECT id FROM pilot_order) AND event_type='physical_qc_bypassed'),1::bigint,'Bypass is audited');
SELECT ok(EXISTS (SELECT 1 FROM public.order_events WHERE order_id=(SELECT id FROM pilot_order)
    AND event_type='physical_qc_bypassed' AND actor_role='coordinator'
    AND changed_by='ba200000-0000-4000-8000-000000000002' AND notes='Trial approved for expedited shipping'),
    'The audit identifies the coordinator and records the reason');
SELECT is((SELECT production_status FROM pilot_order),'try_in_ready','Trial inspection leads straight to shipping');
INSERT INTO pilot_shipments SELECT 'trial',(public.create_shipment('ba200000-0000-4000-8000-000000000013','ba200000-0000-4000-8000-000000000010',NULL,ARRAY['ba200000-0000-4000-8000-000000000011'::uuid])->>'shipment_id')::uuid;
SELECT is((SELECT r.seq FROM public.shipment_orders l JOIN runs r ON r.id=l.production_stage_run_id WHERE l.shipment_id=(SELECT id FROM pilot_shipments WHERE purpose='trial')),40,'Trial shipment linked to first shipping step');
SELECT public.dispatch_shipment((SELECT id FROM pilot_shipments WHERE purpose='trial'));
SELECT public.confirm_shipment_delivery((SELECT id FROM pilot_shipments WHERE purpose='trial'));
SELECT is((SELECT production_status FROM pilot_order),'waiting_doctor','Actual trial receipt opens doctor response');
SELECT is((SELECT first_delivered_at FROM pilot_order),NULL::timestamptz,'Trial receipt never records final delivery');
SELECT is((SELECT count(*) FROM public.financial_obligations WHERE order_id=(SELECT id FROM pilot_order) AND entity_type IN ('doctor','external_lab')),0::bigint,'Trial receipt produces no doctor AR or lab AP');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000004',true);
SELECT throws_ok($$SELECT public.mixed_try_in_doctor_action((SELECT id FROM runs WHERE code='doctor_review'),'approve')$$,'42501','رد الطبيب للأدمن والمنسق فقط','Technician cannot record doctor response');
SELECT throws_ok($$SELECT public.get_mixed_try_in_price((SELECT id FROM runs WHERE code='milling'))$$,'42501','السعر للأدمن فقط','Non-admin cannot fetch a price');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000002',true);
SELECT throws_ok($$SELECT public.mixed_try_in_doctor_action((SELECT id FROM runs WHERE code='doctor_review' AND status='ready'),'reprint',' ')$$,
    'P0001','اكتب تفاصيل رد الطبيب','A repeat trial requires the doctor’s reason');
SELECT public.mixed_try_in_doctor_action((SELECT id FROM runs WHERE code='doctor_review' AND status='ready'),'reprint','Doctor asks for another trial with the same design');
SELECT is((SELECT design_qc_revision_id FROM pilot_order),'ba200000-0000-4000-8000-000000000021'::uuid,'Reprint preserves the design revision');
SELECT is((SELECT status FROM runs WHERE code='printing' AND status='ready'),'ready','Reprint starts printing directly');
SELECT public.complete_stage_run((SELECT id FROM runs WHERE code='printing' AND status='ready'));
SELECT is((SELECT status FROM runs WHERE seq=30 AND status='ready'),'ready','Reprinted trial has a new physical QC');
CREATE FUNCTION pg_temp.send_repeat_trial(p_purpose text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE shipment_id uuid;
BEGIN
    shipment_id:=(public.create_shipment('ba200000-0000-4000-8000-000000000013','ba200000-0000-4000-8000-000000000010',NULL,
        ARRAY['ba200000-0000-4000-8000-000000000011'::uuid])->>'shipment_id')::uuid;
    INSERT INTO pilot_shipments VALUES(p_purpose,shipment_id);
    PERFORM public.dispatch_shipment(shipment_id);
    PERFORM public.confirm_shipment_delivery(shipment_id);
END;
$$;
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000001',true);
SELECT public.complete_stage_run((SELECT id FROM runs WHERE seq=30 AND status='ready'));
SELECT pg_temp.send_repeat_trial('reprint');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000002',true);
SELECT public.mixed_try_in_doctor_action((SELECT id FROM runs WHERE code='doctor_review' AND status='ready'),'request_design_change','Modify the trial contact');
SELECT is((SELECT production_status FROM pilot_order),'designing','A doctor’s design change reopens the designer queue');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000003',true);
SELECT public.submit_design_delivery((SELECT id FROM pilot_order),'ba200000-0000-4000-8000-000000000023','link','https://example.test/mixed-doctor-change','Test');
SELECT is((SELECT count(*) FROM runs WHERE code='printing' AND status='ready'),0::bigint,'Changed design waits for active Design QC');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000001',true);
SELECT public.approve_and_release_design_revision('ba200000-0000-4000-8000-000000000023',gen_random_uuid(),'Approved requested change');
SELECT public.complete_stage_run((SELECT id FROM runs WHERE code='printing' AND status='ready'));
SELECT public.complete_stage_run((SELECT id FROM runs WHERE seq=30 AND status='ready'));
SELECT pg_temp.send_repeat_trial('new_design');
SELECT is((SELECT count(DISTINCT l.production_stage_run_id) FROM public.shipment_orders l JOIN pilot_shipments h ON h.id=l.shipment_id),3::bigint,
    'Each trial has its own shipping run and receipt');
SELECT is((SELECT first_delivered_at FROM pilot_order),NULL::timestamptz,'Repeated trial receipts leave final delivery unset');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000002',true);
SELECT public.mixed_try_in_doctor_action((SELECT id FROM runs WHERE code='doctor_review' AND status='ready'),'approve','Doctor accepted');
SELECT is((SELECT status FROM runs WHERE code='milling'),'ready','Doctor approval opens milling without a separate release');
SELECT is((SELECT production_status FROM pilot_order),'finalization','The order enters finalization when approval is saved');
SELECT lives_ok($$SELECT public.mixed_try_in_doctor_action(
    (SELECT id FROM runs WHERE code='doctor_review' AND doctor_approved_at IS NOT NULL),'approve','Repeated request')$$,
    'Retrying the same approval succeeds');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000001',true);
SELECT is((SELECT array_agg(notes) FROM public.order_events WHERE order_id=(SELECT id FROM pilot_order) AND event_type='try_in_approved'),
    ARRAY['Doctor accepted'], 'The doctor approval is recorded once with the original note');
SELECT is((SELECT count(*) FROM public.external_work_orders w JOIN runs r ON r.id=w.stage_run_id WHERE r.code='milling'),
    0::bigint, 'Approval queues milling without sending a supplier work order');
SELECT is(public.get_mixed_try_in_price((SELECT id FROM runs WHERE code='milling'),'ba200000-0000-4000-8000-000000000012'),250::numeric,'Supplier-specific milling price overrides the frozen catalog rate');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000005',true);
SELECT throws_ok($$SELECT public.send_external_work_order((SELECT id FROM runs WHERE code='milling'),'ba200000-0000-4000-8000-000000000012',NULL,1)$$,
    '42501','تعديل السعر للأدمن فقط','Production manager cannot send with a manual price');
SELECT lives_ok($$SELECT public.send_external_work_order((SELECT id FROM runs WHERE code='milling'))$$,
    'Production manager can send with the frozen default supplier and price');
SELECT throws_ok($$SELECT public.update_mixed_try_in_price((SELECT id FROM runs WHERE code='milling'),1,'Attempt')$$,
    '42501','تعديل السعر للأدمن فقط','Production manager cannot reprice a work order');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000001',true);
SELECT is((SELECT agreed_cost FROM public.external_work_orders WHERE stage_run_id=(SELECT id FROM runs WHERE code='milling')),NULL::numeric,'The operational work order exposes no pilot price');
SELECT is(public.get_mixed_try_in_price((SELECT id FROM runs WHERE code='milling')),250::numeric,'Admin can read the agreed price');
SELECT public.update_mixed_try_in_price((SELECT id FROM runs WHERE code='milling'),270,'Agreed finish adjustment');
SELECT is(public.get_mixed_try_in_price((SELECT id FROM runs WHERE code='milling')),270::numeric,'Admin can revise the agreed price');
SELECT public.receive_external_work_order((SELECT id FROM public.external_work_orders WHERE stage_run_id=(SELECT id FROM runs WHERE code='milling')));
SELECT is((SELECT count(*) FROM public.financial_obligations WHERE order_id=(SELECT id FROM pilot_order) AND entity_type='external_lab'),0::bigint,'Outside receipt does not duplicate lab AP');
SELECT is((SELECT status FROM runs WHERE seq=70),'ready','External receipt opens internal physical QC');
SELECT throws_like($$SELECT public.create_shipment('ba200000-0000-4000-8000-000000000013','ba200000-0000-4000-8000-000000000010',NULL,ARRAY['ba200000-0000-4000-8000-000000000011'::uuid])$$,'%جاهزة للشحن%','Final shipment cannot skip the QC decision');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000004',true);
SELECT throws_ok($$SELECT public.complete_stage_run((SELECT id FROM runs WHERE seq=70))$$,'42501','دورك غير مسموح له بتنفيذ هذه المرحلة','Only assigned roles can pass physical QC');
SELECT throws_ok($$SELECT public.mixed_physical_qc_action((SELECT id FROM runs WHERE seq=70),'bypass','test')$$,'42501','إجراء الفحص للأدمن فقط','Technician cannot bypass physical QC');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000001',true);
SELECT throws_ok($$SELECT public.complete_stage_run((SELECT id FROM runs WHERE seq=70),1,1,'fit')$$,'23514',
 'الفحص للحالة كاملة؛ لا يمكن تمرير جزء منها','Physical QC cannot release part of the trial case');
SELECT public.complete_stage_run((SELECT id FROM runs WHERE seq=70),0,2,'fit');
SELECT is((SELECT status FROM runs WHERE seq=90),'pending','Whole-case failure blocks final shipping');
SELECT is((SELECT j.status FROM public.production_jobs j JOIN pilot_order o ON o.id=j.order_id),'blocked','Whole-case failure remains in a recoverable state');
SELECT public.mixed_physical_qc_action((SELECT id FROM runs WHERE seq=70),'retry','Fit corrected');
SELECT is((SELECT status FROM runs WHERE seq=70),'ready','Admin can reopen failed physical QC');
SELECT throws_ok($$SELECT public.mixed_physical_qc_action(
    (SELECT id FROM public.production_stage_runs WHERE job_id=(SELECT job_id FROM runs WHERE seq=70)
        AND seq=70 AND failure_cause_code='fit'),'return_lab','Stale decision')$$,
    'P0001','إجراء الفحص غير متاح للحالة الحالية','A failed attempt cannot be routed twice');
SELECT is((SELECT count(*) FROM public.production_stage_runs WHERE job_id=(SELECT job_id FROM runs WHERE seq=70)
    AND seq=70 AND failure_cause_code='fit' AND qc_followup_run_id IS NOT NULL),1::bigint,'The failed check remains recorded after reopening');
SELECT public.complete_stage_run((SELECT id FROM runs WHERE seq=70),0,2,'contact');
SELECT public.mixed_physical_qc_action((SELECT id FROM runs WHERE seq=70),'return_design','Correct the contacts');
SELECT is((SELECT production_status FROM pilot_order),'designing','Returning after physical QC reopens the designer dashboard');
SELECT is((SELECT count(*) FROM runs WHERE code='design' AND rework_of IS NOT NULL AND status='ready'),1::bigint,'Design return creates a new design task');
SELECT is((SELECT status FROM runs WHERE code='milling' AND rework_of IS NOT NULL),'pending','Refabrication waits for the corrected design');
UPDATE public.production_doctor_waits SET started_at=now()-interval '90 minutes',ended_at=now()-interval '60 minutes'
WHERE order_id=(SELECT id FROM pilot_order);
UPDATE public.production_stage_runs SET completed_at=now()-interval '80 minutes'
WHERE id=(SELECT id FROM runs WHERE code='design' AND rework_of IS NULL);
UPDATE public.production_stage_runs SET queued_at=now()-interval '20 minutes'
WHERE id=(SELECT id FROM runs WHERE code='design' AND status='ready');
SELECT is((SELECT design_minutes FROM public.production_case_times((SELECT id FROM pilot_order))),50,'Design corrections are counted with design, excluding doctor time');
SELECT is((SELECT production_minutes FROM public.production_case_times((SELECT id FROM pilot_order))),40,'Production time excludes the reopened design interval');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000003',true);
SELECT public.submit_design_delivery('ba200000-0000-4000-8000-000000000011','ba200000-0000-4000-8000-000000000022','link','https://example.test/mixed-design-fix','No HTML in fixture');
SELECT is((SELECT status FROM runs WHERE code='milling' AND rework_of IS NOT NULL),'pending','Refabrication still waits for Design QC on the corrected revision');
SELECT set_config('request.jwt.claim.sub','ba200000-0000-4000-8000-000000000001',true);
SELECT public.approve_and_release_design_revision('ba200000-0000-4000-8000-000000000022',gen_random_uuid(),'Approved revised design');
SELECT is((SELECT status FROM runs WHERE code='milling' AND rework_of IS NOT NULL),'ready','Corrected design opens a new lab task without repeating the trial shipment');
SELECT public.send_external_work_order((SELECT id FROM runs WHERE code='milling' AND status='ready'),'ba200000-0000-4000-8000-000000000012');
SELECT public.receive_external_work_order((SELECT w.id FROM public.external_work_orders w JOIN runs r ON r.id=w.stage_run_id WHERE r.code='milling' AND w.status='sent'));
SELECT public.complete_stage_run((SELECT id FROM runs WHERE seq=70),0,2,'shade');
SELECT public.mixed_physical_qc_action((SELECT id FROM runs WHERE seq=70),'return_lab','Correct the shade');
SELECT is((SELECT supplier_id FROM runs WHERE code='milling' AND status='ready'),'ba200000-0000-4000-8000-000000000012'::uuid,'Lab return goes to the original supplier');
SELECT throws_ok($$SELECT public.send_external_work_order((SELECT id FROM runs WHERE code='milling' AND status='ready'),'ba200000-0000-4000-8000-000000000013')$$,
    'P0001','إعادة العمل تُرسل للمعمل الأصلي على نفس حساب الحالة','Lab repair cannot be sent to another supplier');
SELECT public.send_external_work_order((SELECT id FROM runs WHERE code='milling' AND status='ready'),'ba200000-0000-4000-8000-000000000012');
SELECT is((SELECT count(*) FROM public.external_work_orders w JOIN runs r ON r.id=w.stage_run_id WHERE r.code='milling'),3::bigint,'Each physical lab send has its own tracked work order');
SELECT public.receive_external_work_order((SELECT w.id FROM public.external_work_orders w JOIN runs r ON r.id=w.stage_run_id WHERE r.code='milling' AND w.status='sent'));
SELECT is((SELECT status FROM runs WHERE seq=70),'ready','Lab repair receipt opens a new QC check');
SELECT is((SELECT count(*) FROM public.financial_obligations WHERE order_id=(SELECT id FROM pilot_order) AND entity_type='external_lab'),0::bigint,'Repeated vendor receipt creates no payable');
SELECT public.complete_stage_run((SELECT id FROM runs WHERE seq=70),0,2,'shade');
SELECT public.mixed_physical_qc_action((SELECT id FROM runs WHERE seq=70),'replace_lab','A different lab is needed');
SELECT throws_ok($$SELECT public.send_external_work_order((SELECT id FROM runs WHERE is_supplier_replacement),'ba200000-0000-4000-8000-000000000012')$$,
    'P0001','اختر معملًا مختلفًا عن المعمل الحالي','Replacement rejects the current supplier');
UPDATE public.suppliers SET milling_prices='{"Pilot zirconia":145}' WHERE id='ba200000-0000-4000-8000-000000000014';
SELECT public.send_external_work_order((SELECT id FROM runs WHERE is_supplier_replacement),'ba200000-0000-4000-8000-000000000014');
SELECT is((SELECT supplier_id FROM pilot_order),'ba200000-0000-4000-8000-000000000014'::uuid,'Alternate becomes the case supplier');
SELECT is(public.get_mixed_try_in_price((SELECT id FROM runs WHERE is_supplier_replacement)),290::numeric,'Alternate gets its own supplier quote');
SELECT public.receive_external_work_order((SELECT w.id FROM public.external_work_orders w JOIN runs r ON r.id=w.stage_run_id WHERE r.is_supplier_replacement));
SELECT public.complete_stage_run((SELECT id FROM runs WHERE seq=70));
SELECT is((SELECT production_status FROM pilot_order),'final_ready','Passing final QC directly opens shipping');
INSERT INTO pilot_shipments SELECT 'final',(public.create_shipment('ba200000-0000-4000-8000-000000000013','ba200000-0000-4000-8000-000000000010',NULL,ARRAY['ba200000-0000-4000-8000-000000000011'::uuid])->>'shipment_id')::uuid;
SELECT is((SELECT r.seq FROM public.shipment_orders l JOIN runs r ON r.id=l.production_stage_run_id WHERE l.shipment_id=(SELECT id FROM pilot_shipments WHERE purpose='final')),90,'Final shipment linked to second shipping step');
SELECT public.dispatch_shipment((SELECT id FROM pilot_shipments WHERE purpose='final'));
SELECT is((SELECT first_delivered_at FROM pilot_order),NULL::timestamptz,'Courier dispatch is not final receipt');
SELECT is((SELECT count(*) FROM public.financial_obligations WHERE order_id=(SELECT id FROM pilot_order) AND entity_type='external_lab'),0::bigint,'Courier dispatch does not accrue lab payable');
SELECT public.confirm_shipment_delivery((SELECT id FROM pilot_shipments WHERE purpose='final'));
SELECT is((SELECT production_status FROM pilot_order),'final_delivered','Doctor receipt closes the final shipment');
SELECT is((SELECT net_amount FROM public.financial_obligations WHERE order_id=(SELECT id FROM pilot_order) AND entity_type='external_lab' AND status<>'void'),290::numeric,'Final receipt accrues one supplier obligation at the alternate agreed price');
SELECT is((SELECT entity_id FROM public.financial_obligations WHERE order_id=(SELECT id FROM pilot_order) AND entity_type='external_lab' AND status<>'void'),
    'ba200000-0000-4000-8000-000000000014'::uuid,'The final payable belongs to the lab selected for replacement');
SELECT throws_ok($$SELECT public.update_mixed_try_in_price((SELECT id FROM runs WHERE code='milling' AND rework_of IS NULL),1,'Old vendor')$$,
    'P0001','السعر محفوظ للمعمل السابق. عدّل سعر المعمل الحالي','Archived quote cannot update the final payable');
SELECT public.update_mixed_try_in_price((SELECT id FROM runs WHERE is_supplier_replacement),285,'Verified during account review');
SELECT is((SELECT net_amount FROM public.financial_obligations WHERE order_id=(SELECT id FROM pilot_order) AND entity_type='external_lab' AND status<>'void'),285::numeric,'Account review updates the same unpaid obligation');
SELECT * FROM finish();
ROLLBACK;
