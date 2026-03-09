-- Migration: Sync Service Name Changes
-- Description: Adds a Postgres Trigger to automatically update historical orders and supplier prices when a service is renamed.

-- 1. Create the function that performs the automatic update across all tables
CREATE OR REPLACE FUNCTION sync_service_name_changes()
RETURNS TRIGGER AS $$
BEGIN
    -- Only proceed if the name was actually changed
    IF NEW.name <> OLD.name THEN
        
        -- Update in order_items table
        UPDATE order_items 
        SET product_type = NEW.name
        WHERE product_type = OLD.name;

        -- Update inside the orders JSONB array (Historical Invoices)
        UPDATE orders
        SET items = (
            SELECT jsonb_agg(
                CASE 
                    WHEN item->>'serviceType' = OLD.name THEN 
                        jsonb_set(item, '{serviceType}', to_jsonb(NEW.name))
                    WHEN item->>'serviceType' ILIKE '%' || OLD.name || '%' THEN
                        jsonb_set(item, '{serviceType}', to_jsonb(REPLACE(item->>'serviceType', OLD.name, NEW.name)))
                    ELSE 
                        item 
                END
            )
            FROM jsonb_array_elements(items) AS item
        )
        WHERE items::text ILIKE '%' || OLD.name || '%';

        -- Update inside Suppliers' Custom Prices
        UPDATE suppliers
        SET custom_prices = (custom_prices - OLD.name) || jsonb_build_object(NEW.name, custom_prices->OLD.name)
        WHERE custom_prices ? OLD.name;

        -- Update inside Suppliers' Milling Prices
        UPDATE suppliers
        SET milling_prices = (milling_prices - OLD.name) || jsonb_build_object(NEW.name, milling_prices->OLD.name)
        WHERE milling_prices ? OLD.name;

    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Attach the function to the services table to run automatically on any UPDATE
DROP TRIGGER IF EXISTS trigger_sync_service_name_changes ON services;
CREATE TRIGGER trigger_sync_service_name_changes
AFTER UPDATE OF name ON services
FOR EACH ROW
EXECUTE FUNCTION sync_service_name_changes();
