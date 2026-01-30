-- =====================================================================
-- Migration 044: Fix Representative Dropdown + Auto-Set
-- Date: 2026-01-30
-- Purpose: 
--   1. Allow role-based read access to users for dropdowns
--   2. Auto-set representative_id when rep creates order
-- =====================================================================

-- =====================================================================
-- PART 1: Fix users RLS for dropdown access
-- =====================================================================

-- Drop old policies
DROP POLICY IF EXISTS "users_select" ON users;

-- NEW SELECT POLICY:
-- - Admin/Accountant: see all
-- - Other roles: see all users (needed for dropdowns) but actual data is limited
-- - Self: always see own record
-- 
-- Security note: This is acceptable because:
-- - Users table only contains: id, name, username, role, entity_id
-- - No sensitive data like passwords (handled by auth.users)
-- - Dropdowns need to show names/roles for assignment

CREATE POLICY "users_select" ON users FOR SELECT TO authenticated
USING (
    -- Everyone can read users for dropdowns (names, roles)
    -- Frontend should only display what's needed
    get_my_role() IS NOT NULL
);

-- Keep strict INSERT/UPDATE/DELETE as before
DROP POLICY IF EXISTS "users_insert" ON users;
DROP POLICY IF EXISTS "users_update" ON users;
DROP POLICY IF EXISTS "users_delete" ON users;

CREATE POLICY "users_insert" ON users FOR INSERT TO authenticated
WITH CHECK (get_my_role() = 'admin');

CREATE POLICY "users_update" ON users FOR UPDATE TO authenticated
USING (
    get_my_role() = 'admin'
    OR auth_id = auth.uid()  -- Self can update (password change)
)
WITH CHECK (
    get_my_role() = 'admin'
    OR (
        -- Non-admin: can update self but NOT change role
        auth_id = auth.uid()
        AND role = (SELECT role FROM users WHERE auth_id = auth.uid())
    )
);

CREATE POLICY "users_delete" ON users FOR DELETE TO authenticated
USING (get_my_role() = 'admin');

-- =====================================================================
-- PART 2: Auto-set representative_id on order INSERT
-- =====================================================================

-- Function: Auto-set representative_id when representative creates order
CREATE OR REPLACE FUNCTION auto_set_representative_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    current_role TEXT;
    current_user_id UUID;
BEGIN
    -- Get current user's role and id
    SELECT role, id INTO current_role, current_user_id 
    FROM users WHERE auth_id = auth.uid();
    
    -- If representative is creating order AND didn't set representative_id
    IF current_role = 'representative' AND (NEW.representative_id IS NULL OR NEW.representative_id = '') THEN
        NEW.representative_id := current_user_id;
    END IF;
    
    RETURN NEW;
END;
$$;

-- Create trigger (runs BEFORE INSERT)
DROP TRIGGER IF EXISTS trigger_auto_set_representative ON orders;
CREATE TRIGGER trigger_auto_set_representative
    BEFORE INSERT ON orders
    FOR EACH ROW
    EXECUTE FUNCTION auto_set_representative_id();

-- =====================================================================
-- SUMMARY
-- =====================================================================
-- ✅ Users can now read other users (for dropdowns)
-- ✅ Users table is still write-protected (admin only + self-update without role change)
-- ✅ Representative_id auto-sets when rep creates order
-- =====================================================================
