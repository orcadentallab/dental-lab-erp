-- Add milling_price column to services table
ALTER TABLE services ADD COLUMN IF NOT EXISTS milling_price NUMERIC(10,2) DEFAULT 0;
