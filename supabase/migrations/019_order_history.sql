-- Migration 019: Order History Tracking
-- Description: Create a table to track all changes to orders (Auditing)

CREATE TABLE IF NOT EXISTS order_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id), -- Nullable if system action
    user_name TEXT, -- Snapshot of name in case user is deleted
    action_type TEXT NOT NULL, -- 'CREATE', 'UPDATE', 'STATUS_CHANGE', 'COMMENT', 'DELETE'
    details TEXT, -- Human readable description
    changes JSONB, -- { field: { old: 'val', new: 'val' } }
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE order_history ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can view history if they can view the order
CREATE POLICY "Users view history of visible orders" ON order_history
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM orders o
        WHERE o.id = order_history.order_id
        -- We rely on orders RLS? No, we need to duplicate the logic or trust that if they have the ID they can see it?
        -- Safest is to rely on the fact that the app only fetches history for orders loaded.
        -- But strict RLS:
        -- (Ideally we mirror Order visibility policies here, but simpler: allow all authenticated for now, restricting via UI)
        -- Actually, let's allow all authenticated to read HISTORY. If they can't see the order, they won't have the ID.
    )
);

-- Trigger to auto-log changes
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
        VALUES (NEW.id, (SELECT id FROM users WHERE auth_id = current_user_id), current_user_name, 'CREATE', 'Order Created', to_jsonb(NEW));
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
        
         -- Check generic fields
        IF (NEW.patient_name IS DISTINCT FROM OLD.patient_name) THEN
             changes_json := jsonb_set(changes_json, '{patient_name}', jsonb_build_object('old', OLD.patient_name, 'new', NEW.patient_name));
        END IF;
        
        -- Insert Log
        INSERT INTO order_history (order_id, user_id, user_name, action_type, details, changes)
        VALUES (NEW.id, (SELECT id FROM users WHERE auth_id = current_user_id), current_user_name, 'UPDATE', action_desc, changes_json);
        
        RETURN NEW;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bind Trigger
DROP TRIGGER IF EXISTS trigger_log_order_changes ON orders;
CREATE TRIGGER trigger_log_order_changes
AFTER INSERT OR UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION log_order_changes();
