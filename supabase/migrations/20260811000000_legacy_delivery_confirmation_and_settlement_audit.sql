BEGIN;

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS legacy_delivery_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.workflow_v2_legacy_delivery_confirmations (
    order_id UUID PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    confirmed_by UUID REFERENCES public.users(id),
    confirmation_basis TEXT NOT NULL,
    migration_id TEXT
);

ALTER TABLE public.workflow_v2_legacy_delivery_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_v2_legacy_delivery_confirmations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.workflow_v2_legacy_delivery_confirmations TO authenticated;
DROP POLICY IF EXISTS "Admins review legacy delivery confirmations"
ON public.workflow_v2_legacy_delivery_confirmations;
CREATE POLICY "Admins review legacy delivery confirmations"
ON public.workflow_v2_legacy_delivery_confirmations
FOR SELECT TO authenticated
USING (public.get_my_role() = 'admin');

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_issue_timing_v2_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_issue_timing_v2_check
CHECK (
    NOT public.workflow_flag_enabled('workflow_issue_v2_enforce')
    OR (
        (
            issue_state <> 'cancelled'
            OR (first_delivered_at IS NULL AND NOT legacy_delivery_confirmed)
        )
        AND (
            issue_state NOT IN ('returned', 'doctor_rejected', 'redo')
            OR first_delivered_at IS NOT NULL
            OR legacy_delivery_confirmed
        )
        AND (
            issue_state <> 'lab_rejected'
            OR (
                first_delivered_at IS NULL
                AND NOT legacy_delivery_confirmed
                AND design_submitted_at IS NULL
            )
        )
    )
) NOT VALID;

-- This field is evidence for reviewed historical rows only. New orders and
-- ordinary client writes may never set it.
CREATE OR REPLACE FUNCTION public.guard_legacy_delivery_confirmation_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_operation TEXT := current_setting('app.order_issue_operation', true);
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF COALESCE(NEW.legacy_delivery_confirmed, FALSE) THEN
            RAISE EXCEPTION 'New orders cannot start with legacy delivery confirmation';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.legacy_delivery_confirmed IS NOT DISTINCT FROM OLD.legacy_delivery_confirmed THEN
        RETURN NEW;
    END IF;

    IF v_operation IS DISTINCT FROM 'confirm_legacy_delivery'
       OR public.get_my_role() <> 'admin' THEN
        RAISE EXCEPTION 'Legacy delivery confirmation requires the admin workflow RPC';
    END IF;

    IF NOT NEW.legacy_delivery_confirmed
       OR NEW.first_delivered_at IS NOT NULL
       OR NEW.issue_state NOT IN ('returned', 'doctor_rejected', 'redo') THEN
        RAISE EXCEPTION 'Legacy delivery confirmation is only valid for a post-delivery issue without an exact date';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_legacy_delivery_confirmation_v2 ON public.orders;

-- Apply the reviewed production corrections before installing the immutable
-- client-write guard. Fresh/local databases contain none of these case ids.
DO $legacy_review$
DECLARE
    v_cancelled_count INTEGER;
    v_legacy_count INTEGER;
    v_updated_count INTEGER;
    v_doctor_count_before BIGINT;
    v_doctor_count_after BIGINT;
    v_doctor_net_before NUMERIC;
    v_doctor_net_after NUMERIC;
BEGIN
    SELECT COUNT(*), COALESCE(SUM(net_amount), 0)
    INTO v_doctor_count_before, v_doctor_net_before
    FROM public.financial_obligations
    WHERE entity_type = 'doctor'
      AND status NOT IN ('void', 'written_off');

    SELECT COUNT(*) INTO v_cancelled_count
    FROM public.orders
    WHERE case_id = '1031-260425-502';

    IF v_cancelled_count > 1 THEN
        RAISE EXCEPTION 'Expected at most one reviewed cancelled case, found %', v_cancelled_count;
    ELSIF v_cancelled_count = 1 THEN
        UPDATE public.orders
        SET status = 'Doctor Rejected',
            production_status = 'final_delivered',
            issue_state = 'doctor_rejected',
            first_delivered_at = '2026-04-27 08:56:25.672+00'::TIMESTAMPTZ,
            first_delivered_source = 'status_history',
            rejection_doctor_decision = 'zero',
            rejected_doctor_amount = 0,
            rejection_financial_review_status = 'resolved',
            rejected_lab_cost = 0,
            rejected_designer_cost = 0,
            rejected_lab_cost_status = CASE WHEN supplier_id IS NULL THEN 'not_applicable' ELSE 'resolved' END,
            rejected_designer_cost_status = CASE WHEN designer_id IS NULL THEN 'not_applicable' ELSE 'resolved' END,
            updated_at = timezone('utc', now())
        WHERE case_id = '1031-260425-502'
          AND issue_state = 'cancelled'
          AND production_status = 'not_started'
          AND first_delivered_at IS NULL;

        GET DIAGNOSTICS v_updated_count = ROW_COUNT;
        IF v_updated_count <> 1 THEN
            RAISE EXCEPTION 'Reviewed cancelled case changed since preflight';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.financial_obligations obligation
            JOIN public.orders order_row ON order_row.id = obligation.order_id
            WHERE order_row.case_id = '1031-260425-502'
              AND obligation.status NOT IN ('void', 'written_off')
              AND COALESCE(obligation.net_amount, 0) <> 0
        ) THEN
            RAISE EXCEPTION 'Cancelled-case correction unexpectedly reactivated an obligation';
        END IF;
    END IF;

    SELECT COUNT(*) INTO v_legacy_count
    FROM public.orders
    WHERE case_id = ANY(ARRAY[
        '1001-140226-001','1001-140226-002','1017-170226-001','1049-260707-503',
        '2004-260517-574','2011-260730-504','CASE-1768129706975-2',
        'CASE-1768129706976-105','CASE-1768129706976-97','CASE-1768129706977-162',
        'CASE-1768129706977-163','CASE-1769820310810-32','CASE-1769820310811-63',
        'CASE-1769820310811-64','CASE-1769820310811-74','CASE-1769820310811-84',
        'CASE-1769820310811-86','CASE-1770402907832-15','CASE-1770402907832-16',
        'CASE-1770402907833-18','CASE-1770402907833-29','CASE-1771119936390-14',
        'CASE-1771119936390-7','CASE-1771119936390-8'
    ]::TEXT[]);

    IF v_legacy_count NOT IN (0, 24) THEN
        RAISE EXCEPTION 'Legacy delivery review set is partial: expected 0 or 24 rows, found %', v_legacy_count;
    END IF;

    IF v_legacy_count = 24 THEN
        UPDATE public.orders
        SET legacy_delivery_confirmed = TRUE,
            updated_at = updated_at
        WHERE case_id = ANY(ARRAY[
            '1001-140226-001','1001-140226-002','1017-170226-001','1049-260707-503',
            '2004-260517-574','2011-260730-504','CASE-1768129706975-2',
            'CASE-1768129706976-105','CASE-1768129706976-97','CASE-1768129706977-162',
            'CASE-1768129706977-163','CASE-1769820310810-32','CASE-1769820310811-63',
            'CASE-1769820310811-64','CASE-1769820310811-74','CASE-1769820310811-84',
            'CASE-1769820310811-86','CASE-1770402907832-15','CASE-1770402907832-16',
            'CASE-1770402907833-18','CASE-1770402907833-29','CASE-1771119936390-14',
            'CASE-1771119936390-7','CASE-1771119936390-8'
        ]::TEXT[])
          AND issue_state IN ('doctor_rejected', 'redo')
          AND first_delivered_at IS NULL
          AND NOT legacy_delivery_confirmed;

        GET DIAGNOSTICS v_updated_count = ROW_COUNT;
        IF v_updated_count <> 24 THEN
            RAISE EXCEPTION 'Legacy delivery confirmation preconditions changed: updated % of 24', v_updated_count;
        END IF;

        INSERT INTO public.workflow_v2_legacy_delivery_confirmations(
            order_id, confirmation_basis, migration_id
        )
        SELECT id,
               'Business owner confirmed these historical doctor-rejected/redo orders were delivered; exact first-delivery dates are unavailable.',
               '20260811000000'
        FROM public.orders
        WHERE case_id = ANY(ARRAY[
            '1001-140226-001','1001-140226-002','1017-170226-001','1049-260707-503',
            '2004-260517-574','2011-260730-504','CASE-1768129706975-2',
            'CASE-1768129706976-105','CASE-1768129706976-97','CASE-1768129706977-162',
            'CASE-1768129706977-163','CASE-1769820310810-32','CASE-1769820310811-63',
            'CASE-1769820310811-64','CASE-1769820310811-74','CASE-1769820310811-84',
            'CASE-1769820310811-86','CASE-1770402907832-15','CASE-1770402907832-16',
            'CASE-1770402907833-18','CASE-1770402907833-29','CASE-1771119936390-14',
            'CASE-1771119936390-7','CASE-1771119936390-8'
        ]::TEXT[])
        ON CONFLICT (order_id) DO NOTHING;
    END IF;

    SELECT COUNT(*), COALESCE(SUM(net_amount), 0)
    INTO v_doctor_count_after, v_doctor_net_after
    FROM public.financial_obligations
    WHERE entity_type = 'doctor'
      AND status NOT IN ('void', 'written_off');

    IF v_doctor_count_after <> v_doctor_count_before
       OR v_doctor_net_after <> v_doctor_net_before THEN
        RAISE EXCEPTION
            'Doctor obligations changed during legacy review: count % -> %, net % -> %',
            v_doctor_count_before, v_doctor_count_after,
            v_doctor_net_before, v_doctor_net_after;
    END IF;
END;
$legacy_review$;

CREATE TRIGGER guard_legacy_delivery_confirmation_v2
BEFORE INSERT OR UPDATE OF legacy_delivery_confirmed
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.guard_legacy_delivery_confirmation_v2();

CREATE OR REPLACE FUNCTION public.confirm_legacy_delivery_without_date_v2(
    p_order_id UUID,
    p_confirmation_basis TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_actor UUID := public.get_my_user_id();
    v_order public.orders%ROWTYPE;
BEGIN
    IF public.get_my_role() <> 'admin' OR v_actor IS NULL THEN
        RAISE EXCEPTION 'Admin role is required';
    END IF;
    IF NULLIF(btrim(p_confirmation_basis), '') IS NULL THEN
        RAISE EXCEPTION 'Confirmation basis is required';
    END IF;

    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
    IF v_order.first_delivered_at IS NOT NULL THEN
        RETURN jsonb_build_object('orderId', p_order_id, 'alreadyHasExactDate', TRUE);
    END IF;
    IF v_order.issue_state NOT IN ('returned', 'doctor_rejected', 'redo') THEN
        RAISE EXCEPTION 'Only a reviewed post-delivery legacy issue can be confirmed without a date';
    END IF;

    IF NOT v_order.legacy_delivery_confirmed THEN
        PERFORM set_config('app.order_issue_operation', 'confirm_legacy_delivery', TRUE);
        UPDATE public.orders
        SET legacy_delivery_confirmed = TRUE
        WHERE id = p_order_id;
    END IF;

    INSERT INTO public.workflow_v2_legacy_delivery_confirmations(
        order_id, confirmed_by, confirmation_basis
    ) VALUES (p_order_id, v_actor, btrim(p_confirmation_basis))
    ON CONFLICT (order_id) DO UPDATE
    SET confirmed_by = EXCLUDED.confirmed_by,
        confirmation_basis = EXCLUDED.confirmation_basis,
        confirmed_at = timezone('utc', now());

    RETURN jsonb_build_object('orderId', p_order_id, 'legacyDeliveryConfirmed', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_legacy_delivery_without_date_v2(UUID, TEXT)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_legacy_delivery_without_date_v2(UUID, TEXT)
TO authenticated;

CREATE OR REPLACE VIEW public.workflow_v2_backfill_effective_review
WITH (security_invoker = true)
AS
SELECT
    report.*,
    CASE
        WHEN report.timing_review_reason = 'post_delivery_issue_without_delivery_evidence'
             AND order_row.legacy_delivery_confirmed
            THEN NULL
        ELSE report.timing_review_reason
    END AS effective_timing_review_reason,
    (
        report.timing_review_reason = 'post_delivery_issue_without_delivery_evidence'
        AND order_row.legacy_delivery_confirmed
    ) AS accepted_legacy_delivery_without_date
FROM public.workflow_v2_backfill_dry_run report
JOIN public.orders order_row ON order_row.id = report.order_id;

REVOKE ALL ON public.workflow_v2_backfill_effective_review FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.workflow_v2_backfill_effective_review TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_workflow_v2_backfill(
    p_confirmation TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_actor UUID := public.get_my_user_id();
    v_timestamp_count INTEGER := 0;
    v_doctor_count INTEGER := 0;
    v_lab_count INTEGER := 0;
    v_unresolved_count INTEGER := 0;
    v_timing_unresolved_count INTEGER := 0;
BEGIN
    IF public.get_my_role() <> 'admin' OR v_actor IS NULL THEN RAISE EXCEPTION 'Admin role is required'; END IF;
    IF p_confirmation <> 'APPLY_REVIEWED_WORKFLOW_V2_BACKFILL' THEN RAISE EXCEPTION 'Explicit backfill confirmation is required'; END IF;
    IF public.workflow_flag_enabled('workflow_issue_v2_enforce') THEN RAISE EXCEPTION 'Disable V2 enforcement before controlled backfill'; END IF;
    IF NOT public.workflow_flag_enabled('workflow_finance_v2') THEN RAISE EXCEPTION 'Finance V2 must be enabled before classified rejection rebuild'; END IF;
    IF pg_get_functiondef('public.sync_order_financial_obligations()'::regprocedure) NOT LIKE '%manual_design_price%' THEN
        RAISE EXCEPTION 'Financial function does not use manual_design_price';
    END IF;
    IF (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'public.orders'::regclass AND tgname = 'trigger_sync_order_financial_obligations') LIKE '%is_archived%' THEN
        RAISE EXCEPTION 'is_archived must not invoke financial synchronization';
    END IF;
    IF (SELECT COUNT(*) FROM pg_trigger WHERE tgrelid = 'public.orders'::regclass AND NOT tgisinternal
        AND pg_get_triggerdef(oid) LIKE '%sync_order_financial_obligations%') <> 1 THEN
        RAISE EXCEPTION 'Exactly one order financial synchronization trigger is required';
    END IF;
    IF to_regclass('public.uq_financial_obligation_active_business_key') IS NULL THEN
        RAISE EXCEPTION 'Active obligation business key is missing';
    END IF;

    SELECT count(*) INTO v_timing_unresolved_count
    FROM public.workflow_v2_backfill_effective_review
    WHERE effective_timing_review_reason IS NOT NULL;
    IF v_timing_unresolved_count > 0 THEN
        RAISE EXCEPTION
            'Unresolved lifecycle timing rows must be reviewed before backfill: %',
            v_timing_unresolved_count;
    END IF;

    INSERT INTO public.workflow_v2_backfill_review(order_id, review_type, evidence, proposed_value)
    SELECT order_id, 'unresolved_legacy_rejection', evidence,
           jsonb_build_object('proposedIssue', proposed_legacy_issue)
    FROM public.workflow_v2_backfill_dry_run
    WHERE proposed_legacy_issue = 'unresolved_legacy_rejection'
    ON CONFLICT (order_id) DO UPDATE SET evidence = EXCLUDED.evidence, proposed_value = EXCLUDED.proposed_value;
    GET DIAGNOSTICS v_unresolved_count = ROW_COUNT;

    CREATE TEMP TABLE workflow_v2_selected_backfill ON COMMIT DROP AS
    SELECT * FROM public.workflow_v2_backfill_dry_run
    WHERE proposed_legacy_issue IN ('doctor_rejected', 'lab_rejected');

    UPDATE public.orders o SET
        first_delivered_at = report.proposed_first_delivered_at,
        first_delivered_source = report.proposed_first_delivered_source,
        design_submitted_at = COALESCE(o.design_submitted_at, report.proposed_design_submitted_at)
    FROM public.workflow_v2_backfill_dry_run report
    WHERE o.id = report.order_id
      AND o.status <> 'Rejected'
      AND o.first_delivered_at IS NULL
      AND report.proposed_first_delivered_at IS NOT NULL
      AND COALESCE(o.issue_state, 'none') NOT IN ('cancelled', 'lab_rejected');
    GET DIAGNOSTICS v_timestamp_count = ROW_COUNT;

    UPDATE public.orders o SET
        production_status = 'final_delivered',
        issue_state = 'doctor_rejected',
        first_delivered_at = selected.proposed_first_delivered_at,
        first_delivered_source = selected.proposed_first_delivered_source,
        design_submitted_at = COALESCE(o.design_submitted_at, selected.proposed_design_submitted_at),
        rejection_doctor_decision = CASE
            WHEN o.rejection_doctor_decision IN ('full_price', 'zero', 'custom_amount')
                 AND o.rejected_doctor_amount BETWEEN 0 AND COALESCE(o.total_price, 0)
                THEN o.rejection_doctor_decision
            ELSE 'decide_later'
        END,
        rejected_doctor_amount = CASE
            WHEN o.rejection_doctor_decision IN ('full_price', 'zero', 'custom_amount')
                 AND o.rejected_doctor_amount BETWEEN 0 AND COALESCE(o.total_price, 0)
                THEN o.rejected_doctor_amount
            ELSE NULL
        END,
        rejection_financial_review_status = CASE
            WHEN o.rejection_doctor_decision IN ('full_price', 'zero', 'custom_amount')
                 AND o.rejected_doctor_amount BETWEEN 0 AND COALESCE(o.total_price, 0)
                THEN 'resolved' ELSE 'pending' END,
        rejected_lab_cost_status = CASE WHEN o.supplier_id IS NULL THEN 'not_applicable' ELSE COALESCE(o.rejected_lab_cost_status, 'pending') END,
        rejected_designer_cost_status = CASE WHEN o.designer_id IS NULL THEN 'not_applicable' ELSE COALESCE(o.rejected_designer_cost_status, 'pending') END,
        updated_at = timezone('utc', now())
    FROM workflow_v2_selected_backfill selected
    WHERE o.id = selected.order_id AND selected.proposed_legacy_issue = 'doctor_rejected'
      AND COALESCE(o.issue_state, 'none') IN ('none', 'rejected');
    GET DIAGNOSTICS v_doctor_count = ROW_COUNT;

    UPDATE public.orders o SET
        production_status = CASE WHEN o.production_status IN ('not_started', 'designing') THEN o.production_status ELSE 'not_started' END,
        issue_state = 'lab_rejected', design_submitted_at = NULL,
        first_delivered_at = NULL, first_delivered_source = NULL,
        rejection_doctor_decision = 'zero', rejected_doctor_amount = 0,
        rejection_financial_review_status = 'resolved',
        rejected_lab_cost = 0, rejected_designer_cost = 0,
        rejected_lab_cost_status = CASE WHEN o.supplier_id IS NULL THEN 'not_applicable' ELSE 'resolved' END,
        rejected_designer_cost_status = CASE WHEN o.designer_id IS NULL THEN 'not_applicable' ELSE 'resolved' END,
        updated_at = timezone('utc', now())
    FROM workflow_v2_selected_backfill selected
    WHERE o.id = selected.order_id AND selected.proposed_legacy_issue = 'lab_rejected'
      AND COALESCE(o.issue_state, 'none') IN ('none', 'rejected');
    GET DIAGNOSTICS v_lab_count = ROW_COUNT;

    IF EXISTS (
        SELECT 1 FROM public.orders o JOIN workflow_v2_selected_backfill selected ON selected.order_id = o.id
        JOIN public.financial_obligations obligation ON obligation.order_id = o.id
        WHERE selected.proposed_legacy_issue = 'lab_rejected'
          AND obligation.status NOT IN ('void', 'written_off') AND COALESCE(obligation.net_amount, 0) <> 0
    ) THEN RAISE EXCEPTION 'Lab rejection backfill reconciliation failed'; END IF;

    RETURN jsonb_build_object(
        'timestampRows', v_timestamp_count, 'doctorRejectedRows', v_doctor_count,
        'labRejectedRows', v_lab_count, 'unresolvedRows', v_unresolved_count,
        'timingUnresolvedRows', v_timing_unresolved_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_workflow_v2_backfill(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_workflow_v2_backfill(TEXT) TO authenticated;

-- Active allocations are valid on a settled written-off obligation: they are
-- the real payments made before only the residual was closed by adjustment.
CREATE OR REPLACE VIEW public.financial_obligation_allocation_audit_v2
WITH (security_invoker = true)
AS
SELECT
    obligation.id AS obligation_id,
    obligation.order_id,
    obligation.entity_type,
    obligation.entity_id,
    obligation.status AS obligation_status,
    obligation.net_amount,
    obligation.allocated_amount,
    obligation.remaining_amount,
    COUNT(allocation.id) FILTER (WHERE allocation.status = 'active') AS active_allocation_count,
    COALESCE(SUM(allocation.allocated_amount) FILTER (WHERE allocation.status = 'active'), 0) AS active_allocation_total,
    CASE
        WHEN obligation.status = 'void'
             AND COUNT(allocation.id) FILTER (WHERE allocation.status = 'active') > 0
            THEN 'invalid_active_allocation_on_void'
        WHEN obligation.status = 'written_off'
             AND obligation.metadata->>'settlementStatus' = 'settled_by_adjustment'
             AND obligation.metadata ? 'adjustmentId'
             AND EXISTS (
                 SELECT 1 FROM public.adjustments adjustment
                 WHERE adjustment.id::TEXT = obligation.metadata->>'adjustmentId'
             )
            THEN 'settled_writeoff_valid'
        WHEN obligation.status = 'written_off'
             AND COUNT(allocation.id) FILTER (WHERE allocation.status = 'active') > 0
            THEN 'review_written_off_allocation'
        ELSE 'ok'
    END AS audit_status
FROM public.financial_obligations obligation
LEFT JOIN public.payment_allocations allocation ON allocation.obligation_id = obligation.id
GROUP BY obligation.id;

REVOKE ALL ON public.financial_obligation_allocation_audit_v2 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.financial_obligation_allocation_audit_v2 TO authenticated;

DO $postflight$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.workflow_v2_backfill_effective_review
        WHERE effective_timing_review_reason IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Effective workflow timing review still contains unresolved rows';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.financial_obligation_allocation_audit_v2
        WHERE obligation_id = '45d09bdf-4219-4054-b2f2-99c87c9ae188'::UUID
          AND audit_status <> 'settled_writeoff_valid'
    ) THEN
        RAISE EXCEPTION 'AB Lab settled write-off is not classified as valid';
    END IF;
END;
$postflight$;

COMMIT;
