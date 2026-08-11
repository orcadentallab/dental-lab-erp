-- Atomic redo V2 and deterministic, read-only legacy classification report.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_redo_order_atomic_v2(
    p_original_order_id UUID,
    p_reason_code TEXT,
    p_notes TEXT,
    p_doctor_decision TEXT,
    p_custom_doctor_amount NUMERIC,
    p_idempotency_key UUID
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

REVOKE ALL ON FUNCTION public.create_redo_order_atomic_v2(UUID, TEXT, TEXT, TEXT, NUMERIC, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_redo_order_atomic_v2(UUID, TEXT, TEXT, TEXT, NUMERIC, UUID) TO authenticated;

-- Safe timestamp parser used only by the read-only dry-run report. Invalid
-- historical strings become explicit unresolved evidence instead of aborting
-- or being guessed.
CREATE OR REPLACE FUNCTION public.try_timestamptz_v2(p_value TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF NULLIF(btrim(p_value), '') IS NULL THEN RETURN NULL; END IF;
    RETURN p_value::timestamptz;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE VIEW public.workflow_v2_backfill_dry_run
WITH (security_invoker = true)
AS
WITH evidence AS (
    SELECT
        o.*,
        (
            SELECT MIN(COALESCE(e.changed_at, e.created_at))
            FROM public.order_events e
            WHERE e.order_id = o.id
              AND (e.event_type IN ('order_delivered', 'delivery_completed')
                   OR e.new_value IN ('Delivered', 'final_delivered'))
        ) AS delivered_event_at,
        (
            SELECT MIN(public.try_timestamptz_v2(entry->>'enteredAt'))
            FROM jsonb_array_elements(COALESCE(o.status_history, '[]'::jsonb)) entry
            WHERE entry->>'status' IN ('Delivered', 'Completed', 'final_delivered')
        ) AS delivered_history_at,
        (
            SELECT MIN(COALESCE(e.changed_at, e.created_at))
            FROM public.order_events e
            WHERE e.order_id = o.id
              AND (e.event_type = 'design_submitted_to_lab' OR e.new_value = 'Under Production')
        ) AS design_event_at,
        (
            SELECT MIN(public.try_timestamptz_v2(entry->>'enteredAt'))
            FROM jsonb_array_elements(COALESCE(o.status_history, '[]'::jsonb)) entry
            WHERE entry->>'status' = 'Under Production'
        ) AS design_history_at,
        (
            SELECT MIN(COALESCE(e.changed_at, e.created_at))
            FROM public.order_events e
            WHERE e.order_id = o.id AND (e.new_value = 'Rejected' OR e.event_type = 'case_rejected')
        ) AS legacy_rejected_at
    FROM public.orders o
), resolved AS (
    SELECT evidence.*,
        (SELECT MIN(candidate) FROM (VALUES
            (delivered_event_at), (delivered_history_at),
            (actual_delivery_date::timestamptz),
            (CASE
                WHEN accounting_snapshot->>'status' IN ('Delivered', 'Completed')
                THEN accounting_registered_at
             END)
        ) candidates(candidate) WHERE candidate >= created_at) AS proposed_first_delivered_at,
        (SELECT MIN(candidate) FROM (VALUES
            (design_event_at), (design_history_at)
        ) candidates(candidate) WHERE candidate >= created_at) AS proposed_design_submitted_at
    FROM evidence
)
SELECT
    id AS order_id,
    case_id,
    status AS legacy_status,
    production_status,
    issue_state,
    proposed_first_delivered_at,
    CASE
        WHEN delivered_event_at = proposed_first_delivered_at THEN 'order_event'
        WHEN delivered_history_at = proposed_first_delivered_at THEN 'status_history'
        WHEN actual_delivery_date::timestamptz = proposed_first_delivered_at THEN 'actual_delivery_date'
        WHEN accounting_registered_at = proposed_first_delivered_at
             AND accounting_snapshot->>'status' IN ('Delivered', 'Completed') THEN 'accounting_snapshot_inferred'
        ELSE NULL
    END AS proposed_first_delivered_source,
    proposed_design_submitted_at,
    legacy_rejected_at,
    CASE
        WHEN status <> 'Rejected' THEN NULL
        WHEN legacy_rejected_at IS NULL THEN 'unresolved_legacy_rejection'
        WHEN proposed_first_delivered_at IS NOT NULL
             AND proposed_first_delivered_at <= legacy_rejected_at THEN 'doctor_rejected'
        WHEN (proposed_first_delivered_at IS NULL OR legacy_rejected_at < proposed_first_delivered_at)
             AND (proposed_design_submitted_at IS NULL OR legacy_rejected_at <= proposed_design_submitted_at)
             AND technician_status = 'Rejected'
             AND production_status IN ('not_started', 'designing') THEN 'lab_rejected'
        ELSE 'unresolved_legacy_rejection'
    END AS proposed_legacy_issue,
    CASE
        WHEN issue_state = 'cancelled' AND proposed_first_delivered_at IS NOT NULL
            THEN 'no_mutation_unresolved_timing'
        WHEN issue_state IN ('returned', 'doctor_rejected', 'redo')
             AND proposed_first_delivered_at IS NULL
            THEN 'no_mutation_unresolved_timing'
        WHEN issue_state = 'lab_rejected'
             AND (proposed_first_delivered_at IS NOT NULL OR proposed_design_submitted_at IS NOT NULL)
            THEN 'no_mutation_unresolved_timing'
        WHEN status <> 'Rejected' THEN 'timestamp_backfill_only'
        WHEN legacy_rejected_at IS NULL THEN 'no_mutation_unresolved'
        WHEN proposed_first_delivered_at IS NOT NULL AND proposed_first_delivered_at <= legacy_rejected_at
            THEN 'doctor_rejection_financial_review_required'
        WHEN (proposed_first_delivered_at IS NULL OR legacy_rejected_at < proposed_first_delivered_at)
             AND (proposed_design_submitted_at IS NULL OR legacy_rejected_at <= proposed_design_submitted_at)
             AND technician_status = 'Rejected' AND production_status IN ('not_started', 'designing')
            THEN 'void_all_order_obligations_and_zero_issue_fields'
        ELSE 'no_mutation_unresolved'
    END AS expected_financial_effect,
    pg_get_functiondef('public.sync_order_financial_obligations()'::regprocedure) AS financial_function_definition,
    (
        SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname)
        FROM pg_trigger t
        WHERE t.tgrelid = 'public.orders'::regclass AND NOT t.tgisinternal
    ) AS order_trigger_definitions,
    jsonb_build_object(
        'deliveredEventAt', delivered_event_at,
        'deliveredHistoryAt', delivered_history_at,
        'actualDeliveryDate', actual_delivery_date,
        'accountingRegisteredAt', accounting_registered_at,
        'designEventAt', design_event_at,
        'designHistoryAt', design_history_at,
        'legacyRejectedAt', legacy_rejected_at,
        'technicianStatus', technician_status
    ) AS evidence,
    CASE
        WHEN issue_state = 'cancelled' AND proposed_first_delivered_at IS NOT NULL
            THEN 'cancelled_after_delivery_evidence'
        WHEN issue_state IN ('returned', 'doctor_rejected', 'redo')
             AND proposed_first_delivered_at IS NULL
            THEN 'post_delivery_issue_without_delivery_evidence'
        WHEN issue_state = 'lab_rejected' AND proposed_first_delivered_at IS NOT NULL
            THEN 'lab_rejected_after_delivery_evidence'
        WHEN issue_state = 'lab_rejected' AND proposed_design_submitted_at IS NOT NULL
            THEN 'lab_rejected_after_design_submission_evidence'
        ELSE NULL
    END AS timing_review_reason
FROM resolved;

REVOKE ALL ON public.workflow_v2_backfill_dry_run FROM PUBLIC, anon, authenticated;

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
    FROM public.workflow_v2_backfill_dry_run
    WHERE timing_review_reason IS NOT NULL;
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

COMMIT;
