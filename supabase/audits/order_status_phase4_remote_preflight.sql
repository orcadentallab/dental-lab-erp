BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

SELECT jsonb_build_object(
    'orders', (SELECT count(*) FROM public.orders),
    'intakeStateColumn', EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'orders'
          AND column_name = 'intake_state'
    ),
    'compatHelper',
        to_regprocedure('public.derive_order_legacy_compat_status_v2(text,text,text)') IS NOT NULL,
    'directWriteGuard',
        to_regprocedure('public.guard_direct_legacy_order_status_write()') IS NOT NULL,
    'parityAuditView',
        to_regclass('public.workflow_v2_status_parity_audit') IS NOT NULL,
    'mirrorFlag', (
        SELECT value
        FROM public.app_settings
        WHERE key = 'workflow_status_legacy_mirror'
    ),
    'activeObligations', (
        SELECT count(*)
        FROM public.financial_obligations
        WHERE status NOT IN ('void', 'written_off')
    ),
    'activeObligationNet', (
        SELECT coalesce(sum(net_amount), 0)
        FROM public.financial_obligations
        WHERE status NOT IN ('void', 'written_off')
    ),
    'allocations', (SELECT count(*) FROM public.payment_allocations),
    'allocationAmount', (
        SELECT coalesce(sum(allocated_amount), 0)
        FROM public.payment_allocations
    ),
    'transactions', (SELECT count(*) FROM public.transactions),
    'transactionAmount', (
        SELECT coalesce(sum(amount), 0)
        FROM public.transactions
    )
) AS preflight;

ROLLBACK;
