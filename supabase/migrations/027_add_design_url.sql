-- Add design_url column to orders table if it doesn't exist
ALTER TABLE orders ADD COLUMN IF NOT EXISTS design_url TEXT;

-- Also ensure design_status has the correct values/type if not already handled
-- (Users might have skipped previous manual steps, so this is a safety net)
-- But primarily this is for design_url
