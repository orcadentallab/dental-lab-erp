-- Order issue workflow V2: canonical lifecycle timestamps, guarded/idempotent
-- transitions, designer rejection review, accounting audit trail, and
-- restricted doctor-facing reads.
--
-- PRODUCTION RUNBOOK
-- 1. Run the preflight queries at the end of this file in Supabase SQL Editor.
-- 2. Execute this file in a transaction. Feature flags remain OFF by default.
-- 3. Run the postflight assertions. Do not mark the migration applied until
--    every assertion succeeds.

BEGIN;

CREATE OR REPLACE FUNCTION public.workflow_flag_enabled(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT value = 'on' FROM public.app_settings WHERE key = p_key),
        FALSE
    );
$$;

CREATE OR REPLACE FUNCTION public.get_order_workflow_v2_capabilities()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'shadowRead', public.workflow_flag_enabled('workflow_issue_v2_shadow_read'),
        'write', public.workflow_flag_enabled('workflow_issue_v2_write'),
        'enforce', public.workflow_flag_enabled('workflow_issue_v2_enforce'),
        'finance', public.workflow_flag_enabled('workflow_finance_v2'),
        'accountingAudit', public.workflow_flag_enabled('workflow_accounting_audit_v2')
    );
$$;

INSERT INTO public.app_settings (key, value)
VALUES
    ('workflow_issue_v2_shadow_read', 'off'),
    ('workflow_issue_v2_write', 'off'),
    ('workflow_issue_v2_enforce', 'off'),
    ('workflow_finance_v2', 'off'),
    ('workflow_accounting_audit_v2', 'off'),
    ('workflow_status_legacy_mirror', 'on')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS design_submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS first_delivered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS first_delivered_source TEXT,
    ADD COLUMN IF NOT EXISTS accounting_review_cycle_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_first_delivered_source_check') THEN
        ALTER TABLE public.orders ADD CONSTRAINT orders_first_delivered_source_check
        CHECK (
            first_delivered_source IS NULL OR first_delivered_source IN (
                'direct_transition', 'order_event', 'status_history',
                'actual_delivery_date', 'accounting_snapshot_inferred', 'manual_review'
            )
        ) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_lifecycle_timestamp_check') THEN
        ALTER TABLE public.orders ADD CONSTRAINT orders_lifecycle_timestamp_check
        CHECK (
            (design_submitted_at IS NULL OR design_submitted_at >= created_at)
            AND (first_delivered_at IS NULL OR first_delivered_at >= created_at)
        ) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_issue_timing_v2_check') THEN
        ALTER TABLE public.orders ADD CONSTRAINT orders_issue_timing_v2_check
        CHECK (
            (issue_state <> 'cancelled' OR first_delivered_at IS NULL)
            AND (issue_state NOT IN ('returned', 'doctor_rejected', 'redo') OR first_delivered_at IS NOT NULL)
            AND (issue_state <> 'lab_rejected' OR (first_delivered_at IS NULL AND design_submitted_at IS NULL))
        ) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_zero_issue_financial_fields_check') THEN
        ALTER TABLE public.orders ADD CONSTRAINT orders_zero_issue_financial_fields_check
        CHECK (
            issue_state NOT IN ('cancelled', 'lab_rejected') OR (
                rejection_doctor_decision = 'zero'
                AND rejected_doctor_amount IS NOT DISTINCT FROM 0
                AND rejection_financial_review_status = 'resolved'
                AND rejected_lab_cost IS NOT DISTINCT FROM 0
                AND rejected_designer_cost IS NOT DISTINCT FROM 0
                AND rejected_lab_cost_status IN ('resolved', 'not_applicable')
                AND rejected_designer_cost_status IN ('resolved', 'not_applicable')
            )
        ) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_pending_doctor_decision_check') THEN
        ALTER TABLE public.orders ADD CONSTRAINT orders_pending_doctor_decision_check
        CHECK (
            rejection_doctor_decision IS DISTINCT FROM 'decide_later' OR (
                rejected_doctor_amount IS NOT DISTINCT FROM COALESCE(total_price, 0)
                AND rejection_financial_review_status = 'pending'
            )
        ) NOT VALID;
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.order_transition_commands (
    idempotency_key UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES public.orders(id),
    operation TEXT NOT NULL,
    requested_by UUID NOT NULL REFERENCES public.users(id),
    request_payload JSONB NOT NULL,
    result_payload JSONB,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.order_transition_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_transition_commands FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.schema_deployment_log (
    migration_id TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    executed_by TEXT NOT NULL,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    assertion_results JSONB NOT NULL,
    row_counts_before JSONB NOT NULL DEFAULT '{}'::jsonb,
    row_counts_after JSONB NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.schema_deployment_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schema_deployment_log FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.accounting_review_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id),
    review_cycle_id UUID NOT NULL,
    sequence_no INTEGER NOT NULL,
    changed_by UUID REFERENCES public.users(id),
    event_type TEXT NOT NULL,
    before_snapshot JSONB NOT NULL,
    after_snapshot JSONB NOT NULL,
    changed_fields JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES public.users(id),
    UNIQUE (review_cycle_id, sequence_no)
);
CREATE INDEX IF NOT EXISTS idx_accounting_review_changes_order
ON public.accounting_review_changes(order_id, created_at);
ALTER TABLE public.accounting_review_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_review_changes FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.doctor_order_feedback (
    order_id UUID PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES public.doctors(id),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    issues JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.doctor_order_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_order_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.accounting_review_changes TO authenticated;
DROP POLICY IF EXISTS "Accounting staff view review changes" ON public.accounting_review_changes;
CREATE POLICY "Accounting staff view review changes"
ON public.accounting_review_changes FOR SELECT TO authenticated
USING (public.get_my_role() IN ('admin', 'accountant'));

CREATE TABLE IF NOT EXISTS public.workflow_v2_backfill_review (
    order_id UUID PRIMARY KEY REFERENCES public.orders(id),
    review_type TEXT NOT NULL CHECK (review_type IN (
        'unresolved_delivery_history',
        'unresolved_design_submission_history',
        'unresolved_legacy_rejection',
        'unresolved_rejection_financials'
    )),
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    proposed_value JSONB,
    resolution JSONB,
    resolved_by UUID REFERENCES public.users(id),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.workflow_v2_backfill_review ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_v2_backfill_review FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.workflow_v2_backfill_review TO authenticated;
DROP POLICY IF EXISTS "Admins view workflow backfill review" ON public.workflow_v2_backfill_review;
CREATE POLICY "Admins view workflow backfill review"
ON public.workflow_v2_backfill_review FOR SELECT TO authenticated
USING (public.get_my_role() = 'admin');

CREATE OR REPLACE FUNCTION public.guard_order_issue_transition_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_operation TEXT := current_setting('app.order_issue_operation', true);
    v_pending_rejection UUID;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.issue_state = 'on_hold' THEN
            RAISE EXCEPTION 'on_hold is retired';
        END IF;
        IF COALESCE(NEW.issue_state, 'none') <> 'none' THEN
            RAISE EXCEPTION 'New orders must start with issue_state=none';
        END IF;
        IF NEW.first_delivered_at IS NOT NULL OR NEW.design_submitted_at IS NOT NULL THEN
            RAISE EXCEPTION 'New orders cannot inherit delivery timestamps';
        END IF;
        RETURN NEW;
    END IF;

    IF NOT public.workflow_flag_enabled('workflow_issue_v2_enforce') THEN
        RETURN NEW;
    END IF;

    IF NEW.first_delivered_at IS DISTINCT FROM OLD.first_delivered_at
       AND v_operation IS DISTINCT FROM 'record_final_delivery' THEN
        RAISE EXCEPTION 'first_delivered_at can only be changed by final delivery RPC';
    END IF;
    IF NEW.design_submitted_at IS DISTINCT FROM OLD.design_submitted_at
       AND v_operation IS DISTINCT FROM 'submit_design' THEN
        RAISE EXCEPTION 'design_submitted_at can only be changed by design submission RPC';
    END IF;
    IF NEW.issue_state IS NOT DISTINCT FROM OLD.issue_state THEN
        RETURN NEW;
    END IF;
    IF v_operation IS NULL THEN
        RAISE EXCEPTION 'Issue transitions must use an approved workflow RPC';
    END IF;
    IF v_role NOT IN ('admin', 'representative') THEN
        RAISE EXCEPTION 'Only admin or representative can apply issue transitions';
    END IF;

    CASE NEW.issue_state
        WHEN 'cancelled' THEN
            IF v_operation <> 'cancel_order' OR OLD.first_delivered_at IS NOT NULL THEN
                RAISE EXCEPTION 'Cancellation is only allowed before first delivery';
            END IF;
        WHEN 'returned' THEN
            IF v_operation <> 'return_for_adjustment' OR OLD.first_delivered_at IS NULL THEN
                RAISE EXCEPTION 'Return for adjustment requires prior delivery';
            END IF;
        WHEN 'doctor_rejected' THEN
            IF v_operation <> 'doctor_reject_order' OR OLD.first_delivered_at IS NULL THEN
                RAISE EXCEPTION 'Doctor rejection requires prior delivery';
            END IF;
        WHEN 'redo' THEN
            IF v_operation <> 'create_redo' OR OLD.first_delivered_at IS NULL THEN
                RAISE EXCEPTION 'Redo requires prior delivery';
            END IF;
        WHEN 'lab_rejected' THEN
            IF v_operation NOT IN ('approve_designer_rejection', 'admin_tech_reject')
               OR OLD.first_delivered_at IS NOT NULL
               OR OLD.design_submitted_at IS NOT NULL THEN
                RAISE EXCEPTION 'Lab rejection is only allowed before design submission and final delivery';
            END IF;
            IF v_operation = 'admin_tech_reject' THEN
                IF v_role <> 'admin' THEN
                    RAISE EXCEPTION 'Only admin can reject directly from technician status';
                END IF;
            ELSE
                SELECT event.id INTO v_pending_rejection
                FROM public.order_events event
                WHERE event.order_id = OLD.id
                  AND event.event_type = 'designer_rejection_requested'
                  AND event.approval_status = 'pending'
                ORDER BY event.created_at DESC
                LIMIT 1 FOR UPDATE;
                IF v_pending_rejection IS NULL THEN
                    RAISE EXCEPTION 'Pending designer rejection request is required';
                END IF;
            END IF;
        ELSE
            RAISE EXCEPTION 'Unsupported issue transition: %', NEW.issue_state;
    END CASE;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_order_issue_transition_v2 ON public.orders;
CREATE TRIGGER guard_order_issue_transition_v2
BEFORE INSERT OR UPDATE OF issue_state, design_submitted_at, first_delivered_at
ON public.orders FOR EACH ROW
EXECUTE FUNCTION public.guard_order_issue_transition_v2();

CREATE OR REPLACE FUNCTION public.apply_order_issue_transition_v2(
    p_order_id UUID,
    p_operation TEXT,
    p_reason TEXT,
    p_idempotency_key UUID,
    p_doctor_decision TEXT DEFAULT NULL,
    p_custom_doctor_amount NUMERIC DEFAULT NULL,
    p_user_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := public.get_my_user_id();
    v_order public.orders%ROWTYPE;
    v_target_issue TEXT;
    v_payload JSONB;
    v_existing public.order_transition_commands%ROWTYPE;
    v_result JSONB;
    v_doctor_amount NUMERIC;
    v_review_status TEXT;
    v_inserted INTEGER;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN
        RAISE EXCEPTION 'Order issue workflow V2 writes are disabled';
    END IF;
    IF v_role NOT IN ('admin', 'representative') OR v_user_id IS NULL THEN
        RAISE EXCEPTION 'Only admin or representative can apply issue transitions';
    END IF;
    IF NULLIF(btrim(p_reason), '') IS NULL THEN
        RAISE EXCEPTION 'A reason is required';
    END IF;
    IF p_operation NOT IN ('cancel_order', 'return_for_adjustment', 'doctor_reject_order') THEN
        RAISE EXCEPTION 'Unsupported issue operation: %', p_operation;
    END IF;
    v_target_issue := CASE p_operation
        WHEN 'cancel_order' THEN 'cancelled'
        WHEN 'return_for_adjustment' THEN 'returned'
        WHEN 'doctor_reject_order' THEN 'doctor_rejected'
    END;
    v_payload := jsonb_build_object(
        'reason', btrim(p_reason),
        'doctorDecision', p_doctor_decision,
        'customDoctorAmount', p_custom_doctor_amount
    );

    INSERT INTO public.order_transition_commands(
        idempotency_key, order_id, operation, requested_by, request_payload
    ) VALUES (p_idempotency_key, p_order_id, p_operation, v_user_id, v_payload)
    ON CONFLICT (idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 0 THEN
        SELECT * INTO v_existing FROM public.order_transition_commands
        WHERE idempotency_key = p_idempotency_key;
        IF v_existing.order_id IS DISTINCT FROM p_order_id
           OR v_existing.operation IS DISTINCT FROM p_operation
           OR v_existing.request_payload IS DISTINCT FROM v_payload THEN
            RAISE EXCEPTION 'Idempotency key was already used with a different request';
        END IF;
        IF v_existing.completed_at IS NOT NULL THEN
            RETURN v_existing.result_payload;
        END IF;
    END IF;

    SELECT * INTO v_order FROM public.orders
    WHERE id = p_order_id AND COALESCE(is_deleted, FALSE) = FALSE
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found or access denied'; END IF;

    IF v_order.issue_state = v_target_issue THEN
        v_result := jsonb_build_object('orderId', p_order_id, 'alreadyApplied', TRUE, 'issueState', v_target_issue);
        UPDATE public.order_transition_commands
        SET result_payload = v_result, completed_at = timezone('utc', now())
        WHERE idempotency_key = p_idempotency_key;
        RETURN v_result;
    END IF;
    IF COALESCE(v_order.issue_state, 'none') IN ('cancelled', 'doctor_rejected', 'lab_rejected', 'redo') THEN
        RAISE EXCEPTION 'Order is already in terminal issue state %', v_order.issue_state;
    END IF;

    IF p_operation = 'cancel_order' AND v_order.first_delivered_at IS NOT NULL THEN
        RAISE EXCEPTION 'Cancellation is only allowed before first delivery';
    ELSIF p_operation IN ('return_for_adjustment', 'doctor_reject_order')
          AND v_order.first_delivered_at IS NULL THEN
        RAISE EXCEPTION 'This operation requires prior delivery';
    END IF;

    IF p_operation = 'doctor_reject_order' THEN
        IF p_doctor_decision NOT IN ('decide_later', 'full_price', 'zero', 'custom_amount') THEN
            RAISE EXCEPTION 'Invalid doctor decision';
        END IF;
        v_doctor_amount := CASE p_doctor_decision
            WHEN 'decide_later' THEN COALESCE(v_order.total_price, 0)
            WHEN 'full_price' THEN COALESCE(v_order.total_price, 0)
            WHEN 'zero' THEN 0
            WHEN 'custom_amount' THEN p_custom_doctor_amount
        END;
        IF (
            v_doctor_amount IS NULL OR v_doctor_amount < 0
            OR v_doctor_amount > COALESCE(v_order.total_price, 0)
        ) THEN
            RAISE EXCEPTION 'Doctor amount must be between zero and order total';
        END IF;
        v_review_status := CASE WHEN p_doctor_decision = 'decide_later' THEN 'pending' ELSE 'resolved' END;
    END IF;

    PERFORM set_config('app.order_issue_operation', p_operation, true);
    UPDATE public.orders SET
        status = CASE p_operation
            WHEN 'cancel_order' THEN 'Cancelled'
            WHEN 'return_for_adjustment' THEN 'Returned for Adjustments'
            WHEN 'doctor_reject_order' THEN 'Doctor Rejected'
        END,
        issue_state = v_target_issue,
        production_status = CASE
            WHEN p_operation = 'return_for_adjustment' THEN 'in_production'
            ELSE production_status
        END,
        actual_delivery_date = CASE
            WHEN p_operation = 'return_for_adjustment' THEN NULL
            ELSE actual_delivery_date
        END,
        rejection_doctor_decision = CASE
            WHEN p_operation IN ('cancel_order') THEN 'zero'
            WHEN p_operation = 'doctor_reject_order' THEN p_doctor_decision
            ELSE rejection_doctor_decision
        END,
        rejected_doctor_amount = CASE
            WHEN p_operation = 'cancel_order' THEN 0
            WHEN p_operation = 'doctor_reject_order' THEN v_doctor_amount
            ELSE rejected_doctor_amount
        END,
        rejection_financial_review_status = CASE
            WHEN p_operation = 'cancel_order' THEN 'resolved'
            WHEN p_operation = 'doctor_reject_order' THEN v_review_status
            ELSE rejection_financial_review_status
        END,
        rejected_lab_cost = CASE WHEN p_operation = 'cancel_order' THEN 0 WHEN p_operation = 'doctor_reject_order' THEN NULL ELSE rejected_lab_cost END,
        rejected_designer_cost = CASE WHEN p_operation = 'cancel_order' THEN 0 WHEN p_operation = 'doctor_reject_order' THEN NULL ELSE rejected_designer_cost END,
        rejected_lab_cost_status = CASE
            WHEN p_operation = 'cancel_order' THEN CASE WHEN supplier_id IS NULL THEN 'not_applicable' ELSE 'resolved' END
            WHEN p_operation = 'doctor_reject_order' THEN CASE WHEN supplier_id IS NULL THEN 'not_applicable' ELSE 'pending' END
            ELSE rejected_lab_cost_status
        END,
        rejected_designer_cost_status = CASE
            WHEN p_operation = 'cancel_order' THEN CASE WHEN designer_id IS NULL THEN 'not_applicable' ELSE 'resolved' END
            WHEN p_operation = 'doctor_reject_order' THEN CASE WHEN designer_id IS NULL THEN 'not_applicable' ELSE 'pending' END
            ELSE rejected_designer_cost_status
        END,
        updated_at = timezone('utc', now())
    WHERE id = p_order_id;

    INSERT INTO public.order_events(
        order_id, event_type, old_value, new_value, changed_by, actor_role,
        reason, notes, severity, approval_status, metadata
    ) VALUES (
        p_order_id,
        CASE p_operation
            WHEN 'cancel_order' THEN 'case_cancelled'
            WHEN 'return_for_adjustment' THEN 'case_returned'
            WHEN 'doctor_reject_order' THEN 'case_rejected'
        END,
        COALESCE(v_order.issue_state, 'none'), v_target_issue, v_user_id, v_role,
        btrim(p_reason), btrim(p_reason),
        CASE WHEN p_operation = 'return_for_adjustment' THEN 'warning' ELSE 'critical' END,
        'none', jsonb_build_object('idempotencyKey', p_idempotency_key, 'workflowVersion', 2)
    );

    v_result := jsonb_build_object('orderId', p_order_id, 'alreadyApplied', FALSE, 'issueState', v_target_issue);
    UPDATE public.order_transition_commands
    SET result_payload = v_result, completed_at = timezone('utc', now())
    WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_order_final_delivery_v2(
    p_order_id UUID,
    p_delivered_at TIMESTAMPTZ,
    p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := public.get_my_user_id();
    v_order public.orders%ROWTYPE;
    v_result JSONB;
    v_payload JSONB := jsonb_build_object('deliveredAt', p_delivered_at);
    v_command public.order_transition_commands%ROWTYPE;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN RAISE EXCEPTION 'Workflow V2 writes are disabled'; END IF;
    IF v_role NOT IN ('admin', 'lab') OR v_user_id IS NULL THEN
        RAISE EXCEPTION 'Only admin or lab can record final delivery';
    END IF;
    INSERT INTO public.order_transition_commands(idempotency_key, order_id, operation, requested_by, request_payload)
    VALUES (p_idempotency_key, p_order_id, 'record_final_delivery', v_user_id, v_payload)
    ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT * INTO v_command FROM public.order_transition_commands WHERE idempotency_key = p_idempotency_key FOR UPDATE;
    IF v_command.order_id IS DISTINCT FROM p_order_id OR v_command.operation <> 'record_final_delivery'
       OR v_command.request_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Idempotency key reuse mismatch'; END IF;
    IF v_command.completed_at IS NOT NULL THEN RETURN v_command.result_payload; END IF;
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
    IF COALESCE(v_order.issue_state, 'none') <> 'none' THEN
        RAISE EXCEPTION 'Cannot deliver an order with an active issue';
    END IF;
    IF v_order.production_status = 'final_delivered' AND v_order.first_delivered_at IS NOT NULL THEN
        v_result := jsonb_build_object('orderId', p_order_id, 'productionStatus', 'final_delivered', 'alreadyApplied', TRUE);
        UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
        RETURN v_result;
    END IF;
    PERFORM set_config('app.order_issue_operation', 'record_final_delivery', true);
    UPDATE public.orders SET
        status = 'Delivered', production_status = 'final_delivered',
        actual_delivery_date = COALESCE(p_delivered_at, timezone('utc', now()))::date,
        first_delivered_at = COALESCE(first_delivered_at, p_delivered_at, timezone('utc', now())),
        first_delivered_source = COALESCE(first_delivered_source, 'direct_transition'),
        updated_at = timezone('utc', now())
    WHERE id = p_order_id;
    INSERT INTO public.order_events(order_id, event_type, old_value, new_value, changed_by, actor_role, severity, metadata)
    VALUES (p_order_id, 'order_delivered', v_order.production_status, 'final_delivered', v_user_id, v_role, 'info',
        jsonb_build_object('idempotencyKey', p_idempotency_key, 'workflowVersion', 2));
    v_result := jsonb_build_object('orderId', p_order_id, 'productionStatus', 'final_delivered', 'alreadyApplied', FALSE);
    UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_order_design_v2(
    p_order_id UUID,
    p_design_url TEXT,
    p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := public.get_my_user_id();
    v_order public.orders%ROWTYPE;
    v_payload JSONB := jsonb_build_object('designUrl', btrim(p_design_url));
    v_command public.order_transition_commands%ROWTYPE;
    v_result JSONB;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN RAISE EXCEPTION 'Workflow V2 writes are disabled'; END IF;
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authenticated user is required'; END IF;
    INSERT INTO public.order_transition_commands(idempotency_key, order_id, operation, requested_by, request_payload)
    VALUES (p_idempotency_key, p_order_id, 'submit_design', v_user_id, v_payload)
    ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT * INTO v_command FROM public.order_transition_commands WHERE idempotency_key = p_idempotency_key FOR UPDATE;
    IF v_command.order_id IS DISTINCT FROM p_order_id OR v_command.operation <> 'submit_design'
       OR v_command.request_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Idempotency key reuse mismatch'; END IF;
    IF v_command.completed_at IS NOT NULL THEN RETURN v_command.result_payload; END IF;
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
    IF v_role = 'designer' AND v_order.designer_id IS DISTINCT FROM v_user_id THEN
        RAISE EXCEPTION 'Designer is not assigned to this order';
    END IF;
    IF v_role NOT IN ('designer', 'admin', 'lab') THEN
        RAISE EXCEPTION 'Role cannot submit a design';
    END IF;
    IF NULLIF(btrim(p_design_url), '') IS NULL THEN RAISE EXCEPTION 'Design URL is required'; END IF;
    IF v_order.design_submitted_at IS NOT NULL AND v_order.design_url = btrim(p_design_url) THEN
        v_result := jsonb_build_object('orderId', p_order_id, 'designSubmitted', TRUE, 'alreadyApplied', TRUE);
        UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
        RETURN v_result;
    END IF;
    IF v_order.production_status <> 'designing' OR COALESCE(v_order.issue_state, 'none') <> 'none' THEN
        RAISE EXCEPTION 'Order is not available for design submission';
    END IF;
    PERFORM set_config('app.order_issue_operation', 'submit_design', true);
    UPDATE public.orders SET
        design_url = btrim(p_design_url), design_status = 'completed',
        design_submitted_at = COALESCE(design_submitted_at, timezone('utc', now())),
        technician_status = 'Pending', production_status = 'in_production',
        status = 'Under Production', updated_at = timezone('utc', now())
    WHERE id = p_order_id;
    INSERT INTO public.order_events(order_id, event_type, changed_by, actor_role, severity, metadata)
    VALUES (p_order_id, 'design_submitted_to_lab', v_user_id, v_role, 'info',
        jsonb_build_object('idempotencyKey', p_idempotency_key, 'workflowVersion', 2));
    v_result := jsonb_build_object('orderId', p_order_id, 'designSubmitted', TRUE, 'alreadyApplied', FALSE);
    UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_designer_rejection_v2(
    p_order_id UUID,
    p_reason TEXT,
    p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := public.get_my_user_id();
    v_order public.orders%ROWTYPE;
    v_event_id UUID;
    v_payload JSONB := jsonb_build_object('reason', btrim(p_reason));
    v_command public.order_transition_commands%ROWTYPE;
    v_result JSONB;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN RAISE EXCEPTION 'Workflow V2 writes are disabled'; END IF;
    IF v_role <> 'designer' OR v_user_id IS NULL THEN RAISE EXCEPTION 'Only designer can request rejection'; END IF;
    IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
    INSERT INTO public.order_transition_commands(idempotency_key, order_id, operation, requested_by, request_payload)
    VALUES (p_idempotency_key, p_order_id, 'request_designer_rejection', v_user_id, v_payload)
    ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT * INTO v_command FROM public.order_transition_commands WHERE idempotency_key = p_idempotency_key FOR UPDATE;
    IF v_command.order_id IS DISTINCT FROM p_order_id OR v_command.operation <> 'request_designer_rejection'
       OR v_command.request_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Idempotency key reuse mismatch'; END IF;
    IF v_command.completed_at IS NOT NULL THEN RETURN v_command.result_payload; END IF;
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_order.designer_id IS DISTINCT FROM v_user_id THEN RAISE EXCEPTION 'Order not found or access denied'; END IF;
    IF v_order.production_status <> 'designing' OR v_order.design_submitted_at IS NOT NULL
       OR v_order.first_delivered_at IS NOT NULL OR COALESCE(v_order.issue_state, 'none') <> 'none' THEN
        RAISE EXCEPTION 'Designer rejection is only available before design submission';
    END IF;
    SELECT id INTO v_event_id FROM public.order_events
    WHERE order_id = p_order_id AND event_type = 'designer_rejection_requested' AND approval_status = 'pending'
    ORDER BY created_at DESC LIMIT 1;
    IF v_event_id IS NOT NULL THEN
        v_result := jsonb_build_object('orderId', p_order_id, 'eventId', v_event_id, 'alreadyApplied', TRUE);
        UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
        RETURN v_result;
    END IF;
    INSERT INTO public.order_events(
        order_id, event_type, changed_by, actor_role, reason, notes,
        severity, approval_status, metadata
    ) VALUES (
        p_order_id, 'designer_rejection_requested', v_user_id, v_role,
        btrim(p_reason), btrim(p_reason), 'critical', 'pending',
        jsonb_build_object('idempotencyKey', p_idempotency_key, 'workflowVersion', 2)
    ) RETURNING id INTO v_event_id;
    UPDATE public.orders SET technician_status = 'Rejected', design_status = 'returned', updated_at = timezone('utc', now())
    WHERE id = p_order_id;
    v_result := jsonb_build_object('orderId', p_order_id, 'eventId', v_event_id, 'alreadyApplied', FALSE);
    UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_designer_rejection_v2(
    p_order_id UUID,
    p_action TEXT,
    p_notes TEXT,
    p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := public.get_my_user_id();
    v_order public.orders%ROWTYPE;
    v_event public.order_events%ROWTYPE;
    v_payload JSONB := jsonb_build_object('action', p_action, 'notes', NULLIF(btrim(p_notes), ''));
    v_command public.order_transition_commands%ROWTYPE;
    v_result JSONB;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN RAISE EXCEPTION 'Workflow V2 writes are disabled'; END IF;
    IF v_role NOT IN ('admin', 'representative') OR v_user_id IS NULL THEN RAISE EXCEPTION 'Only admin or representative can review'; END IF;
    IF p_action NOT IN ('approve', 'reject', 'request_details') THEN RAISE EXCEPTION 'Invalid review action'; END IF;
    IF p_action <> 'approve' AND NULLIF(btrim(p_notes), '') IS NULL THEN RAISE EXCEPTION 'Review notes are required'; END IF;
    INSERT INTO public.order_transition_commands(idempotency_key, order_id, operation, requested_by, request_payload)
    VALUES (p_idempotency_key, p_order_id, 'review_designer_rejection', v_user_id, v_payload)
    ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT * INTO v_command FROM public.order_transition_commands WHERE idempotency_key = p_idempotency_key FOR UPDATE;
    IF v_command.order_id IS DISTINCT FROM p_order_id OR v_command.operation <> 'review_designer_rejection'
       OR v_command.request_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Idempotency key reuse mismatch'; END IF;
    IF v_command.completed_at IS NOT NULL THEN RETURN v_command.result_payload; END IF;
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
    IF p_action = 'approve' AND v_order.issue_state = 'lab_rejected' THEN
        v_result := jsonb_build_object('orderId', p_order_id, 'action', p_action, 'alreadyApplied', TRUE);
        UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now())
        WHERE idempotency_key = p_idempotency_key;
        RETURN v_result;
    END IF;
    IF p_action = 'reject' AND EXISTS (
        SELECT 1 FROM public.order_events event
        WHERE event.order_id = p_order_id
          AND event.event_type = 'designer_rejection_requested'
          AND event.approval_status = 'rejected'
          AND event.metadata->>'reviewAction' = 'reject'
    ) THEN
        v_result := jsonb_build_object('orderId', p_order_id, 'action', p_action, 'alreadyApplied', TRUE);
        UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now())
        WHERE idempotency_key = p_idempotency_key;
        RETURN v_result;
    END IF;
    SELECT * INTO v_event FROM public.order_events
    WHERE order_id = p_order_id AND event_type = 'designer_rejection_requested' AND approval_status = 'pending'
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pending designer rejection request not found'; END IF;
    IF p_action = 'approve' THEN
        PERFORM set_config('app.order_issue_operation', 'approve_designer_rejection', true);
        UPDATE public.orders SET
            status = 'Lab Rejected', issue_state = 'lab_rejected',
            rejection_doctor_decision = 'zero', rejected_doctor_amount = 0,
            rejection_financial_review_status = 'resolved', rejected_lab_cost = 0,
            rejected_designer_cost = 0,
            rejected_lab_cost_status = CASE WHEN supplier_id IS NULL THEN 'not_applicable' ELSE 'resolved' END,
            rejected_designer_cost_status = CASE WHEN designer_id IS NULL THEN 'not_applicable' ELSE 'resolved' END,
            updated_at = timezone('utc', now())
        WHERE id = p_order_id;
    ELSIF p_action = 'reject' THEN
        UPDATE public.orders SET technician_status = 'Approved', design_status = 'in_progress',
            production_status = 'designing', status = 'Under Design', updated_at = timezone('utc', now())
        WHERE id = p_order_id;
    ELSE
        UPDATE public.orders SET technician_status = 'NeedDetails', updated_at = timezone('utc', now())
        WHERE id = p_order_id;
    END IF;
    UPDATE public.order_events SET
        approval_status = CASE WHEN p_action = 'approve' THEN 'approved' WHEN p_action = 'reject' THEN 'rejected' ELSE 'pending' END,
        approved_by = CASE WHEN p_action = 'request_details' THEN NULL ELSE v_user_id END,
        approved_at = CASE WHEN p_action = 'request_details' THEN NULL ELSE timezone('utc', now()) END,
        notes = concat_ws(E'\n', notes, NULLIF(btrim(p_notes), '')),
        metadata = metadata || jsonb_build_object('reviewAction', p_action, 'reviewIdempotencyKey', p_idempotency_key)
    WHERE id = v_event.id;
    v_result := jsonb_build_object('orderId', p_order_id, 'action', p_action, 'alreadyApplied', FALSE);
    UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reject_order_from_tech_status_v2(
    p_order_id UUID,
    p_reason TEXT,
    p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := public.get_my_user_id();
    v_order public.orders%ROWTYPE;
    v_payload JSONB := jsonb_build_object('reason', btrim(p_reason));
    v_command public.order_transition_commands%ROWTYPE;
    v_result JSONB;
    v_pending_rejection_id UUID;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN
        RAISE EXCEPTION 'Workflow V2 writes are disabled';
    END IF;
    IF v_role <> 'admin' OR v_user_id IS NULL THEN
        RAISE EXCEPTION 'Only admin can reject directly from technician status';
    END IF;
    IF NULLIF(btrim(p_reason), '') IS NULL THEN
        RAISE EXCEPTION 'Lab rejection reason is required';
    END IF;

    INSERT INTO public.order_transition_commands(
        idempotency_key, order_id, operation, requested_by, request_payload
    ) VALUES (
        p_idempotency_key, p_order_id, 'admin_tech_reject', v_user_id, v_payload
    ) ON CONFLICT (idempotency_key) DO NOTHING;

    SELECT * INTO v_command
    FROM public.order_transition_commands
    WHERE idempotency_key = p_idempotency_key
    FOR UPDATE;
    IF v_command.order_id IS DISTINCT FROM p_order_id
       OR v_command.operation IS DISTINCT FROM 'admin_tech_reject'
       OR v_command.request_payload IS DISTINCT FROM v_payload THEN
        RAISE EXCEPTION 'Idempotency key reuse mismatch';
    END IF;
    IF v_command.completed_at IS NOT NULL THEN
        RETURN v_command.result_payload;
    END IF;

    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id AND COALESCE(is_deleted, FALSE) = FALSE
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

    IF v_order.issue_state = 'lab_rejected' THEN
        v_result := jsonb_build_object(
            'orderId', p_order_id, 'issueState', 'lab_rejected', 'alreadyApplied', TRUE
        );
        UPDATE public.order_transition_commands
        SET result_payload = v_result, completed_at = timezone('utc', now())
        WHERE idempotency_key = p_idempotency_key;
        RETURN v_result;
    END IF;
    IF COALESCE(v_order.issue_state, 'none') <> 'none' THEN
        RAISE EXCEPTION 'Order is already in issue state %', v_order.issue_state;
    END IF;
    IF v_order.first_delivered_at IS NOT NULL
       OR v_order.design_submitted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Lab rejection is only allowed before design submission and final delivery';
    END IF;

    -- An admin override is valid with or without an assigned internal designer.
    -- If the designer did create a proper pending request, consume it so no
    -- orphaned approval remains after the direct technician-status decision.
    SELECT event.id INTO v_pending_rejection_id
    FROM public.order_events event
    WHERE event.order_id = p_order_id
      AND event.event_type = 'designer_rejection_requested'
      AND event.approval_status = 'pending'
    ORDER BY event.created_at DESC
    LIMIT 1
    FOR UPDATE;

    PERFORM set_config('app.order_issue_operation', 'admin_tech_reject', true);
    UPDATE public.orders SET
        status = 'Lab Rejected',
        issue_state = 'lab_rejected',
        technician_status = 'Rejected',
        rejection_doctor_decision = 'zero',
        rejected_doctor_amount = 0,
        rejection_financial_review_status = 'resolved',
        rejected_lab_cost = 0,
        rejected_designer_cost = 0,
        rejected_lab_cost_status = CASE
            WHEN supplier_id IS NULL THEN 'not_applicable' ELSE 'resolved'
        END,
        rejected_designer_cost_status = CASE
            WHEN designer_id IS NULL THEN 'not_applicable' ELSE 'resolved'
        END,
        updated_at = timezone('utc', now())
    WHERE id = p_order_id;

    IF v_pending_rejection_id IS NOT NULL THEN
        UPDATE public.order_events SET
            approval_status = 'approved',
            approved_by = v_user_id,
            approved_at = timezone('utc', now()),
            notes = concat_ws(E'\n', notes, btrim(p_reason)),
            metadata = metadata || jsonb_build_object(
                'reviewAction', 'approve',
                'reviewSource', 'admin_tech_status',
                'reviewIdempotencyKey', p_idempotency_key
            )
        WHERE id = v_pending_rejection_id;
    END IF;

    INSERT INTO public.order_events(
        order_id, event_type, old_value, new_value, changed_by, actor_role,
        reason, notes, severity, approval_status, metadata
    ) VALUES (
        p_order_id, 'case_rejected', COALESCE(v_order.issue_state, 'none'),
        'lab_rejected', v_user_id, v_role, btrim(p_reason), btrim(p_reason),
        'critical', 'none', jsonb_build_object(
            'idempotencyKey', p_idempotency_key,
            'workflowVersion', 2,
            'source', 'admin_tech_status'
        )
    );

    v_result := jsonb_build_object(
        'orderId', p_order_id, 'issueState', 'lab_rejected', 'alreadyApplied', FALSE
    );
    UPDATE public.order_transition_commands
    SET result_payload = v_result, completed_at = timezone('utc', now())
    WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$$;

-- Client event insertion remains available during the compatibility window.
-- It is revoked only by the explicit client-cutover migration after the new
-- frontend has been deployed and workflow_issue_v2_enforce is enabled.

CREATE OR REPLACE FUNCTION public.append_order_event_v2(p_event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := public.get_my_user_id();
    v_order public.orders%ROWTYPE;
    v_event public.order_events%ROWTYPE;
BEGIN
    IF v_role NOT IN ('admin', 'accountant', 'representative', 'lab', 'designer') OR v_user_id IS NULL THEN
        RAISE EXCEPTION 'Role cannot append order events';
    END IF;
    SELECT * INTO v_order FROM public.orders WHERE id = (p_event->>'order_id')::UUID;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
    IF v_role = 'designer' AND v_order.designer_id IS DISTINCT FROM v_user_id THEN RAISE EXCEPTION 'Order access denied'; END IF;
    IF v_role = 'lab' AND v_order.supplier_id IS DISTINCT FROM public.get_my_entity_id() THEN RAISE EXCEPTION 'Order access denied'; END IF;
    IF COALESCE(p_event->>'approval_status', 'none') <> 'none' THEN
        RAISE EXCEPTION 'Approval workflow events require their dedicated RPC';
    END IF;
    IF p_event->>'event_type' IN (
        'financial_adjustment_approved', 'payment_allocated',
        'manual_allocation_override', 'order_reopened'
    ) AND v_role <> 'admin' THEN
        RAISE EXCEPTION 'Sensitive order event requires admin role';
    END IF;

    INSERT INTO public.order_events(
        order_id, event_type, old_value, new_value, changed_by, actor_role,
        changed_at, reason, notes, severity, responsibility_party,
        approval_status, financial_impact, related_transaction_id,
        related_adjustment_id, related_allocation_id, related_issue_id, metadata
    ) VALUES (
        v_order.id, p_event->>'event_type', p_event->>'old_value', p_event->>'new_value',
        v_user_id, v_role, COALESCE((p_event->>'changed_at')::TIMESTAMPTZ, timezone('utc', now())),
        p_event->>'reason', p_event->>'notes', COALESCE(p_event->>'severity', 'info'),
        p_event->>'responsibility_party', 'none', (p_event->>'financial_impact')::NUMERIC,
        NULLIF(p_event->>'related_transaction_id', '')::UUID,
        NULLIF(p_event->>'related_adjustment_id', '')::UUID,
        NULLIF(p_event->>'related_allocation_id', '')::UUID,
        NULLIF(p_event->>'related_issue_id', '')::UUID,
        COALESCE(p_event->'metadata', '{}'::jsonb)
    ) RETURNING * INTO v_event;
    RETURN to_jsonb(v_event);
END;
$$;

-- Doctor-facing allow-listed read and feedback mutation. Doctors no longer
-- need direct access to staff-only workflow columns or event metadata.
CREATE OR REPLACE FUNCTION public.get_my_doctor_orders_v2()
RETURNS TABLE (
    id UUID, case_id TEXT, patient_name TEXT, delivery_date DATE,
    production_status TEXT, issue_state TEXT, total_price NUMERIC,
    feedback JSONB, created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
    SELECT o.id, o.case_id, o.patient_name, o.delivery_date,
           o.production_status, o.issue_state, o.total_price,
           COALESCE(
               (SELECT jsonb_build_object(
                   'rating', f.rating, 'issues', f.issues, 'notes', f.notes, 'createdAt', f.created_at
                ) FROM public.doctor_order_feedback f WHERE f.order_id = o.id),
               o.feedback
           ),
           o.created_at
    FROM public.orders o
    JOIN public.users u ON u.auth_id = auth.uid()
    WHERE public.get_my_role() = 'doctor'
      AND o.doctor_id = u.entity_id
      AND COALESCE(o.is_deleted, FALSE) = FALSE
    ORDER BY o.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.submit_my_order_feedback_v2(
    p_order_id UUID, p_rating INTEGER, p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_doctor_id UUID;
BEGIN
    IF public.get_my_role() <> 'doctor' THEN RAISE EXCEPTION 'Only doctor can submit feedback'; END IF;
    IF p_rating < 1 OR p_rating > 5 THEN RAISE EXCEPTION 'Rating must be between 1 and 5'; END IF;
    SELECT u.entity_id INTO v_doctor_id FROM public.users u WHERE u.auth_id = auth.uid();
    IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id AND o.doctor_id = v_doctor_id) THEN
        RAISE EXCEPTION 'Order not found or access denied';
    END IF;
    INSERT INTO public.doctor_order_feedback(order_id, doctor_id, rating, notes)
    VALUES (p_order_id, v_doctor_id, p_rating, NULLIF(btrim(p_notes), ''))
    ON CONFLICT (order_id) DO UPDATE SET
        rating = EXCLUDED.rating, notes = EXCLUDED.notes, updated_at = timezone('utc', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.create_my_order_request_v2(
    p_patient_name TEXT,
    p_items JSONB,
    p_shade TEXT,
    p_instructions TEXT,
    p_stl_url TEXT,
    p_images_url TEXT,
    p_delivery_date DATE,
    p_total_price NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_doctor_id UUID;
    v_order_id UUID;
    v_case_id TEXT;
BEGIN
    IF public.get_my_role() <> 'doctor' THEN RAISE EXCEPTION 'Only doctor can create an order request'; END IF;
    SELECT entity_id INTO v_doctor_id FROM public.users WHERE auth_id = auth.uid();
    IF v_doctor_id IS NULL THEN RAISE EXCEPTION 'Doctor profile is not linked'; END IF;
    IF NULLIF(btrim(p_patient_name), '') IS NULL OR jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'Patient and at least one service are required';
    END IF;
    IF p_total_price < 0 THEN RAISE EXCEPTION 'Order total cannot be negative'; END IF;
    v_case_id := 'REQ-' || to_char(timezone('Africa/Cairo', now()), 'YYMMDDHH24MISS') || '-' || substr(gen_random_uuid()::text, 1, 4);
    INSERT INTO public.orders(
        case_id, doctor_id, patient_name, items, shade, instructions, stl_url, images_url,
        status, production_status, issue_state, technician_status, delivery_date,
        total_price, cost, discount, priority, comments, workflow_type,
        design_submitted_at, first_delivered_at, actual_delivery_date
    ) VALUES (
        v_case_id, v_doctor_id, btrim(p_patient_name), p_items, COALESCE(p_shade, ''),
        NULLIF(btrim(p_instructions), ''), NULLIF(btrim(p_stl_url), ''), NULLIF(btrim(p_images_url), ''),
        'Pending Review', 'not_started', 'none', 'Pending', p_delivery_date,
        p_total_price, 0, 0, 'Normal', '[]'::jsonb, 'full', NULL, NULL, NULL
    ) RETURNING id INTO v_order_id;
    RETURN v_order_id;
END;
$$;

-- Doctor direct policies remain during the compatibility window so the
-- currently deployed frontend keeps working. The explicit client-cutover
-- migration retires them only after the RPC-based frontend is live.

REVOKE ALL ON FUNCTION public.apply_order_issue_transition_v2(UUID, TEXT, TEXT, UUID, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_order_workflow_v2_capabilities() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.append_order_event_v2(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_order_final_delivery_v2(UUID, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_order_design_v2(UUID, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_designer_rejection_v2(UUID, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_designer_rejection_v2(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_reject_order_from_tech_status_v2(UUID, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_doctor_orders_v2() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_my_order_feedback_v2(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_my_order_request_v2(TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, DATE, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_order_issue_transition_v2(UUID, TEXT, TEXT, UUID, TEXT, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_workflow_v2_capabilities() TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_order_event_v2(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_order_final_delivery_v2(UUID, TIMESTAMPTZ, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_order_design_v2(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_designer_rejection_v2(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_designer_rejection_v2(UUID, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_order_from_tech_status_v2(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_doctor_orders_v2() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_my_order_feedback_v2(UUID, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_my_order_request_v2(TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, DATE, NUMERIC) TO authenticated;

COMMIT;

-- POSTFLIGHT (run separately in SQL Editor):
-- SELECT conname, convalidated FROM pg_constraint
-- WHERE conname LIKE 'orders_%v2%' OR conname IN (
--   'orders_first_delivered_source_check', 'orders_lifecycle_timestamp_check',
--   'orders_zero_issue_financial_fields_check', 'orders_pending_doctor_decision_check'
-- );
-- SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
-- WHERE tgrelid = 'public.orders'::regclass AND NOT tgisinternal ORDER BY tgname;
-- SELECT key, value FROM public.app_settings WHERE key LIKE 'workflow_%v2%' OR key = 'workflow_status_legacy_mirror';
