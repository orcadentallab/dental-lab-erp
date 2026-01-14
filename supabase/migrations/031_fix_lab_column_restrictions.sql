-- Migration 031: Complete Lab Column Restrictions
-- Description: Prevent external labs from modifying columns they shouldn't

CREATE OR REPLACE FUNCTION check_order_update_permissions()
RETURNS TRIGGER AS $$
BEGIN
  -- Admins can do anything
  IF get_my_role() = 'admin' THEN
    RETURN NEW;
  END IF;

  -- Lab users have strict column restrictions
  IF get_my_role() = 'lab' THEN
    -- Labs can ONLY update: external_lab_status, external_lab_notes, technician_status
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

  -- Other roles pass through (RLS handles row access)
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
