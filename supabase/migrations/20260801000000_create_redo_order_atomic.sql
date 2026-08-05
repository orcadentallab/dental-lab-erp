-- Create a remake as one database transaction. The original transition, new
-- case id, linked order, items, comments, events, and financial synchronization
-- either all commit or all roll back.

CREATE OR REPLACE FUNCTION public.create_redo_order_atomic(
    p_original_order_id UUID,
    p_reason_code TEXT,
    p_notes TEXT,
    p_rejected_lab_cost NUMERIC DEFAULT NULL,
    p_rejected_designer_cost NUMERIC DEFAULT NULL
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
    IF v_role NOT IN ('admin', 'representative') THEN
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
$$;
REVOKE ALL ON FUNCTION public.create_redo_order_atomic(
    UUID, TEXT, TEXT, NUMERIC, NUMERIC
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_redo_order_atomic(
    UUID, TEXT, TEXT, NUMERIC, NUMERIC
) TO authenticated;
COMMENT ON FUNCTION public.create_redo_order_atomic(
    UUID, TEXT, TEXT, NUMERIC, NUMERIC
) IS 'Atomically closes the original as redo and creates the linked replacement order, items, comments, events, and financial settlements.';
