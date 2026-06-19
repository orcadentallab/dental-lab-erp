-- Migration to add Branches support to doctors and orders
ALTER TABLE public.doctors
ADD COLUMN IF NOT EXISTS has_branches BOOLEAN DEFAULT FALSE NOT NULL,
ADD COLUMN IF NOT EXISTS branches JSONB DEFAULT NULL;

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS branch_name TEXT DEFAULT NULL;

-- Index for faster lookups by branch name
CREATE INDEX IF NOT EXISTS idx_orders_branch_name ON public.orders(branch_name);
