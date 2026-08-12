-- Make item-change detection deterministic. The previous migration used a
-- transaction-local GUC whenever p_items was supplied, which could reopen
-- later orders in the same transaction and treated identical item payloads as
-- changes.

CREATE OR REPLACE FUNCTION public.reopen_registered_order_for_accounting()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_business_changed BOOLEAN;
BEGIN
    v_business_changed :=
           NEW.case_id                           IS DISTINCT FROM OLD.case_id
        OR NEW.doctor_id                         IS DISTINCT FROM OLD.doctor_id
        OR NEW.branch_name                       IS DISTINCT FROM OLD.branch_name
        OR NEW.patient_name                      IS DISTINCT FROM OLD.patient_name
        OR NEW.items                             IS DISTINCT FROM OLD.items
        OR NEW.discount                          IS DISTINCT FROM OLD.discount
        OR NEW.total_price                       IS DISTINCT FROM OLD.total_price
        OR NEW.shade                             IS DISTINCT FROM OLD.shade
        OR NEW.status                            IS DISTINCT FROM OLD.status
        OR NEW.production_status                 IS DISTINCT FROM OLD.production_status
        OR NEW.issue_state                       IS DISTINCT FROM OLD.issue_state
        OR NEW.delivery_date                     IS DISTINCT FROM OLD.delivery_date
        OR NEW.actual_delivery_date              IS DISTINCT FROM OLD.actual_delivery_date
        OR NEW.cost                              IS DISTINCT FROM OLD.cost
        OR NEW.manual_cost                       IS DISTINCT FROM OLD.manual_cost
        OR NEW.supplier_id                       IS DISTINCT FROM OLD.supplier_id
        OR NEW.representative_id                 IS DISTINCT FROM OLD.representative_id
        OR NEW.designer_id                       IS DISTINCT FROM OLD.designer_id
        OR NEW.design_price                      IS DISTINCT FROM OLD.design_price
        OR NEW.manual_design_price               IS DISTINCT FROM OLD.manual_design_price
        OR NEW.design_status                     IS DISTINCT FROM OLD.design_status
        OR NEW.workflow_type                     IS DISTINCT FROM OLD.workflow_type
        OR NEW.delivery_type                     IS DISTINCT FROM OLD.delivery_type
        OR NEW.priority                          IS DISTINCT FROM OLD.priority
        OR NEW.is_urgent                         IS DISTINCT FROM OLD.is_urgent
        OR NEW.instructions                      IS DISTINCT FROM OLD.instructions
        OR NEW.stl_url                           IS DISTINCT FROM OLD.stl_url
        OR NEW.images_url                        IS DISTINCT FROM OLD.images_url
        OR NEW.design_url                        IS DISTINCT FROM OLD.design_url
        OR NEW.needs_design_review               IS DISTINCT FROM OLD.needs_design_review
        OR NEW.technician_status                 IS DISTINCT FROM OLD.technician_status
        OR NEW.feedback                          IS DISTINCT FROM OLD.feedback
        OR NEW.is_redo                           IS DISTINCT FROM OLD.is_redo
        OR NEW.original_order_id                 IS DISTINCT FROM OLD.original_order_id
        OR NEW.is_deleted                        IS DISTINCT FROM OLD.is_deleted
        OR NEW.rejected_lab_cost                 IS DISTINCT FROM OLD.rejected_lab_cost
        OR NEW.rejected_designer_cost            IS DISTINCT FROM OLD.rejected_designer_cost
        OR NEW.rejection_doctor_decision         IS DISTINCT FROM OLD.rejection_doctor_decision
        OR NEW.rejected_doctor_amount            IS DISTINCT FROM OLD.rejected_doctor_amount
        OR NEW.rejection_financial_review_status IS DISTINCT FROM OLD.rejection_financial_review_status
        OR NEW.rejected_lab_cost_status          IS DISTINCT FROM OLD.rejected_lab_cost_status
        OR NEW.rejected_designer_cost_status     IS DISTINCT FROM OLD.rejected_designer_cost_status;

    IF OLD.is_registered = TRUE AND v_business_changed THEN
        NEW.is_registered := FALSE;
        NEW.needs_accounting_reregistration := TRUE;
    ELSIF NEW.is_registered = TRUE AND OLD.is_registered = FALSE THEN
        NEW.needs_accounting_reregistration := FALSE;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_order_atomic(
    p_order_id UUID,
    p_updates JSONB,
    p_items JSONB DEFAULT NULL,
    p_comments JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_order_exists BOOLEAN;
    v_result JSONB;
    v_existing_items JSONB := '[]'::jsonb;
    v_requested_items JSONB := '[]'::jsonb;
    v_items_changed BOOLEAN := FALSE;
BEGIN
    SELECT EXISTS(SELECT 1 FROM orders WHERE id = p_order_id) INTO v_order_exists;
    IF NOT v_order_exists THEN
        RAISE EXCEPTION 'Order not found or access denied: %', p_order_id;
    END IF;

    IF p_items IS NOT NULL THEN
        SELECT COALESCE(jsonb_agg(normalized ORDER BY normalized::text), '[]'::jsonb)
        INTO v_existing_items
        FROM (
            SELECT jsonb_build_object(
                'product_type', COALESCE(product_type, ''),
                'teeth_numbers', COALESCE(teeth_numbers, '[]'::jsonb),
                'price', COALESCE(price, 0),
                'shade', COALESCE(shade, ''),
                'count', COALESCE(count, 1)
            ) AS normalized
            FROM order_items
            WHERE order_id = p_order_id
        ) current_items;

        SELECT COALESCE(jsonb_agg(normalized ORDER BY normalized::text), '[]'::jsonb)
        INTO v_requested_items
        FROM (
            SELECT jsonb_build_object(
                'product_type', COALESCE(item->>'product_type', ''),
                'teeth_numbers', COALESCE(item->'teeth_numbers', '[]'::jsonb),
                'price', COALESCE((item->>'price')::numeric, 0),
                'shade', COALESCE(item->>'shade', ''),
                'count', COALESCE((item->>'count')::int, 1)
            ) AS normalized
            FROM jsonb_array_elements(p_items) supplied(item)
        ) requested_items;

        v_items_changed := v_existing_items IS DISTINCT FROM v_requested_items;
    END IF;

    UPDATE orders
    SET
        case_id = CASE WHEN p_updates ? 'case_id' THEN (p_updates->>'case_id')::text ELSE case_id END,
        doctor_id = CASE WHEN p_updates ? 'doctor_id' THEN (p_updates->>'doctor_id')::uuid ELSE doctor_id END,
        branch_name = CASE WHEN p_updates ? 'branch_name' THEN (p_updates->>'branch_name')::text ELSE branch_name END,
        patient_name = CASE WHEN p_updates ? 'patient_name' THEN (p_updates->>'patient_name')::text ELSE patient_name END,
        status = CASE WHEN p_updates ? 'status' THEN (p_updates->>'status')::text ELSE status END,
        delivery_date = CASE WHEN p_updates ? 'delivery_date' THEN (p_updates->>'delivery_date')::date ELSE delivery_date END,
        cost = CASE WHEN p_updates ? 'cost' THEN (p_updates->>'cost')::numeric ELSE cost END,
        manual_cost = CASE WHEN p_updates ? 'manual_cost' THEN (p_updates->>'manual_cost')::numeric ELSE manual_cost END,
        discount = CASE WHEN p_updates ? 'discount' THEN (p_updates->>'discount')::numeric ELSE discount END,
        total_price = CASE WHEN p_updates ? 'total_price' THEN (p_updates->>'total_price')::numeric ELSE total_price END,
        shade = CASE WHEN p_updates ? 'shade' THEN (p_updates->>'shade')::text ELSE shade END,
        instructions = CASE WHEN p_updates ? 'instructions' THEN (p_updates->>'instructions')::text ELSE instructions END,
        priority = CASE WHEN p_updates ? 'priority' THEN (p_updates->>'priority')::text ELSE priority END,
        is_urgent = CASE WHEN p_updates ? 'is_urgent' THEN (p_updates->>'is_urgent')::boolean ELSE is_urgent END,
        is_redo = CASE WHEN p_updates ? 'is_redo' THEN (p_updates->>'is_redo')::boolean ELSE is_redo END,
        is_archived = CASE WHEN p_updates ? 'is_archived' THEN (p_updates->>'is_archived')::boolean ELSE is_archived END,
        is_deleted = CASE WHEN p_updates ? 'is_deleted' THEN (p_updates->>'is_deleted')::boolean ELSE is_deleted END,
        stl_url = CASE WHEN p_updates ? 'stl_url' THEN (p_updates->>'stl_url')::text ELSE stl_url END,
        images_url = CASE WHEN p_updates ? 'images_url' THEN (p_updates->>'images_url')::text ELSE images_url END,
        supplier_id = CASE WHEN p_updates ? 'supplier_id' THEN (p_updates->>'supplier_id')::uuid ELSE supplier_id END,
        delivery_type = CASE WHEN p_updates ? 'delivery_type' THEN (p_updates->>'delivery_type')::text ELSE delivery_type END,
        needs_design_review = CASE WHEN p_updates ? 'needs_design_review' THEN (p_updates->>'needs_design_review')::boolean ELSE needs_design_review END,
        technician_status = CASE WHEN p_updates ? 'technician_status' THEN (p_updates->>'technician_status')::text ELSE technician_status END,
        representative_id = CASE WHEN p_updates ? 'representative_id' THEN (p_updates->>'representative_id')::uuid ELSE representative_id END,
        is_registered = CASE
            WHEN v_items_changed AND is_registered = TRUE THEN FALSE
            WHEN p_updates ? 'is_registered' THEN (p_updates->>'is_registered')::boolean
            ELSE is_registered
        END,
        needs_accounting_reregistration = CASE
            WHEN v_items_changed AND is_registered = TRUE THEN TRUE
            WHEN p_updates ? 'is_registered' AND (p_updates->>'is_registered')::boolean = TRUE THEN FALSE
            ELSE needs_accounting_reregistration
        END,
        workflow_type = CASE WHEN p_updates ? 'workflow_type' THEN (p_updates->>'workflow_type')::text ELSE workflow_type END,
        designer_id = CASE WHEN p_updates ? 'designer_id' THEN (p_updates->>'designer_id')::uuid ELSE designer_id END,
        design_url = CASE WHEN p_updates ? 'design_url' THEN (p_updates->>'design_url')::text ELSE design_url END,
        design_status = CASE WHEN p_updates ? 'design_status' THEN (p_updates->>'design_status')::text ELSE design_status END,
        design_price = CASE WHEN p_updates ? 'design_price' THEN (p_updates->>'design_price')::numeric ELSE design_price END,
        manual_design_price = CASE WHEN p_updates ? 'manual_design_price' THEN (p_updates->>'manual_design_price')::numeric ELSE manual_design_price END,
        actual_delivery_date = CASE WHEN p_updates ? 'actual_delivery_date' THEN (p_updates->>'actual_delivery_date')::date ELSE actual_delivery_date END,
        feedback = CASE WHEN p_updates ? 'feedback' THEN (p_updates->'feedback') ELSE feedback END,
        original_order_id = CASE WHEN p_updates ? 'original_order_id' THEN (p_updates->>'original_order_id')::uuid ELSE original_order_id END,
        status_history = CASE WHEN p_updates ? 'status_history' THEN (p_updates->'status_history') ELSE status_history END,
        rejected_lab_cost = CASE WHEN p_updates ? 'rejected_lab_cost' THEN (p_updates->>'rejected_lab_cost')::numeric ELSE rejected_lab_cost END,
        rejected_designer_cost = CASE WHEN p_updates ? 'rejected_designer_cost' THEN (p_updates->>'rejected_designer_cost')::numeric ELSE rejected_designer_cost END,
        rejection_doctor_decision = CASE WHEN p_updates ? 'rejection_doctor_decision' THEN (p_updates->>'rejection_doctor_decision')::text ELSE rejection_doctor_decision END,
        rejected_doctor_amount = CASE WHEN p_updates ? 'rejected_doctor_amount' THEN (p_updates->>'rejected_doctor_amount')::numeric ELSE rejected_doctor_amount END,
        rejection_financial_review_status = CASE WHEN p_updates ? 'rejection_financial_review_status' THEN (p_updates->>'rejection_financial_review_status')::text ELSE rejection_financial_review_status END,
        rejected_lab_cost_status = CASE WHEN p_updates ? 'rejected_lab_cost_status' THEN (p_updates->>'rejected_lab_cost_status')::text ELSE rejected_lab_cost_status END,
        rejected_designer_cost_status = CASE WHEN p_updates ? 'rejected_designer_cost_status' THEN (p_updates->>'rejected_designer_cost_status')::text ELSE rejected_designer_cost_status END,
        production_status = CASE WHEN p_updates ? 'production_status' THEN (p_updates->>'production_status')::text ELSE production_status END,
        issue_state = CASE WHEN p_updates ? 'issue_state' THEN (p_updates->>'issue_state')::text ELSE issue_state END,
        updated_at = NOW()
    WHERE id = p_order_id;

    IF p_items IS NOT NULL AND v_items_changed THEN
        DELETE FROM order_items WHERE order_id = p_order_id;
        IF jsonb_array_length(p_items) > 0 THEN
            INSERT INTO order_items (order_id, product_type, teeth_numbers, price, shade, count)
            SELECT p_order_id, item->>'product_type', item->'teeth_numbers', (item->>'price')::numeric,
                   item->>'shade', COALESCE((item->>'count')::int, 1)
            FROM jsonb_array_elements(p_items) supplied(item);
        END IF;
    END IF;

    IF p_comments IS NOT NULL THEN
        DELETE FROM order_comments WHERE order_id = p_order_id;
        IF jsonb_array_length(p_comments) > 0 THEN
            INSERT INTO order_comments (order_id, content, user_id, user_name, created_at)
            SELECT p_order_id, item->>'text', (item->>'userId')::uuid, item->>'userName',
                   COALESCE((item->>'createdAt')::timestamptz, NOW())
            FROM jsonb_array_elements(p_comments) supplied(item);
        END IF;
    END IF;

    SELECT to_jsonb(o.*) INTO v_result FROM orders o WHERE o.id = p_order_id;
    RETURN v_result;
END;
$$;

-- Catch real order_items writes that bypass update_order_atomic.
CREATE OR REPLACE FUNCTION public.reopen_order_after_direct_item_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order_id UUID := COALESCE(NEW.order_id, OLD.order_id);
BEGIN
    UPDATE orders
    SET is_registered = FALSE,
        needs_accounting_reregistration = TRUE
    WHERE id = v_order_id
      AND is_registered = TRUE;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS zz_reopen_order_after_direct_item_change ON public.order_items;
CREATE TRIGGER zz_reopen_order_after_direct_item_change
AFTER INSERT OR UPDATE OR DELETE ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.reopen_order_after_direct_item_change();
