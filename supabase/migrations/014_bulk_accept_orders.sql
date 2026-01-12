-- Run this in Supabase SQL Editor to accept all pending orders at once

UPDATE orders 
SET status = 'Accepted' 
WHERE status = 'Pending Confirmation';

-- This will change the status of all imported orders to "Accepted"
