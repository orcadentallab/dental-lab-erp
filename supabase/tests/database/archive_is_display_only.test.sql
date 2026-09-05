-- Archiving is a display flag, nothing more.
--
-- Guards 20260903060000_archive_is_display_only.sql.
--
-- The rule (owner, 2026-09-03): archiving NEVER cancels an order and NEVER
-- removes its money. It only hides a finished, settled case from the orders
-- page and the dashboard card. is_deleted is the only real exclusion.

BEGIN;

SET search_path TO public, extensions;

SELECT plan(5);

INSERT INTO public.doctors (
    id, name, phone, address, doctor_code, representative_name
) VALUES (
    '10000000-0000-0000-0000-000000000601',
    'Archive rule doctor', '01000000000', 'Test address',
    'ARCHIVE-DOC', 'Test representative'
);

INSERT INTO public.orders (
    id, case_id, doctor_id, patient_name, items, total_price, shade, status,
    delivery_date, actual_delivery_date, cost, production_status, issue_state,
    is_archived
) VALUES (
    '40000000-0000-0000-0000-000000000601', 'ARCHIVE-RULE-1',
    '10000000-0000-0000-0000-000000000601', 'Archive rule patient', '[]',
    1000, 'A1', 'Delivered', DATE '2026-07-10', DATE '2026-07-10', 400,
    'final_delivered', 'none', FALSE
);

-- ─── Archiving keeps every financial effect ───────────────────────────────

UPDATE public.orders
   SET is_archived = TRUE
 WHERE id = '40000000-0000-0000-0000-000000000601';

SELECT is(
    (public.get_analytics_summary_privileged_20260801(
        DATE '2026-07-01', DATE '2026-07-31')->>'total_sales_value')::numeric,
    1000::numeric,
    'an archived order keeps its full revenue'
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801(
        DATE '2026-07-01', DATE '2026-07-31')->>'total_order_count')::int,
    1,
    'an archived order is still counted'
);

SELECT is(
    (SELECT status FROM public.orders WHERE id = '40000000-0000-0000-0000-000000000601'),
    'Delivered',
    'archiving does not change the status'
);

-- ─── The archive event names itself in the history ────────────────────────

SELECT ok(
    EXISTS (
        SELECT 1 FROM public.order_history
        WHERE order_id = '40000000-0000-0000-0000-000000000601'
          AND action_type = 'UPDATE'
          AND changes ? 'is_archived'
          AND details ILIKE '%archived%'
    ),
    'the archive event is recorded with a description that names it, not a generic "Update Order"'
);

-- ─── Archiving cannot double as a cancellation or a write-off ─────────────

SELECT throws_ok(
    $$UPDATE public.orders
         SET is_archived = FALSE, status = 'Cancelled', total_price = 0
       WHERE id = '40000000-0000-0000-0000-000000000601'$$,
    '23514',
    NULL,
    'flipping the archive flag while changing the status or the money in the same update is rejected'
);

SELECT * FROM finish();
ROLLBACK;
