-- Migration 089: Add operational active flags for users and external labs.
-- Purpose:
-- - Inactive representatives/admin reps stop appearing in new order assignment.
-- - Inactive representatives stop appearing in staff payroll from their deactivation month onward.
-- - Inactive suppliers stop appearing in new order/external lab assignment lists.

ALTER TABLE users
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE suppliers
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_users_role_is_active
ON users(role, is_active);

CREATE INDEX IF NOT EXISTS idx_suppliers_is_active
ON suppliers(is_active);

COMMENT ON COLUMN users.is_active IS 'Operational flag. Inactive representatives are hidden from new assignments and payroll from deactivation month onward.';
COMMENT ON COLUMN users.deactivated_at IS 'Timestamp used to keep historical staff payroll visible for months before deactivation.';
COMMENT ON COLUMN suppliers.is_active IS 'Operational flag. Inactive suppliers are hidden from new external lab assignment lists.';

NOTIFY pgrst, 'reload schema';
