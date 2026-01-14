-- Migration 035: Fix Supabase Security Warnings
-- Description: Fix search_path for functions and order_history INSERT policy

-- 1. Fix search_path for get_my_role
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER
SET search_path = public, auth;

-- 2. Fix search_path for get_my_entity_id
CREATE OR REPLACE FUNCTION get_my_entity_id()
RETURNS UUID AS $$
  SELECT entity_id FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER
SET search_path = public, auth;

-- 3. Fix search_path for get_my_user_id
CREATE OR REPLACE FUNCTION get_my_user_id()
RETURNS UUID AS $$
  SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER
SET search_path = public, auth;

-- 4. Fix search_path for update_updated_at_column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

-- 5. Fix search_path for log_order_changes
CREATE OR REPLACE FUNCTION log_order_changes()
RETURNS TRIGGER AS $$
DECLARE
    current_user_id UUID;
    current_user_name TEXT;
    changes_json JSONB;
    action_desc TEXT;
BEGIN
    current_user_id := auth.uid();
    
    SELECT name INTO current_user_name FROM public.users WHERE auth_id = current_user_id;
    IF current_user_name IS NULL THEN
        current_user_name := 'System/Unknown';
    END IF;

    changes_json := '{}'::JSONB;
    action_desc := 'Update Order';

    IF (TG_OP = 'INSERT') THEN
        INSERT INTO public.order_history (order_id, user_id, user_name, action_type, details, changes)
        VALUES (NEW.id, (SELECT id FROM public.users WHERE auth_id = current_user_id), current_user_name, 'CREATE', 'Order Created', to_jsonb(NEW));
        RETURN NEW;
        
    ELSIF (TG_OP = 'UPDATE') THEN
        IF (NEW.status IS DISTINCT FROM OLD.status) THEN
             action_desc := 'Status changed from ' || OLD.status || ' to ' || NEW.status;
             changes_json := jsonb_set(changes_json, '{status}', jsonb_build_object('old', OLD.status, 'new', NEW.status));
        END IF;

        IF (NEW.technician_status IS DISTINCT FROM OLD.technician_status) THEN
             action_desc := 'Lab Status changed to ' || (NEW.technician_status);
             changes_json := jsonb_set(changes_json, '{technician_status}', jsonb_build_object('old', OLD.technician_status, 'new', NEW.technician_status));
        END IF;
        
        IF (NEW.patient_name IS DISTINCT FROM OLD.patient_name) THEN
             changes_json := jsonb_set(changes_json, '{patient_name}', jsonb_build_object('old', OLD.patient_name, 'new', NEW.patient_name));
        END IF;
        
        INSERT INTO public.order_history (order_id, user_id, user_name, action_type, details, changes)
        VALUES (NEW.id, (SELECT id FROM public.users WHERE auth_id = current_user_id), current_user_name, 'UPDATE', action_desc, changes_json);
        
        RETURN NEW;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth;

-- 6. Fix search_path for check_order_update_permissions
CREATE OR REPLACE FUNCTION check_order_update_permissions()
RETURNS TRIGGER AS $$
BEGIN
  IF get_my_role() = 'admin' THEN
    RETURN NEW;
  END IF;

  IF get_my_role() = 'lab' THEN
    IF (NEW.id IS DISTINCT FROM OLD.id) OR
       (NEW.case_id IS DISTINCT FROM OLD.case_id) OR
       (NEW.doctor_id IS DISTINCT FROM OLD.doctor_id) OR
       (NEW.patient_name IS DISTINCT FROM OLD.patient_name) OR
       (NEW.items IS DISTINCT FROM OLD.items) OR
       (NEW.discount IS DISTINCT FROM OLD.discount) OR
       (NEW.total_price IS DISTINCT FROM OLD.total_price) OR
       (NEW.cost IS DISTINCT FROM OLD.cost) OR
       (NEW.shade IS DISTINCT FROM OLD.shade) OR
       (NEW.status IS DISTINCT FROM OLD.status) OR
       (NEW.delivery_date IS DISTINCT FROM OLD.delivery_date) OR
       (NEW.stl_url IS DISTINCT FROM OLD.stl_url) OR
       (NEW.images_url IS DISTINCT FROM OLD.images_url) OR
       (NEW.supplier_id IS DISTINCT FROM OLD.supplier_id) OR
       (NEW.instructions IS DISTINCT FROM OLD.instructions) OR
       (NEW.priority IS DISTINCT FROM OLD.priority) OR
       (NEW.delivery_type IS DISTINCT FROM OLD.delivery_type) OR
       (NEW.is_urgent IS DISTINCT FROM OLD.is_urgent) OR
       (NEW.representative_id IS DISTINCT FROM OLD.representative_id) OR
       (NEW.workflow_type IS DISTINCT FROM OLD.workflow_type) OR
       (NEW.designer_id IS DISTINCT FROM OLD.designer_id) OR
       (NEW.design_status IS DISTINCT FROM OLD.design_status) OR
       (NEW.design_price IS DISTINCT FROM OLD.design_price) OR
       (NEW.design_url IS DISTINCT FROM OLD.design_url) OR
       (NEW.is_registered IS DISTINCT FROM OLD.is_registered) OR
       (NEW.needs_design_review IS DISTINCT FROM OLD.needs_design_review) OR
       (NEW.created_at IS DISTINCT FROM OLD.created_at)
    THEN
       RAISE EXCEPTION 'Unauthorized: Labs can only update external_lab_status, external_lab_notes, and technician_status';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth;

-- 7. Fix order_history INSERT policy (currently allows unrestricted access)
DROP POLICY IF EXISTS "Users can insert history" ON order_history;
-- History should only be inserted by the trigger, not directly by users
-- If direct insert is needed, restrict to admins
CREATE POLICY "Only system can insert history" ON order_history
FOR INSERT TO authenticated
WITH CHECK (
    -- Allow only if the user is admin (for manual corrections)
    -- Normal inserts happen via trigger which runs as SECURITY DEFINER
    (SELECT role FROM public.users WHERE auth_id = auth.uid()) = 'admin'
);
