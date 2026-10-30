-- Read-only post-pilot gate for phase 5. Safe to run on Staging or Production.

BEGIN READ ONLY;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

SELECT key, value
FROM public.app_settings
WHERE key = 'workflow_status_legacy_mirror';

SELECT is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'orders'
  AND column_name = 'status';

SELECT *
FROM public.workflow_v2_status_parity_gate;

SELECT
    count(*) AS total_orders,
    count(*) FILTER (WHERE status IS NULL) AS null_legacy_statuses,
    count(*) FILTER (WHERE production_status IS NULL) AS null_production_statuses,
    count(*) FILTER (WHERE issue_state IS NULL) AS null_issue_states
FROM public.orders;

SELECT
    count(*) FILTER (WHERE status NOT IN ('void', 'written_off')) AS active_obligations,
    coalesce(sum(net_amount) FILTER (WHERE status NOT IN ('void', 'written_off')), 0) AS active_obligation_net,
    (SELECT count(*) FROM public.payment_allocations) AS allocations,
    (SELECT coalesce(sum(allocated_amount), 0) FROM public.payment_allocations) AS allocation_amount,
    (SELECT count(*) FROM public.transactions) AS transactions,
    (SELECT coalesce(sum(amount), 0) FROM public.transactions) AS transaction_amount
FROM public.financial_obligations;

ROLLBACK;
