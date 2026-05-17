-- Migration 047: Fix Services RLS for Representatives
-- Date: 2026-01-30
-- Description: Allow representatives to view services (needed for order creation).
-- Note: This exposes cost_price to the API level for representatives, but is necessary for the app to function until a View is implemented.

DROP POLICY IF EXISTS "services_select" ON services;

CREATE POLICY "services_select" ON services FOR SELECT TO authenticated
USING (
    get_my_role() IN ('admin', 'accountant', 'designer', 'lab', 'representative')
);
