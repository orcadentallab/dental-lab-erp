BEGIN;
SET search_path = public, extensions;
SELECT no_plan();

INSERT INTO auth.users(id, email) VALUES
 ('ba260000-0000-4000-8000-000000000001', 'conversion-admin@example.test'),
 ('ba260000-0000-4000-8000-000000000002', 'conversion-designer@example.test');
INSERT INTO public.users(id, auth_id, username, role, name) VALUES
 ('ba260000-0000-4000-8000-000000000001', 'ba260000-0000-4000-8000-000000000001', 'conversion_admin', 'admin', 'Admin'),
 ('ba260000-0000-4000-8000-000000000002', 'ba260000-0000-4000-8000-000000000002', 'conversion_designer', 'designer', 'Designer');
INSERT INTO public.doctors(id, name, phone, address, doctor_code, representative_name)
VALUES ('ba260000-0000-4000-8000-000000000003', 'Conversion clinic', '01000000000', 'Address', 'CONVERT', 'Rep');
INSERT INTO public.suppliers(id, name, phone, supplier_type)
VALUES ('ba260000-0000-4000-8000-000000000004', 'Conversion external lab', '01000000000', 'external_lab');
INSERT INTO public.services(name, selling_price, cost_price, designer_price)
VALUES ('Conversion printing', 200, 100, 30);

SELECT set_config('request.jwt.claim.sub', 'ba260000-0000-4000-8000-000000000001', true);
SELECT public.set_design_qc_enabled(false, 'Conversion test');
CREATE TEMP TABLE conversion_cases(id uuid, scenario text);
INSERT INTO conversion_cases VALUES
 ('ba260000-0000-4000-8000-000000000011', 'before_design'),
 ('ba260000-0000-4000-8000-000000000012', 'after_design'),
 ('ba260000-0000-4000-8000-000000000013', 'after_printing');
INSERT INTO public.orders(id, case_id, doctor_id, patient_name, items, total_price, cost, shade, production_status, delivery_date, delivery_type, workflow_type, designer_id, design_price, route_override_id)
SELECT id, 'CONVERSION-' || scenario, 'ba260000-0000-4000-8000-000000000003', 'Fixture', '[]', 200, 30, 'A1', 'designing',
       current_date, 'Final', 'split', 'ba260000-0000-4000-8000-000000000002', 30,
       CASE WHEN scenario = 'before_design' THEN 'ba100000-0000-4000-8000-000000000001'::uuid
            ELSE 'ba500000-0000-4000-8000-000000000001'::uuid END
FROM conversion_cases;
INSERT INTO public.order_items(order_id, product_type, teeth_numbers, price, shade, count)
SELECT id, 'Conversion printing', '["21"]', 200, 'A1', 1 FROM conversion_cases;
CREATE TEMP VIEW conversion_runs AS
SELECT r.*, s.code, c.scenario
FROM public.production_stage_runs r JOIN public.production_jobs j ON j.id = r.job_id
JOIN public.production_stages s ON s.id = r.stage_id JOIN conversion_cases c ON c.id = j.order_id;

SELECT set_config('request.jwt.claim.sub', 'ba260000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT public.admin_convert_order_to_external_lab(
    'ba260000-0000-4000-8000-000000000011','ba260000-0000-4000-8000-000000000004',100,'Correction')$$,
    '42501', 'هذا الإجراء للأدمن فقط', 'Non-admin cannot convert an order');
SELECT public.submit_design_delivery(id, gen_random_uuid(), 'link', 'https://example.test/design', 'Fixture')
FROM conversion_cases WHERE scenario <> 'before_design';

SELECT set_config('request.jwt.claim.sub', 'ba260000-0000-4000-8000-000000000001', true);
SELECT public.complete_stage_run(id) FROM conversion_runs WHERE scenario = 'after_printing' AND code = 'printing';
SELECT throws_ok($$SELECT public.admin_convert_order_to_external_lab(
    'ba260000-0000-4000-8000-000000000013','ba260000-0000-4000-8000-000000000004',100,'Correction')$$,
    '23514', 'بدأ العمل بالفعل في مرحلة مفتوحة أو ارتبطت الحالة بأمر خارجي أو شحنة',
    'Completed physical work prevents conversion');
SELECT throws_ok($$UPDATE public.orders SET route_override_id=NULL WHERE id='ba260000-0000-4000-8000-000000000012'$$,
    'P0001', 'خريطة الإنتاج محفوظة لهذه الحالة', 'Ordinary updates stay protected');
SELECT public.admin_convert_order_to_external_lab(id, 'ba260000-0000-4000-8000-000000000004', 100, 'Wrong lab mode')
FROM conversion_cases WHERE scenario <> 'after_printing';

SELECT is((SELECT count(*) FROM public.orders o JOIN conversion_cases c USING (id)
           WHERE c.scenario <> 'after_printing' AND o.route_override_id IS NULL
             AND o.supplier_id = 'ba260000-0000-4000-8000-000000000004' AND o.lab_cost = 100),
          2::bigint, 'Conversion assigns the external lab and cost and clears the route');
SELECT is((SELECT workflow_type FROM public.orders o JOIN conversion_cases c USING (id) WHERE scenario = 'before_design'),
          'full', 'The external lab owns unfinished design');
SELECT is((SELECT workflow_type FROM public.orders o JOIN conversion_cases c USING (id) WHERE scenario = 'after_design'),
          'split', 'The designer stays assigned after completing design');
SELECT is((SELECT designer_cost FROM public.orders o JOIN conversion_cases c USING (id) WHERE scenario = 'after_design'),
          30::numeric, 'Completed designer cost survives conversion');
SELECT is((SELECT count(*) FROM conversion_runs WHERE scenario = 'after_design' AND code = 'design' AND status = 'done'),
          1::bigint, 'Completed design remains in production history');
SELECT is((SELECT count(*) FROM conversion_runs
           WHERE scenario <> 'after_printing' AND status IN ('pending','ready','in_progress','waiting_external')),
          0::bigint, 'Converted orders have no open stage runs');
SELECT is((SELECT count(*) FROM public.production_jobs j JOIN conversion_cases c ON c.id = j.order_id
           WHERE c.scenario <> 'after_printing' AND j.status = 'cancelled'),
          2::bigint, 'Converted jobs are cancelled');
SELECT is((SELECT count(*) FROM public.order_events e JOIN conversion_cases c ON c.id = e.order_id
           WHERE e.event_type = 'converted_to_external_lab' AND e.reason = 'Wrong lab mode'),
          2::bigint, 'Each conversion records its reason');
SELECT is(public.sync_production_from_order('ba260000-0000-4000-8000-000000000012'), NULL::uuid,
          'Order synchronization leaves converted orders out of the production board');
SELECT * FROM finish();
ROLLBACK;
