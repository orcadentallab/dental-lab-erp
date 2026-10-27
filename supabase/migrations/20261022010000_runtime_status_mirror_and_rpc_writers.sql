-- Make the legacy order status a one-way compatibility projection for V2
-- workflow updates, then remove direct legacy writes from the primary runtime
-- transition RPCs. Portal intake INSERTs are intentionally excluded because
-- Pending Review still needs its own V2 discriminator.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.mirror_order_status_from_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_status_legacy_mirror') THEN
        RETURN NEW;
    END IF;

    -- Redo is a distinct V2 presentation state, but the legacy column never
    -- had that value. Keep its reviewed compatibility encoding until the
    -- legacy column is removed.
    v_status := CASE
        WHEN NEW.issue_state = 'redo' THEN 'Doctor Rejected'
        ELSE public.derive_order_display_status_v2(
            NEW.production_status,
            NEW.issue_state
        )
    END;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Cannot mirror unknown workflow state: production_status=%, issue_state=%',
            NEW.production_status, NEW.issue_state;
    END IF;

    NEW.status := v_status;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzzz_mirror_order_status_from_v2 ON public.orders;
CREATE TRIGGER zzzz_mirror_order_status_from_v2
BEFORE UPDATE OF production_status, issue_state ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.mirror_order_status_from_v2();

CREATE OR REPLACE FUNCTION pg_temp.patch_runtime_function(
    p_signature REGPROCEDURE,
    p_old TEXT,
    p_new TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_definition TEXT;
    v_patched TEXT;
BEGIN
    v_definition := pg_get_functiondef(p_signature);
    v_patched := replace(v_definition, p_old, p_new);
    IF v_patched = v_definition THEN
        RAISE EXCEPTION 'Expected function fragment was not found in %', p_signature;
    END IF;
    EXECUTE v_patched;
END;
$$;

SELECT pg_temp.patch_runtime_function(
    'public.apply_order_issue_transition_v2(uuid,text,text,uuid,text,numeric,text,text,text)'::regprocedure,
    E'        status = CASE p_operation\n            WHEN ''cancel_order'' THEN ''Cancelled''\n            WHEN ''return_for_adjustment'' THEN ''Returned for Adjustments''\n            WHEN ''doctor_reject_order'' THEN ''Doctor Rejected''\n        END,\n',
    ''
);

SELECT pg_temp.patch_runtime_function(
    'public.record_order_final_delivery_v2(uuid,timestamptz,uuid)'::regprocedure,
    'status = ''Delivered'', production_status = ''final_delivered'',',
    'production_status = ''final_delivered'','
);

SELECT pg_temp.patch_runtime_function(
    'public.submit_order_design_v2(uuid,text,uuid)'::regprocedure,
    'status = ''Under Production'', updated_at = timezone(''utc'', now())',
    'updated_at = timezone(''utc'', now())'
);

SELECT pg_temp.patch_runtime_function(
    'public.admin_reject_order_from_tech_status_v2(uuid,text,uuid,text,text)'::regprocedure,
    E'        status = ''Lab Rejected'',\n',
    ''
);

SELECT pg_temp.patch_runtime_function(
    'public.review_designer_rejection_v2(uuid,text,text,uuid,text,text)'::regprocedure,
    E'            status = ''Lab Rejected'', issue_state = ''lab_rejected'',\n',
    E'            issue_state = ''lab_rejected'',\n'
);

SELECT pg_temp.patch_runtime_function(
    'public.update_order_atomic(uuid,jsonb,jsonb,jsonb)'::regprocedure,
    '        status = CASE WHEN p_updates ? ''status'' THEN (p_updates->>''status'')::text ELSE status END,',
    ''
);

SELECT pg_temp.patch_runtime_function(
    'public.update_order_atomic(uuid,jsonb,jsonb,jsonb)'::regprocedure,
    '    SELECT EXISTS(SELECT 1 FROM orders WHERE id = p_order_id) INTO v_order_exists;',
    E'    IF p_updates ? ''status'' THEN\n        RAISE EXCEPTION ''Legacy order status writes are not allowed'' USING ERRCODE = ''22023'';\n    END IF;\n\n    SELECT EXISTS(SELECT 1 FROM orders WHERE id = p_order_id) INTO v_order_exists;'
);

DROP FUNCTION public.apply_order_rejection_atomic(
    UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT
) RESTRICT;

CREATE FUNCTION public.apply_order_rejection_atomic(
    p_order_id UUID,
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
    IF v_role NOT IN ('admin', 'representative', 'coordinator') THEN
        RAISE EXCEPTION 'Only admin or representative can record an order rejection';
    END IF;

    IF p_issue_state NOT IN ('doctor_rejected', 'lab_rejected') THEN
        RAISE EXCEPTION 'Invalid rejection issue state';
    END IF;

    IF p_doctor_decision NOT IN ('decide_later', 'full_price', 'zero', 'custom_amount') THEN
        RAISE EXCEPTION 'Invalid doctor rejection decision';
    END IF;

    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id
      AND COALESCE(is_deleted, FALSE) = FALSE
      AND (
          v_role IN ('admin', 'coordinator')
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

    SELECT id INTO v_profile_id
    FROM public.users
    WHERE auth_id = auth.uid()
    LIMIT 1;

    PERFORM set_config('app.order_rejection_in_progress', 'true', true);

    UPDATE public.orders
    SET production_status = 'not_started',
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
        updated_at = timezone('utc', now())
    WHERE id = p_order_id;

    IF NULLIF(btrim(p_comment), '') IS NOT NULL THEN
        INSERT INTO public.order_comments(
            order_id, content, user_id, user_name, created_at
        ) VALUES (
            p_order_id,
            btrim(p_comment),
            v_profile_id,
            COALESCE(NULLIF(btrim(p_user_name), ''), 'User'),
            timezone('utc', now())
        );
    END IF;

    SELECT to_jsonb(o.*) INTO v_result
    FROM public.orders o
    WHERE o.id = p_order_id;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_order_rejection_atomic(
    UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_order_rejection_atomic(
    UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT
) TO authenticated;

COMMIT;
