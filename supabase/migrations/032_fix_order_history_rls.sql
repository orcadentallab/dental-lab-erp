-- Migration 032: Fix Order History RLS
-- Description: Ensure order history respects orders RLS policies

DROP POLICY IF EXISTS "Users view history of visible orders" ON order_history;

-- This policy only returns history for orders the user can see
-- The subquery automatically applies Orders RLS
CREATE POLICY "Users view history of visible orders" ON order_history
FOR SELECT TO authenticated
USING (
    order_id IN (SELECT id FROM orders)
);
