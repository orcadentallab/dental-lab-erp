-- Fix: the issue-state correction invented a delivery date, and repair the
-- order it already damaged.
--
-- What went wrong (found in production 2026-08-25, same day as the feature):
--   20260825000000 restored a cleared delivery date with
--       COALESCE(actual_delivery_date, first_delivered_at::date)
--   on the assumption that first_delivered_at is the real first delivery.
--   For backfilled rows it is not. 20260808002000 stamps
--   first_delivered_source = 'accounting_snapshot_inferred' when the only
--   evidence it could find was accounting_registered_at — the moment the
--   ACCOUNTANT registered the order, not the moment it was delivered. That
--   bulk registration ran once, so 364 orders now share one identical
--   first_delivered_at (2026-07-30 18:33:28.161247+00).
--
--   Correcting CASE-1769820310810-36 therefore wrote 2026-07-30 into an
--   actual_delivery_date that had always been NULL, moving the case out of
--   its January statement and pushing both obligations' trigger_date and
--   due_date forward by six months.
--
--   The deeper mistake was scope: only `return_for_adjustment` clears
--   actual_delivery_date. A doctor rejection, a lab rejection and a
--   cancellation all leave it untouched, so correcting out of them had
--   nothing to restore in the first place.
--
-- The rule this migration installs:
--   * leaving any issue state EXCEPT `returned` -> keep actual_delivery_date
--     exactly as it is; nothing cleared it.
--   * leaving `returned` -> restore it from first_delivered_at ONLY when
--     first_delivered_source is an observed delivery
--     ('order_event', 'status_history', 'actual_delivery_date',
--      'direct_transition'). Inferred sources are evidence THAT delivery
--     happened, never evidence of WHEN, so the date stays null and the
--     statement falls back to delivery_date — which is what these legacy
--     rows did before anyone touched them.
--
-- first_delivered_at keeps its meaning as delivery EVIDENCE everywhere else
-- (the timing CHECK constraint, the transition guard, the UI gate). This
-- migration only stops it being read as a delivery DATE.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Which first_delivered_source values carry a real observed timestamp.
--    Declared once so the RPC and any future reader cannot drift apart.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_observed_first_delivery_source(p_source TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    -- 'accounting_snapshot_inferred' is accounting_registered_at and
    -- 'manual_review' is a reviewer's note; neither is a delivery timestamp.
    SELECT COALESCE(p_source, '') IN (
        'order_event', 'status_history', 'actual_delivery_date', 'direct_transition'
    );
$$;

COMMENT ON FUNCTION public.is_observed_first_delivery_source(TEXT) IS
'True when orders.first_delivered_source means first_delivered_at is a real observed delivery timestamp, safe to read as a DATE. False for inferred sources, which prove only that delivery happened, not when.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. admin_correct_order_issue_state_v2 — identical to 20260825000000 apart
--    from the delivery-date handling described above.
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
    v_restored_delivery DATE;
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

    SELECT id INTO v_replacement FROM public.orders
    WHERE original_order_id = p_order_id AND COALESCE(is_deleted, FALSE) = FALSE
    LIMIT 1;
    IF v_replacement IS NOT NULL THEN
        RAISE EXCEPTION 'يوجد أوردر بديل مرتبط بهذه الحالة — لا يمكن تصحيح المشكلة';
    END IF;

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

    -- ── The delivery date the corrected row should carry ────────────────
    -- `returned` is the ONLY state that clears actual_delivery_date, so it is
    -- the only one with anything to restore — and only from an observed
    -- timestamp. Every other source state kept its value all along.
    IF v_current = 'returned' THEN
        v_restored_delivery := CASE
            WHEN public.is_observed_first_delivery_source(v_order.first_delivered_source)
                THEN (v_order.first_delivered_at AT TIME ZONE 'UTC')::date
            ELSE NULL
        END;
    ELSE
        v_restored_delivery := v_order.actual_delivery_date;
    END IF;

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
        v_target_delivery := v_restored_delivery;

    ELSIF p_target_issue_state IN ('cancelled', 'lab_rejected') THEN
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
        v_target_delivery := v_restored_delivery;

    ELSE
        v_doctor_decision := NULL;
        v_doctor_amount := NULL;
        v_review_status := NULL;
        v_lab_cost := NULL;
        v_designer_cost := NULL;
        v_lab_cost_status := NULL;
        v_designer_cost_status := NULL;

        IF p_target_issue_state = 'returned' THEN
            v_target_status := 'Returned for Adjustments';
            v_target_production := 'in_production';
            v_target_delivery := NULL;
        ELSIF v_has_delivery THEN
            v_target_status := 'Delivered';
            v_target_production := 'final_delivered';
            v_target_delivery := v_restored_delivery;
        ELSE
            v_target_production := v_order.production_status;
            v_target_delivery := v_restored_delivery;
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
    -- recomputes, so landing on it directly from a rejection would freeze the
    -- rejection amount in place. Erase the wrong record first and let the
    -- owner rebuild the real delivered obligations. Deliberately does NOT
    -- touch actual_delivery_date: nothing cleared it on the way in.
    IF p_target_issue_state = 'returned' THEN
        UPDATE public.orders SET
            status                            = 'Delivered',
            issue_state                       = 'none',
            production_status                 = 'final_delivered',
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
            'previousActualDeliveryDate', v_order.actual_delivery_date,
            'legacyStatus', v_target_status,
            'productionStatus', v_target_production,
            'actualDeliveryDate', v_target_delivery,
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

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Repair the rows the first version already stamped.
--
--    Scope is deliberately tight: an order that WAS corrected, whose
--    first_delivered_source is not an observed delivery, and whose
--    actual_delivery_date is exactly that inferred timestamp's date. That
--    combination cannot occur naturally — it is the signature of the bug.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _delivery_date_repair ON COMMIT DROP AS
SELECT o.id, o.actual_delivery_date AS stamped_date
FROM public.orders o
WHERE o.actual_delivery_date IS NOT NULL
  AND o.first_delivered_at IS NOT NULL
  AND NOT public.is_observed_first_delivery_source(o.first_delivered_source)
  AND o.actual_delivery_date = (o.first_delivered_at AT TIME ZONE 'UTC')::date
  AND EXISTS (
      SELECT 1 FROM public.order_events e
      WHERE e.order_id = o.id AND e.event_type = 'issue_state_corrected'
  );

UPDATE public.orders o
SET actual_delivery_date = NULL,
    updated_at = timezone('utc', now())
FROM _delivery_date_repair r
WHERE o.id = r.id;

-- The obligation owner short-circuits when the entity, amount and trigger
-- status are unchanged, so it will not re-date the existing rows on its own.
-- Put them back on the same basis they had before the bad correction:
-- actual_delivery_date (now null) -> delivery_date -> created_at.
UPDATE public.financial_obligations f
SET trigger_date = COALESCE(o.actual_delivery_date, o.delivery_date, o.created_at::date),
    due_date = public.calculate_financial_obligation_due_date(
        f.entity_type, f.entity_id,
        COALESCE(o.actual_delivery_date, o.delivery_date, o.created_at::date)
    ),
    metadata = COALESCE(f.metadata, '{}'::jsonb) || jsonb_build_object(
        'repairedBy', '20260825001000_fix_issue_correction_delivery_date',
        'repairedFromTriggerDate', f.trigger_date
    )
FROM public.orders o, _delivery_date_repair r
WHERE f.order_id = r.id
  AND o.id = r.id
  AND f.status NOT IN ('void', 'written_off');

INSERT INTO public.order_events(
    order_id, event_type, old_value, new_value, changed_by, actor_role,
    reason, notes, severity, approval_status, metadata
)
SELECT r.id, 'delivery_date_repaired', r.stamped_date::text, NULL, NULL, 'system',
       'Correction had stamped an inferred accounting-registration date as the delivery date',
       'تم إلغاء تاريخ تسليم غير حقيقي كان مأخوذاً من تاريخ التسجيل المحاسبي، ورجعت الاستحقاقات لأساسها الأصلي',
       'warning', 'none',
       jsonb_build_object('repairedBy', '20260825001000_fix_issue_correction_delivery_date')
FROM _delivery_date_repair r;

COMMIT;
