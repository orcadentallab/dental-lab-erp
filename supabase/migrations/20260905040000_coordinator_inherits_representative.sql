-- Production roles, step 2b of 3: the coordinator inherits the representative.
-- See docs/PRODUCTION_ROLES_PLAN_AR.md decision 3 and section 8.1.
--
-- Step 2a added 'coordinator' beside every 'accountant' mechanically, because
-- that literal is never anything but a role check. This half could not be done
-- the same way. 'representative' is also a DATA value in this schema:
--     transactions.entity_type = 'representative'
--     order_events metadata source = 'representative_edit'
--     order_events.responsibility_party := 'representative'
--     expense reports filtering entity_type NOT IN (..., 'representative')
-- A blind pass would have rewritten expense categorisation and audit history
-- while looking exactly like a permission change. So the 13 functions below
-- are an explicit allow-list, changed line by line, and three of those lines
-- were decided by hand against the plan rather than by the rule:
--
--   apply_order_rejection_atomic scopes rows with
--       v_role = 'admin' OR (v_role = 'representative'
--                            AND representative_id = get_my_user_id())
--   Giving the coordinator the representative half would have matched NOTHING,
--   because a coordinator is never stamped as an order's representative (see
--   the note on auto_set_representative_id below). They are scoped beside the
--   admin instead: the coordinator works across all doctors by definition.
--
--   orders_role_field_guard's representative BRANCH is deliberately NOT
--   widened. Step 2a already routes the coordinator through the accountant
--   branch, which sits above it and grants the wider set the plan asks for
--   (section 4.3: the union of REP_AUDITED_ALLOW_LIST and
--   ACCOUNTANT_ALLOW_FIELDS) while still refusing production_status and
--   issue_state. Adding them to the representative branch would be dead code
--   that reads as if it were load-bearing. The representative BYPASS at the
--   top of that function IS widened -- without it the coordinator could not
--   run the V2 workflow RPCs, which is a different thing from editing
--   issue_state by hand and is permitted.
--
--   rep_update_order_fields_with_audit writes the audit source from
--       CASE v_role WHEN 'representative' THEN 'representative_edit' ...
--   with no ELSE, so an unlisted role silently records source = NULL. The
--   coordinator gets its own label, 'coordinator_edit'. Borrowing the
--   representative's would put a false actor in the audit trail, which is
--   worse than the NULL it replaces.
--
-- ONE FUNCTION IS DELIBERATELY LEFT ALONE
--   auto_set_representative_id stamps NEW.representative_id with the creator
--   when that creator is a representative, and that column feeds commission.
--   The plan puts case registration in the coordinator's hands (section 4.3,
--   /case-registration) but never says the coordinator earns a
--   representative's commission on what they register -- and reading it that
--   way would quietly move money. Orders a coordinator registers therefore
--   carry no representative_id unless one is chosen explicitly, which is the
--   reversible default: assigning it later is a field edit, un-assigning it
--   after commissions have accrued is not.
--
--   THIS IS THE ONE ASSUMPTION IN THIS MIGRATION THAT WAS NOT DECIDED IN THE
--   PLAN. If a coordinator should in fact be stamped, that is a one-line
--   follow-up here plus a decision recorded in section 7.
--
-- PURELY ADDITIVE, as in 2a: every change widens a role list. Nothing is
-- revoked, no row is written, and 'representative' keeps everything it had.
--
-- To review only what changed:  grep -n "'coordinator'" <this file>

BEGIN;

-- ═══ Functions (13) ═══

CREATE OR REPLACE FUNCTION public.apply_order_issue_transition_v2(p_order_id uuid, p_operation text, p_reason text, p_idempotency_key uuid, p_doctor_decision text DEFAULT NULL::text, p_custom_doctor_amount numeric DEFAULT NULL::numeric, p_user_name text DEFAULT NULL::text, p_cause_category text DEFAULT NULL::text, p_responsible_stage text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
    IF v_role NOT IN ('admin', 'representative', 'coordinator') OR v_user_id IS NULL THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.apply_order_rejection_atomic(p_order_id uuid, p_target_status text, p_issue_state text, p_doctor_decision text, p_custom_doctor_amount numeric DEFAULT NULL::numeric, p_comment text DEFAULT NULL::text, p_user_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_order public.orders%ROWTYPE;
    v_doctor_amount NUMERIC(12, 2);
    v_review_status TEXT;
    v_result JSONB;
    v_profile_id UUID;
BEGIN
    IF v_role NOT IN ('admin', 'representative', 'coordinator') THEN
        RAISE EXCEPTION 'Only admin or representative can record an order rejection';
    END IF;

    IF p_target_status NOT IN ('Doctor Rejected', 'Lab Rejected') THEN
        RAISE EXCEPTION 'Invalid rejection target status';
    END IF;

    IF p_issue_state NOT IN ('doctor_rejected', 'lab_rejected') THEN
        RAISE EXCEPTION 'Invalid rejection issue state';
    END IF;

    IF (p_target_status = 'Doctor Rejected' AND p_issue_state <> 'doctor_rejected')
       OR (p_target_status = 'Lab Rejected' AND p_issue_state <> 'lab_rejected') THEN
        RAISE EXCEPTION 'Rejection status and issue state do not match';
    END IF;

    IF p_doctor_decision NOT IN ('decide_later', 'full_price', 'zero', 'custom_amount') THEN
        RAISE EXCEPTION 'Invalid doctor rejection decision';
    END IF;

    SELECT *
    INTO v_order
    FROM public.orders
    WHERE id = p_order_id
      AND COALESCE(is_deleted, FALSE) = FALSE
      AND (
          v_role = 'admin'
          OR v_role = 'coordinator'
          OR (
              v_role = 'representative'
              AND representative_id = public.get_my_user_id()
          )
      )
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found or access denied';
    END IF;

    v_doctor_amount := CASE p_doctor_decision
        WHEN 'decide_later' THEN COALESCE(v_order.total_price, 0)
        WHEN 'full_price' THEN COALESCE(v_order.total_price, 0)
        WHEN 'zero' THEN 0
        WHEN 'custom_amount' THEN p_custom_doctor_amount
    END;

    IF v_doctor_amount IS NULL
       OR v_doctor_amount < 0
       OR v_doctor_amount > COALESCE(v_order.total_price, 0) THEN
        RAISE EXCEPTION 'Doctor rejection amount must be between zero and the order total';
    END IF;

    v_review_status := CASE
        WHEN p_doctor_decision = 'decide_later' THEN 'pending'
        ELSE 'resolved'
    END;

    SELECT id
    INTO v_profile_id
    FROM public.users
    WHERE auth_id = auth.uid()
    LIMIT 1;

    PERFORM set_config('app.order_rejection_in_progress', 'true', true);

    UPDATE public.orders
    SET status = p_target_status,
        production_status = 'not_started',
        issue_state = p_issue_state,
        actual_delivery_date = NULL,
        rejected_lab_cost = NULL,
        rejected_designer_cost = NULL,
        rejection_doctor_decision = p_doctor_decision,
        rejected_doctor_amount = v_doctor_amount,
        rejection_financial_review_status = v_review_status,
        rejected_lab_cost_status = CASE
            WHEN supplier_id IS NULL THEN 'not_applicable'
            ELSE 'pending'
        END,
        rejected_designer_cost_status = CASE
            WHEN designer_id IS NULL THEN 'not_applicable'
            ELSE 'pending'
        END,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_order_id;

    IF NULLIF(btrim(p_comment), '') IS NOT NULL THEN
        INSERT INTO public.order_comments (
            order_id,
            content,
            user_id,
            user_name,
            created_at
        )
        VALUES (
            p_order_id,
            btrim(p_comment),
            v_profile_id,
            COALESCE(NULLIF(btrim(p_user_name), ''), 'User'),
            timezone('utc'::text, now())
        );
    END IF;

    SELECT to_jsonb(o.*)
    INTO v_result
    FROM public.orders o
    WHERE o.id = p_order_id;

    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_redo_order_atomic(p_original_order_id uuid, p_reason_code text, p_notes text, p_rejected_lab_cost numeric DEFAULT NULL::numeric, p_rejected_designer_cost numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_original public.orders%ROWTYPE;
    v_owner_doctor public.doctors%ROWTYPE;
    v_profile_id UUID;
    v_actor_name TEXT;
    v_business_date DATE := timezone('Africa/Cairo', now())::DATE;
    v_year INTEGER;
    v_sequence INTEGER;
    v_case_id TEXT;
    v_new_order_id UUID;
    v_reason_label TEXT;
    v_comment TEXT;
BEGIN
    IF v_role NOT IN ('admin', 'representative', 'coordinator') THEN
        RAISE EXCEPTION 'Only admin or representative can create a redo order';
    END IF;

    IF p_reason_code NOT IN (
        'lab_error', 'design_error', 'doctor_change', 'scan_issue', 'other'
    ) THEN
        RAISE EXCEPTION 'Invalid redo reason';
    END IF;

    IF NULLIF(btrim(p_notes), '') IS NULL THEN
        RAISE EXCEPTION 'Redo notes are required';
    END IF;

    IF p_rejected_lab_cost IS NOT NULL AND p_rejected_lab_cost < 0 THEN
        RAISE EXCEPTION 'Redo supplier cost cannot be negative';
    END IF;

    IF p_rejected_designer_cost IS NOT NULL AND p_rejected_designer_cost < 0 THEN
        RAISE EXCEPTION 'Redo designer cost cannot be negative';
    END IF;

    SELECT *
    INTO v_original
    FROM public.orders
    WHERE id = p_original_order_id
      AND COALESCE(is_deleted, FALSE) = FALSE
      AND (
          v_role = 'admin'
          OR representative_id = public.get_my_user_id()
      )
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found or access denied';
    END IF;

    IF COALESCE(v_original.issue_state, 'none') IN ('cancelled', 'redo') THEN
        RAISE EXCEPTION 'Cancelled or already-redone orders cannot create another redo';
    END IF;

    IF p_rejected_lab_cost IS NOT NULL AND v_original.supplier_id IS NULL THEN
        RAISE EXCEPTION 'Redo supplier cost requires an assigned supplier';
    END IF;

    IF p_rejected_designer_cost IS NOT NULL AND v_original.designer_id IS NULL THEN
        RAISE EXCEPTION 'Redo designer cost requires an assigned designer';
    END IF;

    SELECT id, name
    INTO v_profile_id, v_actor_name
    FROM public.users
    WHERE auth_id = auth.uid()
    LIMIT 1;

    SELECT owner.*
    INTO v_owner_doctor
    FROM public.doctors current_doctor
    JOIN public.doctors owner
      ON owner.id = COALESCE(current_doctor.parent_id, current_doctor.id)
    WHERE current_doctor.id = v_original.doctor_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order doctor is missing';
    END IF;

    v_year := EXTRACT(YEAR FROM v_business_date)::INTEGER;

    -- Serialize yearly numbering for the owning doctor/center. The unique
    -- case_id constraint remains the final guard, and the loop handles gaps or
    -- retained ids from soft-deleted orders.
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'redo-case:' || v_owner_doctor.id::TEXT || ':' || v_year::TEXT,
            0
        )
    );

    SELECT COUNT(*)::INTEGER + 1
    INTO v_sequence
    FROM public.orders order_row
    WHERE timezone('Africa/Cairo', order_row.created_at)::DATE
              BETWEEN make_date(v_year, 1, 1) AND make_date(v_year, 12, 31)
      AND COALESCE(order_row.is_deleted, FALSE) = FALSE
      AND (
          order_row.doctor_id = v_owner_doctor.id
          OR (
              COALESCE(v_owner_doctor.is_center, FALSE)
              AND order_row.doctor_id IN (
                  SELECT child.id
                  FROM public.doctors child
                  WHERE child.parent_id = v_owner_doctor.id
              )
          )
      );

    LOOP
        v_case_id := v_owner_doctor.doctor_code
            || '-' || to_char(v_business_date, 'YYMMDD')
            || '-' || (500 + GREATEST(1, v_sequence))::TEXT;
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.orders WHERE case_id = v_case_id
        );
        v_sequence := v_sequence + 1;
    END LOOP;

    v_reason_label := CASE p_reason_code
        WHEN 'lab_error' THEN 'خطأ في المعمل'
        WHEN 'design_error' THEN 'خطأ في التصميم'
        WHEN 'doctor_change' THEN 'تغيير طلب الدكتور'
        WHEN 'scan_issue' THEN 'مشكلة في السكان'
        ELSE 'أخرى'
    END;
    v_comment := 'إعادة إنتاج من #' || v_original.case_id
        || ' — السبب: ' || v_reason_label || ' — ' || btrim(p_notes);

    -- Reuse the approved rejection bypass so representative-trigger guards do
    -- not split this security-definer transaction.
    PERFORM set_config('app.order_rejection_in_progress', 'true', true);

    UPDATE public.orders
    SET status = 'Doctor Rejected',
        production_status = 'not_started',
        issue_state = 'redo',
        actual_delivery_date = NULL,
        rejection_doctor_decision = NULL,
        rejected_doctor_amount = NULL,
        rejection_financial_review_status = NULL,
        rejected_lab_cost = p_rejected_lab_cost,
        rejected_lab_cost_status = CASE
            WHEN supplier_id IS NULL THEN 'not_applicable'
            WHEN p_rejected_lab_cost IS NULL THEN 'pending'
            ELSE 'resolved'
        END,
        rejected_designer_cost = p_rejected_designer_cost,
        rejected_designer_cost_status = CASE
            WHEN designer_id IS NULL THEN 'not_applicable'
            WHEN p_rejected_designer_cost IS NULL THEN 'pending'
            ELSE 'resolved'
        END,
        updated_at = timezone('utc', now())
    WHERE id = v_original.id;

    INSERT INTO public.orders (
        case_id, doctor_id, branch_name, patient_name, items, discount,
        total_price, shade, status, delivery_date, cost, manual_cost, stl_url,
        images_url, supplier_id, instructions, priority, delivery_type,
        needs_design_review, technician_status, is_urgent, comments,
        representative_id, is_registered, workflow_type, designer_id,
        design_url, design_status, design_price, manual_design_price,
        actual_delivery_date, feedback, is_redo, original_order_id,
        status_history, is_archived, is_deleted, rejected_lab_cost,
        rejected_designer_cost, rejection_doctor_decision,
        rejected_doctor_amount, rejection_financial_review_status,
        rejected_lab_cost_status, rejected_designer_cost_status,
        production_status, issue_state
    ) VALUES (
        v_case_id, v_original.doctor_id, v_original.branch_name,
        v_original.patient_name, COALESCE(v_original.items, '[]'::JSONB),
        COALESCE(v_original.discount, 0), COALESCE(v_original.total_price, 0),
        COALESCE(v_original.shade, ''), 'New Case', v_original.delivery_date,
        COALESCE(v_original.cost, 0), v_original.manual_cost,
        v_original.stl_url, v_original.images_url, v_original.supplier_id,
        v_original.instructions, COALESCE(v_original.priority, 'Normal'),
        v_original.delivery_type, COALESCE(v_original.needs_design_review, FALSE),
        'Pending', COALESCE(v_original.is_urgent, FALSE),
        jsonb_build_array(jsonb_build_object(
            'id', gen_random_uuid()::TEXT,
            'text', v_comment,
            'userId', 'system',
            'userName', 'النظام',
            'createdAt', timezone('utc', now())
        )),
        v_original.representative_id, FALSE, v_original.workflow_type,
        v_original.designer_id, v_original.design_url,
        CASE WHEN v_original.workflow_type = 'split' THEN 'pending' ELSE NULL END,
        COALESCE(v_original.design_price, 0), v_original.manual_design_price,
        NULL, NULL, TRUE, v_original.id, '[]'::JSONB, FALSE, FALSE,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'not_started', 'none'
    )
    RETURNING id INTO v_new_order_id;

    INSERT INTO public.order_items (
        order_id, product_type, teeth_numbers, shade, price, count
    )
    SELECT
        v_new_order_id, product_type, teeth_numbers, shade, price, count
    FROM public.order_items
    WHERE order_id = v_original.id;

    INSERT INTO public.order_comments (
        order_id, content, user_id, user_name, created_at
    ) VALUES
        (v_original.id, v_comment, v_profile_id,
         COALESCE(v_actor_name, 'User'), timezone('utc', now())),
        (v_new_order_id, v_comment, NULL,
         'النظام', timezone('utc', now()));

    INSERT INTO public.order_events (
        order_id, event_type, old_value, new_value, changed_by, actor_role,
        reason, notes, severity, responsibility_party, metadata
    ) VALUES (
        v_original.id, 'remake_requested',
        COALESCE(v_original.issue_state, 'none'), 'redo',
        v_profile_id, v_role, p_reason_code, btrim(p_notes), 'warning',
        CASE p_reason_code
            WHEN 'lab_error' THEN 'external_lab'
            WHEN 'design_error' THEN 'designer'
            WHEN 'doctor_change' THEN 'doctor'
            WHEN 'scan_issue' THEN 'scan'
            ELSE 'unknown'
        END,
        jsonb_build_object(
            'originalCaseId', v_original.case_id,
            'redoOrderId', v_new_order_id,
            'redoCaseId', v_case_id,
            'rejectedLabCost', p_rejected_lab_cost,
            'rejectedDesignerCost', p_rejected_designer_cost,
            'atomicRedo', TRUE
        )
    ), (
        v_new_order_id, 'order_created', NULL, 'New Case',
        v_profile_id, v_role, p_reason_code, btrim(p_notes), 'info', NULL,
        jsonb_build_object(
            'caseId', v_case_id,
            'originalOrderId', v_original.id,
            'originalCaseId', v_original.case_id,
            'isRedo', TRUE,
            'atomicRedo', TRUE
        )
    );

    RETURN jsonb_build_object(
        'originalOrderId', v_original.id,
        'originalCaseId', v_original.case_id,
        'newOrderId', v_new_order_id,
        'newCaseId', v_case_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_redo_order_atomic_v2(p_original_order_id uuid, p_reason_code text, p_notes text, p_doctor_decision text, p_custom_doctor_amount numeric, p_idempotency_key uuid, p_cause_category text DEFAULT NULL::text, p_responsible_stage text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
    IF v_role NOT IN ('admin', 'representative', 'coordinator') OR v_profile_id IS NULL THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.get_doctors_activity_analytics(p_representative_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(doctor_id uuid, doctor_name text, parent_name text, doctor_phone text, doctor_phone2 text, doctor_code text, representative_name text, representative_id uuid, first_order_date date, last_order_date date, days_since_last_order integer, total_orders_count integer, valid_orders_count integer, average_monthly_orders_count numeric, average_monthly_orders_value numeric, orders_count_last_30_days integer, orders_value_last_30_days numeric, orders_count_last_60_days integer, orders_value_last_60_days numeric, change_percentage_count numeric, change_percentage_value numeric, rejected_orders_count integer, rejected_orders_value numeric, rejected_orders_count_30 integer, rejected_orders_value_30 numeric, rejected_ratio_pct numeric, last_case_patient text, last_case_code text, calculated_segment text, last_follow_up_date timestamp with time zone, last_follow_up_notes text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_one_case_days INT;
    v_new_days INT;
    v_rec_churn_min_days INT;
    v_long_days INT;
    v_dec_pct NUMERIC;
    v_gro_pct NUMERIC;
    v_my_role TEXT;
    v_my_user_id UUID;
BEGIN
    -- جلب قيم الإعدادات المتغيرة
    SELECT 
        one_case_churn_days, new_client_days, recently_churned_min_days, 
        long_term_churn_days, decline_threshold_pct, growth_threshold_pct
    INTO 
        v_one_case_days, v_new_days, v_rec_churn_min_days, 
        v_long_days, v_dec_pct, v_gro_pct
    FROM doctor_retention_settings
    LIMIT 1;

    -- جلب صلاحيات وهوية المستخدم الحالي لعزل البيانات
    v_my_role := get_my_role();
    v_my_user_id := get_my_user_id();

    RETURN QUERY
    WITH doctor_order_stats AS (
        -- احتساب التواريخ والأعداد للأوردرات الصالحة والمرفوضة
        SELECT 
            o.doctor_id,
            -- الطلبات الصالحة (المستثنى منها المرفوض والملغي)
            MIN(o.created_at::date) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled'))::date AS first_date,
            MAX(o.created_at::date) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled'))::date AS last_date,
            
            -- الإجماليات
            COUNT(o.id)::int AS total_cnt,
            COUNT(o.id) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled'))::int AS valid_cnt,
            
            -- إجمالي قيم الطلبات الصالحة تاريخياً بالكامل (تستخدم في المتوسط الشهري المالي التاريخي)
            COALESCE(SUM(o.total_price) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled')), 0)::numeric AS total_val,
            
            -- آخر حالة صالحة
            (ARRAY_AGG(o.patient_name ORDER BY o.created_at DESC) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled')))[1] AS last_patient,
            (ARRAY_AGG(o.case_id ORDER BY o.created_at DESC) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled')))[1] AS last_code,
            
            -- آخر 30 يوم (صالح)
            COUNT(o.id) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled') AND o.created_at >= (NOW() - INTERVAL '30 days'))::int AS last_30_cnt,
            COALESCE(SUM(o.total_price) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled') AND o.created_at >= (NOW() - INTERVAL '30 days')), 0)::numeric AS last_30_val,
            
            -- آخر 60 يوم (صالح)
            COUNT(o.id) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled') AND o.created_at >= (NOW() - INTERVAL '60 days'))::int AS last_60_cnt,
            COALESCE(SUM(o.total_price) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled') AND o.created_at >= (NOW() - INTERVAL '60 days')), 0)::numeric AS last_60_val,
            
            -- الطلبات المرفوضة والملغاة
            COUNT(o.id) FILTER (WHERE o.status IN ('Doctor Rejected', 'Cancelled'))::int AS rej_cnt,
            COALESCE(SUM(o.total_price) FILTER (WHERE o.status IN ('Doctor Rejected', 'Cancelled')), 0)::numeric AS rej_val,
            COUNT(o.id) FILTER (WHERE o.status IN ('Doctor Rejected', 'Cancelled') AND o.created_at >= (NOW() - INTERVAL '30 days'))::int AS rej_30_cnt,
            COALESCE(SUM(o.total_price) FILTER (WHERE o.status IN ('Doctor Rejected', 'Cancelled') AND o.created_at >= (NOW() - INTERVAL '30 days')), 0)::numeric AS rej_30_val
            
        FROM orders o
        WHERE COALESCE(o.is_deleted, false) = false
        GROUP BY o.doctor_id
    ),
    doctor_metrics AS (
        -- تجميع البيانات وتطبيق عزل مناديب المبيعات (RLS) مع حماية COALESCE للأصفار للعملاء الجدد تماماً
        SELECT 
            d.id AS d_id,
            d.name AS d_name,
            p.name AS parent_name,
            d.phone AS d_phone,
            d.phone2 AS d_phone2,
            d.doctor_code AS d_code,
            d.representative_name AS d_rep_name,
            d.representative_id AS d_rep_id,
            stats.first_date,
            stats.last_date,
            (CURRENT_DATE - stats.last_date)::int AS days_idle,
            COALESCE(stats.total_cnt, 0) AS total_cnt,
            COALESCE(stats.valid_cnt, 0) AS valid_cnt,
            COALESCE(stats.total_val, 0)::numeric AS total_val,
            stats.last_patient,
            stats.last_code,
            COALESCE(stats.last_30_cnt, 0)::int AS last_30_cnt,
            COALESCE(stats.last_30_val, 0)::numeric AS last_30_val,
            COALESCE(stats.last_60_cnt, 0)::int AS last_60_cnt,
            COALESCE(stats.last_60_val, 0)::numeric AS last_60_val,
            COALESCE(stats.rej_cnt, 0)::int AS rej_cnt,
            COALESCE(stats.rej_val, 0)::numeric AS rej_val,
            COALESCE(stats.rej_30_cnt, 0)::int AS rej_30_cnt,
            COALESCE(stats.rej_30_val, 0)::numeric AS rej_30_val,
            d.last_follow_up_date AS f_date,
            d.last_follow_up_notes AS f_notes,
            -- حساب الشهور النشطة بناءً على التواريخ الصالحة
            GREATEST(1.0, ROUND((stats.last_date - stats.first_date)::numeric / 30.0, 1)) AS active_months
        FROM doctors d
        LEFT JOIN doctors p ON d.parent_id = p.id
        LEFT JOIN doctor_order_stats stats ON stats.doctor_id = d.id
        WHERE 
            (v_my_role IN ('admin', 'representative', 'coordinator'))
            AND (p_representative_id IS NULL OR d.representative_id = p_representative_id)
            -- استثناء المراكز الرئيسية التي لديها أطباء فرعيون لمنع ظهور حاويات فارغة
            AND NOT (d.is_center = true AND EXISTS (
                SELECT 1 FROM doctors WHERE parent_id = d.id
            ))
    )
    SELECT 
        m.d_id,
        m.d_name,
        m.parent_name,
        m.d_phone,
        m.d_phone2,
        m.d_code,
        m.d_rep_name,
        m.d_rep_id,
        m.first_date,
        m.last_date,
        m.days_idle,
        
        -- حجم الأعمال
        m.total_cnt,
        m.valid_cnt,
        ROUND(m.valid_cnt / m.active_months, 1) AS average_monthly_orders_count,
        ROUND(m.total_val / m.active_months, 2) AS average_monthly_orders_value,
        m.last_30_cnt,
        m.last_30_val,
        m.last_60_cnt,
        m.last_60_val,
        
        -- نسبة التغير (العدد والقيمة - محسوبة مقارنة بالمتوسط التاريخي الكامل)
        CASE 
            WHEN m.valid_cnt = 0 THEN 0::numeric
            ELSE ROUND(((m.last_30_cnt - (m.valid_cnt / m.active_months)) / GREATEST((m.valid_cnt / m.active_months), 1.0)) * 100, 1)
        END AS change_percentage_count,
        CASE 
            WHEN m.valid_cnt = 0 OR m.total_val = 0 THEN 0::numeric
            ELSE ROUND(((m.last_30_val - (m.total_val / m.active_months)) / GREATEST((m.total_val / m.active_months), 1.0)) * 100, 1)
        END AS change_percentage_value,
        
        -- المرفوضات
        m.rej_cnt,
        m.rej_val,
        m.rej_30_cnt,
        m.rej_30_val,
        CASE 
            WHEN m.total_cnt = 0 THEN 0::numeric
            ELSE ROUND((m.rej_cnt::numeric / m.total_cnt) * 100, 1)
        END AS rejected_ratio_pct,
        
        m.last_patient,
        m.last_code,
        
        -- تصنيف الشريحة تلقائياً
        CASE 
            WHEN m.total_cnt = 0 THEN 'needs_activation'
            WHEN m.total_cnt > 0 AND m.valid_cnt = 0 THEN 'rejected_only'
            WHEN m.valid_cnt = 1 AND m.days_idle > v_one_case_days THEN 'one_case_churned'
            WHEN m.days_idle > v_long_days THEN 'long_term_churned'
            WHEN m.days_idle >= v_rec_churn_min_days THEN 'recently_churned'
            WHEN m.first_date >= (CURRENT_DATE - v_new_days) THEN 'new'
            
            -- فحص التراجع المؤكد أولاً (تناسق المقياس: تراجع عددي مؤكد في الفترتين أو تراجع مالي مؤكد في الفترتين)
            WHEN (
                (
                    (m.last_30_cnt - (m.valid_cnt / m.active_months)) / GREATEST((m.valid_cnt / m.active_months), 1.0) <= -(v_dec_pct/100.0)
                    AND (m.last_60_cnt - (2 * (m.valid_cnt / m.active_months))) / GREATEST((2 * (m.valid_cnt / m.active_months)), 1.0) <= -(v_dec_pct/100.0)
                ) OR (
                    (m.last_30_val - (m.total_val / m.active_months)) / GREATEST((m.total_val / m.active_months), 1.0) <= -(v_dec_pct/100.0)
                    AND (m.last_60_val - (2 * (m.total_val / m.active_months))) / GREATEST((2 * (m.total_val / m.active_months)), 1.0) <= -(v_dec_pct/100.0)
                )
            ) THEN 'declining_confirmed'
            
            -- فحص التراجع المبكر ثانياً (تناسق المقياس: تراجع عددي أو مالي في آخر 30 يوماً فقط)
            WHEN (
                (m.last_30_cnt - (m.valid_cnt / m.active_months)) / GREATEST((m.valid_cnt / m.active_months), 1.0) <= -(v_dec_pct/100.0)
                OR (m.last_30_val - (m.total_val / m.active_months)) / GREATEST((m.total_val / m.active_months), 1.0) <= -(v_dec_pct/100.0)
            ) THEN 'declining_early'
            
            -- فحص النمو
            WHEN (
                (m.last_30_cnt - (m.valid_cnt / m.active_months)) / GREATEST((m.valid_cnt / m.active_months), 1.0) >= (v_gro_pct/100.0)
                OR (m.last_30_val - (m.total_val / m.active_months)) / GREATEST((m.total_val / m.active_months), 1.0) >= (v_gro_pct/100.0)
            ) THEN 'growing'
            
            ELSE 'stable'
        END AS calculated_segment,
        m.f_date,
        m.f_notes
    FROM doctor_metrics m
    ORDER BY calculated_segment DESC, m.days_idle DESC NULLS LAST;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_todays_follow_ups()
 RETURNS TABLE(id uuid, doctor_id uuid, contacted_at timestamp with time zone, contacted_by uuid, notes text, status text, next_follow_up_date date, created_at timestamp with time zone, doctor_name text, parent_name text, doctor_phone text, doctor_phone2 text, doctor_code text, representative_id uuid, representative_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_my_role TEXT;
    v_my_user_id UUID;
BEGIN
    v_my_role := get_my_role();
    v_my_user_id := get_my_user_id();

    RETURN QUERY
    WITH latest_follow_ups AS (
        SELECT DISTINCT ON (f.doctor_id)
            f.id,
            f.doctor_id,
            f.contacted_at,
            f.contacted_by,
            f.notes,
            f.status,
            f.next_follow_up_date,
            f.created_at
        FROM doctor_follow_ups f
        ORDER BY f.doctor_id, f.created_at DESC
    )
    SELECT 
        lf.id,
        lf.doctor_id,
        lf.contacted_at,
        lf.contacted_by,
        lf.notes,
        lf.status,
        lf.next_follow_up_date,
        lf.created_at,
        d.name AS doctor_name,
        p.name AS parent_name,
        d.phone AS doctor_phone,
        d.phone2 AS doctor_phone2,
        d.doctor_code,
        d.representative_id,
        d.representative_name
    FROM latest_follow_ups lf
    JOIN doctors d ON d.id = lf.doctor_id
    LEFT JOIN doctors p ON d.parent_id = p.id
    WHERE 
        lf.next_follow_up_date <= CURRENT_DATE
        AND (v_my_role IN ('admin', 'representative', 'coordinator'))
        -- استثناء المراكز الرئيسية التي لديها أطباء فرعيون لمنع ظهورها كحاويات فارغة
        AND NOT (d.is_center = true AND EXISTS (
            SELECT 1 FROM doctors WHERE parent_id = d.id
        ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_order_issue_transition_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
    IF v_role NOT IN ('admin', 'representative', 'coordinator') THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.guard_rejected_designer_cost_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_operation TEXT := current_setting('app.order_issue_operation', true);
    v_legacy_atomic_rejection BOOLEAN :=
        current_setting('app.order_rejection_in_progress', true) = 'true';
BEGIN
    IF NEW.rejected_designer_cost IS NOT DISTINCT FROM OLD.rejected_designer_cost THEN
        RETURN NEW;
    END IF;

    IF v_role IS NULL OR v_role = 'admin' OR v_legacy_atomic_rejection THEN
        RETURN NEW;
    END IF;

    IF v_role = ANY (ARRAY['representative', 'coordinator'])
       AND v_operation IN (
           'cancel_order',
           'return_for_adjustment',
           'doctor_reject_order',
           'create_redo',
           'approve_designer_rejection'
       ) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Only admin can update rejected designer cost';
END;
$function$;

CREATE OR REPLACE FUNCTION public.orders_role_field_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_operation TEXT := current_setting('app.order_issue_operation', true);
    v_strict_rep TEXT;
    v_audit_flag TEXT := current_setting('app.rep_audit_in_progress', true);
BEGIN
    IF v_role IS NULL OR v_role = 'admin' THEN RETURN NEW; END IF;

    -- These bypasses are narrow and are revalidated by the V2 transition guard.
    IF v_role = ANY (ARRAY['representative', 'coordinator']) AND v_operation IN (
        'cancel_order', 'return_for_adjustment', 'doctor_reject_order',
        'create_redo', 'approve_designer_rejection'
    ) THEN RETURN NEW; END IF;
    IF v_role = 'designer' AND v_operation IN ('submit_design') THEN RETURN NEW; END IF;
    IF v_role = 'lab' AND v_operation IN ('record_final_delivery', 'submit_design') THEN RETURN NEW; END IF;

    IF v_role = 'lab' THEN
        IF NEW.issue_state IN ('doctor_rejected', 'lab_rejected', 'cancelled', 'redo')
           AND OLD.issue_state IS DISTINCT FROM NEW.issue_state THEN
            RAISE EXCEPTION 'lab role cannot apply issue transition %', NEW.issue_state;
        END IF;
        RETURN NEW;
    END IF;

    IF v_role = ANY (ARRAY['accountant', 'coordinator']) THEN
        IF NEW.production_status IS DISTINCT FROM OLD.production_status
           OR NEW.issue_state IS DISTINCT FROM OLD.issue_state
           OR NEW.actual_delivery_date IS DISTINCT FROM OLD.actual_delivery_date
           OR NEW.first_delivered_at IS DISTINCT FROM OLD.first_delivered_at
           OR NEW.design_submitted_at IS DISTINCT FROM OLD.design_submitted_at THEN
            RAISE EXCEPTION 'accountant cannot change workflow or delivery fields';
        END IF;
        RETURN NEW;
    END IF;

    IF v_role = 'designer' THEN
        IF NEW.total_price IS DISTINCT FROM OLD.total_price
           OR NEW.cost IS DISTINCT FROM OLD.cost
           OR NEW.manual_cost IS DISTINCT FROM OLD.manual_cost
           OR NEW.manual_design_price IS DISTINCT FROM OLD.manual_design_price
           OR NEW.discount IS DISTINCT FROM OLD.discount
           OR NEW.rejected_lab_cost IS DISTINCT FROM OLD.rejected_lab_cost
           OR NEW.rejected_designer_cost IS DISTINCT FROM OLD.rejected_designer_cost
           OR NEW.rejected_doctor_amount IS DISTINCT FROM OLD.rejected_doctor_amount
           OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
           OR NEW.representative_id IS DISTINCT FROM OLD.representative_id
           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
           OR NEW.designer_id IS DISTINCT FROM OLD.designer_id
           OR NEW.items IS DISTINCT FROM OLD.items
           OR NEW.delivery_type IS DISTINCT FROM OLD.delivery_type
           OR NEW.actual_delivery_date IS DISTINCT FROM OLD.actual_delivery_date
           OR NEW.first_delivered_at IS DISTINCT FROM OLD.first_delivered_at
           OR NEW.issue_state IS DISTINCT FROM OLD.issue_state THEN
            RAISE EXCEPTION 'designer cannot change protected order fields';
        END IF;
        RETURN NEW;
    END IF;

    IF v_role = 'representative' THEN
        SELECT value INTO v_strict_rep FROM public.app_settings WHERE key = 'workflow_strict_rep';
        IF v_strict_rep IS DISTINCT FROM 'on' THEN RETURN NEW; END IF;

        IF NEW.patient_name IS DISTINCT FROM OLD.patient_name
           OR NEW.stl_url IS DISTINCT FROM OLD.stl_url
           OR NEW.images_url IS DISTINCT FROM OLD.images_url
           OR NEW.delivery_date IS DISTINCT FROM OLD.delivery_date
           OR NEW.is_urgent IS DISTINCT FROM OLD.is_urgent
           OR NEW.priority IS DISTINCT FROM OLD.priority
           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
           OR NEW.designer_id IS DISTINCT FROM OLD.designer_id
           OR NEW.instructions IS DISTINCT FROM OLD.instructions
           OR NEW.items IS DISTINCT FROM OLD.items
           OR NEW.total_price IS DISTINCT FROM OLD.total_price
           OR NEW.cost IS DISTINCT FROM OLD.cost
           OR NEW.design_price IS DISTINCT FROM OLD.design_price
           OR NEW.discount IS DISTINCT FROM OLD.discount
           OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
           OR NEW.representative_id IS DISTINCT FROM OLD.representative_id
           OR NEW.workflow_type IS DISTINCT FROM OLD.workflow_type
           OR NEW.is_archived IS DISTINCT FROM OLD.is_archived
           OR NEW.case_id IS DISTINCT FROM OLD.case_id
           OR NEW.is_registered IS DISTINCT FROM OLD.is_registered
           OR NEW.feedback IS DISTINCT FROM OLD.feedback THEN
            IF v_audit_flag IS DISTINCT FROM 'true' THEN
                RAISE EXCEPTION 'representative protected edits require the audited RPC';
            END IF;
        END IF;

        IF (NEW.total_price IS DISTINCT FROM OLD.total_price
                AND NEW.items IS NOT DISTINCT FROM OLD.items)
           OR (NEW.cost IS DISTINCT FROM OLD.cost
                AND NEW.items IS NOT DISTINCT FROM OLD.items
                AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id
                AND NEW.designer_id IS NOT DISTINCT FROM OLD.designer_id)
           OR (NEW.design_price IS DISTINCT FROM OLD.design_price
                AND NEW.items IS NOT DISTINCT FROM OLD.items
                AND NEW.designer_id IS NOT DISTINCT FROM OLD.designer_id)
           OR NEW.manual_cost IS DISTINCT FROM OLD.manual_cost
           OR NEW.manual_design_price IS DISTINCT FROM OLD.manual_design_price
           OR NEW.discount IS DISTINCT FROM OLD.discount
           OR NEW.rejected_lab_cost IS DISTINCT FROM OLD.rejected_lab_cost
           OR NEW.rejected_designer_cost IS DISTINCT FROM OLD.rejected_designer_cost
           OR NEW.rejected_doctor_amount IS DISTINCT FROM OLD.rejected_doctor_amount
           OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
           OR NEW.representative_id IS DISTINCT FROM OLD.representative_id
           OR NEW.workflow_type IS DISTINCT FROM OLD.workflow_type
           OR NEW.is_archived IS DISTINCT FROM OLD.is_archived
           OR NEW.case_id IS DISTINCT FROM OLD.case_id
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR NEW.is_registered IS DISTINCT FROM OLD.is_registered THEN
            RAISE EXCEPTION 'representative cannot change protected finance or identity fields';
        END IF;
        IF NEW.issue_state IN ('doctor_rejected', 'lab_rejected', 'cancelled', 'redo')
           AND OLD.issue_state IS DISTINCT FROM NEW.issue_state THEN
            RAISE EXCEPTION 'representative issue transitions require a V2 workflow RPC';
        END IF;
        RETURN NEW;
    END IF;

    IF v_role = 'doctor' THEN RAISE EXCEPTION 'doctor role cannot update orders directly'; END IF;
    RAISE EXCEPTION 'role % is not permitted to update orders', v_role;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_order_final_delivery_v2(p_order_id uuid, p_delivered_at timestamp with time zone, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := public.get_my_user_id();
    v_order public.orders%ROWTYPE;
    v_result JSONB;
    v_payload JSONB := jsonb_build_object('deliveredAt', p_delivered_at);
    v_command public.order_transition_commands%ROWTYPE;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN RAISE EXCEPTION 'Workflow V2 writes are disabled'; END IF;
    IF v_role NOT IN ('admin', 'lab', 'representative', 'coordinator') OR v_user_id IS NULL THEN
        RAISE EXCEPTION 'Only admin, lab, or representative can record final delivery';
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
$function$;

CREATE OR REPLACE FUNCTION public.rep_update_order_fields_with_audit(p_order_id uuid, p_changes jsonb, p_reason_code text, p_reason_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := get_my_role();
    v_user_id UUID;
    v_old orders%ROWTYPE;
    v_old_items JSONB;
    v_changed_keys TEXT[] := ARRAY(SELECT jsonb_object_keys(p_changes));
    -- Allowed keys.
    v_allowed_keys CONSTANT TEXT[] := ARRAY[
        'patient_name','stl_url','images_url','delivery_date',
        'is_urgent','priority','supplier_id','designer_id',
        'instructions','items','total_price','cost','design_price'
    ];
    v_allowed_reasons CONSTANT TEXT[] := ARRAY[
        'doctor_requested','wrong_intake_data','missing_info_completed',
        'scan_updated','images_updated','items_corrected','teeth_corrected',
        'delivery_rescheduled_doctor','delivery_rescheduled_lab',
        'urgent_doctor_requested','external_lab_reassigned',
        'designer_reassigned','internal_correction','other'
    ];
    v_key TEXT;
    v_event_type TEXT;
    v_old_text TEXT;
    v_new_text TEXT;
    v_metadata JSONB;
    v_severity TEXT;
    v_responsibility TEXT;
    v_prev_supplier_name TEXT;
    v_new_supplier_name TEXT;
    v_prev_designer_name TEXT;
    v_new_designer_name TEXT;
    v_new_value JSONB;
    v_pending_event_id UUID;
BEGIN
    -- 1. Auth.
    SELECT id INTO v_user_id FROM users WHERE auth_id = auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'unauthenticated';
    END IF;

    -- 2. Role check.
    IF v_role NOT IN ('representative', 'coordinator','admin','lab') THEN
        RAISE EXCEPTION 'role % cannot use this RPC', v_role;
    END IF;

    -- 3. Reason validation.
    IF p_reason_code IS NULL OR NOT (p_reason_code = ANY(v_allowed_reasons)) THEN
        RAISE EXCEPTION 'invalid reason_code: %', p_reason_code;
    END IF;
    IF p_reason_code = 'other' AND coalesce(btrim(p_reason_note),'') = '' THEN
        RAISE EXCEPTION 'reason_note required when reason_code=other';
    END IF;

    -- 4. Allow-list check.
    IF v_changed_keys IS NULL OR array_length(v_changed_keys, 1) IS NULL THEN
        RAISE EXCEPTION 'no changes provided';
    END IF;
    FOREACH v_key IN ARRAY v_changed_keys LOOP
        IF NOT (v_key = ANY(v_allowed_keys)) THEN
            RAISE EXCEPTION 'field % not in audited rep allow-list', v_key;
        END IF;
    END LOOP;

    -- 5. Lock OLD row.
    SELECT * INTO v_old FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'order % not found', p_order_id;
    END IF;

    -- 5b. Snapshot the services as they stand BEFORE the update.
    -- orders.items is a legacy JSON mirror that stays '[]' for every order created
    -- through the order_items table, so reading it straight made the audit's
    -- "before" column blank while "after" showed the new services. Prefer the
    -- order_items rows and fall back to the legacy column, exactly like
    -- dbToOrder() does on the client.
    SELECT COALESCE(
        (
            SELECT jsonb_agg(
                       jsonb_strip_nulls(jsonb_build_object(
                           'serviceType',  oi.product_type,
                           'teethNumbers', oi.teeth_numbers,
                           'price',        oi.price,
                           'shade',        oi.shade
                       ))
                       ORDER BY oi.created_at, oi.id
                   )
            FROM order_items oi
            WHERE oi.order_id = p_order_id
        ),
        v_old.items
    ) INTO v_old_items;

    -- 6. INTERCEPT IF DELIVERED & actor is representative.
    -- If delivered/completed, save/upsert pending proposal event.
    IF v_role = ANY (ARRAY['representative', 'coordinator']) AND (v_old.status IN ('Delivered', 'Completed') OR v_old.production_status = 'final_delivered') THEN
        v_metadata := jsonb_build_object(
            'changes', p_changes,
            'oldValues', jsonb_build_object(
                'patient_name', v_old.patient_name,
                'delivery_date', v_old.delivery_date::TEXT,
                'supplier_id', v_old.supplier_id::TEXT,
                'designer_id', v_old.designer_id::TEXT,
                'stl_url', v_old.stl_url,
                'images_url', v_old.images_url,
                'instructions', v_old.instructions,
                'items', v_old_items,
                'total_price', v_old.total_price::TEXT,
                'cost', v_old.cost::TEXT,
                'design_price', v_old.design_price::TEXT,
                'priority', v_old.priority,
                'is_urgent', v_old.is_urgent::TEXT
            ),
            'reasonCode', p_reason_code,
            'note', p_reason_note,
            'actorUserId', v_user_id,
            'actorRole', v_role
        );
        
        -- Check if there is already a pending proposal for this order
        SELECT id INTO v_pending_event_id 
        FROM order_events 
        WHERE order_id = p_order_id 
          AND event_type = 'order_edit_proposed' 
          AND approval_status = 'pending';
          
        IF v_pending_event_id IS NOT NULL THEN
            UPDATE order_events SET
                reason = p_reason_code,
                notes = p_reason_note,
                metadata = v_metadata,
                changed_at = now(),
                changed_by = v_user_id
            WHERE id = v_pending_event_id;
        ELSE
            INSERT INTO order_events (
                order_id, event_type, approval_status, changed_by, actor_role, reason, notes, metadata
            ) VALUES (
                p_order_id, 'order_edit_proposed', 'pending', v_user_id, v_role, p_reason_code, p_reason_note, v_metadata
            );
        END IF;
        
        RETURN p_order_id;
    END IF;

    -- 7. State guards for undelivered (representative only; admin/lab bypass).
    IF v_role = ANY (ARRAY['representative', 'coordinator']) THEN
        IF v_old.issue_state <> 'none' THEN
            RAISE EXCEPTION 'representative cannot edit while issue_state=%', v_old.issue_state;
        END IF;
        IF p_changes ? 'supplier_id'
           AND v_old.production_status IN ('final_ready','final_delivered') THEN
            RAISE EXCEPTION 'representative cannot reassign supplier after final_ready';
        END IF;
        IF p_changes ? 'designer_id' THEN
            IF v_old.production_status IN ('finalization','final_ready','final_delivered') THEN
                RAISE EXCEPTION 'representative cannot reassign designer after finalization';
            END IF;
            IF v_old.workflow_type IS DISTINCT FROM 'split' THEN
                RAISE EXCEPTION 'representative can only reassign designer in split workflow';
            END IF;
        END IF;
    END IF;

    -- 8. Resolve display names for assignment changes.
    IF p_changes ? 'supplier_id' THEN
        SELECT name INTO v_prev_supplier_name FROM suppliers WHERE id = v_old.supplier_id;
        SELECT name INTO v_new_supplier_name  FROM suppliers WHERE id = (p_changes->>'supplier_id')::UUID;
    END IF;
    IF p_changes ? 'designer_id' THEN
        SELECT name INTO v_prev_designer_name FROM users WHERE id = v_old.designer_id;
        SELECT name INTO v_new_designer_name  FROM users WHERE id = (p_changes->>'designer_id')::UUID;
    END IF;

    -- 9. Write one order_events row per changed field.
    FOREACH v_key IN ARRAY v_changed_keys LOOP
        -- Skip price/cost events directly, or log them as info if items is updated.
        IF v_key IN ('total_price', 'cost', 'design_price') THEN
            CONTINUE;
        END IF;

        v_event_type := CASE v_key
            WHEN 'patient_name'   THEN 'patient_name_changed'
            WHEN 'stl_url'        THEN 'stl_url_changed'
            WHEN 'images_url'     THEN 'images_url_changed'
            WHEN 'delivery_date'  THEN 'delivery_date_changed'
            WHEN 'is_urgent'      THEN 'urgency_changed'
            WHEN 'priority'       THEN 'priority_changed'
            WHEN 'supplier_id'    THEN 'supplier_changed'
            WHEN 'designer_id'    THEN 'designer_changed'
            WHEN 'instructions'   THEN 'instructions_changed'
            WHEN 'items'          THEN 'items_changed'
            ELSE 'order_field_changed'
        END;

        v_severity := CASE WHEN v_key IN ('supplier_id','designer_id') THEN 'warning' ELSE 'info' END;
        v_responsibility := CASE WHEN v_role = 'representative' THEN 'representative' ELSE NULL END;

        -- Scalar repr for the timeline UI.
        v_old_text := CASE v_key
            WHEN 'patient_name'   THEN v_old.patient_name
            WHEN 'stl_url'        THEN v_old.stl_url
            WHEN 'images_url'     THEN v_old.images_url
            WHEN 'delivery_date'  THEN v_old.delivery_date::TEXT
            WHEN 'is_urgent'      THEN v_old.is_urgent::TEXT
            WHEN 'priority'       THEN v_old.priority
            WHEN 'supplier_id'    THEN v_old.supplier_id::TEXT
            WHEN 'designer_id'    THEN v_old.designer_id::TEXT
            WHEN 'instructions'   THEN v_old.instructions
            WHEN 'items'          THEN v_old_items::TEXT
            ELSE NULL
        END;

        v_new_value := p_changes -> v_key;
        v_new_text := CASE jsonb_typeof(v_new_value)
            WHEN 'string'  THEN v_new_value #>> '{}'
            WHEN 'null'    THEN NULL
            WHEN 'boolean' THEN v_new_value::TEXT
            WHEN 'number'  THEN v_new_value::TEXT
            ELSE v_new_value::TEXT
        END;

        v_metadata := jsonb_build_object(
            'fieldName',   v_key,
            'oldValue',    to_jsonb(v_old_text),
            'newValue',    v_new_value,
            'reasonCode',  p_reason_code,
            'note',        p_reason_note,
            'source',      CASE v_role
                              WHEN 'representative' THEN 'representative_edit'
                              WHEN 'coordinator' THEN 'coordinator_edit'
                              WHEN 'admin' THEN 'admin_correction'
                              WHEN 'lab' THEN 'lab_operation'
                           END,
            'rpcVersion',  1,
            'actorUserId', v_user_id,
            'actorRole',   v_role
        );

        IF v_key = 'supplier_id' THEN
            v_metadata := v_metadata
                || jsonb_build_object(
                    'previousSupplierId',   v_old.supplier_id,
                    'newSupplierId',        (p_changes->>'supplier_id')::UUID,
                    'previousSupplierName', v_prev_supplier_name,
                    'newSupplierName',      v_new_supplier_name
                );
        ELSIF v_key = 'designer_id' THEN
            v_metadata := v_metadata
                || jsonb_build_object(
                    'previousDesignerId',   v_old.designer_id,
                    'newDesignerId',        (p_changes->>'designer_id')::UUID,
                    'previousDesignerName', v_prev_designer_name,
                    'newDesignerName',      v_new_designer_name
                );
        END IF;

        INSERT INTO order_events (
            order_id, event_type, old_value, new_value,
            changed_by, actor_role, reason, notes, severity,
            responsibility_party, metadata
        ) VALUES (
            p_order_id, v_event_type,
            CASE WHEN v_old_text IS NOT NULL THEN substring(v_old_text from 1 for 4000) ELSE NULL END,
            CASE WHEN v_new_text IS NOT NULL THEN substring(v_new_text from 1 for 4000) ELSE NULL END,
            v_user_id, v_role, p_reason_code, p_reason_note, v_severity,
            v_responsibility, v_metadata
        );
    END LOOP;

    -- Write a combined 'order_edit_applied' event for undelivered cases.
    v_metadata := jsonb_build_object(
        'changes', p_changes,
        'oldValues', jsonb_build_object(
            'patient_name', v_old.patient_name,
            'delivery_date', v_old.delivery_date::TEXT,
            'supplier_id', v_old.supplier_id::TEXT,
            'designer_id', v_old.designer_id::TEXT,
            'stl_url', v_old.stl_url,
            'images_url', v_old.images_url,
            'instructions', v_old.instructions,
            'items', v_old_items,
            'total_price', v_old.total_price::TEXT,
            'cost', v_old.cost::TEXT,
            'design_price', v_old.design_price::TEXT,
            'priority', v_old.priority,
            'is_urgent', v_old.is_urgent::TEXT
        ),
        'reasonCode', p_reason_code,
        'note', p_reason_note,
        'actorUserId', v_user_id,
        'actorRole', v_role
    );
    
    INSERT INTO order_events (
        order_id, event_type, approval_status, changed_by, actor_role, reason, notes, metadata
    ) VALUES (
        p_order_id, 'order_edit_applied', 'none', v_user_id, v_role, p_reason_code, p_reason_note, v_metadata
    );

    -- 10. Set tx-local audit flag for the trigger and apply UPDATE.
    PERFORM set_config('app.rep_audit_in_progress', 'true', true);

    UPDATE orders SET
        patient_name  = CASE WHEN p_changes ? 'patient_name'  THEN p_changes->>'patient_name'                       ELSE patient_name  END,
        stl_url       = CASE WHEN p_changes ? 'stl_url'       THEN NULLIF(p_changes->>'stl_url','')                 ELSE stl_url       END,
        images_url    = CASE WHEN p_changes ? 'images_url'    THEN NULLIF(p_changes->>'images_url','')              ELSE images_url    END,
        delivery_date = CASE WHEN p_changes ? 'delivery_date' THEN (p_changes->>'delivery_date')::DATE              ELSE delivery_date END,
        is_urgent     = CASE WHEN p_changes ? 'is_urgent'     THEN (p_changes->>'is_urgent')::BOOLEAN               ELSE is_urgent     END,
        priority      = CASE WHEN p_changes ? 'priority'      THEN p_changes->>'priority'                           ELSE priority      END,
        supplier_id   = CASE WHEN p_changes ? 'supplier_id'   THEN NULLIF(p_changes->>'supplier_id','')::UUID       ELSE supplier_id   END,
        designer_id   = CASE WHEN p_changes ? 'designer_id'   THEN NULLIF(p_changes->>'designer_id','')::UUID       ELSE designer_id   END,
        instructions  = CASE WHEN p_changes ? 'instructions'  THEN NULLIF(p_changes->>'instructions','')            ELSE instructions  END,
        items         = CASE WHEN p_changes ? 'items'         THEN p_changes->'items'                               ELSE items         END,
        total_price   = CASE WHEN p_changes ? 'total_price'   THEN (p_changes->>'total_price')::NUMERIC              ELSE total_price   END,
        cost          = CASE WHEN p_changes ? 'cost'          THEN (p_changes->>'cost')::NUMERIC                     ELSE cost          END,
        design_price  = CASE WHEN p_changes ? 'design_price'  THEN (p_changes->>'design_price')::NUMERIC             ELSE design_price  END
    WHERE id = p_order_id;

    -- Sync items to order_items table if present
    IF p_changes ? 'items' THEN
        DELETE FROM order_items WHERE order_id = p_order_id;

        IF jsonb_array_length(p_changes->'items') > 0 THEN
            INSERT INTO order_items (
                order_id,
                product_type,
                teeth_numbers,
                price,
                shade,
                count
            )
            SELECT
                p_order_id,
                COALESCE(x->>'product_type', x->>'serviceType'),
                COALESCE(x->'teeth_numbers', x->'teethNumbers'),
                (COALESCE(x->>'price', '0'))::numeric,
                x->>'shade',
                COALESCE(
                    (x->>'count')::int,
                    jsonb_array_length(COALESCE(x->'teeth_numbers', x->'teethNumbers')),
                    1
                )
            FROM jsonb_array_elements(p_changes->'items') t(x);
        END IF;
    END IF;

    -- 11. Reset flag (defense in depth; tx-local already self-clears).
    PERFORM set_config('app.rep_audit_in_progress', 'false', true);

    RETURN p_order_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_designer_rejection_v2(p_order_id uuid, p_reason text, p_idempotency_key uuid, p_cause_category text DEFAULT NULL::text, p_responsible_stage text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := public.get_my_user_id();
    v_acts_as_designer BOOLEAN := public.get_my_role() = 'designer'
        OR (public.get_my_role() = ANY (ARRAY['representative', 'coordinator']) AND public.get_my_custom_permission('secondary_designer'));
    v_order public.orders%ROWTYPE;
    v_event_id UUID;
    v_payload JSONB := jsonb_build_object(
        'reason', btrim(p_reason),
        'causeCategory', p_cause_category,
        'responsibleStage', p_responsible_stage
    );
    v_command public.order_transition_commands%ROWTYPE;
    v_result JSONB;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN RAISE EXCEPTION 'Workflow V2 writes are disabled'; END IF;
    IF NOT v_acts_as_designer OR v_user_id IS NULL THEN RAISE EXCEPTION 'Only designer can request rejection'; END IF;
    IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
    IF p_cause_category IS NOT NULL THEN
        IF p_cause_category NOT IN ('scan_impression', 'prep', 'no_space', 'unknown') THEN
            RAISE EXCEPTION 'Invalid cause_category % for lab rejection', p_cause_category;
        END IF;
    END IF;
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
        jsonb_build_object(
            'idempotencyKey', p_idempotency_key, 'workflowVersion', 2,
            'causeCategory', p_cause_category, 'responsibleStage', p_responsible_stage
        )
    ) RETURNING id INTO v_event_id;
    UPDATE public.orders SET technician_status = 'Rejected', design_status = 'returned', updated_at = timezone('utc', now())
    WHERE id = p_order_id;
    v_result := jsonb_build_object('orderId', p_order_id, 'eventId', v_event_id, 'alreadyApplied', FALSE);
    UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.review_designer_rejection_v2(p_order_id uuid, p_action text, p_notes text, p_idempotency_key uuid, p_cause_category text DEFAULT NULL::text, p_responsible_stage text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := public.get_my_user_id();
    v_order public.orders%ROWTYPE;
    v_event public.order_events%ROWTYPE;
    v_payload JSONB := jsonb_build_object('action', p_action, 'notes', NULLIF(btrim(p_notes), ''));
    v_command public.order_transition_commands%ROWTYPE;
    v_result JSONB;
    v_effective_cause TEXT := p_cause_category;
    v_effective_stage TEXT := p_responsible_stage;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN RAISE EXCEPTION 'Workflow V2 writes are disabled'; END IF;
    IF v_role NOT IN ('admin', 'representative', 'coordinator') OR v_user_id IS NULL THEN RAISE EXCEPTION 'Only admin or representative can review'; END IF;
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
        -- Prefill from the designer's own selection when the approver did not
        -- send an explicit override. Old pending rows without a stored cause
        -- (pre-migration) simply resolve to NULL here, same as today.
        IF v_effective_cause IS NULL AND v_event.id IS NOT NULL THEN
            v_effective_cause := v_event.metadata->>'causeCategory';
            v_effective_stage := v_event.metadata->>'responsibleStage';
        END IF;
        IF v_effective_cause IS NOT NULL THEN
            IF v_effective_cause NOT IN ('scan_impression', 'prep', 'no_space', 'unknown') THEN
                RAISE EXCEPTION 'Invalid cause_category % for lab rejection', v_effective_cause;
            END IF;
            PERFORM set_config('app.explicit_issue_cause', v_effective_cause, true);
            PERFORM set_config('app.explicit_issue_stage', COALESCE(v_effective_stage, ''), true);
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
$function$;

-- ═══ RLS policies (25) ═══

DROP POLICY IF EXISTS "Staff can view adjustments" ON public.adjustments;
CREATE POLICY "Staff can view adjustments" ON public.adjustments
    AS PERMISSIVE FOR SELECT
    TO public
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'representative'::text, 'lab'::text])));

DROP POLICY IF EXISTS "auth_select" ON public.contact_inquiries;
CREATE POLICY "auth_select" ON public.contact_inquiries
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'representative'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "auth_update" ON public.contact_inquiries;
CREATE POLICY "auth_update" ON public.contact_inquiries
    AS PERMISSIVE FOR UPDATE
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'representative'::text, 'coordinator'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'representative'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "doctor_follow_ups_insert" ON public.doctor_follow_ups;
CREATE POLICY "doctor_follow_ups_insert" ON public.doctor_follow_ups
    AS PERMISSIVE FOR INSERT
    TO authenticated
    WITH CHECK (((get_my_role() = 'admin'::text) OR ((get_my_role() = ANY (ARRAY['representative'::text, 'coordinator'::text])) AND (EXISTS ( SELECT 1
   FROM doctors
  WHERE ((doctors.id = doctor_follow_ups.doctor_id) AND (doctors.representative_id = get_my_user_id())))))));

DROP POLICY IF EXISTS "doctor_follow_ups_select" ON public.doctor_follow_ups;
CREATE POLICY "doctor_follow_ups_select" ON public.doctor_follow_ups
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (((get_my_role() = 'admin'::text) OR ((get_my_role() = ANY (ARRAY['representative'::text, 'coordinator'::text])) AND (EXISTS ( SELECT 1
   FROM doctors
  WHERE ((doctors.id = doctor_follow_ups.doctor_id) AND (doctors.representative_id = get_my_user_id())))))));

DROP POLICY IF EXISTS "doctors_insert" ON public.doctors;
CREATE POLICY "doctors_insert" ON public.doctors
    AS PERMISSIVE FOR INSERT
    TO authenticated
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'representative'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "doctors_select" ON public.doctors;
CREATE POLICY "doctors_select" ON public.doctors
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'representative'::text, 'designer'::text])) OR ((get_my_role() = 'lab'::text) AND (EXISTS ( SELECT 1
   FROM orders
  WHERE ((orders.doctor_id = doctors.id) AND (orders.supplier_id = get_my_entity_id())))))));

DROP POLICY IF EXISTS "doctors_update" ON public.doctors;
CREATE POLICY "doctors_update" ON public.doctors
    AS PERMISSIVE FOR UPDATE
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'representative'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Representatives view doctor billing settings" ON public.entity_billing_settings;
CREATE POLICY "Representatives view doctor billing settings" ON public.entity_billing_settings
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (((get_my_role() = ANY (ARRAY['representative'::text, 'coordinator'::text])) AND (entity_type = 'doctor'::text)));

DROP POLICY IF EXISTS "Representatives manage financial obligations" ON public.financial_obligations;
CREATE POLICY "Representatives manage financial obligations" ON public.financial_obligations
    AS PERMISSIVE FOR ALL
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['representative'::text, 'coordinator'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['representative'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Staff can read material batches" ON public.material_batches;
CREATE POLICY "Staff can read material batches" ON public.material_batches
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'lab'::text, 'technician'::text, 'accountant'::text, 'coordinator'::text, 'designer'::text, 'representative'::text])));

DROP POLICY IF EXISTS "Staff can read materials" ON public.materials;
CREATE POLICY "Staff can read materials" ON public.materials
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'lab'::text, 'technician'::text, 'accountant'::text, 'coordinator'::text, 'designer'::text, 'representative'::text])));

DROP POLICY IF EXISTS "write_order_attachments" ON public.order_attachments;
CREATE POLICY "write_order_attachments" ON public.order_attachments
    AS PERMISSIVE FOR INSERT
    TO authenticated
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'lab'::text, 'technician'::text, 'designer'::text, 'representative'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Internal staff can insert order events" ON public.order_events;
CREATE POLICY "Internal staff can insert order events" ON public.order_events
    AS PERMISSIVE FOR INSERT
    TO authenticated
    WITH CHECK (((get_my_role() = 'admin'::text) OR ((get_my_role() = ANY (ARRAY['accountant'::text, 'coordinator'::text, 'representative'::text])) AND (event_type <> ALL (ARRAY['financial_adjustment_approved'::text, 'payment_allocated'::text, 'manual_allocation_override'::text, 'order_reopened'::text])))));

DROP POLICY IF EXISTS "Internal staff can view order events" ON public.order_events;
CREATE POLICY "Internal staff can view order events" ON public.order_events
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'representative'::text])));

DROP POLICY IF EXISTS "order_issues_rep_read_own" ON public.order_issues;
CREATE POLICY "order_issues_rep_read_own" ON public.order_issues
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (((get_my_role() = ANY (ARRAY['representative'::text, 'coordinator'::text])) AND (order_id IN ( SELECT orders.id
   FROM orders
  WHERE (orders.representative_id = ( SELECT users.id
           FROM users
          WHERE (users.auth_id = auth.uid())))))));

DROP POLICY IF EXISTS "orders_insert" ON public.orders;
CREATE POLICY "orders_insert" ON public.orders
    AS PERMISSIVE FOR INSERT
    TO authenticated
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'representative'::text])));

DROP POLICY IF EXISTS "orders_select" ON public.orders;
CREATE POLICY "orders_select" ON public.orders
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])) OR ((get_my_role() = 'designer'::text) AND (designer_id = get_my_user_id())) OR (get_my_role() = ANY (ARRAY['representative'::text, 'coordinator'::text])) OR ((get_my_role() = 'lab'::text) AND (supplier_id = get_my_entity_id()))));

DROP POLICY IF EXISTS "orders_update" ON public.orders;
CREATE POLICY "orders_update" ON public.orders
    AS PERMISSIVE FOR UPDATE
    TO authenticated
    USING (((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])) OR ((get_my_role() = 'designer'::text) AND (designer_id = get_my_user_id())) OR ((get_my_role() = ANY (ARRAY['representative'::text, 'coordinator'::text])) AND (status <> 'Delivered'::text)) OR ((get_my_role() = 'lab'::text) AND (supplier_id = get_my_entity_id()))))
    WITH CHECK (((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])) OR ((get_my_role() = 'designer'::text) AND (designer_id = get_my_user_id())) OR (get_my_role() = ANY (ARRAY['representative'::text, 'coordinator'::text])) OR ((get_my_role() = 'lab'::text) AND (supplier_id = get_my_entity_id()))));

DROP POLICY IF EXISTS "services_select" ON public.services;
CREATE POLICY "services_select" ON public.services
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'designer'::text, 'lab'::text, 'representative'::text, 'doctor'::text])));

DROP POLICY IF EXISTS "suppliers_select" ON public.suppliers;
CREATE POLICY "suppliers_select" ON public.suppliers
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'representative'::text, 'designer'::text])) OR ((get_my_role() = 'lab'::text) AND (id = get_my_entity_id()))));

DROP POLICY IF EXISTS "transactions_insert" ON public.transactions;
CREATE POLICY "transactions_insert" ON public.transactions
    AS PERMISSIVE FOR INSERT
    TO authenticated
    WITH CHECK (((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])) OR ((get_my_role() = ANY (ARRAY['representative'::text, 'coordinator'::text])) AND (type = 'expense'::text))));

DROP POLICY IF EXISTS "transactions_select" ON public.transactions;
CREATE POLICY "transactions_select" ON public.transactions
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])) OR ((get_my_role() = ANY (ARRAY['representative'::text, 'coordinator'::text])) AND ((entity_id = get_my_user_id()) OR (entity_type = 'doctor'::text))) OR ((get_my_role() = 'designer'::text) AND (entity_id = get_my_user_id())) OR ((get_my_role() = 'lab'::text) AND (entity_id = get_my_entity_id()))));

DROP POLICY IF EXISTS "users_select" ON public.users;
CREATE POLICY "users_select" ON public.users
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'representative'::text, 'lab'::text, 'designer'::text])) OR ((get_my_role() = 'doctor'::text) AND (id = get_my_user_id()))));

DROP POLICY IF EXISTS "Staff can read warehouses" ON public.warehouses;
CREATE POLICY "Staff can read warehouses" ON public.warehouses
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'lab'::text, 'technician'::text, 'accountant'::text, 'coordinator'::text, 'designer'::text, 'representative'::text])));
COMMIT;
