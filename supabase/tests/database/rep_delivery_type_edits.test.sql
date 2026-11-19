BEGIN;
SET search_path TO public, extensions;
SELECT no_plan();

SELECT is(public.delivery_type_transition_status(status, 'TryIn', 'Final'), expected,
    'TryIn to Final at ' || status)
FROM (VALUES ('not_started','not_started'), ('designing','designing'), ('in_production','in_production'),
    ('try_in_ready','in_production'), ('waiting_doctor','in_production'), ('finalization','in_production'),
    ('final_ready','final_ready'), ('final_delivered','final_delivered')) states(status,expected);
SELECT is(public.delivery_type_transition_status(status, 'Final', 'TryIn'), expected,
    'Final to TryIn at ' || status)
FROM (VALUES ('not_started','not_started'), ('designing','designing'), ('in_production','in_production'),
    ('final_ready','try_in_ready'), ('final_delivered','final_delivered')) states(status,expected);
SELECT throws_ok($$SELECT public.delivery_type_transition_status('in_production','Final',NULL)$$,
    '22023', 'نوع التسليم يجب أن يكون Final أو TryIn', 'null type is rejected');

UPDATE public.app_settings SET value='on' WHERE key IN ('workflow_issue_v2_write','workflow_issue_v2_enforce');
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT ('99420000-0000-0000-0000-00000000000'||i)::uuid, '00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated','rep-type-'||i||'@example.test','','{}','{}',now(),now()
FROM generate_series(1,4) i;
INSERT INTO public.users(id,auth_id,username,role,name) VALUES
    ('39420000-0000-0000-0000-000000000001','99420000-0000-0000-0000-000000000001','type_admin','admin','Type Admin'),
    ('39420000-0000-0000-0000-000000000002','99420000-0000-0000-0000-000000000002','type_rep','representative','Type Rep'),
    ('39420000-0000-0000-0000-000000000003','99420000-0000-0000-0000-000000000003','type_coordinator','coordinator','Type Coordinator'),
    ('39420000-0000-0000-0000-000000000004','99420000-0000-0000-0000-000000000004','type_designer','designer','Type Designer');
INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name)
VALUES ('19420000-0000-0000-0000-000000000001','Type Doctor','01000000200','Test','TYPE-TEST','Type Rep');
INSERT INTO public.suppliers(id,name,phone)
VALUES ('29420000-0000-0000-0000-000000000001','Type Lab','01000000201');
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,shade,status,
    delivery_date,cost,supplier_id,representative_id,production_status,issue_state,delivery_type)
VALUES ('49420000-0000-0000-0000-000000000001','REP-TYPE-TEST','19420000-0000-0000-0000-000000000001',
    'Type Patient','[]',1000,'A1','Ready',current_date,400,'29420000-0000-0000-0000-000000000001',
    '39420000-0000-0000-0000-000000000002','final_ready','none','Final');

INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,status,delivery_date,representative_id,
    production_status,issue_state,delivery_type,workflow_type,designer_id,route_override_id)
VALUES ('49420000-0000-0000-0000-000000000002','REP-ROUTE-LOCK-TEST','19420000-0000-0000-0000-000000000001',
    'Type Route','[]',1000,0,'A1','In Progress',current_date,'39420000-0000-0000-0000-000000000002',
    'designing','none','TryIn','split','39420000-0000-0000-0000-000000000004','ba100000-0000-4000-8000-000000000001');

SELECT set_config('request.jwt.claim.sub','99420000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$UPDATE public.orders SET delivery_type='TryIn'
    WHERE id='49420000-0000-0000-0000-000000000001'$$,
    '42501','Delivery type changes require the audited representative RPC',
    'representative cannot write the type directly on their own order');
SELECT throws_ok($$SELECT public.rep_update_order_fields_with_audit('49420000-0000-0000-0000-000000000002',
    '{"delivery_type":"Final"}','doctor_requested','final requested')$$,
    'P0001','نوع التسليم ثابت في خريطة الإنتاج الخاصة بالأوردر','a fixed production route keeps its delivery type');
SELECT lives_ok($$SELECT public.rep_update_order_fields_with_audit('49420000-0000-0000-0000-000000000001',
    '{"delivery_type":"TryIn"}','doctor_requested','trial requested')$$, 'representative changes Final to TryIn through audited edit');
RESET ROLE;
SELECT is((SELECT delivery_type||':'||production_status FROM public.orders WHERE case_id='REP-TYPE-TEST'),
    'TryIn:try_in_ready','ready final becomes ready trial');
SELECT is((SELECT count(*)::integer FROM public.financial_obligations
    WHERE order_id='49420000-0000-0000-0000-000000000001' AND status NOT IN ('void','written_off')),
    0,'premature lab payable is voided');
SELECT is((SELECT old_value||':'||new_value FROM public.order_events
    WHERE order_id='49420000-0000-0000-0000-000000000001' AND event_type='delivery_type_changed'),
    'Final:TryIn','type audit records old and new values');

SELECT set_config('request.jwt.claim.sub','99420000-0000-0000-0000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.rep_update_order_fields_with_audit('49420000-0000-0000-0000-000000000001',
    '{"delivery_type":"Final"}','doctor_requested','final requested')$$, 'coordinator uses the same audited path');
SELECT throws_ok($$UPDATE public.orders SET delivery_type='TryIn'
    WHERE id='49420000-0000-0000-0000-000000000001'$$,
    '42501','Delivery type changes require the audited representative RPC','direct type write is denied');
RESET ROLE;
SELECT is((SELECT delivery_type||':'||production_status FROM public.orders WHERE case_id='REP-TYPE-TEST'),
    'Final:in_production','trial to final returns to production, never final-ready');

-- Delivery history still gates this field behind admin approval.
SELECT set_config('request.jwt.claim.sub','99420000-0000-0000-0000-000000000001',true);
SELECT public.record_order_final_delivery_v2('49420000-0000-0000-0000-000000000001',now(),gen_random_uuid());
SELECT set_config('request.jwt.claim.sub','99420000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT public.rep_update_order_fields_with_audit('49420000-0000-0000-0000-000000000001',
    '{"delivery_type":"TryIn"}','wrong_intake_data','type correction after delivery');
SELECT throws_like($$SELECT public.rep_update_order_fields_with_audit('49420000-0000-0000-0000-000000000001',
    '{"production_status":"not_started"}','doctor_requested','forged status')$$,
    '%not in audited rep allow-list%', 'representative cannot submit arbitrary production status');
SELECT throws_like($$SELECT public.rep_update_order_fields_with_audit('49420000-0000-0000-0000-000000000001',
    '{"is_urgent":true}','doctor_requested','forged urgency')$$,
    '%not in audited rep allow-list%', 'removed urgency flag is rejected');
SELECT throws_like($$SELECT public.rep_update_order_fields_with_audit('49420000-0000-0000-0000-000000000001',
    '{"priority":"Urgent"}','doctor_requested','forged priority')$$,
    '%not in audited rep allow-list%', 'removed priority is rejected');
SELECT throws_ok($$SELECT public.rep_update_order_fields_with_audit('49420000-0000-0000-0000-000000000001',
    '{"delivery_type":"invalid"}','doctor_requested','invalid')$$,
    '22023','نوع التسليم يجب أن يكون Final أو TryIn','invalid type cannot even enter a proposal');
RESET ROLE;
SELECT is((SELECT delivery_type FROM public.orders WHERE case_id='REP-TYPE-TEST'),'Final','proposal does not mutate delivered order');
SELECT is((SELECT metadata->'oldValues'->>'delivery_type' FROM public.order_events
    WHERE order_id='49420000-0000-0000-0000-000000000001' AND event_type='order_edit_proposed' AND approval_status='pending'),
    'Final','proposal snapshots delivery type');
SELECT set_config('request.jwt.claim.sub','99420000-0000-0000-0000-000000000001',true);
SELECT public.admin_review_order_edit((SELECT id FROM public.order_events
    WHERE order_id='49420000-0000-0000-0000-000000000001' AND event_type='order_edit_proposed' AND approval_status='pending'),'approve','approved');
SELECT is((SELECT delivery_type||':'||production_status FROM public.orders WHERE case_id='REP-TYPE-TEST'),
    'TryIn:final_delivered','approval changes type without undoing a completed delivery');
SELECT ok((SELECT actual_delivery_date IS NOT NULL AND first_delivered_at IS NOT NULL
    FROM public.orders WHERE case_id='REP-TYPE-TEST'),'approval preserves delivery evidence');
SELECT is((SELECT net_amount FROM public.financial_obligations
    WHERE order_id='49420000-0000-0000-0000-000000000001' AND entity_type='doctor' AND status NOT IN ('void','written_off')),
    1000::numeric,'delivered doctor receivable remains intact');

SELECT * FROM finish();
ROLLBACK;
