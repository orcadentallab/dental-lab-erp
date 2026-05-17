-- Migration 049: Fix Admin Role (Postgres -> Admin)
-- Date: 2026-01-30

-- The debug message showed the user has role 'postgres'. 
-- This updates that specific user (and any others aimed at being admin) to the correct role 'admin'.

UPDATE public.users
SET role = 'admin'
WHERE auth_id = '5e93f943-566a-4582-8ad0-67c63ecdbd9a';

-- Also ensure anyone with username 'admin' has role 'admin'
UPDATE public.users
SET role = 'admin'
WHERE username = 'admin';
