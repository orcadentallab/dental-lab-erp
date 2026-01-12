-- Migration 017: Make Username Login Case-Insensitive
-- Update the function to use ILIKE for case-insensitive matching

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
