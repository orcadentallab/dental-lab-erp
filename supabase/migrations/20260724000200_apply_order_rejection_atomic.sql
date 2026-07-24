-- Approved atomic rejection and rejected-order financial review RPCs.
-- This function must be deployed in the same reviewed migration as
-- atomic_order_financial_obligations.DRAFT.sql.

-- The existing representative guard intentionally blocks direct rejection
-- updates. Add a transaction-local bypass that is only set by the validated
-- SECURITY DEFINER RPC below. Regular client updates remain blocked.
DO $$
DECLARE
    v_definition TEXT;
    v_patched TEXT;
BEGIN
    SELECT pg_get_functiondef('public.orders_role_field_guard()'::regprocedure)
    INTO v_definition;

    v_patched := replace(
        v_definition,
        'IF v_role = ''representative'' THEN',
        'IF v_role = ''representative'' THEN
        IF current_setting(''app.order_rejection_in_progress'', true) = ''true'' THEN
            RETURN NEW;
        END IF;'
    );

    IF v_patched = v_definition THEN
        RAISE EXCEPTION
            'orders_role_field_guard did not contain the expected representative branch';
    END IF;

    EXECUTE v_patched;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_rejected_designer_cost_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
BEGIN
    IF NEW.rejected_designer_cost IS DISTINCT FROM OLD.rejected_designer_cost
       AND v_role IS NOT NULL
       AND v_role <> 'admin'
       AND current_setting('app.order_rejection_in_progress', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Only admin can update rejected designer cost';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_order_rejection_atomic(
    p_order_id UUID,
    p_target_status TEXT,
    p_issue_state TEXT,
    p_doctor_decision TEXT,
    p_custom_doctor_amount NUMERIC DEFAULT NULL,
    p_comment TEXT DEFAULT NULL,
    p_user_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_order public.orders%ROWTYPE;
    v_doctor_amount NUMERIC(12, 2);
    v_review_status TEXT;
    v_result JSONB;
    v_profile_id UUID;
BEGIN
    IF v_role NOT IN ('admin', 'representative') THEN
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
$$;

REVOKE ALL ON FUNCTION public.apply_order_rejection_atomic(
    UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_order_rejection_atomic(
    UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT
) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_rejection_financials_atomic(
    p_order_id UUID,
    p_doctor_amount NUMERIC,
    p_lab_cost NUMERIC,
    p_lab_cost_status TEXT,
    p_designer_cost NUMERIC,
    p_designer_cost_status TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_order public.orders%ROWTYPE;
    v_result JSONB;
BEGIN
    IF public.get_my_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only admin can amend rejected-order financial decisions';
    END IF;

    IF NULLIF(btrim(p_reason), '') IS NULL THEN
        RAISE EXCEPTION 'Financial amendment reason is required';
    END IF;

    SELECT *
    INTO v_order
    FROM public.orders
    WHERE id = p_order_id
      AND status IN ('Doctor Rejected', 'Lab Rejected', 'Rejected')
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Rejected order not found';
    END IF;

    IF p_doctor_amount IS NULL
       OR p_doctor_amount < 0
       OR p_doctor_amount > COALESCE(v_order.total_price, 0) THEN
        RAISE EXCEPTION 'Doctor amount must be between zero and the order total';
    END IF;

    IF p_lab_cost_status NOT IN ('pending', 'resolved', 'not_applicable')
       OR p_designer_cost_status NOT IN ('pending', 'resolved', 'not_applicable') THEN
        RAISE EXCEPTION 'Invalid party cost review status';
    END IF;

    IF p_lab_cost_status = 'resolved' AND (p_lab_cost IS NULL OR p_lab_cost < 0) THEN
        RAISE EXCEPTION 'Resolved supplier cost must be a non-negative amount';
    END IF;

    IF p_designer_cost_status = 'resolved'
       AND (p_designer_cost IS NULL OR p_designer_cost < 0) THEN
        RAISE EXCEPTION 'Resolved designer cost must be a non-negative amount';
    END IF;

    UPDATE public.orders
    SET rejected_doctor_amount = p_doctor_amount,
        rejection_doctor_decision = CASE
            WHEN p_doctor_amount = 0 THEN 'zero'
            WHEN p_doctor_amount = total_price THEN 'full_price'
            ELSE 'custom_amount'
        END,
        rejection_financial_review_status = 'resolved',
        rejected_lab_cost = CASE
            WHEN p_lab_cost_status = 'resolved' THEN p_lab_cost
            ELSE NULL
        END,
        rejected_lab_cost_status = p_lab_cost_status,
        rejected_designer_cost = CASE
            WHEN p_designer_cost_status = 'resolved' THEN p_designer_cost
            ELSE NULL
        END,
        rejected_designer_cost_status = p_designer_cost_status,
        updated_at = timezone('utc'::text, now())
    WHERE id = p_order_id;

    INSERT INTO public.order_comments (
        order_id,
        content,
        user_id,
        user_name,
        created_at
    )
    SELECT
        p_order_id,
        '[تعديل مالي للرفض] ' || btrim(p_reason),
        u.id,
        COALESCE(u.name, u.username, 'Admin'),
        timezone('utc'::text, now())
    FROM public.users u
    WHERE u.auth_id = auth.uid()
    LIMIT 1;

    SELECT to_jsonb(o.*)
    INTO v_result
    FROM public.orders o
    WHERE o.id = p_order_id;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_rejection_financials_atomic(
    UUID, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_rejection_financials_atomic(
    UUID, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT
) TO authenticated;

-- Activate the financial synchronization only after every dependency and RPC
-- above has been created successfully.
DROP TRIGGER IF EXISTS trigger_sync_order_financial_obligations
ON public.orders;

CREATE TRIGGER trigger_sync_order_financial_obligations
AFTER INSERT OR UPDATE OF
    status,
    production_status,
    issue_state,
    doctor_id,
    supplier_id,
    designer_id,
    total_price,
    cost,
    manual_cost,
    design_price,
    manual_design_price,
    workflow_type,
    design_status,
    delivery_date,
    actual_delivery_date,
    rejected_lab_cost,
    rejected_designer_cost,
    rejection_doctor_decision,
    rejected_doctor_amount,
    rejection_financial_review_status,
    rejected_lab_cost_status,
    rejected_designer_cost_status,
    is_deleted
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_order_financial_obligations();

DROP TRIGGER IF EXISTS trigger_guard_financially_active_order_delete
ON public.orders;

CREATE TRIGGER trigger_guard_financially_active_order_delete
BEFORE UPDATE OF is_deleted ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.guard_financially_active_order_delete();
