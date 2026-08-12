BEGIN;

SET search_path TO public, extensions;

-- Isolate the dedicated on-hold retirement guard from the broader V2 guard.
UPDATE public.app_settings SET value = 'off'
WHERE key = 'workflow_issue_v2_enforce';

SELECT plan(8);

INSERT INTO public.doctors (
    id, name, phone, address, doctor_code, representative_name
) VALUES (
    '10000000-0000-0000-0000-000000000201',
    'On hold retirement doctor', '01000000000', 'Test address',
    'DBHOLD', 'Test representative'
);

SELECT has_function(
    'public',
    'prevent_new_on_hold_issue_state',
    ARRAY[]::text[],
    'database guard function exists'
);

SELECT has_trigger(
    'public',
    'orders',
    'trigger_prevent_new_on_hold_issue_state',
    'database guard trigger exists'
);

SELECT throws_like(
    $$
    INSERT INTO public.orders (
        case_id, doctor_id, patient_name, items, total_price, shade, status,
        delivery_date, cost, production_status, issue_state
    ) VALUES (
        'DBHOLD-NEW-BLOCKED',
        '10000000-0000-0000-0000-000000000201', 'Blocked insert', '[]',
        1000, 'A1', 'Under Production', CURRENT_DATE, 400,
        'in_production', 'on_hold'
    )
    $$,
    '%on_hold is retired%',
    'new orders cannot be inserted on hold'
);

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state
) VALUES (
    '40000000-0000-0000-0000-000000000201', 'DBHOLD-ACTIVE',
    '10000000-0000-0000-0000-000000000201', 'Active order', '[]',
    1000, 'A1', 'Under Production', CURRENT_DATE, 400,
    'in_production', 'none'
);

SELECT throws_like(
    $$
    UPDATE public.orders
    SET issue_state = 'on_hold'
    WHERE id = '40000000-0000-0000-0000-000000000201'
    $$,
    '%on_hold is retired%',
    'an active order cannot transition into on hold'
);

-- Seed one pre-migration row without disabling a table trigger while deferred
-- financial trigger events are pending in this test transaction.
SET LOCAL session_replication_role = replica;

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state
) VALUES (
    '40000000-0000-0000-0000-000000000202', 'DBHOLD-HISTORICAL',
    '10000000-0000-0000-0000-000000000201', 'Historical order', '[]',
    1250, 'A2', 'Under Production', CURRENT_DATE, 450,
    'in_production', 'on_hold'
);

SET LOCAL session_replication_role = origin;

UPDATE public.orders
SET patient_name = 'Historical order retained'
WHERE id = '40000000-0000-0000-0000-000000000202';

SELECT is(
    (SELECT issue_state FROM public.orders
     WHERE id = '40000000-0000-0000-0000-000000000202'),
    'on_hold',
    'unrelated edits preserve the historical on hold value'
);

SELECT ok((
    SELECT total_price = 1250 AND cost = 450
    FROM public.orders
    WHERE id = '40000000-0000-0000-0000-000000000202'
), 'historical financial amounts are not rewritten');

UPDATE public.orders
SET issue_state = 'none'
WHERE id = '40000000-0000-0000-0000-000000000202';

SELECT is(
    (SELECT issue_state FROM public.orders
     WHERE id = '40000000-0000-0000-0000-000000000202'),
    'none',
    'a historical on hold order may leave the retired state'
);

SELECT ok((
    SELECT total_price = 1250 AND cost = 450
    FROM public.orders
    WHERE id = '40000000-0000-0000-0000-000000000202'
), 'leaving the retired state does not rewrite order amounts');

ROLLBACK;
