-- Migration 004: Remove password field from users table
-- This migration removes the password field as we're using Supabase Auth exclusively

-- Note: Before running this migration, ensure all users have been migrated to Supabase Auth
-- and their auth_id is properly linked to auth.users

-- Remove password column from users table
ALTER TABLE users DROP COLUMN IF EXISTS password;

-- Add comment to table documenting the change
COMMENT ON TABLE users IS 'User profiles linked to Supabase Auth. Password management is handled by Supabase Auth exclusively.';
