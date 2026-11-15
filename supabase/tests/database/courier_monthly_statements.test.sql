BEGIN;
SET search_path=public,extensions;
SELECT no_plan();

INSERT INTO auth.users(id,email) VALUES
 ('ce000000-0000-4000-8000-000000000001','courier-finance-admin@example.test'),
 ('ce000000-0000-4000-8000-000000000002','courier-finance-coord@example.test'),
 ('ce000000-0000-4000-8000-000000000003','courier-finance-designer@example.test');
INSERT INTO public.users(id,auth_id,username,role,name)
SELECT id,id,split_part(email,'@',1),CASE right(id::text,1) WHEN '1' THEN 'admin' WHEN '2' THEN 'coordinator' ELSE 'designer' END,email
FROM auth.users WHERE id IN ('ce000000-0000-4000-8000-000000000001','ce000000-0000-4000-8000-000000000002','ce000000-0000-4000-8000-000000000003');
INSERT INTO public.suppliers(id,name,phone,supplier_type) VALUES
 ('ce000000-0000-4000-8000-000000000010','Invoice test courier','01000000000','courier'),
 ('ce000000-0000-4000-8000-000000000011','Invoice test equipment','01000000000','material_vendor');
INSERT INTO public.doctors(id,name,phone,address,doctor_code,representative_name)
VALUES('ce000000-0000-4000-8000-000000000012','Invoice fixture doctor','01000000000','Fixture','COURIER-QA','Test');
INSERT INTO public.orders(id,case_id,doctor_id,patient_name,items,total_price,cost,shade,delivery_date)
SELECT ('ce000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'COURIER-QA-'||n,
 'ce000000-0000-4000-8000-000000000012','Synthetic','[]',1000,0,'A1',current_date FROM generate_series(20,22) n;
INSERT INTO public.shipments(id,shipment_code,courier_id,status,created_at) VALUES
 ('ce000000-0000-4000-8000-000000000030','COURIER-SHARED','ce000000-0000-4000-8000-000000000010','delivered','2026-08-08T12:00Z'),
 ('ce000000-0000-4000-8000-000000000031','COURIER-RETURNED','ce000000-0000-4000-8000-000000000010','returned','2026-08-09T12:00Z'),
 ('ce000000-0000-4000-8000-000000000032','COURIER-OVER-MIN','ce000000-0000-4000-8000-000000000010','delivered','2026-09-08T12:00Z');
INSERT INTO public.shipment_orders(shipment_id,order_id)
SELECT 'ce000000-0000-4000-8000-000000000030',id FROM public.orders WHERE case_id LIKE 'COURIER-QA-%';
INSERT INTO public.transactions(id,type,amount,category,date,description,entity_type,entity_id,status,is_approved) VALUES
 ('ce000000-0000-4000-8000-000000000040','expense',2000,'supplier_payment','2026-09-05','Existing cash payment','supplier','ce000000-0000-4000-8000-000000000010','approved',true),
 ('ce000000-0000-4000-8000-000000000041','expense',1000,'supplier_payment','2026-09-05','Equipment payment','supplier','ce000000-0000-4000-8000-000000000011','approved',true);
CREATE TEMP TABLE courier_baseline AS SELECT (SELECT count(*) FROM public.transactions) AS cash_rows,
    (SELECT count(*) FROM public.adjustments WHERE entity_type='doctor') AS doctor_charges;

SELECT set_config('request.jwt.claim.sub','ce000000-0000-4000-8000-000000000002',true);
SELECT lives_ok($$SELECT public.save_courier_monthly_invoice('ce000000-0000-4000-8000-000000000010','2026-08-01','QA-AUG',7000,7000,
 '{"ce000000-0000-4000-8000-000000000030":300,"ce000000-0000-4000-8000-000000000031":5900}',false,0)$$,'Coordinator prepares the invoice');
CREATE TEMP VIEW august_invoice AS SELECT * FROM public.courier_monthly_invoices WHERE invoice_ref='QA-AUG';
SELECT is((SELECT status FROM august_invoice),'draft','A prepared invoice is a draft');
SELECT throws_ok($$SELECT public.save_courier_monthly_invoice('ce000000-0000-4000-8000-000000000010','2026-08-01','QA-AUG',7000,7000,'{}',true,1)$$,
 '42501','اعتماد فاتورة الشحن للأدمن فقط','Coordinator cannot confirm');
SELECT throws_ok($$SELECT public.link_courier_invoice_payment((SELECT id FROM august_invoice),'ce000000-0000-4000-8000-000000000040',1000)$$,
 'P0001','اعتمد الفاتورة قبل ربط السداد','Draft accepts no allocation');

SELECT set_config('request.jwt.claim.sub','ce000000-0000-4000-8000-000000000001',true);
SELECT throws_ok($$SELECT public.save_courier_monthly_invoice('ce000000-0000-4000-8000-000000000010','2026-08-01','QA-AUG',7000,7001,'{}',true,1)$$,
 'P0001','اكتب سبب فرق المطابقة أو الشحنات بدون تكلفة','Unmatched totals or missing costs need a reason');
SELECT lives_ok($$SELECT public.save_courier_monthly_invoice('ce000000-0000-4000-8000-000000000010','2026-08-01','QA-AUG',7000,7000,
 '{"ce000000-0000-4000-8000-000000000030":300,"ce000000-0000-4000-8000-000000000031":5900}',true,1)$$,'Admin confirms the matched invoice');
SELECT is((SELECT shipment_amount FROM august_invoice),6200::numeric,'The 800 minimum shortfall stays out of case costs');
SELECT is((SELECT greatest(minimum_amount,shipment_amount) FROM august_invoice),7000::numeric,'The minimum produces a 7000 invoice');
SELECT is((SELECT count(*) FROM august_invoice i, jsonb_array_elements(i.shipment_charges->'ce000000-0000-4000-8000-000000000030'->'cases') x
 WHERE (x->>'allocated')::numeric=100),3::bigint,'A shared 300 trip allocates 100 to each case');
SELECT public.save_courier_monthly_invoice('ce000000-0000-4000-8000-000000000010','2026-09-01','QA-SEP',7000,8100,
 '{"ce000000-0000-4000-8000-000000000032":8100}',true,0);
SELECT is((SELECT invoice_amount-shipment_amount FROM public.courier_monthly_invoices WHERE invoice_ref='QA-SEP'),0::numeric,'8100 charges have no minimum gap');
SELECT throws_ok($$SELECT public.link_courier_invoice_payment((SELECT id FROM august_invoice),'ce000000-0000-4000-8000-000000000041',1000)$$,
 'P0001','اختار سداد معتمد لنفس الشركة','Payment for an equipment supplier cannot settle a courier invoice');
SELECT public.link_courier_invoice_payment((SELECT id FROM august_invoice),'ce000000-0000-4000-8000-000000000040',1500);
SELECT public.link_courier_invoice_payment((SELECT id FROM august_invoice),'ce000000-0000-4000-8000-000000000040',1500);
SELECT is((SELECT sum(amount) FROM public.courier_invoice_payments WHERE invoice_id=(SELECT id FROM august_invoice)),1500::numeric,'Retry does not double the linked payment');
SELECT is((public.get_courier_statement('ce000000-0000-4000-8000-000000000010','2026-08-01')->'invoices'->1->>'paid')::numeric,1500::numeric,'Statement exposes the applied amount');
INSERT INTO public.financial_obligations(order_id,entity_type,entity_id,direction,trigger_type,trigger_date,due_date,gross_amount,net_amount)
VALUES ('ce000000-0000-4000-8000-000000000020','external_lab','ce000000-0000-4000-8000-000000000010','payable','external_lab_ready',
    '2026-08-01','2026-08-01',1000,1000);
SELECT throws_ok($$INSERT INTO public.payment_allocations(payment_transaction_id,obligation_id,entity_type,entity_id,direction,allocated_amount,allocation_method)
    SELECT 'ce000000-0000-4000-8000-000000000040',id,'external_lab','ce000000-0000-4000-8000-000000000010','payable',501,'manual'
    FROM public.financial_obligations WHERE order_id='ce000000-0000-4000-8000-000000000020' AND entity_type='external_lab'$$,
 'P0001','جزء من السداد مرتبط بفاتورة شركة الشحن','An older lab obligation cannot reuse cash applied to courier invoices');
SELECT throws_ok($$SELECT public.link_courier_invoice_payment((SELECT id FROM public.courier_monthly_invoices WHERE invoice_ref='QA-SEP'),
 'ce000000-0000-4000-8000-000000000040',501)$$,'P0001','المبلغ أكبر من المتبقي على الفاتورة أو المتاح من السداد','A transaction cannot be overallocated across invoices');
SELECT throws_ok($$UPDATE public.transactions SET amount=1000 WHERE id='ce000000-0000-4000-8000-000000000040'$$,
 'P0001','السداد مرتبط بفاتورة شحن، راجع الربط قبل تغيير الحساب أو المبلغ','A cash edit cannot invalidate an allocation');
SELECT throws_ok($$SELECT public.save_courier_monthly_invoice('ce000000-0000-4000-8000-000000000010','2026-08-01','QA-AUG',7000,7000,'{}',true,2)$$,
 '42501','تعديل فاتورة معتمدة للأدمن مع كتابة السبب','Confirmed corrections require a reason');
SELECT public.unlink_courier_invoice_payment((SELECT id FROM august_invoice),'ce000000-0000-4000-8000-000000000040','Correct matching');
SELECT is((SELECT count(*) FROM public.courier_invoice_events WHERE invoice_id=(SELECT id FROM august_invoice) AND action='payment_unlinked'),1::bigint,'Unlinking preserves audit history');
SELECT is((SELECT count(*) FROM public.transactions),(SELECT cash_rows FROM courier_baseline),'Invoice, allocation and unlink create no cash movement');
SELECT is((SELECT count(*) FROM public.adjustments WHERE entity_type='doctor'),(SELECT doctor_charges FROM courier_baseline),'Courier invoices do not change doctor fees');

INSERT INTO public.cashboxes(id,name,type,opening_balance)
VALUES ('ce000000-0000-4000-8000-000000000050','Courier retry fixture wallet','cash',1000);
CREATE TEMP TABLE courier_retry_fixture AS
SELECT (public.create_routed_shipping_request('ce000000-0000-4000-8000-000000000051',NULL,
    'ce000000-0000-4000-8000-000000000012',NULL,ARRAY['ce000000-0000-4000-8000-000000000020']::uuid[],
    '{}',NULL,NULL,NULL,NULL,'ألف مسكن','to_lab',NULL,true,NULL,NULL,'scooter',false)->>'shipment_id')::uuid AS first_id;
SELECT lives_ok($$SELECT public.close_shipping_attempt((SELECT first_id FROM courier_retry_fixture),'failed','Clinic closed',44,
    'ce000000-0000-4000-8000-000000000050')$$,'Closing a failed scooter attempt records the cash already paid');
SELECT is((SELECT attempt_outcome_reason FROM public.shipments WHERE id=(SELECT first_id FROM courier_retry_fixture)),
    'Clinic closed','The failed attempt retains its reason');
ALTER TABLE courier_retry_fixture ADD COLUMN retry_id uuid;
UPDATE courier_retry_fixture SET retry_id=public.retry_shipping_attempt(first_id);
SELECT is((SELECT public.retry_shipping_attempt(first_id) FROM courier_retry_fixture),
    (SELECT retry_id FROM courier_retry_fixture),'A repeated retry request returns the same new attempt');
SELECT lives_ok($$SELECT public.confirm_shipping_request((SELECT retry_id FROM courier_retry_fixture),NULL,now(),NULL,56,
    'ce000000-0000-4000-8000-000000000050')$$,'The retry records a separate expense upon arrival');
SELECT is((SELECT sum((r->>'actual')::numeric) FROM jsonb_array_elements(public.get_shipping_cost_report(
    (now() AT TIME ZONE 'Africa/Cairo')::date)) r WHERE r->>'case_id'='COURIER-QA-20' AND r->>'shipping_area'='ألف مسكن'),
    100::numeric,'The cost report includes both paid attempts for the same case');

SELECT set_config('request.jwt.claim.sub','ce000000-0000-4000-8000-000000000003',true);
SELECT throws_ok($$SELECT public.get_courier_statement()$$,'42501','كشف شركة الشحن لفريق الحسابات والتنسيق','Designer cannot read courier finances');
SELECT throws_ok($$SELECT public.get_shipping_cost_report(current_date)$$,'42501','تكلفة الشحن لفريق الحسابات والتنسيق','Designer cannot read shipment costs');
SELECT ok(NOT has_function_privilege('authenticated','public.reconcile_courier_invoice(uuid,date,numeric,text)','EXECUTE'),'Legacy full-invoice averaging is retired for clients');
SELECT * FROM finish();
ROLLBACK;
