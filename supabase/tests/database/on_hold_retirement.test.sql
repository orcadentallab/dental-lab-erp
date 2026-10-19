BEGIN;

SET search_path TO public, extensions;

SELECT plan(5);

INSERT INTO public.doctors (
    id, name, phone, address, doctor_code, representative_name
) VALUES (
    '10000000-0000-0000-0000-000000000201',
    'Removed on hold doctor', '01000000000', 'Test address',
    'DBHOLD', 'Test representative'
);

SELECT ok(
    to_regprocedure('public.prevent_new_on_hold_issue_state()') IS NULL,
    'the temporary on_hold guard function is removed'
);

SELECT ok(
    NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trigger_prevent_new_on_hold_issue_state'
          AND NOT tgisinternal
    ),
    'the temporary on_hold guard trigger is removed'
);

SELECT ok(
    to_regprocedure('public.guard_retired_on_hold_insert_v2()') IS NULL,
    'the redundant V2 insert-only on_hold guard is removed'
);

SELECT throws_like(
    $$
    INSERT INTO public.orders (
        case_id, doctor_id, patient_name, items, total_price, shade, status,
        delivery_date, cost, production_status, issue_state
    ) VALUES (
        'DBHOLD-REMOVED',
        '10000000-0000-0000-0000-000000000201', 'Blocked insert', '[]',
        1000, 'A1', 'Under Production', CURRENT_DATE, 400,
        'in_production', 'on_hold'
    )
    $$,
    '%on_hold%',
    'on_hold is rejected by the database workflow boundary'
);

SELECT is(
    (SELECT count(*)::bigint FROM public.orders WHERE issue_state = 'on_hold'),
    0::bigint,
    'the database contains no on_hold orders'
);

ROLLBACK;
