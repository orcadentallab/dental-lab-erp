-- Phase 3 Materials, Inventory and Supplier Accounts Test Suite
--
-- Guards 20260827001000_materials_inventory_and_suppliers.sql:
--   1. Supplier type classification ('external_lab', 'material_vendor', 'courier').
--   2. Purchases record finance expense transactions for the supplier
--      and WITHOUT touching order-level financial_obligations.
--   3. Ledger movements (purchase_in, consume, adjust) are immutable audit records.
--   4. 2-tap technician workflow: open_material_batch and deplete_material_batch.
--   5. Material batch usage auto-attribution on stage completion.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(16);

-- ─── 1. Fixtures ────────────────────────────────────────────────────────────

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('b9000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'mat-admin@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('b9000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'mat-tech@example.test', '',
     '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name) VALUES
    ('b8000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001',
     'mat_admin', 'admin', 'Material Admin'),
    ('b8000000-0000-0000-0000-000000000002', 'b9000000-0000-0000-0000-000000000002',
     'mat_tech', 'technician', 'Material Technician');

INSERT INTO public.suppliers (id, name, phone, username, supplier_type)
VALUES ('b7000000-0000-0000-0000-000000000001', 'Zirconia Material Supplier Co.',
        '01111111111', 'zircon_sup', 'material_vendor');

INSERT INTO public.materials (id, code, name_ar, category, unit, tracking_mode, expected_units_per_batch, reorder_point)
VALUES ('b6000000-0000-0000-0000-000000000001', 'TEST-ZIR-DISC', 'ديسك اختبار زيركونيا', 'zirconia', 'disc', 'batch_depletion', 20, 2);

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name)
VALUES ('b2000000-0000-0000-0000-000000000001', 'Mat test doc', '01000000000', 'Cairo', 'MATDOC', 'Rep 1');

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state, priority
) VALUES (
    'b3000000-0000-0000-0000-000000000001', 'CASE-MAT-01', 'b2000000-0000-0000-0000-000000000001',
    'Patient Mat', '[]'::jsonb, 500, 'A2', 'In Progress',
    CURRENT_DATE + 3, 0, 'in_production', 'none', 'Normal'
);

INSERT INTO public.production_routes (id, name_ar, is_fallback)
VALUES ('b1000000-0000-0000-0000-000000000001', 'Mat Test Route', FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.production_jobs (id, order_id, route_id, round_no, status, priority, unit_count)
VALUES (
    'b4000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001', 1, 'active', 'Normal', 3
);

INSERT INTO public.production_stages (id, code, name_ar, sequence, scope, default_execution, driven_by)
VALUES ('b5000000-0000-0000-0000-000000000001', 'test_milling', 'خراطة وسنترة تجريبية', 10, 'optional', 'internal', 'my_tasks')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.production_stage_runs (
    id, job_id, stage_id, seq, execution, status, units_in, units_passed
) VALUES (
    'b5500000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001',
    'b5000000-0000-0000-0000-000000000001', 1, 'internal', 'in_progress', 3, 3
);

-- Bind material to stage
INSERT INTO public.stage_material_bindings (stage_id, material_id, consumption_mode)
VALUES ('b5000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 'depletion');

-- ─── 2. Supplier Type Verification ──────────────────────────────────────────

SELECT is(
    (SELECT supplier_type FROM public.suppliers WHERE id = 'b7000000-0000-0000-0000-000000000001'),
    'material_vendor',
    'Supplier is marked with supplier_type = material_vendor'
);

-- ─── 3. Material Purchase Atomic Recording ──────────────────────────────────

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO 'b9000000-0000-0000-0000-000000000001';

SELECT lives_ok(
    $$
    SELECT public.record_material_purchase(
        'b7000000-0000-0000-0000-000000000001'::uuid,
        'INV-2026-001',
        CURRENT_DATE,
        jsonb_build_array(
            jsonb_build_object(
                'material_id', 'b6000000-0000-0000-0000-000000000001'::uuid,
                'batch_code', 'LOT-ZIR-001',
                'qty', 5,
                'unit_cost', 1200,
                'attributes', jsonb_build_object('shade', 'A2', 'thickness_mm', 14)
            )
        ),
        'شحنة ديسكات زيركونيا جديدة'
    );
    $$,
    'Admin successfully records material purchase invoice'
);

-- Verify Purchase created
SELECT is(
    (SELECT count(*)::int FROM public.material_purchases WHERE invoice_ref = 'INV-2026-001'),
    1,
    'Material purchase header recorded'
);

-- Verify Total Amount calculation
SELECT is(
    (SELECT total_amount FROM public.material_purchases WHERE invoice_ref = 'INV-2026-001'),
    6000.00::numeric,
    'Total purchase amount calculated correctly (5 * 1200 = 6000)'
);

-- Verify Expense transaction created in transactions table (normalized to supplier_payment)
SELECT is(
    (SELECT category FROM public.transactions WHERE description LIKE '%INV-2026-001%'),
    'supplier_payment',
    'Expense transaction created for supplier'
);

-- Verify Financial Obligations are untouched
SELECT is(
    (SELECT count(*)::int FROM public.financial_obligations WHERE entity_id = 'b7000000-0000-0000-0000-000000000001'),
    0,
    'Material purchase did NOT create order-level financial obligations (debt integrity protected)'
);

-- Verify Batch created
SELECT is(
    (SELECT status FROM public.material_batches WHERE batch_code = 'LOT-ZIR-001'),
    'sealed',
    'New batch created with sealed status'
);

-- Verify Ledger Movement created
SELECT is(
    (SELECT movement_type FROM public.material_movements WHERE notes LIKE '%INV-2026-001%'),
    'purchase_in',
    'Purchase IN ledger movement logged'
);

-- ─── 4. Technician 2-Tap Workflow (Open & Deplete Batch) ─────────────────────

-- Switch to technician
SET LOCAL "request.jwt.claim.sub" TO 'b9000000-0000-0000-0000-000000000002';

-- Tap 1: Open Batch
SELECT lives_ok(
    $$
    SELECT public.open_material_batch(
        (SELECT id FROM public.material_batches WHERE batch_code = 'LOT-ZIR-001')
    );
    $$,
    'Technician can open a sealed material batch'
);

SELECT is(
    (SELECT status FROM public.material_batches WHERE batch_code = 'LOT-ZIR-001'),
    'open',
    'Batch status transitioned to open'
);

-- Complete stage run -> Trigger auto-attribution
UPDATE public.production_stage_runs
   SET status = 'done',
       completed_at = NOW()
 WHERE id = 'b5500000-0000-0000-0000-000000000001';

SELECT is(
    (SELECT units_attributed FROM public.material_batch_usage WHERE stage_run_id = 'b5500000-0000-0000-0000-000000000001'),
    3.00::numeric,
    '3 units automatically attributed to the open batch upon stage completion'
);

-- Tap 2: Deplete Batch
SELECT lives_ok(
    $$
    SELECT public.deplete_material_batch(
        (SELECT id FROM public.material_batches WHERE batch_code = 'LOT-ZIR-001')
    );
    $$,
    'Technician can deplete an open material batch'
);

SELECT is(
    (SELECT status FROM public.material_batches WHERE batch_code = 'LOT-ZIR-001'),
    'depleted',
    'Batch status transitioned to depleted'
);

SELECT is(
    (SELECT movement_type FROM public.material_movements WHERE notes = 'استنفاد الديسك بالكامل' LIMIT 1),
    'consume',
    'Consumption ledger movement recorded when batch is depleted'
);

-- ─── 5. Stock Adjustment ───────────────────────────────────────────────────

-- Switch to admin
SET LOCAL "request.jwt.claim.sub" TO 'b9000000-0000-0000-0000-000000000001';

INSERT INTO public.material_batches (
    id, material_id, warehouse_id, batch_code, qty_received, qty_remaining, unit_cost, status
) VALUES (
    'b6600000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.warehouses WHERE is_default = TRUE LIMIT 1),
    'LOT-ADJUST-TEST', 10, 10, 100, 'sealed'
);

SELECT lives_ok(
    $$
    SELECT public.adjust_material_batch(
        'b6600000-0000-0000-0000-000000000001'::uuid,
        8::numeric,
        'جرد دوري: تلف 2 قطعة'
    );
    $$,
    'Admin can adjust batch stock quantity'
);

SELECT is(
    (SELECT qty_remaining FROM public.material_batches WHERE id = 'b6600000-0000-0000-0000-000000000001'),
    8.00::numeric,
    'Batch quantity remaining adjusted to 8'
);

SELECT * FROM finish();
ROLLBACK;
