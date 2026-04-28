-- Migration 079: Log delivery date changes in order history
-- Purpose: Ensure representative/admin delivery date edits are auditable

CREATE OR REPLACE FUNCTION public.log_order_changes()
RETURNS TRIGGER AS $$
DECLARE
    current_user_id UUID;
    current_user_name TEXT;
    changes_json JSONB;
    action_desc TEXT;
BEGIN
    current_user_id := auth.uid();

    SELECT name INTO current_user_name
    FROM public.users
    WHERE auth_id = current_user_id;

    IF current_user_name IS NULL THEN
        current_user_name := 'System/Unknown';
    END IF;

    changes_json := '{}'::JSONB;
    action_desc := 'Update Order';

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.order_history (order_id, user_id, user_name, action_type, details, changes)
        VALUES (
            NEW.id,
            (SELECT id FROM public.users WHERE auth_id = current_user_id),
            current_user_name,
            'CREATE',
            'Order Created',
            to_jsonb(NEW)
        );
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            action_desc := 'Status changed from ' || OLD.status || ' to ' || NEW.status;
            changes_json := jsonb_set(changes_json, '{status}', jsonb_build_object('old', OLD.status, 'new', NEW.status));
        END IF;

        IF NEW.technician_status IS DISTINCT FROM OLD.technician_status THEN
            action_desc := 'Lab Status changed to ' || NEW.technician_status;
            changes_json := jsonb_set(changes_json, '{technician_status}', jsonb_build_object('old', OLD.technician_status, 'new', NEW.technician_status));
        END IF;

        IF NEW.design_status IS DISTINCT FROM OLD.design_status THEN
            action_desc := 'Design Status: ' || NEW.design_status;
            changes_json := jsonb_set(changes_json, '{design_status}', jsonb_build_object('old', OLD.design_status, 'new', NEW.design_status));
        END IF;

        IF NEW.design_url IS DISTINCT FROM OLD.design_url THEN
            action_desc := 'Design Link Updated';
            changes_json := jsonb_set(changes_json, '{design_url}', jsonb_build_object('old', OLD.design_url, 'new', NEW.design_url));
        END IF;

        IF NEW.patient_name IS DISTINCT FROM OLD.patient_name THEN
            changes_json := jsonb_set(changes_json, '{patient_name}', jsonb_build_object('old', OLD.patient_name, 'new', NEW.patient_name));
        END IF;

        IF NEW.delivery_date IS DISTINCT FROM OLD.delivery_date THEN
            action_desc := 'Delivery date updated';
            changes_json := jsonb_set(changes_json, '{delivery_date}', jsonb_build_object('old', OLD.delivery_date, 'new', NEW.delivery_date));
        END IF;

        INSERT INTO public.order_history (order_id, user_id, user_name, action_type, details, changes)
        VALUES (
            NEW.id,
            (SELECT id FROM public.users WHERE auth_id = current_user_id),
            current_user_name,
            'UPDATE',
            action_desc,
            changes_json
        );

        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth;
