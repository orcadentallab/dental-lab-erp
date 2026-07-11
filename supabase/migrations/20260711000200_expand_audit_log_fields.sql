-- Migration: Expand log_order_changes to track issue_state and rejected_lab_cost changes in order_history.

CREATE OR REPLACE FUNCTION log_order_changes()
RETURNS TRIGGER AS $$
DECLARE
    current_user_id UUID;
    current_user_name TEXT;
    changes_json JSONB;
    action_desc TEXT;
BEGIN
    current_user_id := auth.uid();
    
    -- Get user name safely
    SELECT name INTO current_user_name FROM users WHERE auth_id = current_user_id;
    IF current_user_name IS NULL THEN
        current_user_name := 'System/Unknown';
    END IF;

    changes_json := '{}'::JSONB;
    action_desc := 'Update Order';

    IF (TG_OP = 'INSERT') THEN
        INSERT INTO order_history (order_id, user_id, user_name, action_type, details, changes)
        VALUES (NEW.id, (SELECT id FROM public.users WHERE auth_id = current_user_id), current_user_name, 'CREATE', 'Order Created', to_jsonb(NEW));
        RETURN NEW;
        
    ELSIF (TG_OP = 'UPDATE') THEN
        -- Detect Status Change specifically
        IF (NEW.status IS DISTINCT FROM OLD.status) THEN
             action_desc := 'Status changed from ' || OLD.status || ' to ' || NEW.status;
             changes_json := jsonb_set(changes_json, '{status}', jsonb_build_object('old', OLD.status, 'new', NEW.status));
        END IF;

        IF (NEW.technician_status IS DISTINCT FROM OLD.technician_status) THEN
             action_desc := 'Lab Status changed to ' || (NEW.technician_status);
             changes_json := jsonb_set(changes_json, '{technician_status}', jsonb_build_object('old', OLD.technician_status, 'new', NEW.technician_status));
        END IF;
        
        -- Track Design Status
        IF (NEW.design_status IS DISTINCT FROM OLD.design_status) THEN
             action_desc := 'Design Status: ' || (NEW.design_status);
             changes_json := jsonb_set(changes_json, '{design_status}', jsonb_build_object('old', OLD.design_status, 'new', NEW.design_status));
        END IF;

        -- Track Design URL
        IF (NEW.design_url IS DISTINCT FROM OLD.design_url) THEN
             action_desc := 'Design Link Updated';
             changes_json := jsonb_set(changes_json, '{design_url}', jsonb_build_object('old', OLD.design_url, 'new', NEW.design_url));
        END IF;
        
        -- Track generic fields
        IF (NEW.patient_name IS DISTINCT FROM OLD.patient_name) THEN
             changes_json := jsonb_set(changes_json, '{patient_name}', jsonb_build_object('old', OLD.patient_name, 'new', NEW.patient_name));
        END IF;

        -- NEW: Track financial and operational fields
        IF (NEW.cost IS DISTINCT FROM OLD.cost) THEN
             changes_json := jsonb_set(changes_json, '{cost}', jsonb_build_object('old', OLD.cost, 'new', NEW.cost));
        END IF;

        IF (NEW.manual_cost IS DISTINCT FROM OLD.manual_cost) THEN
             changes_json := jsonb_set(changes_json, '{manual_cost}', jsonb_build_object('old', OLD.manual_cost, 'new', NEW.manual_cost));
        END IF;

        IF (NEW.total_price IS DISTINCT FROM OLD.total_price) THEN
             changes_json := jsonb_set(changes_json, '{total_price}', jsonb_build_object('old', OLD.total_price, 'new', NEW.total_price));
        END IF;

        IF (NEW.design_price IS DISTINCT FROM OLD.design_price) THEN
             changes_json := jsonb_set(changes_json, '{design_price}', jsonb_build_object('old', OLD.design_price, 'new', NEW.design_price));
        END IF;

        IF (NEW.manual_design_price IS DISTINCT FROM OLD.manual_design_price) THEN
             changes_json := jsonb_set(changes_json, '{manual_design_price}', jsonb_build_object('old', OLD.manual_design_price, 'new', NEW.manual_design_price));
        END IF;

        IF (NEW.discount IS DISTINCT FROM OLD.discount) THEN
             changes_json := jsonb_set(changes_json, '{discount}', jsonb_build_object('old', OLD.discount, 'new', NEW.discount));
        END IF;

        IF (NEW.delivery_date IS DISTINCT FROM OLD.delivery_date) THEN
             changes_json := jsonb_set(changes_json, '{delivery_date}', jsonb_build_object('old', OLD.delivery_date::text, 'new', NEW.delivery_date::text));
        END IF;

        IF (NEW.priority IS DISTINCT FROM OLD.priority) THEN
             changes_json := jsonb_set(changes_json, '{priority}', jsonb_build_object('old', OLD.priority, 'new', NEW.priority));
        END IF;

        IF (NEW.delivery_type IS DISTINCT FROM OLD.delivery_type) THEN
             changes_json := jsonb_set(changes_json, '{delivery_type}', jsonb_build_object('old', OLD.delivery_type, 'new', NEW.delivery_type));
        END IF;

        IF (NEW.doctor_id IS DISTINCT FROM OLD.doctor_id) THEN
             changes_json := jsonb_set(changes_json, '{doctor_id}', jsonb_build_object('old', OLD.doctor_id::text, 'new', NEW.doctor_id::text));
        END IF;

        IF (NEW.supplier_id IS DISTINCT FROM OLD.supplier_id) THEN
             changes_json := jsonb_set(changes_json, '{supplier_id}', jsonb_build_object('old', OLD.supplier_id::text, 'new', NEW.supplier_id::text));
        END IF;

        IF (NEW.designer_id IS DISTINCT FROM OLD.designer_id) THEN
             changes_json := jsonb_set(changes_json, '{designer_id}', jsonb_build_object('old', OLD.designer_id::text, 'new', NEW.designer_id::text));
        END IF;

        IF (NEW.is_redo IS DISTINCT FROM OLD.is_redo) THEN
             changes_json := jsonb_set(changes_json, '{is_redo}', jsonb_build_object('old', OLD.is_redo, 'new', NEW.is_redo));
        END IF;

        IF (NEW.is_urgent IS DISTINCT FROM OLD.is_urgent) THEN
             changes_json := jsonb_set(changes_json, '{is_urgent}', jsonb_build_object('old', OLD.is_urgent, 'new', NEW.is_urgent));
        END IF;
        
        -- Track issue_state and rejected_lab_cost
        IF (NEW.issue_state IS DISTINCT FROM OLD.issue_state) THEN
             changes_json := jsonb_set(changes_json, '{issue_state}', jsonb_build_object('old', OLD.issue_state, 'new', NEW.issue_state));
        END IF;

        IF (NEW.rejected_lab_cost IS DISTINCT FROM OLD.rejected_lab_cost) THEN
             changes_json := jsonb_set(changes_json, '{rejected_lab_cost}', jsonb_build_object('old', OLD.rejected_lab_cost, 'new', NEW.rejected_lab_cost));
        END IF;
        
        -- Insert Log
        INSERT INTO order_history (order_id, user_id, user_name, action_type, details, changes)
        VALUES (NEW.id, (SELECT id FROM public.users WHERE auth_id = current_user_id), current_user_name, 'UPDATE', action_desc, changes_json);
        
        RETURN NEW;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
