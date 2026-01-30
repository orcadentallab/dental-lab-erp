-- Migration 047: Admin Password Reset Function
-- Date: 2026-01-30

-- Ensure pgcrypto is available for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create RPC function to allow admins to reset user passwords
CREATE OR REPLACE FUNCTION admin_reset_password(target_user_id UUID, new_password TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    found_user_role TEXT; -- Renamed to avoid reserved keyword conflict
    target_auth_id UUID;
BEGIN
    -- 1. Check if the executing user is an 'admin' in the public.users table
    SELECT role INTO found_user_role 
    FROM public.users 
    WHERE auth_id = auth.uid();

    -- Check correct variable
    IF found_user_role IS NULL OR found_user_role != 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can reset passwords. My AuthID: %, Role Found: %', auth.uid(), found_user_role;
    END IF;

    -- 2. Get the auth_id of the target user from public.users
    SELECT auth_id INTO target_auth_id 
    FROM public.users 
    WHERE id = target_user_id;

    IF target_auth_id IS NULL THEN
        RAISE EXCEPTION 'User not found or has no linked auth account.';
    END IF;

    -- 3. Update the password in auth.users
    -- Using pgcrypto's crypt function with blowfish salt (standard for Supabase/Postgres)
    UPDATE auth.users
    SET encrypted_password = crypt(new_password, gen_salt('bf'))
    WHERE id = target_auth_id;

END;
$$;
