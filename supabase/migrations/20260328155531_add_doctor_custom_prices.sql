-- Add custom_prices to doctors table
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS custom_prices JSONB DEFAULT '{}'::jsonb;

-- Ensure that the new column is returned in queries
-- We don't need additional setup for JSONB, just the column itself.
