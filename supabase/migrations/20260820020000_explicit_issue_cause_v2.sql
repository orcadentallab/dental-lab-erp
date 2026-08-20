-- Explicit issue cause/stage at the moment of action, instead of guessing
-- from a comment.
--
-- Why: log_order_issue_trigger_fn() (20260816000000) infers cause_category
-- and responsible_stage by keyword-matching the most recent order_comments
-- row. Three of the four V2 workflow RPCs that drive issue_state transitions
-- (apply_order_issue_transition_v2, admin_reject_order_from_tech_status_v2,
-- review_designer_rejection_v2) never write to order_comments at all, so the
-- trigger guesses from a stale, unrelated comment -- not even the text the
-- user entered for this action. This is the root cause of the 89-95%
-- "unknown" cause rate seen in this week's issue reports.
--
-- Fix: let the acting RPC pass the cause/stage explicitly via the same
-- transaction-local GUC pattern already used for app.order_issue_operation
-- (set_config(..., true), read with current_setting(..., true)). The trigger
-- checks the GUC FIRST; only when it is empty (any legacy caller that never
-- sends the new params) does it fall back to the existing keyword guess,
-- completely unchanged. Zero behavior change for any existing caller.
--
-- Scope: V2 RPCs only (workflow_issue_v2_write is fully enabled in
-- production; V1/legacy paths are not reachable and are left untouched).
--
-- Cause vocabularies are deliberately different per action type -- a single
-- unified list produced the same "meaningless guess" problem this migration
-- fixes. See docs discussion for full reasoning:
--   - lab_rejection (before production starts): doctor-side input causes only
--   - cancellation: doctor's decision, not a production defect
--   - post_delivery (doctor reject / return for adjustment / redo): a real,
--     specific defect in the finished product. Since all production is done
--     by external labs today, responsible_stage is external_lab for all of
--     these except logistics_damage (logistics).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Extend the cause_category CHECK constraint with the new codes only.
--    Old codes (cad, material, milling, glaze, doctor_side) stay allowed for
--    historical rows; nothing in the app writes them going forward.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.order_issues
    DROP CONSTRAINT IF EXISTS order_issues_cause_category_check;
ALTER TABLE public.order_issues
    ADD CONSTRAINT order_issues_cause_category_check
    CHECK (cause_category IN (
        'prep', 'scan_impression', 'cad', 'fit', 'contact', 'occlusion',
        'shade', 'milling', 'material', 'finish', 'glaze',
        'doctor_side', 'logistics_damage', 'unknown',
        -- new (20260820020000)
        'crack', 'no_space', 'doctor_changed_mind', 'doctor_prior_issues',
        'financial_reason', 'duplicate_order'
    ));

-- responsible_stage already allows doctor/external_lab/logistics/unknown --
-- no change needed there (20260816000000).

-- ─────────────────────────────────────────────────────────────────────────
-- 2. apply_order_issue_transition_v2 -- cancel_order / return_for_adjustment
--    / doctor_reject_order. Cause vocabulary depends on which transition is
--    actually being applied (v_target_issue), so the check is conditional.
--
--    NOTE: appending parameters via CREATE OR REPLACE does NOT replace the
--    old-signature function in place -- Postgres treats a changed argument
--    list as a distinct overload, and calls made with the old arg count
--    become ambiguous ("is not unique") between the two. The old signature
--    must be dropped explicitly first.
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.apply_order_issue_transition_v2(UUID, TEXT, TEXT, UUID, TEXT, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION public.apply_order_issue_transition_v2(
    p_order_id UUID,
    p_operation TEXT,
    p_reason TEXT,
    p_idempotency_key UUID,
    p_doctor_decision TEXT DEFAULT NULL,
    p_custom_doctor_amount NUMERIC DEFAULT NULL,
    p_user_name TEXT DEFAULT NULL,
    p_cause_category TEXT DEFAULT NULL,
    p_responsible_stage TEXT DEFAULT NULL
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

    IF p_cause_category IS NOT NULL THEN
        IF v_target_issue = 'cancelled' THEN
            IF p_cause_category NOT IN (
                'doctor_changed_mind', 'doctor_prior_issues', 'financial_reason',
                'duplicate_order', 'unknown'
            ) THEN
                RAISE EXCEPTION 'Invalid cause_category % for cancellation', p_cause_category;
            END IF;
        ELSIF v_target_issue IN ('doctor_rejected', 'returned') THEN
            IF p_cause_category NOT IN (
                'contact', 'occlusion', 'fit', 'shade', 'crack', 'finish',
                'logistics_damage', 'unknown'
            ) THEN
                RAISE EXCEPTION 'Invalid cause_category % for %', p_cause_category, v_target_issue;
            END IF;
        END IF;
        PERFORM set_config('app.explicit_issue_cause', p_cause_category, true);
        PERFORM set_config('app.explicit_issue_stage', COALESCE(p_responsible_stage, ''), true);
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

-- ─────────────────────────────────────────────────────────────────────────
-- 3. admin_reject_order_from_tech_status_v2 -- lab_rejection context.
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_reject_order_from_tech_status_v2(UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.admin_reject_order_from_tech_status_v2(
    p_order_id UUID,
    p_reason TEXT,
    p_idempotency_key UUID,
    p_cause_category TEXT DEFAULT NULL,
    p_responsible_stage TEXT DEFAULT NULL
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

    IF p_cause_category IS NOT NULL THEN
        IF p_cause_category NOT IN ('scan_impression', 'prep', 'no_space', 'unknown') THEN
            RAISE EXCEPTION 'Invalid cause_category % for lab rejection', p_cause_category;
        END IF;
        PERFORM set_config('app.explicit_issue_cause', p_cause_category, true);
        PERFORM set_config('app.explicit_issue_stage', COALESCE(p_responsible_stage, ''), true);
    END IF;

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

-- ─────────────────────────────────────────────────────────────────────────
-- 4. review_designer_rejection_v2 -- lab_rejection context, approve branch
--    only (that is the only branch that mutates issue_state).
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.review_designer_rejection_v2(UUID, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.review_designer_rejection_v2(
    p_order_id UUID,
    p_action TEXT,
    p_notes TEXT,
    p_idempotency_key UUID,
    p_cause_category TEXT DEFAULT NULL,
    p_responsible_stage TEXT DEFAULT NULL
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
    IF NOT FOUND AND v_order.technician_status NOT IN ('Rejected', 'NeedDetails') THEN
        RAISE EXCEPTION 'Pending designer rejection request not found';
    END IF;
    IF p_action = 'approve' THEN
        IF p_cause_category IS NOT NULL THEN
            IF p_cause_category NOT IN ('scan_impression', 'prep', 'no_space', 'unknown') THEN
                RAISE EXCEPTION 'Invalid cause_category % for lab rejection', p_cause_category;
            END IF;
            PERFORM set_config('app.explicit_issue_cause', p_cause_category, true);
            PERFORM set_config('app.explicit_issue_stage', COALESCE(p_responsible_stage, ''), true);
        END IF;
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
    IF v_event.id IS NOT NULL THEN
        UPDATE public.order_events SET
            approval_status = CASE WHEN p_action = 'approve' THEN 'approved' WHEN p_action = 'reject' THEN 'rejected' ELSE 'pending' END,
            approved_by = CASE WHEN p_action = 'request_details' THEN NULL ELSE v_user_id END,
            approved_at = CASE WHEN p_action = 'request_details' THEN NULL ELSE timezone('utc', now()) END,
            notes = concat_ws(E'\n', notes, NULLIF(btrim(p_notes), '')),
            metadata = metadata || jsonb_build_object('reviewAction', p_action, 'reviewIdempotencyKey', p_idempotency_key)
        WHERE id = v_event.id;
    ELSE
        INSERT INTO public.order_events(
            order_id, event_type, changed_by, actor_role, reason, notes,
            severity, approval_status, metadata
        ) VALUES (
            p_order_id, 'designer_rejection_requested', v_user_id, v_role,
            'Legacy designer rejection reviewed without a matching v2 request event',
            NULLIF(btrim(p_notes), ''), 'critical',
            CASE WHEN p_action = 'approve' THEN 'approved' WHEN p_action = 'reject' THEN 'rejected' ELSE 'pending' END,
            jsonb_build_object('reviewAction', p_action, 'reviewIdempotencyKey', p_idempotency_key, 'legacyFallback', TRUE)
        );
    END IF;
    v_result := jsonb_build_object('orderId', p_order_id, 'action', p_action, 'alreadyApplied', FALSE);
    UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. create_redo_order_atomic_v2 -- post_delivery context. p_reason_code /
--    REDO_REASONS stay completely untouched (separate financial/audit
--    vocabulary); this is an additional, independent cause classification.
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.create_redo_order_atomic_v2(UUID, TEXT, TEXT, TEXT, NUMERIC, UUID);

CREATE OR REPLACE FUNCTION public.create_redo_order_atomic_v2(
    p_original_order_id UUID,
    p_reason_code TEXT,
    p_notes TEXT,
    p_doctor_decision TEXT,
    p_custom_doctor_amount NUMERIC,
    p_idempotency_key UUID,
    p_cause_category TEXT DEFAULT NULL,
    p_responsible_stage TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_original public.orders%ROWTYPE;
    v_owner_doctor public.doctors%ROWTYPE;
    v_profile_id UUID := public.get_my_user_id();
    v_actor_name TEXT;
    v_business_date DATE := timezone('Africa/Cairo', now())::DATE;
    v_year INTEGER;
    v_sequence INTEGER;
    v_case_id TEXT;
    v_new_order_id UUID;
    v_reason_label TEXT;
    v_comment TEXT;
    v_doctor_amount NUMERIC;
    v_review_status TEXT;
    v_payload JSONB;
    v_existing public.order_transition_commands%ROWTYPE;
    v_result JSONB;
    v_inserted INTEGER;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN
        RAISE EXCEPTION 'Order issue workflow V2 writes are disabled';
    END IF;
    IF v_role NOT IN ('admin', 'representative') OR v_profile_id IS NULL THEN
        RAISE EXCEPTION 'Only admin or representative can create a redo order';
    END IF;
    IF p_reason_code NOT IN ('lab_error', 'design_error', 'doctor_change', 'scan_issue', 'other') THEN
        RAISE EXCEPTION 'Invalid redo reason';
    END IF;
    IF NULLIF(btrim(p_notes), '') IS NULL THEN RAISE EXCEPTION 'Redo notes are required'; END IF;
    IF p_doctor_decision NOT IN ('decide_later', 'full_price', 'zero', 'custom_amount') THEN
        RAISE EXCEPTION 'Invalid doctor decision';
    END IF;

    v_payload := jsonb_build_object(
        'reasonCode', p_reason_code, 'notes', btrim(p_notes),
        'doctorDecision', p_doctor_decision, 'customDoctorAmount', p_custom_doctor_amount
    );
    INSERT INTO public.order_transition_commands(idempotency_key, order_id, operation, requested_by, request_payload)
    VALUES (p_idempotency_key, p_original_order_id, 'create_redo', v_profile_id, v_payload)
    ON CONFLICT (idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 0 THEN
        SELECT * INTO v_existing FROM public.order_transition_commands WHERE idempotency_key = p_idempotency_key;
        IF v_existing.order_id IS DISTINCT FROM p_original_order_id
           OR v_existing.operation IS DISTINCT FROM 'create_redo'
           OR v_existing.request_payload IS DISTINCT FROM v_payload THEN
            RAISE EXCEPTION 'Idempotency key was already used with a different request';
        END IF;
        IF v_existing.completed_at IS NOT NULL THEN RETURN v_existing.result_payload; END IF;
    END IF;

    SELECT * INTO v_original FROM public.orders
    WHERE id = p_original_order_id AND COALESCE(is_deleted, FALSE) = FALSE
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found or access denied'; END IF;
    IF v_original.issue_state = 'redo' THEN
        SELECT id, case_id INTO v_new_order_id, v_case_id
        FROM public.orders
        WHERE original_order_id = v_original.id AND COALESCE(is_deleted, FALSE) = FALSE
        ORDER BY created_at DESC LIMIT 1;
        IF v_new_order_id IS NULL THEN RAISE EXCEPTION 'Redo state exists without its replacement order'; END IF;
        v_result := jsonb_build_object(
            'originalOrderId', v_original.id, 'originalCaseId', v_original.case_id,
            'newOrderId', v_new_order_id, 'newCaseId', v_case_id, 'alreadyApplied', TRUE
        );
        UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now())
        WHERE idempotency_key = p_idempotency_key;
        RETURN v_result;
    END IF;
    IF v_original.first_delivered_at IS NULL THEN RAISE EXCEPTION 'Redo requires prior delivery'; END IF;
    IF COALESCE(v_original.issue_state, 'none') IN ('cancelled', 'doctor_rejected', 'lab_rejected', 'redo') THEN
        RAISE EXCEPTION 'Order is already in a terminal issue state';
    END IF;

    v_doctor_amount := CASE p_doctor_decision
        WHEN 'decide_later' THEN COALESCE(v_original.total_price, 0)
        WHEN 'full_price' THEN COALESCE(v_original.total_price, 0)
        WHEN 'zero' THEN 0
        WHEN 'custom_amount' THEN p_custom_doctor_amount
    END;
    IF (
        v_doctor_amount IS NULL OR v_doctor_amount < 0
        OR v_doctor_amount > COALESCE(v_original.total_price, 0)
    ) THEN RAISE EXCEPTION 'Doctor amount must be between zero and order total'; END IF;
    v_review_status := CASE WHEN p_doctor_decision = 'decide_later' THEN 'pending' ELSE 'resolved' END;

    IF p_cause_category IS NOT NULL THEN
        IF p_cause_category NOT IN (
            'contact', 'occlusion', 'fit', 'shade', 'crack', 'finish',
            'logistics_damage', 'unknown'
        ) THEN
            RAISE EXCEPTION 'Invalid cause_category % for redo', p_cause_category;
        END IF;
    END IF;

    SELECT name INTO v_actor_name FROM public.users WHERE id = v_profile_id;
    SELECT owner.* INTO v_owner_doctor
    FROM public.doctors current_doctor
    JOIN public.doctors owner ON owner.id = COALESCE(current_doctor.parent_id, current_doctor.id)
    WHERE current_doctor.id = v_original.doctor_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order doctor is missing'; END IF;

    v_year := EXTRACT(YEAR FROM v_business_date)::INTEGER;
    PERFORM pg_advisory_xact_lock(hashtextextended('redo-case:' || v_owner_doctor.id || ':' || v_year, 0));
    SELECT COUNT(*)::INTEGER + 1 INTO v_sequence
    FROM public.orders order_row
    WHERE timezone('Africa/Cairo', order_row.created_at)::DATE BETWEEN make_date(v_year, 1, 1) AND make_date(v_year, 12, 31)
      AND COALESCE(order_row.is_deleted, FALSE) = FALSE
      AND (order_row.doctor_id = v_owner_doctor.id OR (
          COALESCE(v_owner_doctor.is_center, FALSE)
          AND order_row.doctor_id IN (SELECT child.id FROM public.doctors child WHERE child.parent_id = v_owner_doctor.id)
      ));
    LOOP
        v_case_id := v_owner_doctor.doctor_code || '-' || to_char(v_business_date, 'YYMMDD') || '-' || (500 + GREATEST(1, v_sequence));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.orders WHERE case_id = v_case_id);
        v_sequence := v_sequence + 1;
    END LOOP;

    v_reason_label := CASE p_reason_code
        WHEN 'lab_error' THEN 'خطأ في المعمل'
        WHEN 'design_error' THEN 'خطأ في التصميم'
        WHEN 'doctor_change' THEN 'تغيير طلب الدكتور'
        WHEN 'scan_issue' THEN 'مشكلة في السكان'
        ELSE 'أخرى'
    END;
    v_comment := 'إعادة إنتاج من #' || v_original.case_id || ' — السبب: ' || v_reason_label || ' — ' || btrim(p_notes);

    IF p_cause_category IS NOT NULL THEN
        PERFORM set_config('app.explicit_issue_cause', p_cause_category, true);
        PERFORM set_config('app.explicit_issue_stage', COALESCE(p_responsible_stage, ''), true);
    END IF;

    PERFORM set_config('app.order_issue_operation', 'create_redo', true);
    PERFORM set_config('app.order_rejection_in_progress', 'true', true);
    UPDATE public.orders SET
        status = 'Doctor Rejected', production_status = 'final_delivered', issue_state = 'redo',
        rejection_doctor_decision = p_doctor_decision, rejected_doctor_amount = v_doctor_amount,
        rejection_financial_review_status = v_review_status,
        rejected_lab_cost = NULL,
        rejected_lab_cost_status = CASE WHEN supplier_id IS NULL THEN 'not_applicable' ELSE 'pending' END,
        rejected_designer_cost = NULL,
        rejected_designer_cost_status = CASE WHEN designer_id IS NULL THEN 'not_applicable' ELSE 'pending' END,
        updated_at = timezone('utc', now())
    WHERE id = v_original.id;

    INSERT INTO public.orders(
        case_id, doctor_id, branch_name, patient_name, items, discount, total_price,
        shade, status, delivery_date, cost, manual_cost, stl_url, images_url,
        supplier_id, instructions, priority, delivery_type, needs_design_review,
        technician_status, is_urgent, comments, representative_id, is_registered,
        workflow_type, designer_id, design_url, design_status, design_price,
        manual_design_price, actual_delivery_date, feedback, is_redo,
        original_order_id, status_history, is_archived, is_deleted,
        rejected_lab_cost, rejected_designer_cost, rejection_doctor_decision,
        rejected_doctor_amount, rejection_financial_review_status,
        rejected_lab_cost_status, rejected_designer_cost_status,
        production_status, issue_state, design_submitted_at,
        first_delivered_at, first_delivered_source
    ) VALUES (
        v_case_id, v_original.doctor_id, v_original.branch_name, v_original.patient_name,
        COALESCE(v_original.items, '[]'::jsonb), COALESCE(v_original.discount, 0),
        COALESCE(v_original.total_price, 0), COALESCE(v_original.shade, ''),
        'New Case', v_original.delivery_date, COALESCE(v_original.cost, 0),
        v_original.manual_cost, v_original.stl_url, v_original.images_url,
        v_original.supplier_id, v_original.instructions, COALESCE(v_original.priority, 'Normal'),
        v_original.delivery_type, COALESCE(v_original.needs_design_review, FALSE),
        'Pending', COALESCE(v_original.is_urgent, FALSE),
        jsonb_build_array(jsonb_build_object(
            'id', gen_random_uuid()::text, 'text', v_comment, 'userId', 'system',
            'userName', 'النظام', 'createdAt', timezone('utc', now())
        )),
        v_original.representative_id, FALSE, v_original.workflow_type,
        v_original.designer_id, NULL,
        CASE WHEN v_original.workflow_type = 'split' THEN 'pending' ELSE NULL END,
        COALESCE(v_original.design_price, 0), v_original.manual_design_price,
        NULL, NULL, TRUE, v_original.id, '[]'::jsonb, FALSE, FALSE,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        'not_started', 'none', NULL, NULL, NULL
    ) RETURNING id INTO v_new_order_id;

    INSERT INTO public.order_items(order_id, product_type, teeth_numbers, shade, price, count)
    SELECT v_new_order_id, product_type, teeth_numbers, shade, price, count
    FROM public.order_items WHERE order_id = v_original.id;
    INSERT INTO public.order_comments(order_id, content, user_id, user_name, created_at)
    VALUES
        (v_original.id, v_comment, v_profile_id, COALESCE(v_actor_name, 'User'), timezone('utc', now())),
        (v_new_order_id, v_comment, NULL, 'النظام', timezone('utc', now()));
    INSERT INTO public.order_events(
        order_id, event_type, old_value, new_value, changed_by, actor_role,
        reason, notes, severity, responsibility_party, metadata
    ) VALUES (
        v_original.id, 'remake_requested', COALESCE(v_original.issue_state, 'none'), 'redo',
        v_profile_id, v_role, p_reason_code, btrim(p_notes), 'warning',
        CASE p_reason_code WHEN 'lab_error' THEN 'external_lab' WHEN 'design_error' THEN 'designer'
             WHEN 'doctor_change' THEN 'doctor' WHEN 'scan_issue' THEN 'scan' ELSE 'unknown' END,
        jsonb_build_object('originalCaseId', v_original.case_id, 'redoOrderId', v_new_order_id,
            'redoCaseId', v_case_id, 'doctorDecision', p_doctor_decision,
            'doctorAmount', v_doctor_amount, 'idempotencyKey', p_idempotency_key, 'workflowVersion', 2)
    ), (
        v_new_order_id, 'order_created', NULL, 'not_started/none', v_profile_id, v_role,
        p_reason_code, btrim(p_notes), 'info', NULL,
        jsonb_build_object('caseId', v_case_id, 'originalOrderId', v_original.id,
            'isRedo', TRUE, 'idempotencyKey', p_idempotency_key, 'workflowVersion', 2)
    );

    v_result := jsonb_build_object(
        'originalOrderId', v_original.id, 'originalCaseId', v_original.case_id,
        'newOrderId', v_new_order_id, 'newCaseId', v_case_id
    );
    UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now())
    WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. log_order_issue_trigger_fn -- check the explicit GUC BEFORE any
--    keyword guessing, in both the "has comment" and "no comment" paths.
--    Empty GUC (any caller that never sends the new params) falls through
--    to the existing guess, byte-for-byte unchanged.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION log_order_issue_trigger_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_latest_comment RECORD;
    v_cause_category TEXT := 'unknown';
    v_responsible_stage TEXT := NULL;
    v_notes TEXT;
    v_reporter_name TEXT := 'system';
    v_reporter_id UUID := NULL;
    v_is_transition BOOLEAN := FALSE;
    v_explicit_cause TEXT := current_setting('app.explicit_issue_cause', true);
    v_explicit_stage TEXT := current_setting('app.explicit_issue_stage', true);
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.issue_state IN ('returned', 'rejected', 'cancelled', 'redo', 'doctor_rejected', 'lab_rejected') THEN
            v_is_transition := TRUE;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.issue_state IN ('returned', 'rejected', 'cancelled', 'redo', 'doctor_rejected', 'lab_rejected')
           AND NEW.issue_state IS DISTINCT FROM OLD.issue_state THEN
            v_is_transition := TRUE;
        END IF;
    END IF;

    IF v_is_transition THEN
        SELECT content, user_id, user_name INTO v_latest_comment
        FROM order_comments
        WHERE order_id = NEW.id
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_latest_comment.content IS NOT NULL THEN
            v_notes := v_latest_comment.content;
            v_reporter_id := v_latest_comment.user_id;
            v_reporter_name := v_latest_comment.user_name;

            IF NULLIF(v_explicit_cause, '') IS NOT NULL THEN
                v_cause_category := v_explicit_cause;
                v_responsible_stage := NULLIF(v_explicit_stage, '');
            ELSE
                -- Keyword matching is a best-effort guess, so it resolves to the
                -- broadest honest code rather than inventing a specific stage.
                IF v_notes LIKE '%معمل%' OR v_notes LIKE '%lab%' THEN
                    v_cause_category := 'unknown';
                    v_responsible_stage := 'external_lab';
                ELSIF v_notes LIKE '%دكتور%' OR v_notes LIKE '%doctor%' OR v_notes LIKE '%طبيب%' THEN
                    v_cause_category := 'doctor_side';
                    v_responsible_stage := 'doctor';
                ELSIF v_notes LIKE '%سكان%' OR v_notes LIKE '%scan%' THEN
                    v_cause_category := 'scan_impression';
                    v_responsible_stage := 'doctor';
                ELSIF v_notes LIKE '%تصميم%' OR v_notes LIKE '%design%' OR v_notes LIKE '%مصمم%' THEN
                    v_cause_category := 'cad';
                    v_responsible_stage := 'design';
                ELSIF v_notes LIKE '%تواصل%' OR v_notes LIKE '%communication%' THEN
                    v_cause_category := 'unknown';
                    v_responsible_stage := 'unknown';
                ELSE
                    v_cause_category := 'unknown';
                END IF;
            END IF;
        ELSE
            v_notes := CASE NEW.issue_state
                WHEN 'returned'         THEN 'تم الإرجاع للتعديل من لوحة التحكم'
                WHEN 'rejected'         THEN 'تم رفض الحالة من لوحة التحكم'
                WHEN 'doctor_rejected'  THEN 'مرتجع طبيب - تم رفض الحالة من قبل الطبيب'
                WHEN 'lab_rejected'     THEN 'رفض معمل - تم رفض الحالة داخلياً'
                WHEN 'cancelled'        THEN 'تم إلغاء الحالة من لوحة التحكم'
                WHEN 'redo'             THEN 'تم طلب إعادة إنتاج للحالة'
                ELSE 'تغيير حالة الأوردر تلقائياً'
            END;
            v_reporter_name := 'system';

            IF NULLIF(v_explicit_cause, '') IS NOT NULL THEN
                v_cause_category := v_explicit_cause;
                v_responsible_stage := NULLIF(v_explicit_stage, '');
            END IF;
        END IF;

        INSERT INTO order_issues (
            order_id, issue_type, cause_category, responsible_stage,
            notes, reporter_id, reporter_name, created_at
        )
        VALUES (
            NEW.id, NEW.issue_state, v_cause_category, v_responsible_stage,
            v_notes, v_reporter_id, v_reporter_name, NOW()
        );
    END IF;

    RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Grants for the new signatures (permissions carry over from the
--    replaced function automatically, this just documents/pins them).
-- ─────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.apply_order_issue_transition_v2(UUID, TEXT, TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_order_issue_transition_v2(UUID, TEXT, TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_reject_order_from_tech_status_v2(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_order_from_tech_status_v2(UUID, TEXT, UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.review_designer_rejection_v2(UUID, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_designer_rejection_v2(UUID, TEXT, TEXT, UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.create_redo_order_atomic_v2(UUID, TEXT, TEXT, TEXT, NUMERIC, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_redo_order_atomic_v2(UUID, TEXT, TEXT, TEXT, NUMERIC, UUID, TEXT, TEXT) TO authenticated;

COMMIT;
