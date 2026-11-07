BEGIN;
SET search_path = public, extensions;
SELECT plan(20);

INSERT INTO auth.users(id,email) VALUES
    ('ab100000-0000-4000-8000-000000000001','qc-combined-admin@local.test'),
    ('ab100000-0000-4000-8000-000000000002','qc-combined-coordinator@local.test'),
    ('ab100000-0000-4000-8000-000000000003','qc-combined-designer@local.test');
INSERT INTO public.users(id,auth_id,username,role,name) VALUES
    ('ab100000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000001','qc_combined_admin','admin','QC admin'),
    ('ab100000-0000-4000-8000-000000000002','ab100000-0000-4000-8000-000000000002','qc_combined_coordinator','coordinator','QC coordinator'),
    ('ab100000-0000-4000-8000-000000000003','ab100000-0000-4000-8000-000000000003','qc_combined_designer','designer','QC designer');
INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name)
VALUES ('ab100000-0000-4000-8000-000000000010','QC doctor','01000000000','Local','QC-COMBINED','Test');
SELECT set_config('request.jwt.claim.sub','ab100000-0000-4000-8000-000000000001',true);
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,production_status,delivery_date,workflow_type,designer_id,design_price)
VALUES ('ab100000-0000-4000-8000-000000000011','QC-COMBINED','ab100000-0000-4000-8000-000000000010','Synthetic patient','[]',900,400,'A1','designing',current_date,'split','ab100000-0000-4000-8000-000000000003',100);
SELECT public.set_design_qc_enabled(true,'Combined approval test');
SELECT public.submit_design_delivery('ab100000-0000-4000-8000-000000000011','ab100000-0000-4000-8000-000000000021','link','https://example.test/old','No preview');
SELECT public.submit_design_delivery('ab100000-0000-4000-8000-000000000011','ab100000-0000-4000-8000-000000000022','link','https://example.test/new','No preview');

SELECT set_config('request.jwt.claim.sub','ab100000-0000-4000-8000-000000000002',true);
SELECT throws_ok($$SELECT public.approve_and_release_design_revision('ab100000-0000-4000-8000-000000000022',gen_random_uuid(),'')$$,'42501','Admin role required','Coordinator cannot approve and release');
SELECT set_config('request.jwt.claim.sub','ab100000-0000-4000-8000-000000000001',true);
SELECT throws_ok($$SELECT public.approve_and_release_design_revision('ab100000-0000-4000-8000-000000000021',gen_random_uuid(),'')$$,'23514','Review the current revision','A stale revision cannot be approved or released');

CREATE FUNCTION pg_temp.fail_test_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.case_id = 'QC-COMBINED' AND NEW.production_status = 'in_production' THEN
        RAISE EXCEPTION 'Test release failed';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER qc_test_fail_release BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_test_release();
SELECT throws_ok($$SELECT public.approve_and_release_design_revision('ab100000-0000-4000-8000-000000000022',gen_random_uuid(),'')$$,'P0001','Test release failed','Release failures reach the caller');
SELECT is((SELECT count(*) FROM public.design_qc_events WHERE order_id='ab100000-0000-4000-8000-000000000011' AND action='approved'),0::bigint,'Release failure rolls back the approval');
DROP TRIGGER qc_test_fail_release ON public.orders;

SELECT lives_ok($$SELECT public.approve_and_release_design_revision('ab100000-0000-4000-8000-000000000022','ab100000-0000-4000-8000-000000000031','Reviewed')$$,'Admin can approve and release in one call');
SELECT is((SELECT production_status::text FROM public.orders WHERE case_id='QC-COMBINED'),'in_production','The order moves to production');
SELECT is((SELECT action FROM public.design_qc_events WHERE id='ab100000-0000-4000-8000-000000000031'),'approved','The approval event is saved');
SELECT lives_ok($$SELECT public.approve_and_release_design_revision('ab100000-0000-4000-8000-000000000022','ab100000-0000-4000-8000-000000000031','Reviewed')$$,'Same event can be safely retried');

UPDATE public.orders SET production_status='finalization' WHERE case_id='QC-COMBINED';
SELECT lives_ok($$SELECT public.approve_and_release_design_revision('ab100000-0000-4000-8000-000000000022',gen_random_uuid(),'Later review')$$,'An advanced order can be reviewed');
SELECT is((SELECT production_status::text FROM public.orders WHERE case_id='QC-COMBINED'),'finalization','Later review does not move an advanced order backwards');
SELECT public.return_design_revision('ab100000-0000-4000-8000-000000000011','ab100000-0000-4000-8000-000000000003','Change requested');
SELECT lives_ok($$SELECT public.approve_and_release_design_revision('ab100000-0000-4000-8000-000000000022','ab100000-0000-4000-8000-000000000031','Reviewed')$$,'Retry after return is accepted');
SELECT is((SELECT production_status::text FROM public.orders WHERE case_id='QC-COMBINED'),'designing','Retry does not undo an intervening return');

SELECT throws_ok($$SELECT public.release_design_revision('ab100000-0000-4000-8000-000000000011')$$,'23514','Await a new design submission','A returned design must be submitted again before execution');
SELECT public.submit_design_delivery('ab100000-0000-4000-8000-000000000011','ab100000-0000-4000-8000-000000000023','link','https://example.test/coordinator','No preview');
SELECT set_config('request.jwt.claim.sub','ab100000-0000-4000-8000-000000000002',true);
SELECT throws_ok($$SELECT public.bypass_and_release_design_revision('ab100000-0000-4000-8000-000000000023',gen_random_uuid(),' ')$$,'22023','Reason required','Coordinator bypass requires a reason');
CREATE TRIGGER qc_test_fail_release BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_test_release();
SELECT throws_ok($$SELECT public.bypass_and_release_design_revision('ab100000-0000-4000-8000-000000000023',gen_random_uuid(),'Urgent')$$,'P0001','Test release failed','Coordinator release failure reaches the caller');
SELECT is((SELECT count(*) FROM public.design_qc_events WHERE revision_id='ab100000-0000-4000-8000-000000000023' AND action='bypassed'),0::bigint,'Failed release rolls back the bypass');
DROP TRIGGER qc_test_fail_release ON public.orders;
SELECT lives_ok($$SELECT public.bypass_and_release_design_revision('ab100000-0000-4000-8000-000000000023','ab100000-0000-4000-8000-000000000033','Urgent')$$,'Coordinator can bypass and release atomically');
SELECT is((SELECT production_status::text FROM public.orders WHERE case_id='QC-COMBINED'),'in_production','Bypass sends the case to production');
SELECT is((SELECT note FROM public.design_qc_events WHERE id='ab100000-0000-4000-8000-000000000033'),'Urgent','The bypass reason is saved');
SELECT throws_ok($$UPDATE public.orders SET production_status='designing' WHERE case_id='QC-COMBINED'$$,'P0001','accountant cannot change workflow or delivery fields','Coordinator still cannot change production status directly');
SELECT * FROM finish();
ROLLBACK;
