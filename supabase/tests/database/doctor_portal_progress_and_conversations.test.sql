BEGIN;
SET search_path = public, extensions;
SELECT no_plan();

INSERT INTO auth.users(id, email)
SELECT ('db570000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, 'portal-workflow-' || n || '@example.test'
FROM generate_series(1,5) n;
INSERT INTO public.doctors(id, name, phone, address, doctor_code, representative_name) VALUES
 ('db570000-0000-4000-8000-000000000004','Portal review doctor','01050006004','QA','PORTAL-TEST-01','QA'),
 ('db570000-0000-4000-8000-000000000005','Portal sibling doctor','01050006005','QA','PORTAL-TEST-02','QA');
INSERT INTO public.users(id, auth_id, username, role, name, entity_id)
SELECT id, id, split_part(email, '@', 1),
       CASE right(id::text, 1) WHEN '1' THEN 'admin' WHEN '2' THEN 'designer' WHEN '3' THEN 'coordinator' ELSE 'doctor' END,
       split_part(email, '@', 1), CASE WHEN right(id::text, 1) IN ('4','5') THEN id END
FROM auth.users WHERE id::text LIKE 'db570000-0000-4000-8000-%';
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000001', true);
UPDATE public.doctors SET requires_design_approval = true WHERE doctor_code='PORTAL-TEST-01';
SELECT public.set_design_qc_enabled(false, 'Portal approval integration test');

INSERT INTO public.orders(id, case_id, doctor_id, patient_name, items, total_price, cost, shade,
    production_status, delivery_date, delivery_type, workflow_type, designer_id, design_price)
VALUES
 ('db570000-0000-4000-8000-000000000021','PORTAL-REVIEW-TRIAL','db570000-0000-4000-8000-000000000004',
  'Try-in sample','[]',500,0,'A1','designing',current_date+2,'TryIn','split','db570000-0000-4000-8000-000000000002',50),
 ('db570000-0000-4000-8000-000000000022','PORTAL-REVIEW-FINAL','db570000-0000-4000-8000-000000000005',
  'Final sample','[]',500,0,'A1','designing',current_date+2,'Final','split','db570000-0000-4000-8000-000000000002',50);

INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
 ('design-qc-files','db570000-0000-4000-8000-000000000022/db570000-0000-4000-8000-000000000032/preview.html',
  '{"size":100,"eTag":"portal-preview","mimetype":"text/html"}');
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000002', true);
SELECT public.submit_design_delivery('db570000-0000-4000-8000-000000000021','db570000-0000-4000-8000-000000000031','link','https://example.test/first','No model in SQL fixture');
SELECT public.submit_design_delivery('db570000-0000-4000-8000-000000000022','db570000-0000-4000-8000-000000000032','link','https://example.test/final','');
SELECT is((SELECT production_status FROM public.orders WHERE case_id='PORTAL-REVIEW-TRIAL'), 'designing', 'Opted-in case waits with Design QC paused');
SELECT is((SELECT production_status FROM public.orders WHERE case_id='PORTAL-REVIEW-FINAL'), 'in_production', 'Regular external case keeps its existing flow');

SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000003', true);
SELECT throws_ok($$ SELECT public.release_design_revision('db570000-0000-4000-8000-000000000021') $$,
    '23514', 'Doctor design approval required', 'Staff cannot release an opted-in pending design');
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000005', true);
SELECT is((SELECT state FROM public.get_my_doctor_design_reviews() WHERE revision_id='db570000-0000-4000-8000-000000000032'),
    'preview_only', 'A regular design is presented as a preview without a decision');
SELECT ok(public.doctor_design_preview_allowed('db570000-0000-4000-8000-000000000022/db570000-0000-4000-8000-000000000032/preview.html'),
    'The treating doctor can read current HTML with no review request');
SELECT ok(NOT public.doctor_design_preview_allowed('db570000-0000-4000-8000-000000000022/db570000-0000-4000-8000-000000000032/execution.zip'),
    'The preview scope excludes execution files');
SELECT throws_ok($$ SELECT public.decide_doctor_design_review('db570000-0000-4000-8000-000000000031','approved') $$,
    '42501', 'Doctor design review access denied', 'Another doctor cannot approve it');
SELECT throws_ok($$ SELECT public.write_doctor_support_thread('start', NULL, 'db570000-0000-4000-8000-000000000021', 'Other case') $$,
    '42501', 'Support access denied', 'Another doctor cannot attach a conversation to the case');

SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000004', true);
SELECT is((SELECT state FROM public.get_my_doctor_design_reviews() WHERE revision_id='db570000-0000-4000-8000-000000000031'),
    'pending','The opted-in doctor has a decision to make');
SELECT ok(NOT public.doctor_design_preview_allowed('db570000-0000-4000-8000-000000000022/db570000-0000-4000-8000-000000000032/preview.html'),
    'A doctor cannot see the HTML for another patient');
SELECT is((SELECT has_try_in FROM public.get_doctor_portal_case_progress() WHERE order_id='db570000-0000-4000-8000-000000000021'),true,'Try-in metadata is returned to the owning doctor');
SELECT throws_ok($$ SELECT public.decide_doctor_design_review('db570000-0000-4000-8000-000000000031','changes',' ') $$,
    '22023', 'Write the requested changes', 'Changes require a note');
SELECT lives_ok($$ SELECT public.decide_doctor_design_review('db570000-0000-4000-8000-000000000031','changes','Adjust the contact') $$,'Doctor sends design feedback');
SELECT is((SELECT note FROM public.design_qc_events WHERE revision_id='db570000-0000-4000-8000-000000000031' AND action='returned'),
    'Adjust the contact','Designer sees the note in the existing return workflow');

CREATE TEMP TABLE chat_fixture AS
SELECT public.write_doctor_support_thread('start',NULL,'db570000-0000-4000-8000-000000000021','First question') AS thread_id;
SELECT is(public.write_doctor_support_thread('start',NULL,'db570000-0000-4000-8000-000000000021','One more detail'),
    (SELECT thread_id FROM chat_fixture), 'A follow-up goes to the same open conversation');
SELECT lives_ok($$ SELECT public.write_doctor_support_thread('start',NULL,NULL,'General question') $$,'Doctor can also start a general conversation');
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000003', true);
SELECT lives_ok($$ SELECT public.write_doctor_support_thread('reply',(SELECT thread_id FROM chat_fixture),NULL,'Lab reply') $$,'Lab replies to the same conversation');
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000004', true);
SELECT is((SELECT jsonb_array_length(t->'posts') FROM jsonb_array_elements(public.get_doctor_support_threads()) t
    WHERE (t->>'id')::uuid=(SELECT thread_id FROM chat_fixture)),3,'Doctor sees both messages and the lab reply together');
SELECT lives_ok($$ SELECT public.write_doctor_support_thread('close',(SELECT thread_id FROM chat_fixture)) $$,'Doctor can mark it resolved');
SELECT throws_ok($$ SELECT public.write_doctor_support_thread('reply',(SELECT thread_id FROM chat_fixture),NULL,'Too late') $$,
    '23514','Conversation is closed','Closed conversation rejects new replies');
SELECT isnt(public.write_doctor_support_thread('start',NULL,'db570000-0000-4000-8000-000000000021','New question'),
    (SELECT thread_id FROM chat_fixture), 'A new message after closure starts a new conversation');

SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000002', true);
SELECT public.submit_design_delivery('db570000-0000-4000-8000-000000000021','db570000-0000-4000-8000-000000000033','link','https://example.test/revised','No model in SQL fixture');
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000004', true);
SELECT lives_ok($$ SELECT public.decide_doctor_design_review('db570000-0000-4000-8000-000000000033','approved') $$,'Doctor approves the new revision');
SELECT is((SELECT production_status FROM public.orders WHERE case_id='PORTAL-REVIEW-TRIAL'), 'in_production', 'Approval releases the case while Design QC is paused');
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000003', true);
SELECT lives_ok($$ SELECT public.write_doctor_support_thread('close',(SELECT (t->>'id')::uuid
    FROM jsonb_array_elements(public.get_doctor_support_threads()) t
    WHERE t->>'case_id'='PORTAL-REVIEW-TRIAL' AND t->>'closed_at' IS NULL)) $$,'Lab can also resolve the new conversation');
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000001', true);
SELECT public.set_design_qc_enabled(true, 'Test independent lab review');
SELECT public.return_design_revision('db570000-0000-4000-8000-000000000021','db570000-0000-4000-8000-000000000002','New change');
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000002', true);
SELECT public.submit_design_delivery('db570000-0000-4000-8000-000000000021','db570000-0000-4000-8000-000000000034','link','https://example.test/with-qc','No model in SQL fixture');
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000004', true);
SELECT public.decide_doctor_design_review('db570000-0000-4000-8000-000000000034','approved');
SELECT is((SELECT production_status FROM public.orders WHERE case_id='PORTAL-REVIEW-TRIAL'), 'designing', 'Doctor approval does not waive enabled Design QC');
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000001', true);
SELECT public.approve_and_release_design_revision('db570000-0000-4000-8000-000000000034',gen_random_uuid(),'Lab QC passed');
SELECT is((SELECT production_status FROM public.orders WHERE case_id='PORTAL-REVIEW-TRIAL'), 'in_production', 'Lab review releases the doctor-approved revision');
SELECT public.set_design_qc_enabled(false, 'Mixed route portal approval');
INSERT INTO public.services(name,selling_price,cost_price,milling_price,designer_price)
VALUES ('Portal trial zirconia',900,300,150,50);
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,
    production_status,delivery_date,delivery_type,workflow_type,designer_id,design_price,route_override_id)
VALUES ('db570000-0000-4000-8000-000000000023','PORTAL-REVIEW-MIXED','db570000-0000-4000-8000-000000000004',
    'Mixed sample','[]',900,300,'A1','designing',current_date+2,'TryIn','split',
    'db570000-0000-4000-8000-000000000002',50,'ba100000-0000-4000-8000-000000000001');
INSERT INTO public.order_items(order_id,product_type,teeth_numbers,price,shade,count)
VALUES ('db570000-0000-4000-8000-000000000023','Portal trial zirconia','["11"]',900,'A1',1);
CREATE TEMP VIEW mixed_portal_stages AS
SELECT s.code, r.status FROM public.production_stage_runs r
JOIN public.production_stages s ON s.id=r.stage_id JOIN public.production_jobs j ON j.id=r.job_id
WHERE j.order_id='db570000-0000-4000-8000-000000000023';
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000002', true);
SELECT public.submit_design_delivery('db570000-0000-4000-8000-000000000023','db570000-0000-4000-8000-000000000035','link',
    'https://example.test/mixed','No model in SQL fixture');
SELECT is((SELECT status FROM mixed_portal_stages WHERE code='printing'),'pending','Internal trial printing still waits for the doctor');
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000004', true);
SELECT lives_ok($$ SELECT public.decide_doctor_design_review('db570000-0000-4000-8000-000000000035','approved') $$,
    'Doctor can release the opted-in mixed case while lab Design QC is paused');
SELECT is((SELECT status FROM mixed_portal_stages WHERE code='printing'),'ready','Mixed production continues from the route to trial printing');
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000001', true);
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,
    production_status,delivery_date,delivery_type,workflow_type)
VALUES
 ('db570000-0000-4000-8000-000000000025','PORTAL-TRYIN-YES','db570000-0000-4000-8000-000000000004',
 'Approval sample','[]',500,0,'A1','waiting_doctor',current_date+2,'TryIn','full'),
 ('db570000-0000-4000-8000-000000000026','PORTAL-TRYIN-EDIT','db570000-0000-4000-8000-000000000004',
 'Revision sample','[]',500,0,'A1','waiting_doctor',current_date+2,'TryIn','full');
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000005', true);
SELECT throws_ok($$ SELECT public.respond_to_doctor_try_in('db570000-0000-4000-8000-000000000025', now(), 'approve') $$,
    '42501', 'Trial response access denied', 'Another doctor cannot respond to the trial');
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000004', true);
SELECT throws_ok($$ SELECT public.respond_to_doctor_try_in('db570000-0000-4000-8000-000000000025', now() - interval '1 day','approve') $$,
    '23514', 'This trial is no longer awaiting your response', 'The portal rejects an old case version');
SELECT throws_ok($$ SELECT public.respond_to_doctor_try_in('db570000-0000-4000-8000-000000000026', now(), 'changes',' ') $$,
    '22023','Write the requested trial changes','A trial adjustment must include a note');
SELECT public.respond_to_doctor_try_in('db570000-0000-4000-8000-000000000025',
    (SELECT order_version FROM public.get_my_doctor_try_in_requests() WHERE order_id='db570000-0000-4000-8000-000000000025'),'approve');
SELECT is((SELECT production_status FROM public.orders WHERE case_id='PORTAL-TRYIN-YES'),'finalization','Approval starts the legacy final');
SELECT public.respond_to_doctor_try_in('db570000-0000-4000-8000-000000000026',
    (SELECT order_version FROM public.get_my_doctor_try_in_requests() WHERE order_id='db570000-0000-4000-8000-000000000026'),'changes','Adjust the fit');
SELECT is((SELECT production_status FROM public.orders WHERE case_id='PORTAL-TRYIN-EDIT'),'in_production','A full external case returns to production for adjustment');
SELECT is((SELECT notes FROM public.order_events WHERE order_id='db570000-0000-4000-8000-000000000026' AND event_type='try_in_adjustment_requested'),
    'Adjust the fit','The lab can see the adjustment note in case history');

SELECT throws_ok($$ SELECT public.start_lab_doctor_support('db570000-0000-4000-8000-000000000005',NULL,'Account','Not staff') $$,
    '42501','Support access denied','The doctor cannot impersonate the lab');
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000003', true);
SELECT ok(EXISTS(SELECT 1 FROM public.get_lab_support_recipients() WHERE id='db570000-0000-4000-8000-000000000005'),
    'Coordinator can select an active portal recipient');
SELECT throws_ok($$ SELECT public.start_lab_doctor_support('db570000-0000-4000-8000-000000000005',
    'db570000-0000-4000-8000-000000000021','Wrong case','The recipient must own this case') $$,
    '42501','Support access denied','Lab cannot attach a case outside the recipient scope');
CREATE TEMP TABLE lab_conversations AS SELECT
    public.start_lab_doctor_support('db570000-0000-4000-8000-000000000005',NULL,'Monthly account','Please check the monthly statement') AS general_id,
    public.start_lab_doctor_support('db570000-0000-4000-8000-000000000005','db570000-0000-4000-8000-000000000022',
        'Shade confirmation','Please confirm the shade') AS linked_id;
SELECT isnt((SELECT general_id FROM lab_conversations),(SELECT linked_id FROM lab_conversations),
    'A general message and a case message go into separate conversations');
SELECT is(public.start_lab_doctor_support('db570000-0000-4000-8000-000000000005',NULL,'Different title','A follow-up'),
    (SELECT general_id FROM lab_conversations),'Lab follow-up joins the open general conversation');
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000004', true);
SELECT ok(NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(public.get_doctor_support_threads()) AS t
    WHERE (t->>'id')::uuid IN (SELECT linked_id FROM lab_conversations UNION SELECT general_id FROM lab_conversations)
),'A different doctor cannot read either lab-initiated conversation');
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000005', true);
SELECT is((SELECT t->>'subject' FROM jsonb_array_elements(public.get_doctor_support_threads()) AS t
    WHERE (t->>'id')::uuid=(SELECT general_id FROM lab_conversations)),'Monthly account','Original subject survives a follow-up');
SELECT is((SELECT t->'posts'->0->>'from_lab' FROM jsonb_array_elements(public.get_doctor_support_threads()) AS t
    WHERE (t->>'id')::uuid=(SELECT linked_id FROM lab_conversations)),'true','The recipient sees who initiated the case conversation');
SELECT lives_ok($$ SELECT public.write_doctor_support_thread('reply',(SELECT linked_id FROM lab_conversations),NULL,'Shade confirmed') $$,
    'Doctor can reply to the lab in the same case conversation');
SELECT public.write_doctor_support_thread('close',(SELECT general_id FROM lab_conversations));
SELECT set_config('request.jwt.claim.sub','db570000-0000-4000-8000-000000000003', true);
SELECT isnt(public.start_lab_doctor_support('db570000-0000-4000-8000-000000000005',NULL,'Next month','New topic'),
    (SELECT general_id FROM lab_conversations),'Lab can start a separate general conversation after closure');
SELECT * FROM finish();
ROLLBACK;
