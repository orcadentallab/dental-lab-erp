-- Final client cutover. Run only after the RPC-based frontend is deployed,
-- parity checks are clean, and DB enforcement has been explicitly enabled.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
    v_effective_review_unresolved BOOLEAN := FALSE;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_enforce')
       AND NOT EXISTS (SELECT 1 FROM public.orders)
       AND NOT EXISTS (SELECT 1 FROM public.financial_obligations)
       AND NOT EXISTS (SELECT 1 FROM public.transactions) THEN
        -- A fresh database has no historical rows requiring parity review.
        UPDATE public.app_settings
        SET value = 'on', updated_at = timezone('utc', now())
        WHERE key IN (
            'workflow_issue_v2_enforce',
            'workflow_issue_v2_write',
            'workflow_finance_v2',
            'workflow_accounting_audit_v2'
        );
    END IF;

    IF NOT public.workflow_flag_enabled('workflow_issue_v2_enforce') THEN
        RAISE EXCEPTION
            'Set workflow_issue_v2_enforce=on only after frontend cutover and parity approval';
    END IF;

    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write')
       OR NOT public.workflow_flag_enabled('workflow_finance_v2')
       OR NOT public.workflow_flag_enabled('workflow_accounting_audit_v2') THEN
        RAISE EXCEPTION
            'Workflow write, finance, and accounting audit flags must be enabled before client cutover';
    END IF;

    -- The effective-review view was introduced by a later historical
    -- migration. Query it only when it already exists (as it did at the live
    -- cutover); clean replays validate it in that later migration.
    IF to_regclass('public.workflow_v2_backfill_effective_review') IS NOT NULL THEN
        EXECUTE
            'SELECT EXISTS (
                SELECT 1
                FROM public.workflow_v2_backfill_effective_review
                WHERE effective_timing_review_reason IS NOT NULL
            )'
        INTO v_effective_review_unresolved;
    END IF;

    IF v_effective_review_unresolved OR EXISTS (
        SELECT 1
        FROM public.workflow_v2_backfill_dry_run
        WHERE proposed_legacy_issue = 'unresolved_legacy_rejection'
    ) THEN
        RAISE EXCEPTION 'Workflow V2 backfill still contains unresolved rows';
    END IF;

    IF to_regprocedure('public.get_my_doctor_orders_v2()') IS NULL
       OR to_regprocedure('public.create_my_order_request_v2(text,jsonb,text,text,text,text,date,numeric)') IS NULL
       OR to_regprocedure('public.submit_my_order_feedback_v2(uuid,integer,text)') IS NULL
       OR to_regprocedure('public.append_order_event_v2(jsonb)') IS NULL THEN
        RAISE EXCEPTION 'Required client-cutover RPCs are missing';
    END IF;
END;
$$;

-- Doctors now read/write through field-allowlisted SECURITY DEFINER RPCs.
DROP POLICY IF EXISTS "Doctors view own orders" ON public.orders;
DROP POLICY IF EXISTS "Doctors create order requests" ON public.orders;
DROP POLICY IF EXISTS "Doctors rate orders" ON public.orders;

-- All new clients append events through append_order_event_v2 or dedicated
-- workflow RPCs. Direct insert is retired only at this final stage.
REVOKE INSERT ON public.order_events FROM authenticated;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'orders'
          AND policyname IN (
              'Doctors view own orders',
              'Doctors create order requests',
              'Doctors rate orders'
          )
    ) THEN
        RAISE EXCEPTION 'Doctor direct orders policies were not retired';
    END IF;

    IF has_table_privilege('authenticated', 'public.order_events', 'INSERT') THEN
        RAISE EXCEPTION 'Authenticated clients still have direct order_events INSERT';
    END IF;
END;
$$;

COMMIT;
