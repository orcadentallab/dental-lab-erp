-- =====================================================================
-- Migration 058: Fix AI Conversations RLS Policy
-- Date: 2026-02-06
-- =====================================================================
-- Issue: 403 Forbidden when creating AI conversations
-- Root Cause: RLS policy requires get_my_role() = 'admin'/'accountant'
-- but some users may not have proper role mapping in users table
-- 
-- Fix: Allow any authenticated user to use AI features
-- (The AI should be accessible to all lab employees)
-- =====================================================================

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "ai_conversations_select" ON ai_conversations;
DROP POLICY IF EXISTS "ai_conversations_insert" ON ai_conversations;
DROP POLICY IF EXISTS "ai_conversations_update" ON ai_conversations;
DROP POLICY IF EXISTS "ai_conversations_delete" ON ai_conversations;

DROP POLICY IF EXISTS "ai_messages_select" ON ai_messages;
DROP POLICY IF EXISTS "ai_messages_insert" ON ai_messages;
DROP POLICY IF EXISTS "ai_messages_update" ON ai_messages;
DROP POLICY IF EXISTS "ai_messages_delete" ON ai_messages;

-- =====================================================================
-- AI CONVERSATIONS: Any authenticated user can use their own conversations
-- =====================================================================

-- SELECT: User can see their own conversations
CREATE POLICY "ai_conversations_select" ON ai_conversations 
FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- INSERT: Any authenticated user can create conversations for themselves
CREATE POLICY "ai_conversations_insert" ON ai_conversations 
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

-- UPDATE: User can update their own conversations
CREATE POLICY "ai_conversations_update" ON ai_conversations 
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- DELETE: User can delete their own conversations
CREATE POLICY "ai_conversations_delete" ON ai_conversations 
FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- =====================================================================
-- AI MESSAGES: User can access messages in their conversations
-- =====================================================================

-- SELECT: User can see messages in their conversations
CREATE POLICY "ai_messages_select" ON ai_messages 
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM ai_conversations 
        WHERE ai_conversations.id = ai_messages.conversation_id 
        AND ai_conversations.user_id = auth.uid()
    )
);

-- INSERT: User can add messages to their conversations
CREATE POLICY "ai_messages_insert" ON ai_messages 
FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM ai_conversations 
        WHERE ai_conversations.id = ai_messages.conversation_id 
        AND ai_conversations.user_id = auth.uid()
    )
);

-- UPDATE: User can update messages in their conversations
CREATE POLICY "ai_messages_update" ON ai_messages 
FOR UPDATE TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM ai_conversations 
        WHERE ai_conversations.id = ai_messages.conversation_id 
        AND ai_conversations.user_id = auth.uid()
    )
);

-- DELETE: User can delete messages in their conversations
CREATE POLICY "ai_messages_delete" ON ai_messages 
FOR DELETE TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM ai_conversations 
        WHERE ai_conversations.id = ai_messages.conversation_id 
        AND ai_conversations.user_id = auth.uid()
    )
);

-- =====================================================================
-- SUMMARY
-- =====================================================================
-- Changed from role-based access (admin/accountant only) to 
-- user-based access (each user owns their conversations)
-- This is more appropriate for a chat feature
-- =====================================================================
