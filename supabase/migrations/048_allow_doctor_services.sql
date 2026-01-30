-- Migration 048: Allow Doctors to View Services
-- Date: 2026-01-30
-- Description: Update RLS policy to allow 'doctor' role to read from the 'services' table.
-- Why: Doctors need to select services when creating new order requests.

DROP POLICY IF EXISTS "services_select" ON services;

CREATE POLICY "services_select" ON services FOR SELECT TO authenticated
USING (
    get_my_role() IN ('admin', 'accountant', 'designer', 'lab', 'representative', 'doctor')
);
