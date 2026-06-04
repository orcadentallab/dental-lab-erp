-- Add designer_price to services table
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS designer_price numeric(10, 2);

-- Add manual_design_price to orders table
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS manual_design_price numeric(10, 2);

-- Add designer_service_prices to users table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS designer_service_prices jsonb;

-- Optionally, add comments for the schema cache
COMMENT ON COLUMN public.services.designer_price IS 'Default designer cost per unit (0 = not billed to designer)';
COMMENT ON COLUMN public.orders.manual_design_price IS 'Admin override for designPrice in split workflow';
COMMENT ON COLUMN public.users.designer_service_prices IS 'Per-service price overrides for designers';
