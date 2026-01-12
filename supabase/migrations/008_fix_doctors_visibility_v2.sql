-- Migration 008: FORCE FIX Doctors Visibility
-- The previous migration might not have applied or conflicted.
-- This script brutally cleans up policies on 'doctors' table and resets them.

-- 1. Enable RLS (just in case)
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;

-- 2. DROP ALL EXISTING POLICIES ON DOCTORS
-- We use a DO block to loop and drop, or just drop known names.
-- Let's drop everything we know of.
DROP POLICY IF EXISTS "Admins view all doctors" ON doctors;
DROP POLICY IF EXISTS "Reps view all doctors" ON doctors;
DROP POLICY IF EXISTS "Authenticated users view all doctors" ON doctors;
DROP POLICY IF EXISTS "Reps/Admins can insert doctors" ON doctors;
DROP POLICY IF EXISTS "Authenticated users update doctors" ON doctors;
DROP POLICY IF EXISTS "Enable read access for all users" ON doctors; -- Default Supabase name
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON doctors;
DROP POLICY IF EXISTS "Enable update for users based on email" ON doctors;

-- 3. RE-CREATE THE "VIEW ALL" POLICY
-- This allows ANY logged-in user to see ALL doctors.
CREATE POLICY "Anyone can view doctors" ON doctors
AS PERMISSIVE -- Default, but being explicit
FOR SELECT
TO authenticated
USING (true);

-- 4. INSERT POLICY
CREATE POLICY "Admins and Reps can insert doctors" ON doctors
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IN (
    SELECT id FROM users WHERE role IN ('admin', 'representative', 'lab')
  )
  -- Or simpler if you trust the app to hide buttons:
  -- (true) 
  -- But let's stick to checking role via subquery or helper
  -- Assuming get_my_role() is available. If not, use subquery.
);

-- 5. UPDATE POLICY
CREATE POLICY "Admins and Reps can update doctors" ON doctors
FOR UPDATE
TO authenticated
USING (
  auth.uid() IN (
    SELECT id FROM users WHERE role IN ('admin', 'representative', 'lab')
  )
);
