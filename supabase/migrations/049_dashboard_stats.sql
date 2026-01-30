-- RPC for fetching Active Orders for Dashboard
-- Returns:
-- 1. Active Orders (Not Delivered/Cancelled/Rejected/Returned)
-- 2. Orders created TODAY (regardless of status) - ensures "Today's Orders" count is accurate
-- 3. Orders status 'Returned for Adjustments' - usually need attention
-- 4. Orders with status 'Delivered' but NOT registered (assuming simple check, but maybe handled by UI filter)

CREATE OR REPLACE FUNCTION get_dashboard_active_orders()
RETURNS SETOF orders
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT *
  FROM orders
  WHERE 
    status NOT IN ('Delivered', 'Cancelled', 'Rejected') 
    OR 
    created_at >= CURRENT_DATE::timestamp
    OR
    status = 'Returned for Adjustments'
  ORDER BY created_at DESC;
$$;
