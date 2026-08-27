BEGIN;

SET search_path TO public, extensions;

SELECT plan(10);

-- Fixtures
INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
    ('94000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec-admin@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('94000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec-accountant@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('94000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec-doctor@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('94000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rec-lab@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.users (id, auth_id, username, role, name) VALUES
    ('34000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001', 'rec_admin', 'admin', 'Rec Admin'),
    ('34000000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000002', 'rec_accountant', 'accountant', 'Rec Accountant'),
    ('34000000-0000-0000-0000-000000000003', '94000000-0000-0000-0000-000000000003', 'rec_doctor', 'doctor', 'Rec Doctor'),
    ('34000000-0000-0000-0000-000000000004', '94000000-0000-0000-0000-000000000004', 'rec_lab', 'lab', 'Rec External Lab');

INSERT INTO public.doctors (id, name, phone, address, doctor_code, representative_name)
VALUES ('14000000-0000-0000-0000-000000000001', 'Rec Doctor Entity', '01000000000', 'Test', 'REC-DOC', 'Rec Rep');

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state
) VALUES (
    '44000000-0000-0000-0000-000000000001', 'REC-ORDER-1',
    '14000000-0000-0000-0000-000000000001', 'Rec Patient', '[]', 100,
    'A1', 'New Case', CURRENT_DATE, 0, 'not_started', 'none'
);

-- 1. Insert reconciliation flag
INSERT INTO public.reconciliation_flags (
    id, flag_type, order_id, entity_type, entity_id, severity, message, metadata
) VALUES (
    '84000000-0000-0000-0000-000000000001',
    'orphaned_doctor_obligation_on_deletion',
    '44000000-0000-0000-0000-000000000001',
    'doctor',
    '14000000-0000-0000-0000-000000000001',
    'error',
    'Test orphaned obligation issue',
    '{"detail": "test"}'::jsonb
);

SELECT is(
    (SELECT status FROM public.reconciliation_flags WHERE id = '84000000-0000-0000-0000-000000000001'),
    'open',
    'new reconciliation flag defaults to open status'
);

SELECT is(
    (SELECT severity FROM public.reconciliation_flags WHERE id = '84000000-0000-0000-0000-000000000001'),
    'error',
    'reconciliation flag preserves error severity'
);

-- 2. Resolve reconciliation flag
UPDATE public.reconciliation_flags
SET status = 'resolved',
    resolved_at = now(),
    resolved_by = '34000000-0000-0000-0000-000000000002',
    resolution_notes = 'Manual audit completed and balance verified.'
WHERE id = '84000000-0000-0000-0000-000000000001';

SELECT is(
    (SELECT status FROM public.reconciliation_flags WHERE id = '84000000-0000-0000-0000-000000000001'),
    'resolved',
    'reconciliation flag transitions to resolved'
);

SELECT is(
    (SELECT resolution_notes FROM public.reconciliation_flags WHERE id = '84000000-0000-0000-0000-000000000001'),
    'Manual audit completed and balance verified.',
    'reconciliation flag stores resolution notes'
);

-- 3. RLS checks
-- As Accountant: can select
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "94000000-0000-0000-0000-000000000002"}';

SELECT is(
    (SELECT count(*)::integer FROM public.reconciliation_flags),
    1,
    'accountant can select reconciliation flags'
);

-- As Accountant: can insert
INSERT INTO public.reconciliation_flags (
    id, flag_type, message, status
) VALUES (
    '84000000-0000-0000-0000-000000000002',
    'test_flag',
    'Accountant inserted flag',
    'open'
);

SELECT is(
    (SELECT count(*)::integer FROM public.reconciliation_flags WHERE id = '84000000-0000-0000-0000-000000000002'),
    1,
    'accountant can insert reconciliation flag'
);

-- As Doctor: cannot select
SET LOCAL "request.jwt.claims" = '{"sub": "94000000-0000-0000-0000-000000000003"}';

SELECT is(
    (SELECT count(*)::integer FROM public.reconciliation_flags),
    0,
    'doctor cannot select reconciliation flags under RLS'
);

-- As Doctor: cannot insert either. This table is an audit queue the accountant
-- trusts, so a portal account must not be able to fabricate rows in it.
SELECT throws_ok(
    $$
        INSERT INTO public.reconciliation_flags (flag_type, message)
        VALUES ('forged_flag', 'Injected by a doctor account')
    $$,
    '42501',
    NULL,
    'doctor cannot insert reconciliation flags under RLS'
);

-- As External lab: cannot select — these rows expose doctor receivable details.
SET LOCAL "request.jwt.claims" = '{"sub": "94000000-0000-0000-0000-000000000004"}';

SELECT is(
    (SELECT count(*)::integer FROM public.reconciliation_flags),
    0,
    'external lab cannot select reconciliation flags under RLS'
);

-- As Admin: can select all
SET LOCAL "request.jwt.claims" = '{"sub": "94000000-0000-0000-0000-000000000001"}';

SELECT is(
    (SELECT count(*)::integer FROM public.reconciliation_flags),
    2,
    'admin can view all reconciliation flags'
);

SELECT * FROM finish();
ROLLBACK;
