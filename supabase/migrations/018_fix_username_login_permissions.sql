-- Migration 018: Fix Username Login Permissions
-- Re-create function and ensure permissions are granted

CREATE OR REPLACE FUNCTION get_email_by_username(uname text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    found_email text;
BEGIN
    SELECT email INTO found_email
    FROM users 
    WHERE username ILIKE uname 
    LIMIT 1;
    
    RETURN found_email;
END;
$$;

-- Explicitly grant permissions again to be sure
GRANT EXECUTE ON FUNCTION get_email_by_username(text) TO anon;
GRANT EXECUTE ON FUNCTION get_email_by_username(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_email_by_username(text) TO service_role;
