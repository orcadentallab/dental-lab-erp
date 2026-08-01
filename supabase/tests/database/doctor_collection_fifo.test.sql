BEGIN;

SET search_path TO public, extensions;

SELECT plan(14);

-- One center with two branches verifies that collections and credits operate
-- on the canonical account while allocations still target the real branch
-- obligations.
INSERT INTO public.doctors (
    id, name, phone, address, doctor_code, representative_name, is_center, parent_id
) VALUES
    (
        '10000000-0000-0000-0000-000000000201',
        'FIFO test center', '01000000000', 'Test address', 'FIFO-CENTER', 'Test rep', TRUE, NULL
    ),
    (
        '10000000-0000-0000-0000-000000000202',
        'FIFO test branch A', '01000000000', 'Test address', 'FIFO-A', 'Test rep', FALSE,
        '10000000-0000-0000-0000-000000000201'
    ),
    (
        '10000000-0000-0000-0000-000000000203',
        'FIFO test branch B', '01000000000', 'Test address', 'FIFO-B', 'Test rep', FALSE,
        '10000000-0000-0000-0000-000000000201'
    ),
    (
        '10000000-0000-0000-0000-000000000204',
        'FIFO standalone doctor', '01000000000', 'Test address', 'FIFO-SOLO', 'Test rep', FALSE, NULL
    );

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, actual_delivery_date, cost, production_status, issue_state
) VALUES
    (
        '40000000-0000-0000-0000-000000000201', 'FIFO-OLD-A',
        '10000000-0000-0000-0000-000000000202', 'Old branch A case', '[]',
        500, 'A1', 'Delivered', CURRENT_DATE - 2, CURRENT_DATE - 2, 0,
        'final_delivered', 'none'
    ),
    (
        '40000000-0000-0000-0000-000000000202', 'FIFO-OLD-B',
        '10000000-0000-0000-0000-000000000203', 'Old branch B case', '[]',
        500, 'A1', 'Delivered', CURRENT_DATE - 1, CURRENT_DATE - 1, 0,
        'final_delivered', 'none'
    );

INSERT INTO public.transactions (
    id, type, amount, category, date, description, entity_id, entity_type,
    status, is_approved
) VALUES (
    '50000000-0000-0000-0000-000000000201', 'income', 1300,
    'collection', CURRENT_DATE, 'FIFO center collection',
    '10000000-0000-0000-0000-000000000201', 'doctor', 'approved', TRUE
);

SELECT is(
    (SELECT COALESCE(SUM(allocated_amount), 0)
     FROM public.payment_allocations
     WHERE payment_transaction_id = '50000000-0000-0000-0000-000000000201'
       AND status = 'active'),
    1000::numeric,
    'approved center collection allocates the available amount automatically'
);

SELECT is(
    (SELECT count(*)::integer
     FROM public.payment_allocations
     WHERE payment_transaction_id = '50000000-0000-0000-0000-000000000201'
       AND status = 'active'),
    2,
    'one center collection allocates across both branch obligations'
);

SELECT is(
    (SELECT status FROM public.financial_obligations
     WHERE order_id = '40000000-0000-0000-0000-000000000201'
       AND entity_type = 'doctor' AND status <> 'void'),
    'paid'::text,
    'the oldest doctor obligation is paid first'
);

SELECT is(
    (SELECT remaining_amount FROM public.account_credits
     WHERE source_transaction_id = '50000000-0000-0000-0000-000000000201'
       AND status = 'active'),
    300::numeric,
    'collection excess becomes one active doctor credit'
);

SELECT is(
    (SELECT entity_id FROM public.account_credits
     WHERE source_transaction_id = '50000000-0000-0000-0000-000000000201'
       AND status = 'active'),
    '10000000-0000-0000-0000-000000000201'::uuid,
    'doctor credit belongs to the canonical center account'
);

-- A later obligation on a branch must consume the center credit immediately.
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, actual_delivery_date, cost, production_status, issue_state
) VALUES (
    '40000000-0000-0000-0000-000000000203', 'FIFO-NEW-B',
    '10000000-0000-0000-0000-000000000203', 'New branch B case', '[]',
    250, 'A1', 'Delivered', CURRENT_DATE, CURRENT_DATE, 0,
    'final_delivered', 'none'
);

SELECT is(
    (SELECT allocated_amount FROM public.payment_allocations
     WHERE payment_transaction_id = '50000000-0000-0000-0000-000000000201'
       AND obligation_id = (
           SELECT id FROM public.financial_obligations
           WHERE order_id = '40000000-0000-0000-0000-000000000203'
             AND entity_type = 'doctor' AND status <> 'void'
       )
       AND allocation_method = 'credit_auto_apply'
       AND status = 'active'),
    250::numeric,
    'a new branch obligation consumes existing center credit automatically'
);

SELECT is(
    (SELECT remaining_amount FROM public.account_credits
     WHERE source_transaction_id = '50000000-0000-0000-0000-000000000201'
       AND status = 'active'),
    50::numeric,
    'only the unused center credit remains after the new obligation'
);

SELECT is(
    (SELECT count(DISTINCT entity_id)::integer
     FROM public.payment_allocations
     WHERE payment_transaction_id = '50000000-0000-0000-0000-000000000201'
       AND status = 'active'),
    1,
    'all center allocations use one canonical account id'
);

SELECT is(
    (SELECT 1300
          - COALESCE(SUM(allocated_amount), 0)
          - COALESCE((
                SELECT SUM(remaining_amount)
                FROM public.account_credits
                WHERE source_transaction_id = '50000000-0000-0000-0000-000000000201'
                  AND status IN ('active', 'review')
            ), 0)
     FROM public.payment_allocations
     WHERE payment_transaction_id = '50000000-0000-0000-0000-000000000201'
       AND status = 'active'),
    0::numeric,
    'the approved center collection has no untracked residual'
);

-- Approval transitions allocate exactly once; pending payments do nothing.
INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, actual_delivery_date, cost, production_status, issue_state
) VALUES (
    '40000000-0000-0000-0000-000000000204', 'FIFO-PENDING',
    '10000000-0000-0000-0000-000000000204', 'Pending approval case', '[]',
    400, 'A1', 'Delivered', CURRENT_DATE, CURRENT_DATE, 0,
    'final_delivered', 'none'
);

INSERT INTO public.transactions (
    id, type, amount, category, date, description, entity_id, entity_type,
    status, is_approved
) VALUES (
    '50000000-0000-0000-0000-000000000204', 'income', 400,
    'collection', CURRENT_DATE, 'Pending doctor collection',
    '10000000-0000-0000-0000-000000000204', 'doctor', 'pending', FALSE
);

SELECT is(
    (SELECT count(*)::integer FROM public.payment_allocations
     WHERE payment_transaction_id = '50000000-0000-0000-0000-000000000204'),
    0,
    'pending doctor collection is not allocated'
);

UPDATE public.transactions
SET status = 'approved', is_approved = TRUE
WHERE id = '50000000-0000-0000-0000-000000000204';

SELECT is(
    (SELECT COALESCE(SUM(allocated_amount), 0)
     FROM public.payment_allocations
     WHERE payment_transaction_id = '50000000-0000-0000-0000-000000000204'
       AND status = 'active'),
    400::numeric,
    'approving a pending doctor collection allocates it once'
);

SELECT throws_like(
    $$UPDATE public.transactions
      SET amount = 401
      WHERE id = '50000000-0000-0000-0000-000000000204'$$,
    '%Allocated payment cannot be edited or deleted directly%',
    'an allocated doctor collection cannot be edited directly'
);

SELECT is(
    (SELECT count(*)::integer
     FROM (
         SELECT obligation.id
         FROM public.financial_obligations obligation
         LEFT JOIN public.payment_allocations allocation
           ON allocation.obligation_id = obligation.id
          AND allocation.status = 'active'
         WHERE obligation.entity_type = 'doctor'
         GROUP BY obligation.id, obligation.allocated_amount
         HAVING ABS(obligation.allocated_amount - COALESCE(SUM(allocation.allocated_amount), 0)) > 0.005
     ) mismatches),
    0,
    'doctor obligation allocated amounts match active allocation rows'
);

SELECT is(
    (SELECT count(*)::integer
     FROM public.payment_allocations allocation
     JOIN public.financial_obligations obligation
       ON obligation.id = allocation.obligation_id
     WHERE allocation.status = 'active'
       AND obligation.status = 'void'),
    0,
    'no active doctor allocation points to a void obligation'
);

SELECT * FROM finish();
ROLLBACK;
