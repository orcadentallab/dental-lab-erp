-- Admin-only correction of a WRONG issue state on an order.
--
-- Why this is needed (asked for 2026-08-25):
--   "مرتجع طبيب" (and every other issue state) is terminal by design. Once a
--   rep or admin presses it, guard_order_issue_transition_v2 refuses every
--   further issue transition — its CASE has no branch for `none`, so leaving
--   an issue state raises "Unsupported issue transition: none". That is right
--   for the normal workflow: a rejection is an accounting event, not a toggle.
--   But it leaves no way at all to undo a MISCLICK, and today the only
--   workaround is a hand-written UPDATE against production.
--
--   This adds one narrow, admin-only, audited escape hatch — the same idea as
--   the existing admin "…" legacy-status override in WorkflowActionBar, but
--   for the issue axis instead of the production axis.
--
-- Why nothing here touches money directly:
--   sync_order_financial_obligations() is a DECLARATIVE owner: it recomputes
--   all five obligations from whatever the order row ends up saying. Put the
--   row back into the state it should have had, and the doctor receivable,
--   the external-lab payable, the designer payable and the two issue
--   settlements are rebuilt for us. Payments already made are carried over by
--   reallocate_voided_obligation_allocations() (transferred to the
--   replacement obligation, remainder becomes an account credit), and
--   reopen_registered_order_for_accounting() sends the order back to the
--   accountant's queue. So this RPC's ONLY job is to write a correct,
--   internally consistent order row — never to move a single amount by hand.
--
-- Invariants deliberately preserved (identical to pressing the right button
-- the first time round):
--   - cancelled / lab_rejected require NO delivery evidence
--   - returned / doctor_rejected require delivery evidence
--   - redo is NOT a correction target and NOT a correctable source: a redo
--     owns a replacement order, and silently detaching it would orphan a real
--     case. Those must be handled by deleting the replacement first.
--   - order_issues rows are VOIDED, never deleted (20260816002000 precedent).
--   - `none` restores final_delivered only where delivery is actually
--     evidenced (first_delivered_at or the reviewed legacy confirmation);
--     otherwise the production stage is left exactly where it was, because we
--     do not know — and will not invent — what it used to be.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Teach the transition guard about the correction operation.
--
--    Everything below is the 20260808000000 guard verbatim, plus:
--      * a `none` branch (previously fell through to the ELSE and raised)
--      * `admin_correct_issue_state` accepted alongside the normal operation
--        for each issue target, admin-only
--    No existing path changes behaviour.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_order_issue_transition_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_operation TEXT := current_setting('app.order_issue_operation', true);
    v_correcting BOOLEAN := current_setting('app.order_issue_operation', true)
                            = 'admin_correct_issue_state';
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

    -- A correction is an admin privilege only; a rep who mislabelled a case
    -- must ask an admin, exactly like the legacy-status override.
    IF v_correcting AND v_role <> 'admin' THEN
        RAISE EXCEPTION 'Only admin can correct an issue state';
    END IF;

    CASE NEW.issue_state
        WHEN 'none' THEN
            -- Leaving an issue state is ONLY ever a correction. There is no
            -- ordinary "un-reject" in the workflow.
            IF NOT v_correcting THEN
                RAISE EXCEPTION 'Clearing an issue state requires the admin correction RPC';
            END IF;
            IF COALESCE(OLD.issue_state, 'none') = 'redo' THEN
                RAISE EXCEPTION 'A redo owns a replacement order and cannot be cleared';
            END IF;
        WHEN 'cancelled' THEN
            IF v_operation NOT IN ('cancel_order', 'admin_correct_issue_state')
               OR OLD.first_delivered_at IS NOT NULL THEN
                RAISE EXCEPTION 'Cancellation is only allowed before first delivery';
            END IF;
        WHEN 'returned' THEN
            IF v_operation NOT IN ('return_for_adjustment', 'admin_correct_issue_state')
               OR OLD.first_delivered_at IS NULL THEN
                RAISE EXCEPTION 'Return for adjustment requires prior delivery';
            END IF;
        WHEN 'doctor_rejected' THEN
            IF v_operation NOT IN ('doctor_reject_order', 'admin_correct_issue_state')
               OR OLD.first_delivered_at IS NULL THEN
                RAISE EXCEPTION 'Doctor rejection requires prior delivery';
            END IF;
        WHEN 'redo' THEN
            IF v_operation <> 'create_redo' OR OLD.first_delivered_at IS NULL THEN
                RAISE EXCEPTION 'Redo requires prior delivery';
            END IF;
        WHEN 'lab_rejected' THEN
            IF v_operation NOT IN (
                    'approve_designer_rejection', 'admin_tech_reject',
                    'admin_correct_issue_state'
               )
               OR OLD.first_delivered_at IS NOT NULL
               OR OLD.design_submitted_at IS NOT NULL THEN
                RAISE EXCEPTION 'Lab rejection is only allowed before design submission and final delivery';
            END IF;
            IF v_operation = 'admin_tech_reject' THEN
                IF v_role <> 'admin' THEN
                    RAISE EXCEPTION 'Only admin can reject directly from technician status';
                END IF;
            ELSIF v_operation = 'approve_designer_rejection' THEN
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

-- ─────────────────────────────────────────────────────────────────────────
-- 2. admin_correct_order_issue_state_v2
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_correct_order_issue_state_v2(
    p_order_id UUID,
    p_target_issue_state TEXT,
    p_reason TEXT,
    p_idempotency_key UUID,
    p_doctor_decision TEXT DEFAULT NULL,
    p_custom_doctor_amount NUMERIC DEFAULT NULL,
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
    v_current TEXT;
    v_payload JSONB;
    v_existing public.order_transition_commands%ROWTYPE;
    v_result JSONB;
    v_inserted INTEGER;
    v_has_delivery BOOLEAN;
    v_replacement UUID;
    v_target_status TEXT;
    v_target_production TEXT;
    v_target_delivery DATE;
    v_doctor_decision TEXT;
    v_doctor_amount NUMERIC;
    v_review_status TEXT;
    v_lab_cost NUMERIC;
    v_designer_cost NUMERIC;
    v_lab_cost_status TEXT;
    v_designer_cost_status TEXT;
    v_voided INTEGER := 0;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN
        RAISE EXCEPTION 'Order issue workflow V2 writes are disabled';
    END IF;
    IF v_role IS DISTINCT FROM 'admin' OR v_user_id IS NULL THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;
    IF NULLIF(btrim(p_reason), '') IS NULL THEN
        RAISE EXCEPTION 'سبب التصحيح مطلوب' USING ERRCODE = '22023';
    END IF;
    IF p_target_issue_state NOT IN (
        'none', 'returned', 'cancelled', 'doctor_rejected', 'lab_rejected'
    ) THEN
        RAISE EXCEPTION 'حالة مشكلة غير مدعومة للتصحيح: %', p_target_issue_state;
    END IF;

    v_payload := jsonb_build_object(
        'targetIssueState', p_target_issue_state,
        'reason', btrim(p_reason),
        'doctorDecision', p_doctor_decision,
        'customDoctorAmount', p_custom_doctor_amount
    );

    INSERT INTO public.order_transition_commands(
        idempotency_key, order_id, operation, requested_by, request_payload
    ) VALUES (
        p_idempotency_key, p_order_id, 'admin_correct_issue_state', v_user_id, v_payload
    ) ON CONFLICT (idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 0 THEN
        SELECT * INTO v_existing FROM public.order_transition_commands
        WHERE idempotency_key = p_idempotency_key;
        IF v_existing.order_id IS DISTINCT FROM p_order_id
           OR v_existing.operation IS DISTINCT FROM 'admin_correct_issue_state'
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

    v_current := COALESCE(v_order.issue_state, 'none');
    IF v_current = 'none' THEN
        RAISE EXCEPTION 'الحالة ليس عليها مشكلة مسجّلة لتصحيحها';
    END IF;
    IF v_current = p_target_issue_state THEN
        RAISE EXCEPTION 'الحالة بالفعل %', p_target_issue_state;
    END IF;
    IF v_current = 'redo' THEN
        RAISE EXCEPTION 'حالة إعادة الإنتاج مرتبطة بأوردر بديل — احذف الأوردر البديل أولاً';
    END IF;

    -- Even outside issue_state='redo', a replacement order pins this one as
    -- the closed original of a chain.
    SELECT id INTO v_replacement FROM public.orders
    WHERE original_order_id = p_order_id AND COALESCE(is_deleted, FALSE) = FALSE
    LIMIT 1;
    IF v_replacement IS NOT NULL THEN
        RAISE EXCEPTION 'يوجد أوردر بديل مرتبط بهذه الحالة — لا يمكن تصحيح المشكلة';
    END IF;

    -- Same evidence the timing CHECK constraint accepts.
    v_has_delivery := v_order.first_delivered_at IS NOT NULL
                      OR COALESCE(v_order.legacy_delivery_confirmed, FALSE);

    IF p_target_issue_state IN ('cancelled', 'lab_rejected') AND v_has_delivery THEN
        RAISE EXCEPTION 'لا يمكن تحويل حالة تم تسليمها إلى إلغاء أو رفض معمل';
    END IF;
    IF p_target_issue_state = 'lab_rejected' AND v_order.design_submitted_at IS NOT NULL THEN
        RAISE EXCEPTION 'رفض المعمل غير مسموح بعد رفع التصميم';
    END IF;
    IF p_target_issue_state IN ('returned', 'doctor_rejected') AND NOT v_has_delivery THEN
        RAISE EXCEPTION 'الإرجاع للتعديل ومرتجع الطبيب يتطلبان تسليماً سابقاً';
    END IF;

    -- ── Target state → order row ────────────────────────────────────────
    IF p_target_issue_state = 'doctor_rejected' THEN
        IF p_doctor_decision NOT IN ('decide_later', 'full_price', 'zero', 'custom_amount') THEN
            RAISE EXCEPTION 'Invalid doctor decision';
        END IF;
        v_doctor_decision := p_doctor_decision;
        v_doctor_amount := CASE p_doctor_decision
            WHEN 'decide_later' THEN COALESCE(v_order.total_price, 0)
            WHEN 'full_price'   THEN COALESCE(v_order.total_price, 0)
            WHEN 'zero'         THEN 0
            WHEN 'custom_amount' THEN p_custom_doctor_amount
        END;
        IF v_doctor_amount IS NULL OR v_doctor_amount < 0
           OR v_doctor_amount > COALESCE(v_order.total_price, 0) THEN
            RAISE EXCEPTION 'Doctor amount must be between zero and order total';
        END IF;
        v_review_status := CASE
            WHEN p_doctor_decision = 'decide_later' THEN 'pending' ELSE 'resolved'
        END;
        v_lab_cost := NULL;
        v_designer_cost := NULL;
        v_lab_cost_status := CASE WHEN v_order.supplier_id IS NULL THEN 'not_applicable' ELSE 'pending' END;
        v_designer_cost_status := CASE WHEN v_order.designer_id IS NULL THEN 'not_applicable' ELSE 'pending' END;
        v_target_status := 'Doctor Rejected';
        v_target_production := v_order.production_status;
        v_target_delivery := v_order.actual_delivery_date;

    ELSIF p_target_issue_state IN ('cancelled', 'lab_rejected') THEN
        -- normalize_zero_fields_for_lab_rejected_cancelled() rewrites these
        -- anyway; setting them here keeps the row honest before the trigger.
        v_doctor_decision := 'zero';
        v_doctor_amount := 0;
        v_review_status := 'resolved';
        v_lab_cost := 0;
        v_designer_cost := 0;
        v_lab_cost_status := CASE WHEN v_order.supplier_id IS NULL THEN 'not_applicable' ELSE 'resolved' END;
        v_designer_cost_status := CASE WHEN v_order.designer_id IS NULL THEN 'not_applicable' ELSE 'resolved' END;
        v_target_status := CASE p_target_issue_state
            WHEN 'cancelled' THEN 'Cancelled' ELSE 'Lab Rejected'
        END;
        v_target_production := v_order.production_status;
        v_target_delivery := v_order.actual_delivery_date;

    ELSE
        -- 'returned' and 'none': no rejection settlement exists on either, so
        -- every rejection field is cleared rather than carried over.
        v_doctor_decision := NULL;
        v_doctor_amount := NULL;
        v_review_status := NULL;
        v_lab_cost := NULL;
        v_designer_cost := NULL;
        v_lab_cost_status := NULL;
        v_designer_cost_status := NULL;

        IF p_target_issue_state = 'returned' THEN
            -- Identical to pressing "إرجاع للتعديل": back on the bench, and
            -- the delivery date is cleared because it will be redelivered.
            v_target_status := 'Returned for Adjustments';
            v_target_production := 'in_production';
            v_target_delivery := NULL;
        ELSIF v_has_delivery THEN
            v_target_status := 'Delivered';
            v_target_production := 'final_delivered';
            -- A return CLEARS actual_delivery_date (the case is going back on
            -- the bench and will be redelivered). Restoring the delivered
            -- state therefore has to restore the date too, or we leave a
            -- final_delivered order with no delivery date — which silently
            -- pushes the statement date and the obligation due date onto the
            -- PLANNED delivery_date. first_delivered_at is the recorded first
            -- delivery, so it is the honest source. A reviewed legacy row has
            -- no exact timestamp by definition, and correctly stays null.
            v_target_delivery := COALESCE(
                v_order.actual_delivery_date,
                (v_order.first_delivered_at AT TIME ZONE 'UTC')::date
            );
        ELSE
            -- No delivery evidence: leave the production stage untouched and
            -- mirror it into the legacy status column.
            v_target_production := v_order.production_status;
            v_target_delivery := v_order.actual_delivery_date;
            v_target_status := CASE v_order.production_status
                WHEN 'not_started'     THEN 'New Case'
                WHEN 'designing'       THEN 'Under Design'
                WHEN 'in_production'   THEN 'Under Production'
                WHEN 'try_in_ready'    THEN 'Try In'
                WHEN 'waiting_doctor'  THEN 'Waiting Dr Approval'
                WHEN 'finalization'    THEN 'Try In Approved'
                WHEN 'final_ready'     THEN 'Ready'
                WHEN 'final_delivered' THEN 'Delivered'
                ELSE 'New Case'
            END;
        END IF;
    END IF;

    IF p_cause_category IS NOT NULL AND p_target_issue_state <> 'none' THEN
        PERFORM set_config('app.explicit_issue_cause', p_cause_category, true);
        PERFORM set_config('app.explicit_issue_stage', COALESCE(p_responsible_stage, ''), true);
    END IF;

    PERFORM set_config('app.order_issue_operation', 'admin_correct_issue_state', true);

    -- `returned` is the one target the financial owner PRESERVES rather than
    -- recomputes (sync_order_financial_obligations sets v_preserve_doctor /
    -- v_preserve_designer / v_preserve_external_lab for it, so a return does
    -- not wipe an already-earned receivable). Landing on it directly from a
    -- rejection would therefore freeze the REJECTION amount in place — zero,
    -- for a case the doctor actually owes in full. So erase the wrong record
    -- first: clear to the delivered state, let the owner rebuild the real
    -- delivered obligations, and only then apply the return. The second write
    -- preserves what the first one just built, which is exactly what a genuine
    -- "delivered, then returned for adjustment" order looks like.
    IF p_target_issue_state = 'returned' THEN
        UPDATE public.orders SET
            status                            = 'Delivered',
            issue_state                       = 'none',
            production_status                 = 'final_delivered',
            actual_delivery_date              = COALESCE(
                actual_delivery_date, (first_delivered_at AT TIME ZONE 'UTC')::date
            ),
            rejection_doctor_decision         = NULL,
            rejected_doctor_amount            = NULL,
            rejection_financial_review_status = NULL,
            rejected_lab_cost                 = NULL,
            rejected_designer_cost            = NULL,
            rejected_lab_cost_status          = NULL,
            rejected_designer_cost_status     = NULL,
            updated_at                        = timezone('utc', now())
        WHERE id = p_order_id;
    END IF;

    UPDATE public.orders SET
        status                            = v_target_status,
        issue_state                       = p_target_issue_state,
        production_status                 = v_target_production,
        actual_delivery_date              = v_target_delivery,
        rejection_doctor_decision         = v_doctor_decision,
        rejected_doctor_amount            = v_doctor_amount,
        rejection_financial_review_status = v_review_status,
        rejected_lab_cost                 = v_lab_cost,
        rejected_designer_cost            = v_designer_cost,
        rejected_lab_cost_status          = v_lab_cost_status,
        rejected_designer_cost_status     = v_designer_cost_status,
        updated_at                        = timezone('utc', now())
    WHERE id = p_order_id;

    -- The issue log keeps the mis-filed row for audit, marked void so the
    -- issue statistics stop counting a problem that never happened.
    UPDATE public.order_issues SET
        is_voided         = TRUE,
        corrected_at      = NOW(),
        corrected_by      = v_user_id,
        correction_reason = btrim(p_reason)
    WHERE order_id = p_order_id
      AND issue_type = v_current
      AND COALESCE(is_voided, FALSE) = FALSE;
    GET DIAGNOSTICS v_voided = ROW_COUNT;

    INSERT INTO public.order_events(
        order_id, event_type, old_value, new_value, changed_by, actor_role,
        reason, notes, severity, approval_status, metadata
    ) VALUES (
        p_order_id, 'issue_state_corrected', v_current, p_target_issue_state,
        v_user_id, v_role, btrim(p_reason), btrim(p_reason), 'warning', 'none',
        jsonb_build_object(
            'idempotencyKey', p_idempotency_key,
            'workflowVersion', 2,
            'previousLegacyStatus', v_order.status,
            'previousProductionStatus', v_order.production_status,
            'legacyStatus', v_target_status,
            'productionStatus', v_target_production,
            'voidedIssueRows', v_voided,
            'causeCategory', p_cause_category,
            'responsibleStage', p_responsible_stage
        )
    );

    v_result := jsonb_build_object(
        'orderId', p_order_id,
        'previousIssueState', v_current,
        'issueState', p_target_issue_state,
        'legacyStatus', v_target_status,
        'productionStatus', v_target_production,
        'voidedIssueRows', v_voided
    );
    UPDATE public.order_transition_commands
    SET result_payload = v_result, completed_at = timezone('utc', now())
    WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_correct_order_issue_state_v2(
    UUID, TEXT, TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_correct_order_issue_state_v2(
    UUID, TEXT, TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.admin_correct_order_issue_state_v2(
    UUID, TEXT, TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT
) IS
'Admin-only correction of a wrongly recorded issue_state. Writes a consistent order row and lets sync_order_financial_obligations rebuild every obligation; never moves an amount by hand. Blocked for redo chains.';

COMMIT;
