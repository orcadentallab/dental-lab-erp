-- Migration: Add 'Rejected' to order status check constraint
-- Description: Adds 'Rejected' as a valid order status value

-- 1. Drop the existing CHECK constraint
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

-- 2. Add new CHECK constraint including 'Rejected'
ALTER TABLE orders ADD CONSTRAINT orders_status_check 
CHECK (status IN (
    'Pending', 
    'In Progress', 
    'Completed', 
    'Delivered', 
    'New Case', 
    'Under Design', 
    'Waiting Dr Approval', 
    'Under Production', 
    'Try In', 
    'Try In Approved', 
    'Ready', 
    'Returned for Adjustments',
    'Rejected'
));
