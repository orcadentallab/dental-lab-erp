-- Apply reviewed lifecycle timestamps without weakening the transition guard.
-- Delivery and design submission are written in separate statements because
-- each timestamp has a distinct controlled operation marker.

BEGIN;

DO $$
BEGIN
    IF public.workflow_flag_enabled('workflow_issue_v2_enforce') THEN
        RAISE EXCEPTION 'Disable V2 enforcement before timestamp backfill';
    END IF;
    IF NOT public.workflow_flag_enabled('workflow_finance_v2') THEN
        RAISE EXCEPTION 'Finance V2 must be enabled before timestamp backfill';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.workflow_v2_backfill_effective_review
        WHERE effective_timing_review_reason IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Lifecycle timing review still contains unresolved rows';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.workflow_v2_backfill_dry_run report
        JOIN public.orders orders ON orders.id = report.order_id
        WHERE report.proposed_legacy_issue IN ('doctor_rejected', 'lab_rejected')
          AND orders.issue_state IS DISTINCT FROM report.proposed_legacy_issue
    ) THEN
        RAISE EXCEPTION 'Timestamp-only backfill cannot change issue classification';
    END IF;
END;
$$;

CREATE TEMP TABLE workflow_v2_financial_baseline ON COMMIT DROP AS
SELECT entity_type, count(*) AS active_count, COALESCE(sum(net_amount), 0) AS active_net
FROM public.financial_obligations
WHERE status NOT IN ('void', 'written_off')
GROUP BY entity_type;

SELECT set_config('app.order_issue_operation', 'record_final_delivery', true);

UPDATE public.orders orders
SET first_delivered_at = report.proposed_first_delivered_at,
    first_delivered_source = report.proposed_first_delivered_source
FROM public.workflow_v2_backfill_dry_run report
WHERE orders.id = report.order_id
  AND orders.status <> 'Rejected'
  AND orders.first_delivered_at IS NULL
  AND report.proposed_first_delivered_at IS NOT NULL
  AND COALESCE(orders.issue_state, 'none') NOT IN ('cancelled', 'lab_rejected');

SELECT set_config('app.order_issue_operation', 'submit_design', true);

UPDATE public.orders orders
SET design_submitted_at = report.proposed_design_submitted_at
FROM public.workflow_v2_backfill_dry_run report
WHERE orders.id = report.order_id
  AND orders.design_submitted_at IS NULL
  AND report.proposed_design_submitted_at IS NOT NULL
  AND COALESCE(orders.issue_state, 'none') <> 'lab_rejected';

DO $$
BEGIN
    IF EXISTS (
        SELECT entity_type, active_count, active_net
        FROM workflow_v2_financial_baseline
        EXCEPT
        SELECT entity_type, count(*), COALESCE(sum(net_amount), 0)
        FROM public.financial_obligations
        WHERE status NOT IN ('void', 'written_off')
        GROUP BY entity_type
    ) OR EXISTS (
        SELECT entity_type, count(*), COALESCE(sum(net_amount), 0)
        FROM public.financial_obligations
        WHERE status NOT IN ('void', 'written_off')
        GROUP BY entity_type
        EXCEPT
        SELECT entity_type, active_count, active_net
        FROM workflow_v2_financial_baseline
    ) THEN
        RAISE EXCEPTION 'Timestamp backfill changed active financial obligations';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.workflow_v2_backfill_effective_review
        WHERE effective_timing_review_reason IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Timestamp backfill left unresolved lifecycle timing rows';
    END IF;
END;
$$;

COMMIT;
