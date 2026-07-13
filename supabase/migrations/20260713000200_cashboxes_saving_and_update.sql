-- Add is_saving column to cashboxes table
ALTER TABLE cashboxes ADD COLUMN IF NOT EXISTS is_saving BOOLEAN NOT NULL DEFAULT FALSE;
