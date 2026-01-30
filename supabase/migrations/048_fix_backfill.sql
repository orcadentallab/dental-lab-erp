-- Migration 048: Fix Backfill Keys (ServiceType)
-- Date: 2026-01-30
-- Description: The previous backfill used 'type' instead of 'serviceType', resulting in NULL product_type.
-- This script deletes the invalid rows and re-runs the backfill for orders that are missing items.

-- 1. Remove failed backfill rows (where product_type is null)
-- Note: New orders created properly via the app will have product_type set, so they are safe.
DELETE FROM order_items WHERE product_type IS NULL;

-- 2. Run Backfill Again with correct key 'serviceType'
DO $$
DECLARE
    r RECORD;
    item JSONB;
BEGIN
    FOR r IN SELECT id, items FROM orders 
             WHERE items IS NOT NULL 
             AND jsonb_array_length(items) > 0 
             AND NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = orders.id) -- Only process if no items exist
    LOOP
        FOR item IN SELECT * FROM jsonb_array_elements(r.items) LOOP
            INSERT INTO order_items (order_id, product_type, teeth_numbers, shade, price, count)
            VALUES (
                r.id,
                item->>'serviceType', -- CORRECT KEY
                item->'teethNumbers', -- Checked: correct
                item->>'shade',
                (item->>'price')::numeric,
                COALESCE((item->>'count')::int, 1)
            );
        END LOOP;
    END LOOP;
END $$;
