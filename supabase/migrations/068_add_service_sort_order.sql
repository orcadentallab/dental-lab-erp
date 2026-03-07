-- Add sort_order column to services table for manual ordering
ALTER TABLE services ADD COLUMN IF NOT EXISTS sort_order INTEGER;

-- Initialize sort_order based on current alphabetical order
WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY name ASC) * 10 AS rn
    FROM services
)
UPDATE services
SET sort_order = ranked.rn
FROM ranked
WHERE services.id = ranked.id;
