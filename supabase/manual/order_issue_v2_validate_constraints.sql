-- Run manually in Supabase SQL Editor only after the backfill review queue is empty.
BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.workflow_v2_backfill_review
        WHERE resolved_by IS NULL OR resolution IS NULL
    ) THEN
        RAISE EXCEPTION 'Workflow V2 backfill still has unresolved rows';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.workflow_v2_backfill_dry_run
        WHERE proposed_legacy_issue = 'unresolved_legacy_rejection'
    ) THEN
        RAISE EXCEPTION 'Dry-run still reports unresolved legacy rejections';
    END IF;
END;
$$;

ALTER TABLE public.orders VALIDATE CONSTRAINT orders_first_delivered_source_check;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_lifecycle_timestamp_check;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_issue_timing_v2_check;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_zero_issue_financial_fields_check;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_pending_doctor_decision_check;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.orders'::regclass
          AND conname IN (
            'orders_first_delivered_source_check', 'orders_lifecycle_timestamp_check',
            'orders_issue_timing_v2_check', 'orders_zero_issue_financial_fields_check',
            'orders_pending_doctor_decision_check'
          )
          AND NOT convalidated
    ) THEN
        RAISE EXCEPTION 'One or more Workflow V2 constraints were not validated';
    END IF;
END;
$$;

COMMIT;
