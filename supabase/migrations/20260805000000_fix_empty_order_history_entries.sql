-- Do not create an audit entry for technical-only updates (for example,
-- updated_at). Older versions inserted "System/Unknown / Update Order" rows
-- with an empty changes object, which gave users no indication of what changed.

CREATE OR REPLACE FUNCTION public.log_order_changes()
RETURNS TRIGGER AS $$
DECLARE
    current_user_id UUID := auth.uid();
    current_user_name TEXT;
    current_profile_id UUID;
    changes_json JSONB := '{}'::JSONB;
    action_desc TEXT := 'Update Order';
    old_row JSONB;
    new_row JSONB;
    field_name TEXT;
    old_value JSONB;
    new_value JSONB;
BEGIN
    SELECT id, name
    INTO current_profile_id, current_user_name
    FROM public.users
    WHERE auth_id = current_user_id;

    IF current_user_name IS NULL THEN
        current_user_name := 'System/Unknown';
    END IF;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.order_history (order_id, user_id, user_name, action_type, details, changes)
        VALUES (NEW.id, current_profile_id, current_user_name, 'CREATE', 'Order Created', to_jsonb(NEW));
        RETURN NEW;
    END IF;

    -- Compare the complete order record. This means every business field is
    -- audited automatically, including fields added after this migration.
    -- IDs and timestamps are technical metadata, not user-facing changes.
    old_row := to_jsonb(OLD);
    new_row := to_jsonb(NEW);

    FOR field_name, new_value IN SELECT key, value FROM jsonb_each(new_row)
    LOOP
        IF field_name = ANY (ARRAY['id', 'created_at', 'updated_at']) THEN
            CONTINUE;
        END IF;

        old_value := old_row -> field_name;
        IF new_value IS DISTINCT FROM old_value THEN
            changes_json := jsonb_set(
                changes_json,
                ARRAY[field_name],
                jsonb_build_object('old', old_value, 'new', new_value)
            );
        END IF;
    END LOOP;

    IF changes_json ? 'status' THEN
        action_desc := 'Status changed';
    ELSIF changes_json ? 'delivery_date' THEN
        action_desc := 'Delivery date updated';
    END IF;

    -- The only changed column was a technical column such as updated_at.
    -- Do not add a misleading audit item.
    IF changes_json = '{}'::JSONB THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.order_history (order_id, user_id, user_name, action_type, details, changes)
    VALUES (NEW.id, current_profile_id, current_user_name, 'UPDATE', action_desc, changes_json);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth;
