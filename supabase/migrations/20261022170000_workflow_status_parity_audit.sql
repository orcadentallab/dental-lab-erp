-- Phase 4: read-only parity evidence before the legacy status mirror can be disabled.
-- This migration creates views only. It does not mutate orders, obligations,
-- allocations, transactions, accounting snapshots, or workflow flags.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE VIEW public.workflow_v2_status_parity_audit
WITH (security_invoker = true)
AS
WITH classified AS (
    SELECT
        o.id AS order_id,
        o.case_id,
        o.status AS legacy_status,
        o.production_status,
        o.issue_state,
        o.intake_state,
        public.derive_order_display_status_v2(
            o.production_status,
            o.issue_state,
            o.intake_state
        ) AS derived_status,
        public.derive_order_legacy_compat_status_v2(
            o.production_status,
            o.issue_state,
            o.intake_state
        ) AS expected_legacy_compat_status,
        COALESCE(o.legacy_delivery_confirmed, FALSE)
            AND o.actual_delivery_date IS NULL
            AND o.first_delivered_at IS NULL
            AS legacy_confirmed_without_timestamp,
        EXISTS (
            SELECT 1
            FROM public.workflow_v2_backfill_review review
            WHERE review.order_id = o.id
              AND review.resolved_at IS NULL
        ) AS has_unresolved_legacy_review,
        CASE
            WHEN o.status IN ('Delivered', 'Completed')
                THEN 'doctor_receivable_and_lab_payable'
            WHEN o.status = 'Ready'
                THEN 'lab_payable'
            WHEN o.status IN ('Doctor Rejected', 'Rejected')
                THEN 'issue_settlement'
            WHEN o.status IN ('Lab Rejected', 'Cancelled')
                THEN 'no_active_obligation'
            WHEN o.status = 'Returned for Adjustments'
                THEN 'preserve_earned_obligations'
            ELSE 'none'
        END AS legacy_financial_effect,
        CASE
            WHEN o.issue_state IN ('doctor_rejected', 'redo')
                THEN 'issue_settlement'
            WHEN o.issue_state IN ('lab_rejected', 'cancelled')
                THEN 'no_active_obligation'
            WHEN o.issue_state = 'returned'
                THEN 'preserve_earned_obligations'
            WHEN o.issue_state = 'none' AND o.production_status = 'final_delivered'
                THEN 'doctor_receivable_and_lab_payable'
            WHEN o.issue_state = 'none' AND o.production_status = 'final_ready'
                THEN 'lab_payable'
            ELSE 'none'
        END AS v2_financial_effect
    FROM public.orders o
), compared AS (
    SELECT
        classified.*,
        legacy_status IS DISTINCT FROM derived_status AS presentation_mismatch,
        CASE
            WHEN derived_status IS NULL THEN 'unresolved_v2_axes'
            WHEN legacy_status IS NOT DISTINCT FROM derived_status THEN NULL
            WHEN issue_state = 'redo' AND legacy_status = 'Doctor Rejected'
                THEN 'expected_redo_legacy_alias'
            WHEN legacy_status IS DISTINCT FROM expected_legacy_compat_status
                THEN 'legacy_status_differs_from_v2'
            ELSE 'compatibility_alias_differs_from_display'
        END AS presentation_mismatch_reason,
        legacy_financial_effect IS DISTINCT FROM v2_financial_effect
            AS financial_effect_differs,
        CASE
            WHEN legacy_financial_effect IS DISTINCT FROM v2_financial_effect
                THEN legacy_financial_effect || '_vs_' || v2_financial_effect
            ELSE NULL
        END AS financial_difference_reason
    FROM classified
)
SELECT
    order_id,
    case_id,
    legacy_status,
    derived_status,
    expected_legacy_compat_status,
    production_status,
    issue_state,
    intake_state,
    presentation_mismatch,
    presentation_mismatch_reason,
    legacy_confirmed_without_timestamp,
    has_unresolved_legacy_review,
    legacy_financial_effect,
    v2_financial_effect,
    financial_effect_differs,
    financial_difference_reason,
    (
        derived_status IS NULL
        OR has_unresolved_legacy_review
        OR financial_effect_differs
        OR (
            presentation_mismatch
            AND presentation_mismatch_reason <> 'expected_redo_legacy_alias'
        )
    ) AS requires_review
FROM compared;

CREATE OR REPLACE VIEW public.workflow_v2_status_parity_review
WITH (security_invoker = true)
AS
SELECT *
FROM public.workflow_v2_status_parity_audit
WHERE requires_review;

CREATE OR REPLACE VIEW public.workflow_v2_status_parity_gate
WITH (security_invoker = true)
AS
SELECT
    count(*)::BIGINT AS total_orders,
    count(*) FILTER (
        WHERE presentation_mismatch
          AND presentation_mismatch_reason <> 'expected_redo_legacy_alias'
    )::BIGINT AS unexplained_presentation_mismatches,
    count(*) FILTER (
        WHERE presentation_mismatch_reason = 'expected_redo_legacy_alias'
    )::BIGINT AS explained_redo_aliases,
    count(*) FILTER (WHERE derived_status IS NULL)::BIGINT AS unresolved_v2_rows,
    count(*) FILTER (WHERE has_unresolved_legacy_review)::BIGINT AS unresolved_legacy_rows,
    count(*) FILTER (WHERE financial_effect_differs)::BIGINT AS financial_differences,
    count(*) FILTER (WHERE requires_review)::BIGINT AS review_rows,
    count(*) FILTER (WHERE requires_review) = 0 AS ready_for_mirror_off
FROM public.workflow_v2_status_parity_audit;

REVOKE ALL ON public.workflow_v2_status_parity_audit
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.workflow_v2_status_parity_review
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.workflow_v2_status_parity_gate
FROM PUBLIC, anon, authenticated;

COMMENT ON VIEW public.workflow_v2_status_parity_audit IS
    'Read-only per-order phase-4 parity evidence. Presentation differences and financial-effect differences are intentionally separate.';
COMMENT ON VIEW public.workflow_v2_status_parity_review IS
    'Read-only phase-4 rows that require explanation or historical review before mirror-off.';
COMMENT ON VIEW public.workflow_v2_status_parity_gate IS
    'Read-only aggregate mirror-off gate. ready_for_mirror_off is true only when every review dimension is zero.';

COMMIT;
