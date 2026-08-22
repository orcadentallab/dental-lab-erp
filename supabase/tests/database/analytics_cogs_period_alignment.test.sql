BEGIN;

SET search_path TO public, extensions;

SELECT plan(4);

-- Regression guard for 20260823000000_align_cogs_period_with_revenue_period.
--
-- An order delivered LATE books its revenue in the month of actual delivery.
-- Its supplier/designer cost used to stay in the month it was PLANNED for
-- (delivery_date), splitting the two sides of the margin across periods and
-- inflating the delivering month's gross margin.

INSERT INTO public.doctors (
    id, name, phone, address, doctor_code, representative_name
) VALUES (
    '10000000-0000-0000-0000-000000000501',
    'Period alignment doctor', '01000000000', 'Test address',
    'PERIOD-DOC', 'Test representative'
);

INSERT INTO public.suppliers (id, name, phone) VALUES
    ('20000000-0000-0000-0000-000000000501', 'Period alignment supplier', '01000000001');

INSERT INTO public.users (id, username, role, name, custom_permissions) VALUES
    ('30000000-0000-0000-0000-000000000501', 'period_designer', 'designer', 'Period designer', '{}'::jsonb);

-- Planned for July, actually delivered in August.
INSERT INTO public.orders (
    id, case_id, doctor_id, supplier_id, designer_id, patient_name, items,
    total_price, shade, status, delivery_date, actual_delivery_date, cost,
    workflow_type, design_price, design_status, production_status, issue_state
) VALUES (
    '40000000-0000-0000-0000-000000000501', 'PERIOD-LATE-DELIVERY',
    '10000000-0000-0000-0000-000000000501',
    '20000000-0000-0000-0000-000000000501',
    '30000000-0000-0000-0000-000000000501',
    'Late delivery', '[]', 1000, 'A1', 'Delivered',
    '2026-07-20', '2026-08-05', 600,
    'split', 100, 'completed', 'final_delivered', 'none'
);

-- August window: revenue 1000, supplier cost 600-100=500, designer cost 100.
SELECT is(
    (public.get_analytics_summary_privileged_20260801('2026-08-01', '2026-08-31')->>'total_sales_value')::numeric,
    1000::numeric,
    'revenue of a late-delivered order lands in the month of actual delivery'
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801('2026-08-01', '2026-08-31')->>'total_cost_of_goods')::numeric,
    600::numeric,
    'its supplier + designer cost lands in the SAME month as the revenue it earned'
);

-- July window (the planned delivery month): neither side belongs there.
SELECT is(
    (public.get_analytics_summary_privileged_20260801('2026-07-01', '2026-07-31')->>'total_sales_value')::numeric,
    0::numeric,
    'no revenue is booked in the planned-delivery month'
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801('2026-07-01', '2026-07-31')->>'total_cost_of_goods')::numeric,
    0::numeric,
    'no cost is left behind in the planned-delivery month (the bug this migration fixes)'
);

SELECT * FROM finish();
ROLLBACK;
