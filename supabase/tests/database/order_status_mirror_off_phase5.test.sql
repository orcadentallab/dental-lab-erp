BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;

SELECT plan(7);

SELECT ok(
    EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'orders'
          AND column_name = 'status'
          AND is_nullable = 'YES'
    ),
    'phase 5 keeps legacy status but allows V2-only inserts'
);

SELECT is(
    (SELECT value FROM public.app_settings
     WHERE key = 'workflow_status_legacy_mirror'),
    'off',
    'phase 5 disables the legacy status mirror'
);

INSERT INTO public.doctors(id, name, phone, address, doctor_code, representative_name)
VALUES (
    '1f500000-0000-0000-0000-000000000001',
    'Phase 5 mirror-off doctor', '01000005999', 'Test', 'PHASE5-OFF', ''
);

INSERT INTO public.orders(
    id, case_id, doctor_id, patient_name, items, total_price, shade,
    delivery_date, cost, production_status, issue_state, intake_state
) VALUES (
    '2f500000-0000-0000-0000-000000000001', 'PHASE5-OFF-1',
    '1f500000-0000-0000-0000-000000000001', 'V2 only order',
    '[]', 0, 'A1', CURRENT_DATE, 0, 'not_started', 'none', 'accepted'
);

SELECT is(
    (SELECT status FROM public.orders
     WHERE id = '2f500000-0000-0000-0000-000000000001'),
    NULL::text,
    'new orders do not write the legacy status while the mirror is off'
);

UPDATE public.orders
SET production_status = 'designing'
WHERE id = '2f500000-0000-0000-0000-000000000001';

SELECT is(
    (SELECT production_status FROM public.orders
     WHERE id = '2f500000-0000-0000-0000-000000000001'),
    'designing',
    'V2 production transitions still work while the mirror is off'
);

SELECT is(
    (SELECT status FROM public.orders
     WHERE id = '2f500000-0000-0000-0000-000000000001'),
    NULL::text,
    'V2 transitions leave the legacy status untouched'
);

SELECT throws_ok(
    $$UPDATE public.orders
      SET status = 'Delivered'
      WHERE id = '2f500000-0000-0000-0000-000000000001'$$,
    '22023',
    'Legacy order status writes are not allowed; update workflow V2 axes instead.',
    'direct legacy status writes remain blocked after mirror-off'
);

SELECT is(
    (SELECT count(*) FROM public.financial_obligations
     WHERE order_id = '2f500000-0000-0000-0000-000000000001'),
    0::bigint,
    'a zero-value V2 transition creates no financial obligation'
);

SELECT * FROM finish();
ROLLBACK;
