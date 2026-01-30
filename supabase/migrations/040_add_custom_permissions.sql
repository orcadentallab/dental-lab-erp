-- Migration 040: Add custom_permissions column to users table
-- Allows per-user permission overrides beyond their base role

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS custom_permissions JSONB DEFAULT '{}';

COMMENT ON COLUMN users.custom_permissions IS 
'JSON object with permission overrides. Format: {"view_finance": true, "view_doctors": false}';

-- Create index for faster permission lookups
CREATE INDEX IF NOT EXISTS idx_users_custom_permissions ON users USING GIN (custom_permissions);
