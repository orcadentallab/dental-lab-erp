-- Migration 064: Fix AI Insights RLS for all authenticated users
-- Date: 2026-02-03
-- Purpose: Allow all authenticated users to read/write ai_insights

-- Step 1: Remove ALL existing policies on ai_insights
DO $$ 
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'ai_insights'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON ai_insights', pol.policyname);
    END LOOP;
END $$;

-- Step 2: Disable then re-enable RLS with permissive policy
ALTER TABLE ai_insights DISABLE ROW LEVEL SECURITY;
ALTER TABLE ai_insights ENABLE ROW LEVEL SECURITY;

-- Step 3: Simple policy that allows all authenticated users
CREATE POLICY "ai_insights_allow_all" ON ai_insights
FOR ALL TO authenticated
USING (true)
WITH CHECK (true);

-- Step 4: Ensure grants
GRANT ALL ON ai_insights TO authenticated;
GRANT ALL ON ai_insights TO service_role;
