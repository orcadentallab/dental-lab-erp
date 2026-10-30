-- Transactional phase-5 smoke test. It leaves no rows behind.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

CREATE TEMP TABLE phase5_smoke_baseline AS
SELECT jsonb_build_object(
    'activeObligations', (SELECT count(*) FROM public.financial_obligations WHERE status NOT IN ('void', 'written_off')),
    'activeObligationNet', (SELECT coalesce(sum(net_amount), 0) FROM public.financial_obligations WHERE status NOT IN ('void', 'written_off')),
    'allocations', (SELECT count(*) FROM public.payment_allocations),
    'allocationAmount', (SELECT coalesce(sum(allocated_amount), 0) FROM public.payment_allocations),
    'transactions', (SELECT count(*) FROM public.transactions),
    'transactionAmount', (SELECT coalesce(sum(amount), 0) FROM public.transactions)
) AS snapshot;

INSERT INTO public.doctors(id, name, phone, address, doctor_code, representative_name)
VALUES (
    '1f510000-0000-0000-0000-000000000001',
    'Phase 5 staging smoke', '01000005998', 'Test', 'PHASE5-SMOKE', ''
);

INSERT INTO public.orders(
    id, case_id, doctor_id, patient_name, items, total_price, shade,
    delivery_date, cost, production_status, issue_state, intake_state
) VALUES (
    '2f510000-0000-0000-0000-000000000001', 'PHASE5-SMOKE-1',
    '1f510000-0000-0000-0000-000000000001', 'Mirror-off smoke',
    '[]', 0, 'A1', CURRENT_DATE, 0, 'not_started', 'none', 'accepted'
);

DO $$
BEGIN
    IF (SELECT status FROM public.orders
        WHERE id = '2f510000-0000-0000-0000-000000000001') IS NOT NULL
    THEN
        RAISE EXCEPTION 'Mirror-off insert unexpectedly wrote legacy status';
    END IF;
END;
$$;

UPDATE public.orders
SET production_status = 'designing'
WHERE id = '2f510000-0000-0000-0000-000000000001';

UPDATE public.orders
SET production_status = 'in_production'
WHERE id = '2f510000-0000-0000-0000-000000000001';

DO $$
BEGIN
    IF (SELECT status FROM public.orders
        WHERE id = '2f510000-0000-0000-0000-000000000001') IS NOT NULL
    THEN
        RAISE EXCEPTION 'Mirror-off V2 transition unexpectedly wrote legacy status';
    END IF;

    BEGIN
        UPDATE public.orders
        SET status = 'Delivered'
        WHERE id = '2f510000-0000-0000-0000-000000000001';
        RAISE EXCEPTION 'Direct legacy status write unexpectedly succeeded';
    EXCEPTION
        WHEN SQLSTATE '22023' THEN NULL;
    END;

    IF (SELECT snapshot FROM phase5_smoke_baseline) IS DISTINCT FROM
       jsonb_build_object(
           'activeObligations', (SELECT count(*) FROM public.financial_obligations WHERE status NOT IN ('void', 'written_off')),
           'activeObligationNet', (SELECT coalesce(sum(net_amount), 0) FROM public.financial_obligations WHERE status NOT IN ('void', 'written_off')),
           'allocations', (SELECT count(*) FROM public.payment_allocations),
           'allocationAmount', (SELECT coalesce(sum(allocated_amount), 0) FROM public.payment_allocations),
           'transactions', (SELECT count(*) FROM public.transactions),
           'transactionAmount', (SELECT coalesce(sum(amount), 0) FROM public.transactions)
       )
    THEN
        RAISE EXCEPTION 'Mirror-off smoke changed financial baseline';
    END IF;
END;
$$;

ROLLBACK;
