-- Phase 4 Test Suite: Packaging, Shipments, and Delivery Integration
-- Tests: creation, multi-case linking, conflict prevention, dispatch, delivery confirmation, cancellation, and RLS.

BEGIN;

SELECT plan(16);

SET search_path TO public, extensions;

-- ─── 0. Fixtures ─────────────────────────────────────────────────────────────
CREATE TEMP TABLE fixture_ctx (
    admin_id UUID,
    doc_id UUID,
    courier_id UUID,
    order1_id UUID,
    order2_id UUID,
    order3_id UUID
) ON COMMIT DROP;

DO $$
DECLARE
    v_admin_id UUID := gen_random_uuid();
    v_doc_id UUID := gen_random_uuid();
    v_courier_id UUID := gen_random_uuid();
    v_order1_id UUID := gen_random_uuid();
    v_order2_id UUID := gen_random_uuid();
    v_order3_id UUID := gen_random_uuid();
BEGIN
    INSERT INTO auth.users (id, email) VALUES (v_admin_id, 'admin_ship@test.local');
    -- auth_id matters: get_my_user_id() resolves through it, and
    -- record_order_final_delivery_v2 -- which confirm_shipment_delivery now
    -- calls to bill the doctor -- refuses a NULL user.
    INSERT INTO public.users (id, username, email, role, name, auth_id)
    VALUES (v_admin_id, 'admin_ship', 'admin_ship@test.local', 'admin', 'Ship Admin', v_admin_id);

    INSERT INTO public.doctors (id, doctor_code, name, phone, address, representative_name)
    VALUES (v_doc_id, 'DOC-TEST-001', 'د. محمود شريف', '01012345678', 'شارع التحرير الدقي', 'مندوب الدقي');

    INSERT INTO public.suppliers (id, supplier_code, name, supplier_type, phone)
    VALUES (v_courier_id, 'SUP-TEST-001', 'شركة الفرسان للشحن السريع', 'courier', '01122334455');

    INSERT INTO public.orders (id, case_id, doctor_id, patient_name, items, shade, status, production_status, total_price, cost, delivery_date)
    VALUES 
        (v_order1_id, 'ORD-SHP-001', v_doc_id, 'مريض أ', '[]'::jsonb, 'A1', 'Ready', 'final_ready', 1500, 300, CURRENT_DATE + 2),
        (v_order2_id, 'ORD-SHP-002', v_doc_id, 'مريض ب', '[]'::jsonb, 'A2', 'Ready', 'final_ready', 1200, 250, CURRENT_DATE + 2),
        (v_order3_id, 'ORD-SHP-003', v_doc_id, 'مريض ج', '[]'::jsonb, 'A3', 'Ready', 'final_ready', 900, 180, CURRENT_DATE + 2);

    INSERT INTO fixture_ctx (admin_id, doc_id, courier_id, order1_id, order2_id, order3_id)
    VALUES (v_admin_id, v_doc_id, v_courier_id, v_order1_id, v_order2_id, v_order3_id);
END;
$$;

-- Switch to admin context
DO $$
DECLARE
    v_admin_id UUID;
BEGIN
    SELECT admin_id INTO v_admin_id FROM fixture_ctx;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text, true);
END;
$$;

-- ─── 1. Create Multi-Order Shipment ──────────────────────────────────────────
CREATE TEMP TABLE test_shipment_res AS
SELECT public.create_shipment(
    (SELECT courier_id FROM fixture_ctx),
    (SELECT doc_id FROM fixture_ctx),
    'TRK-100200',
    ARRAY[(SELECT order1_id FROM fixture_ctx), (SELECT order2_id FROM fixture_ctx)],
    ARRAY['https://storage.local/proof1.jpg', 'https://storage.local/proof2.jpg'],
    'د. محمود شريف',
    '01012345678',
    'شارع التحرير الدقي',
    'حالات مستعجلة جداً'
) AS result;

SELECT is(
    (SELECT (result->>'success')::boolean FROM test_shipment_res),
    true,
    'create_shipment succeeds for valid payload'
);

SELECT is(
    (SELECT (result->>'order_count')::int FROM test_shipment_res),
    2,
    'create_shipment links 2 orders to the shipment'
);

SELECT is(
    (SELECT count(*)::int FROM public.shipment_orders WHERE shipment_id = ((SELECT result->>'shipment_id' FROM test_shipment_res)::uuid)),
    2,
    'shipment_orders rows exist in db'
);

SELECT is(
    (SELECT array_length(packing_proof_urls, 1) FROM public.shipments WHERE id = ((SELECT result->>'shipment_id' FROM test_shipment_res)::uuid)),
    2,
    'packing_proof_urls array stored properly'
);

-- ─── 2. Conflict Check: Order Already in Active Shipment ─────────────────────
SELECT throws_ok(
    $$
    SELECT public.create_shipment(
        (SELECT courier_id FROM fixture_ctx),
        (SELECT doc_id FROM fixture_ctx),
        'TRK-CONFLICT',
        ARRAY[(SELECT order1_id FROM fixture_ctx)],
        '{}'::TEXT[],
        NULL, NULL, NULL, NULL
    );
    $$,
    NULL,
    'creating shipment with an order already in an active shipment throws an error'
);

-- ─── 3. Dispatch Shipment ────────────────────────────────────────────────────
CREATE TEMP TABLE test_dispatch_res AS
SELECT public.dispatch_shipment(
    (SELECT (result->>'shipment_id')::uuid FROM test_shipment_res),
    'TRK-UPDATED-99',
    'تم تسليم الطرد للمندوب أحمد'
) AS result;

SELECT is(
    (SELECT (result->>'status') FROM test_dispatch_res),
    'dispatched',
    'dispatch_shipment updates status to dispatched'
);

SELECT is(
    (SELECT status FROM public.shipments WHERE id = ((SELECT result->>'shipment_id' FROM test_shipment_res)::uuid)),
    'dispatched',
    'shipment record status is dispatched in db'
);

-- ─── 4. Confirm Delivery ─────────────────────────────────────────────────────
CREATE TEMP TABLE test_delivery_res AS
SELECT public.confirm_shipment_delivery(
    (SELECT (result->>'shipment_id')::uuid FROM test_shipment_res),
    'https://storage.local/delivered_sig.jpg',
    now(),
    'تم التسليم وتوقيع الطبيب'
) AS result;

SELECT is(
    (SELECT (result->>'status') FROM test_delivery_res),
    'delivered',
    'confirm_shipment_delivery updates status to delivered'
);

SELECT is(
    (SELECT delivery_proof_url FROM public.shipments WHERE id = ((SELECT result->>'shipment_id' FROM test_shipment_res)::uuid)),
    'https://storage.local/delivered_sig.jpg',
    'delivery_proof_url recorded correctly'
);

-- ─── 4b. THE MONEY (plan 4.5) ────────────────────────────────────────────────
-- Confirming a shipment is what bills the doctor. These four assertions exist
-- because an earlier draft updated only the shipment row: the screen reported
-- success, the order stayed undelivered, and the doctor was never invoiced.

SELECT is(
    (SELECT COUNT(*)::int FROM public.orders o
      JOIN public.shipment_orders so ON so.order_id = o.id
     WHERE so.shipment_id = ((SELECT result->>'shipment_id' FROM test_shipment_res)::uuid)
       AND o.first_delivered_at IS NOT NULL),
    2,
    'confirm_shipment_delivery stamps first_delivered_at on every order it billed'
);

SELECT is(
    (SELECT COUNT(*)::int FROM public.orders o
      JOIN public.shipment_orders so ON so.order_id = o.id
     WHERE so.shipment_id = ((SELECT result->>'shipment_id' FROM test_shipment_res)::uuid)
       AND o.production_status = 'final_delivered' AND o.status = 'Delivered'),
    2,
    'delivery travels the existing path: orders reach Delivered / final_delivered'
);

SELECT is(
    (SELECT (result->>'orders_delivered')::int FROM test_delivery_res),
    2,
    'orders_delivered reports how many cases were actually billed'
);

-- Idempotent: re-confirming must not bill the doctor a second time.
SELECT is(
    (SELECT (public.confirm_shipment_delivery(
        (SELECT (result->>'shipment_id')::uuid FROM test_shipment_res),
        NULL, now(), NULL
    ) ->> 'message')),
    'الشحنة مسلّمة بالفعل',
    're-confirming a delivered shipment is a no-op, not a second billing'
);

-- ─── 5. Cannot Cancel Delivered Shipment ─────────────────────────────────────
SELECT throws_ok(
    $$
    SELECT public.cancel_shipment(
        (SELECT (result->>'shipment_id')::uuid FROM test_shipment_res),
        'محاولة إلغاء بعد التسليم'
    );
    $$,
    NULL,
    'cannot cancel already delivered shipment'
);

-- ─── 6. Cancel Pending Shipment ──────────────────────────────────────────────
CREATE TEMP TABLE test_shipment2_res AS
SELECT public.create_shipment(
    (SELECT courier_id FROM fixture_ctx),
    (SELECT doc_id FROM fixture_ctx),
    'TRK-CANCEL-TEST',
    ARRAY[(SELECT order3_id FROM fixture_ctx)],
    '{}'::TEXT[],
    NULL, NULL, NULL, NULL
) AS result;

SELECT is(
    (SELECT (public.cancel_shipment((result->>'shipment_id')::uuid, 'إلغاء بناء على طلب الطبيب')->>'status') FROM test_shipment2_res),
    'cancelled',
    'cancel_shipment sets status to cancelled'
);

-- ─── 7. Re-using Order from Cancelled Shipment ───────────────────────────────
SELECT lives_ok(
    $$
    SELECT public.create_shipment(
        (SELECT courier_id FROM fixture_ctx),
        (SELECT doc_id FROM fixture_ctx),
        'TRK-RECREATED',
        ARRAY[(SELECT order3_id FROM fixture_ctx)],
        '{}'::TEXT[],
        NULL, NULL, NULL, NULL
    );
    $$,
    'order from cancelled shipment can now be added to a new shipment'
);

SELECT * FROM finish();

ROLLBACK;
