-- 1. Add status_history column if it doesn't exist
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_history JSONB;

-- 2. Drop the existing CHECK constraint for status
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

-- 3. Add the new CHECK constraint including 'Try In Approved'
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
    'Returned for Adjustments'
));
