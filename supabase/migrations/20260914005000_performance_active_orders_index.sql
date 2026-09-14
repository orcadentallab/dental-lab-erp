-- Migration: Add partial indexes for speeding up active dashboard and orders queries
-- Safe, additive-only migration. Does NOT modify any existing tables, columns, or constraints.

-- 1. Index for active non-deleted orders (used heavily by Dashboard and Orders lists)
CREATE INDEX IF NOT EXISTS idx_orders_active_created_at 
ON public.orders (created_at DESC) 
WHERE (is_deleted = FALSE OR is_deleted IS NULL) 
  AND (is_archived = FALSE OR is_archived IS NULL);

-- 2. Index for unregistered candidate cases (used by accounting registration and nav badges)
CREATE INDEX IF NOT EXISTS idx_orders_unregistered_accounting 
ON public.orders (created_at DESC) 
WHERE (is_deleted = FALSE OR is_deleted IS NULL) 
  AND (exclude_from_accounting_registration IS DISTINCT FROM TRUE)
  AND (is_registered = FALSE OR is_registered IS NULL OR needs_accounting_reregistration = TRUE);

-- 3. Index on order_comments created_at for fast retrieval of recent comments
CREATE INDEX IF NOT EXISTS idx_order_comments_created_at 
ON public.order_comments (created_at DESC);
