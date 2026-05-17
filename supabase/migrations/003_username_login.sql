-- Migration 003: Function to resolve username to email securely
-- This allows users to login with username by looking up their email
-- Bypasses RLS to read strictly the email for the given username

CREATE OR REPLACE FUNCTION get_email_by_username(uname text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with privileges of creator (admin), bypassing RLS
SET search_path = public -- Secure search path
AS $$
DECLARE
    found_email text;
BEGIN
    SELECT email INTO found_email
    FROM users 
    WHERE username = uname 
    LIMIT 1;
    
    RETURN found_email;
END;
$$;

-- Grant access to everyone (including unauthenticated login page)
GRANT EXECUTE ON FUNCTION get_email_by_username(text) TO anon;
GRANT EXECUTE ON FUNCTION get_email_by_username(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_email_by_username(text) TO service_role;
