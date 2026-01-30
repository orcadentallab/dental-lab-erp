-- Migration 048: Fix Admin Role
-- Date: 2026-01-30

-- Force update the user with username 'admin' to have the correct role
UPDATE public.users
SET role = 'admin'
WHERE username = 'admin';

-- Optional: If you are using a different username for the admin (e.g. your email),
-- you can manually update the role for your specific user ID using the dashboard.
-- But this script ensures the default 'admin' user has the 'admin' role.

-- Double check that the auth_id is set (it should be if you can login)
-- SELECT * FROM public.users WHERE username = 'admin';
