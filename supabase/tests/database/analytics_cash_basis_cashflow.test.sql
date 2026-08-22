BEGIN;

SET search_path TO public, extensions;

SELECT plan(5);

-- Regression guard for 20260823001000_cash_basis_cashflow_fields.
--
-- cash_* must mirror financeService.getCashboxSummary(): dated by `date`,
-- excluding system-generated transfer fees and employee claims. The accrual
-- fields must keep dating by COALESCE(effective_date, date).

INSERT INTO public.suppliers (id, name, phone) VALUES
    ('20000000-0000-0000-0000-000000000601', 'Cash basis supplier', '01000000001');

INSERT INTO public.transactions (
    id, type, amount, category, date, effective_date, description,
    entity_id, entity_type, status, is_approved, is_system_generated_fee
) VALUES
    -- Paid in August against July's obligation: cash in August, accrual in July.
    (
        '50000000-0000-0000-0000-000000000601', 'expense', 1000,
        'supplier_payment', '2026-08-10', '2026-07-05', 'August payment for July',
        '20000000-0000-0000-0000-000000000601', 'supplier', 'approved', TRUE, FALSE
    ),
    -- Internal transfer fee: never part of cash flow.
    (
        '50000000-0000-0000-0000-000000000602', 'expense', 50,
        'عمولات ورسوم بنكية', '2026-08-12', NULL, 'Transfer fee',
        NULL, NULL, 'approved', TRUE, TRUE
    ),
    -- Employee claim (entity on a representative, non-salary category):
    -- settled separately, so counting it here would double-count the cash.
    (
        '50000000-0000-0000-0000-000000000603', 'expense', 300,
        'انتقالات ووقود', '2026-08-13', NULL, 'Rep travel claim',
        '30000000-0000-0000-0000-000000000601', 'representative', 'approved', TRUE, FALSE
    ),
    -- Plain operating expense with no entity: real cash out.
    (
        '50000000-0000-0000-0000-000000000604', 'expense', 200,
        'إيجارات ومرافق', '2026-08-14', NULL, 'Rent',
        NULL, NULL, 'approved', TRUE, FALSE
    );

SELECT is(
    (public.get_analytics_summary_privileged_20260801('2026-08-01', '2026-08-31')->>'cash_total_expenses')::numeric,
    1200::numeric,
    'cash expenses = the 1000 paid in August + 200 rent; the 50 transfer fee and the 300 employee claim are excluded'
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801('2026-08-01', '2026-08-31')->>'cash_supplier_payments')::numeric,
    1000::numeric,
    'the August-dated supplier payment counts as August cash even though it settles a July obligation'
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801('2026-08-01', '2026-08-31')->>'cash_other_expenses')::numeric,
    200::numeric,
    'suppliers + designers + other partition cash_total_expenses exactly'
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801('2026-07-01', '2026-07-31')->>'supplier_payments')::numeric,
    1000::numeric,
    'the accrual field still books that same payment in July, its effective month'
);

SELECT is(
    (public.get_analytics_summary_privileged_20260801('2026-07-01', '2026-07-31')->>'cash_supplier_payments')::numeric,
    0::numeric,
    'and no cash is reported in July, when no money moved'
);

SELECT * FROM finish();
ROLLBACK;
