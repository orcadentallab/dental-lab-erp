-- Migration 047: Restore AI Analytics RLS Policies
-- Date: 2026-01-31
-- Purpose: Restore policies dropped by migration 045

-- 1. Ensure RLS is enabled
ALTER TABLE ai_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing if any (clean slate)
DROP POLICY IF EXISTS "ai_insights_admin_all" ON ai_insights;
DROP POLICY IF EXISTS "ai_insights_select" ON ai_insights;
DROP POLICY IF EXISTS "ai_insights_insert" ON ai_insights;
DROP POLICY IF EXISTS "ai_insights_update" ON ai_insights;
DROP POLICY IF EXISTS "ai_insights_delete" ON ai_insights;
DROP POLICY IF EXISTS "ai_insights_authenticated_all" ON ai_insights;

DROP POLICY IF EXISTS "ai_conversations_admin_all" ON ai_conversations;
DROP POLICY IF EXISTS "ai_conversations_select" ON ai_conversations;
DROP POLICY IF EXISTS "ai_conversations_insert" ON ai_conversations;
DROP POLICY IF EXISTS "ai_conversations_update" ON ai_conversations;
DROP POLICY IF EXISTS "ai_conversations_delete" ON ai_conversations;

DROP POLICY IF EXISTS "ai_messages_admin_all" ON ai_messages;
DROP POLICY IF EXISTS "ai_messages_select" ON ai_messages;
DROP POLICY IF EXISTS "ai_messages_insert" ON ai_messages;
DROP POLICY IF EXISTS "ai_messages_update" ON ai_messages;
DROP POLICY IF EXISTS "ai_messages_delete" ON ai_messages;

-- 3. Create Secure Policies (Admin all, Accountant select)

-- ai_insights
CREATE POLICY "ai_insights_select" ON ai_insights FOR SELECT TO authenticated
USING (get_my_role() IN ('admin', 'accountant'));

CREATE POLICY "ai_insights_insert" ON ai_insights FOR INSERT TO authenticated
WITH CHECK (get_my_role() IN ('admin', 'accountant'));

CREATE POLICY "ai_insights_update" ON ai_insights FOR UPDATE TO authenticated
USING (get_my_role() IN ('admin', 'accountant'))
WITH CHECK (get_my_role() IN ('admin', 'accountant'));

CREATE POLICY "ai_insights_delete" ON ai_insights FOR DELETE TO authenticated
USING (get_my_role() = 'admin');

-- ai_conversations
CREATE POLICY "ai_conversations_select" ON ai_conversations FOR SELECT TO authenticated
USING (get_my_role() IN ('admin', 'accountant'));

CREATE POLICY "ai_conversations_insert" ON ai_conversations FOR INSERT TO authenticated
WITH CHECK (get_my_role() IN ('admin', 'accountant'));

CREATE POLICY "ai_conversations_update" ON ai_conversations FOR UPDATE TO authenticated
USING (get_my_role() IN ('admin', 'accountant'))
WITH CHECK (get_my_role() IN ('admin', 'accountant'));

CREATE POLICY "ai_conversations_delete" ON ai_conversations FOR DELETE TO authenticated
USING (get_my_role() = 'admin');

-- ai_messages
CREATE POLICY "ai_messages_select" ON ai_messages FOR SELECT TO authenticated
USING (get_my_role() IN ('admin', 'accountant'));

CREATE POLICY "ai_messages_insert" ON ai_messages FOR INSERT TO authenticated
WITH CHECK (get_my_role() IN ('admin', 'accountant'));

CREATE POLICY "ai_messages_update" ON ai_messages FOR UPDATE TO authenticated
USING (get_my_role() IN ('admin', 'accountant'))
WITH CHECK (get_my_role() IN ('admin', 'accountant'));

CREATE POLICY "ai_messages_delete" ON ai_messages FOR DELETE TO authenticated
USING (get_my_role() = 'admin');

-- 4. Re-grant permissions
GRANT ALL ON ai_insights TO authenticated;
GRANT ALL ON ai_insights TO service_role;
GRANT ALL ON ai_conversations TO authenticated;
GRANT ALL ON ai_conversations TO service_role;
GRANT ALL ON ai_messages TO authenticated;
GRANT ALL ON ai_messages TO service_role;
