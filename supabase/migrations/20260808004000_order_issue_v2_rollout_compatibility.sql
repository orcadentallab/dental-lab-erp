-- Keep legacy rollback usable until DB enforcement is explicitly enabled.
-- NOT VALID alone still checks every newly inserted/updated row, so the V2
-- transition/finance constraints must also respect the rollout gate.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_retired_on_hold_insert_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.issue_state = 'on_hold' THEN RAISE EXCEPTION 'on_hold is retired'; END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS aa_guard_retired_on_hold_insert_v2 ON public.orders;
CREATE TRIGGER aa_guard_retired_on_hold_insert_v2
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_retired_on_hold_insert_v2();

ALTER TABLE public.orders
    DROP CONSTRAINT IF EXISTS orders_issue_timing_v2_check,
    DROP CONSTRAINT IF EXISTS orders_zero_issue_financial_fields_check,
    DROP CONSTRAINT IF EXISTS orders_pending_doctor_decision_check;

ALTER TABLE public.orders
    ADD CONSTRAINT orders_issue_timing_v2_check
    CHECK (
        NOT public.workflow_flag_enabled('workflow_issue_v2_enforce')
        OR (
            (issue_state <> 'cancelled' OR first_delivered_at IS NULL)
            AND (issue_state NOT IN ('returned', 'doctor_rejected', 'redo') OR first_delivered_at IS NOT NULL)
            AND (issue_state <> 'lab_rejected' OR (first_delivered_at IS NULL AND design_submitted_at IS NULL))
        )
    ) NOT VALID,
    ADD CONSTRAINT orders_zero_issue_financial_fields_check
    CHECK (
        NOT public.workflow_flag_enabled('workflow_issue_v2_enforce')
        OR issue_state NOT IN ('cancelled', 'lab_rejected')
        OR (
            rejection_doctor_decision = 'zero'
            AND rejected_doctor_amount IS NOT DISTINCT FROM 0
            AND rejection_financial_review_status = 'resolved'
            AND rejected_lab_cost IS NOT DISTINCT FROM 0
            AND rejected_designer_cost IS NOT DISTINCT FROM 0
            AND rejected_lab_cost_status IN ('resolved', 'not_applicable')
            AND rejected_designer_cost_status IN ('resolved', 'not_applicable')
        )
    ) NOT VALID,
    ADD CONSTRAINT orders_pending_doctor_decision_check
    CHECK (
        NOT public.workflow_flag_enabled('workflow_issue_v2_enforce')
        OR rejection_doctor_decision IS DISTINCT FROM 'decide_later'
        OR (
            rejected_doctor_amount IS NOT DISTINCT FROM COALESCE(total_price, 0)
            AND rejection_financial_review_status = 'pending'
        )
    ) NOT VALID;

DO $$
BEGIN
    IF pg_get_constraintdef((
        SELECT oid FROM pg_constraint
        WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_issue_timing_v2_check'
    )) NOT LIKE '%workflow_flag_enabled%' THEN
        RAISE EXCEPTION 'V2 rollout-compatible constraints were not installed';
    END IF;
END;
$$;

COMMIT;
