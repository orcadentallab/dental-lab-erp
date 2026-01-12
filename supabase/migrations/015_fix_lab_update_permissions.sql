-- Migration 015: Fix Lab Update Permissions
-- Description: Labs need to be able to update technician_status, not just external_lab_status

-- Drop the old restrictive trigger
DROP TRIGGER IF EXISTS enforce_lab_column_updates ON orders;
DROP FUNCTION IF EXISTS check_lab_column_updates();

-- Create a new, less restrictive trigger that allows technician_status updates
CREATE OR REPLACE FUNCTION check_lab_column_updates()
RETURNS TRIGGER AS $$
DECLARE
  current_role TEXT;
BEGIN
  SELECT role INTO current_role FROM users WHERE auth_id = auth.uid();

  -- If user is Lab
  IF current_role = 'lab' THEN
    -- Labs can ONLY update these columns:
    -- technician_status, technician_notes (for confirmation workflow)
    -- external_lab_status, external_lab_notes (legacy)
    IF (
       (NEW.doctor_id IS DISTINCT FROM OLD.doctor_id) OR
       (NEW.patient_name IS DISTINCT FROM OLD.patient_name) OR
       (NEW.total_price IS DISTINCT FROM OLD.total_price) OR
       (NEW.representative_id IS DISTINCT FROM OLD.representative_id) OR
       (NEW.status IS DISTINCT FROM OLD.status)
       -- We REMOVED technician_status from this list, allowing Labs to update it
    ) THEN
       RAISE EXCEPTION 'Unauthorized: Labs can only update technician_status, external_lab_status, and notes';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER enforce_lab_column_updates
BEFORE UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION check_lab_column_updates();
