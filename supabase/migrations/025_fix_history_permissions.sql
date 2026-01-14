-- Allow authenticated users (including designers) to INSERT into order_history
-- This is required because the 'log_order_changes' trigger runs with the permissions of the user performing the update.

GRANT INSERT ON order_history TO authenticated;
GRANT SELECT ON order_history TO authenticated;

-- Make sure the sequence is accessible if it exists (usually handled by serial/identity but good to ensure)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Also ensure they can see the suppliers table (already done in 023 but confirming for all 'authenticated' if needed, or specific roles)
-- Designers need to see suppliers for the dropdowns or name resolution.
GRANT SELECT ON suppliers TO authenticated;
