-- =====================================================================
-- Migration 076: Add rejected_lab_cost to orders table
-- Date: 2026-03-11
-- Purpose: Allow specifying a specific cost towards the lab when an 
-- order is rejected, instead of always assuming cost is 0.
-- =====================================================================

ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS rejected_lab_cost NUMERIC DEFAULT NULL;

-- Update the update_order_atomic RPC to handle rejected_lab_cost
CREATE OR REPLACE FUNCTION update_order_atomic(
    p_order_id UUID,
    p_updates JSONB,           -- Fields to update in 'orders' table
    p_items JSONB DEFAULT NULL, -- Optional: New order items (replaces old)
    p_comments JSONB DEFAULT NULL -- Optional: New/Updated comments (replaces old)
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_order_exists BOOLEAN;
    v_result JSONB;
BEGIN
    SELECT EXISTS(SELECT 1 FROM orders WHERE id = p_order_id) INTO v_order_exists;
    IF NOT v_order_exists THEN
        RAISE EXCEPTION 'Order not found or access denied: %', p_order_id;
    END IF;

    UPDATE orders
    SET
        case_id = CASE WHEN p_updates ? 'case_id' THEN (p_updates->>'case_id')::text ELSE case_id END,
        doctor_id = CASE WHEN p_updates ? 'doctor_id' THEN (p_updates->>'doctor_id')::uuid ELSE doctor_id END,
        patient_name = CASE WHEN p_updates ? 'patient_name' THEN (p_updates->>'patient_name')::text ELSE patient_name END,
        status = CASE WHEN p_updates ? 'status' THEN (p_updates->>'status')::text ELSE status END,
        delivery_date = CASE WHEN p_updates ? 'delivery_date' THEN (p_updates->>'delivery_date')::date ELSE delivery_date END,
        cost = CASE WHEN p_updates ? 'cost' THEN (p_updates->>'cost')::numeric ELSE cost END,
        discount = CASE WHEN p_updates ? 'discount' THEN (p_updates->>'discount')::numeric ELSE discount END,
        total_price = CASE WHEN p_updates ? 'total_price' THEN (p_updates->>'total_price')::numeric ELSE total_price END,
        instructions = CASE WHEN p_updates ? 'instructions' THEN (p_updates->>'instructions')::text ELSE instructions END,
        priority = CASE WHEN p_updates ? 'priority' THEN (p_updates->>'priority')::text ELSE priority END,
        is_urgent = CASE WHEN p_updates ? 'is_urgent' THEN (p_updates->>'is_urgent')::boolean ELSE is_urgent END,
        is_redo = CASE WHEN p_updates ? 'is_redo' THEN (p_updates->>'is_redo')::boolean ELSE is_redo END,
        is_archived = CASE WHEN p_updates ? 'is_archived' THEN (p_updates->>'is_archived')::boolean ELSE is_archived END,
        
        -- Optional fields
        stl_url = CASE WHEN p_updates ? 'stl_url' THEN (p_updates->>'stl_url')::text ELSE stl_url END,
        images_url = CASE WHEN p_updates ? 'images_url' THEN (p_updates->>'images_url')::text ELSE images_url END,
        supplier_id = CASE WHEN p_updates ? 'supplier_id' THEN (p_updates->>'supplier_id')::uuid ELSE supplier_id END,
        technician_status = CASE WHEN p_updates ? 'technician_status' THEN (p_updates->>'technician_status')::text ELSE technician_status END,
        representative_id = CASE WHEN p_updates ? 'representative_id' THEN (p_updates->>'representative_id')::uuid ELSE representative_id END,
        is_registered = CASE WHEN p_updates ? 'is_registered' THEN (p_updates->>'is_registered')::boolean ELSE is_registered END,
        workflow_type = CASE WHEN p_updates ? 'workflow_type' THEN (p_updates->>'workflow_type')::text ELSE workflow_type END,
        designer_id = CASE WHEN p_updates ? 'designer_id' THEN (p_updates->>'designer_id')::uuid ELSE designer_id END,
        design_url = CASE WHEN p_updates ? 'design_url' THEN (p_updates->>'design_url')::text ELSE design_url END,
        design_status = CASE WHEN p_updates ? 'design_status' THEN (p_updates->>'design_status')::text ELSE design_status END,
        design_price = CASE WHEN p_updates ? 'design_price' THEN (p_updates->>'design_price')::numeric ELSE design_price END,
        actual_delivery_date = CASE WHEN p_updates ? 'actual_delivery_date' THEN (p_updates->>'actual_delivery_date')::date ELSE actual_delivery_date END,
        feedback = CASE WHEN p_updates ? 'feedback' THEN (p_updates->'feedback') ELSE feedback END,
        original_order_id = CASE WHEN p_updates ? 'original_order_id' THEN (p_updates->>'original_order_id')::uuid ELSE original_order_id END,
        status_history = CASE WHEN p_updates ? 'status_history' THEN (p_updates->'status_history') ELSE status_history END,
        
        -- New field
        rejected_lab_cost = CASE WHEN p_updates ? 'rejected_lab_cost' THEN (p_updates->>'rejected_lab_cost')::numeric ELSE rejected_lab_cost END,

        updated_at = NOW()
    WHERE id = p_order_id;

    IF p_items IS NOT NULL THEN
        DELETE FROM order_items WHERE order_id = p_order_id;
        
        IF jsonb_array_length(p_items) > 0 THEN
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
                x->>'product_type',
                x->'teeth_numbers',
                (x->>'price')::numeric,
                x->>'shade',
                COALESCE((x->>'count')::int, 1)
            FROM jsonb_array_elements(p_items) t(x);
        END IF;
    END IF;

    IF p_comments IS NOT NULL THEN
        DELETE FROM order_comments WHERE order_id = p_order_id;
        
        IF jsonb_array_length(p_comments) > 0 THEN
            INSERT INTO order_comments (
                order_id,
                content,
                user_id,
                user_name,
                created_at
            )
            SELECT 
                p_order_id,
                x->>'text',
                (x->>'userId')::uuid,
                x->>'userName',
                (x->>'createdAt')::timestamptz
            FROM jsonb_array_elements(p_comments) t(x);
        END IF;
    END IF;

    SELECT row_to_json(o) INTO v_result FROM orders o WHERE id = p_order_id;
    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$;
