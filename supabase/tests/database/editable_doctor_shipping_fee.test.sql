BEGIN;
SET search_path = public, extensions;
SELECT plan(20);

INSERT INTO auth.users(id,email) VALUES
    ('da530000-0000-4000-8000-000000000001', 'edit-fee-admin@example.test'),
    ('da530000-0000-4000-8000-000000000002', 'edit-fee-coordinator@example.test');
INSERT INTO public.users(id,auth_id,username,role,name) VALUES
    ('da530000-0000-4000-8000-000000000001','da530000-0000-4000-8000-000000000001','edit_fee_admin','admin','QA admin'),
    ('da530000-0000-4000-8000-000000000002','da530000-0000-4000-8000-000000000002','edit_fee_coordinator','coordinator','QA coordinator');
INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name)
VALUES ('da530000-0000-4000-8000-000000000010','QA shipping fee clinic','01000000000','Fixture','EDIT-FEE-QA','QA');

SELECT set_config('request.jwt.claim.sub','da530000-0000-4000-8000-000000000001',true);
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,production_status,delivery_date)
VALUES
    ('da530000-0000-4000-8000-000000000011','EDIT-FEE-QA-01','da530000-0000-4000-8000-000000000010','Synthetic','[]',900,0,'A1','final_ready',current_date),
    ('da530000-0000-4000-8000-000000000012','EDIT-FEE-QA-02','da530000-0000-4000-8000-000000000010','Synthetic','[]',900,0,'A1','final_ready',current_date);
CREATE TEMP VIEW fee_case AS SELECT * FROM public.orders WHERE id='da530000-0000-4000-8000-000000000011';
CREATE TEMP VIEW case_charge AS SELECT * FROM public.adjustments WHERE shipping_order_id='da530000-0000-4000-8000-000000000011';
CREATE TEMP TABLE cash_baseline AS SELECT count(*) AS rows FROM public.transactions;

SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.update_order_with_doctor_shipping_fee('da530000-0000-4000-8000-000000000011','{}',NULL,NULL,45.75)$$,'Admin can set a quote before delivery');
RESET ROLE;
SELECT is((SELECT quoted_shipping_fee FROM fee_case),45.75::numeric,'Quote is stored on the order');
SELECT is((SELECT count(*) FROM case_charge),0::bigint,'Saving the quote leaves the doctor balance alone');
SELECT public.update_order_with_doctor_shipping_fee('da530000-0000-4000-8000-000000000011','{}',NULL,NULL,NULL);
SELECT is((SELECT quoted_shipping_fee FROM fee_case),NULL::numeric,'Admin can clear a pre-delivery fee');
SELECT public.update_order_with_doctor_shipping_fee('da530000-0000-4000-8000-000000000011','{}',NULL,NULL,55);

INSERT INTO public.shipments(id, shipment_code, doctor_id, status)
VALUES ('da530000-0000-4000-8000-000000000020','EDIT-FEE-SHP','da530000-0000-4000-8000-000000000010','dispatched');
INSERT INTO public.shipment_orders(shipment_id, order_id)
VALUES ('da530000-0000-4000-8000-000000000020','da530000-0000-4000-8000-000000000011');
SELECT public.confirm_shipment_delivery('da530000-0000-4000-8000-000000000020');
SELECT is((SELECT amount FROM case_charge),55::numeric,'First final delivery posts the quoted fee');
CREATE TEMP TABLE original_charge AS SELECT id,date FROM case_charge;
SELECT public.update_order_with_doctor_shipping_fee('da530000-0000-4000-8000-000000000011','{}',NULL,NULL,61.50);
SELECT public.update_order_with_doctor_shipping_fee('da530000-0000-4000-8000-000000000011','{}',NULL,NULL,61.50);
SELECT is((SELECT count(*) FROM case_charge),1::bigint,'Edits and retries keep one charge');
SELECT is((SELECT amount FROM case_charge),61.50::numeric,'Editing after delivery changes the same charge');
SELECT is((SELECT id FROM case_charge),(SELECT id FROM original_charge),'Existing invoice line keeps its identity');
SELECT is((SELECT date FROM case_charge),(SELECT date FROM original_charge),'Existing invoice line keeps its period');
SELECT is((SELECT total_price FROM fee_case),900::numeric,'Base order revenue is unchanged');
SELECT is((SELECT count(*) FROM public.transactions),(SELECT rows FROM cash_baseline),'Shipping edits do not post cash');

SELECT public.update_order_with_doctor_shipping_fee('da530000-0000-4000-8000-000000000011','{}',NULL,NULL,NULL);
SELECT is((SELECT count(*) FROM case_charge),0::bigint,'Clearing removes the posted charge from the account');
SELECT is((SELECT financial_impact FROM public.order_events WHERE order_id=(SELECT id FROM fee_case)
    AND event_type='doctor_shipping_fee_edited' AND new_value IS NULL AND related_adjustment_id IS NOT NULL),-61.50::numeric,'Removal has an audit event');
SELECT public.update_order_with_doctor_shipping_fee('da530000-0000-4000-8000-000000000011','{}',NULL,NULL,72);
SELECT is((SELECT amount FROM case_charge),72::numeric,'New fee on a delivered order posts immediately');
SELECT is((SELECT service_charge_kind FROM case_charge),'shipping','Charge is included by the monthly invoice service-charge filter');

SELECT public.add_doctor_shipping_charge('da530000-0000-4000-8000-000000000012',60);
SELECT public.update_order_with_doctor_shipping_fee('da530000-0000-4000-8000-000000000012','{}',NULL,NULL,65);
SELECT is((SELECT sum(amount) FROM public.adjustments WHERE shipping_order_id='da530000-0000-4000-8000-000000000012'),65::numeric,
    'An existing manually posted legacy fee is updated in place even if the quote was empty');

SELECT throws_ok($$SELECT public.update_order_with_doctor_shipping_fee('da530000-0000-4000-8000-000000000011','{}',NULL,NULL,8.123)$$,
    '22023','أدخل رسوم شحن صحيحة بمنزلتين عشريتين على الأكثر','Invalid precision is denied');
SELECT set_config('request.jwt.claim.sub','da530000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.update_order_with_doctor_shipping_fee('da530000-0000-4000-8000-000000000011','{}',NULL,NULL,NULL)$$,
    '42501','تعديل رسوم شحن الأوردر للأدمن فقط','Coordinator cannot remove or revise an admin adjustment');
SELECT ok(NOT has_function_privilege('anon','public.update_order_with_doctor_shipping_fee(uuid,jsonb,jsonb,jsonb,numeric)','EXECUTE'),'Anonymous callers lack grant');
RESET ROLE;
SELECT is((SELECT sum(amount) FROM case_charge),72::numeric,'Denials leave the posted fee untouched');

SELECT * FROM finish();
ROLLBACK;
