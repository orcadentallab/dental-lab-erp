BEGIN;

SET search_path TO public, extensions;

SELECT plan(5);

-- ─── Actual-delivery-date bucketing (get_top_doctors) ───────────────────
-- Order scheduled for June but actually delivered in August must be
-- reported under August (matching getOfficialStatementDate), not June.

INSERT INTO public.doctors (
    id, name, phone, address, doctor_code, representative_name
) VALUES (
    '10000000-0000-0000-0000-000000000501',
    'Top parity doctor', '01000000000', 'Test address',
    'TOPPAR-DOC', 'Test representative'
);

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, actual_delivery_date, cost, production_status, issue_state
) VALUES (
    '40000000-0000-0000-0000-000000000501', 'TOPPAR-SLIPPED',
    '10000000-0000-0000-0000-000000000501', 'Slipped delivery', '[]',
    1000, 'A1', 'Delivered', '2026-06-15', '2026-08-05', 400,
    'final_delivered', 'none'
);

SELECT is(
    (
        SELECT (row->>'revenue')::numeric
        FROM jsonb_array_elements(public.get_top_doctors_privileged_20260801('2026-08-01', '2026-08-31', 5)) row
        LIMIT 1
    ),
    1000::numeric,
    'an order scheduled in June but actually delivered in August is reported under August'
);

SELECT is(
    jsonb_array_length(public.get_top_doctors_privileged_20260801('2026-06-01', '2026-06-30', 5)),
    0,
    'the same order does not appear under June (its scheduled month) once actually delivered elsewhere'
);

-- ─── Proportional item weighting (get_top_services) ──────────────────────
-- One order, two items: one with an explicit price, one with neither an
-- item price nor a catalog/custom price -- the priced item should absorb
-- almost all the order's revenue, the unpriced one only its equal-weight
-- share (matching StatementTab.tsx's client-side distribution exactly).

INSERT INTO public.doctors (
    id, name, phone, address, doctor_code, representative_name
) VALUES (
    '10000000-0000-0000-0000-000000000502',
    'Top parity doctor 2', '01000000000', 'Test address',
    'TOPPAR-DOC2', 'Test representative'
);

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, cost, production_status, issue_state
) VALUES (
    '40000000-0000-0000-0000-000000000502', 'TOPPAR-SPLIT-ITEMS',
    '10000000-0000-0000-0000-000000000502', 'Mixed pricing items', '[]',
    1000, 'A1', 'Delivered', CURRENT_DATE, 400,
    'final_delivered', 'none'
);

INSERT INTO public.order_items (order_id, product_type, price, teeth_numbers) VALUES
    ('40000000-0000-0000-0000-000000000502', 'Priced Service', 600, '[11]'::jsonb),
    ('40000000-0000-0000-0000-000000000502', 'Unpriced Service', 0, '[12]'::jsonb);

-- weight(priced) = 600*1 = 600; weight(unpriced) = fallback to unit_count = 1.
-- total_weight = 601. order total = 1000 (normal delivered, full price).
-- revenue(priced)   = 1000 * 600/601 ~= 998.34
-- revenue(unpriced) = 1000 *   1/601 ~=   1.66
SELECT ok(
    abs((
        SELECT (row->>'revenue')::numeric
        FROM jsonb_array_elements(public.get_top_services_privileged_20260801(NULL, NULL, 10)) row
        WHERE row->>'name' = 'Priced Service'
    ) - 998.34) < 0.5,
    'the explicitly-priced item absorbs almost the entire order revenue via proportional weighting'
);

SELECT ok(
    abs((
        SELECT (row->>'revenue')::numeric
        FROM jsonb_array_elements(public.get_top_services_privileged_20260801(NULL, NULL, 10)) row
        WHERE row->>'name' = 'Unpriced Service'
    ) - 1.66) < 0.5,
    'the item with no known price at all still gets a small equal-weight share, not zero'
);

SELECT is(
    (
        SELECT SUM((row->>'revenue')::numeric)
        FROM jsonb_array_elements(public.get_top_services_privileged_20260801(NULL, NULL, 10)) row
        WHERE row->>'name' IN ('Priced Service', 'Unpriced Service')
    )::numeric(10,2),
    1000.00,
    'the two items'' distributed revenue sums back exactly to the order total'
);

ROLLBACK;
