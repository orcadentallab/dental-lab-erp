BEGIN;

SET search_path TO public, extensions;

SELECT plan(8);

INSERT INTO public.cashboxes (id, name, type, opening_balance)
VALUES (
    '63000000-0000-0000-0000-000000000001',
    'Atomic finance cashbox', 'cash', 0
);

SELECT lives_ok(
    $$
        SELECT public.create_finance_transaction_atomic(
            'expense', 1000, 'خامات ومستهلكات', 'Atomic material purchase',
            CURRENT_DATE, CURRENT_DATE, 'general', NULL,
            '63000000-0000-0000-0000-000000000001', 'approved', 25, CURRENT_DATE
        )
    $$,
    'the original transaction and transfer fee commit together'
);

SELECT is(
    (SELECT count(*)::integer FROM public.transactions
     WHERE description IN ('Atomic material purchase', 'عمولة سحب/تحويل - Atomic material purchase')),
    2,
    'exactly the original transaction and one fee are created'
);

SELECT is(
    (SELECT amount FROM public.transactions WHERE description = 'Atomic material purchase'),
    1000::numeric,
    'the original transaction keeps its exact amount'
);

SELECT is(
    (SELECT amount FROM public.transactions WHERE description = 'عمولة سحب/تحويل - Atomic material purchase'),
    25::numeric,
    'the linked fee keeps its exact amount'
);

SELECT is(
    (SELECT fee.linked_transaction_id
     FROM public.transactions fee
     WHERE fee.description = 'عمولة سحب/تحويل - Atomic material purchase'),
    (SELECT original.id
     FROM public.transactions original
     WHERE original.description = 'Atomic material purchase'),
    'the fee is linked to the original transaction'
);

SELECT is(
    (SELECT SUM(amount) FROM public.transactions
     WHERE cashbox_id = '63000000-0000-0000-0000-000000000001'
       AND type = 'expense'),
    1025::numeric,
    'cashbox outflow includes both the transaction and its fee'
);

SELECT throws_ok(
    $$
        SELECT public.create_finance_transaction_atomic(
            'expense', 400, 'خامات ومستهلكات', 'Must roll back',
            CURRENT_DATE, CURRENT_DATE, 'general', NULL,
            '63000000-0000-0000-0000-000000000001', 'approved', -1, CURRENT_DATE
        )
    $$,
    'P0001',
    'Transfer fee amount cannot be negative',
    'invalid fee rejects the complete operation before any row is inserted'
);

SELECT is(
    (SELECT count(*)::integer FROM public.transactions WHERE description = 'Must roll back'),
    0,
    'a rejected atomic operation leaves no original transaction behind'
);

SELECT * FROM finish();
ROLLBACK;
