-- Run this in Supabase SQL Editor to bulk approve all orders for the lab
-- This handles NULLs, Pending, and ensures everything old is marked as Approved

UPDATE orders 
SET technician_status = 'Approved' 
WHERE technician_status IS NULL 
   OR technician_status = 'Pending'
   OR technician_status = '';

-- Verify the update
-- SELECT count(*) FROM orders WHERE technician_status = 'Approved';
