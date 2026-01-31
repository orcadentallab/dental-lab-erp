-- =====================================================================
-- Migration 057: Fix Performance and Comments RLS
-- Date: 2026-02-01
-- =====================================================================
-- Issues Fixed:
-- 1. Performance: Add indexes and optimize role lookup
-- 2. Comments: Allow all authenticated users to manage comments
-- =====================================================================

-- =====================================================================
-- PART 1: PERFORMANCE INDEXES
-- =====================================================================
-- These indexes speed up common queries

-- Index for status filtering (very common in Orders page)
CREATE INDEX IF NOT EXISTS idx_orders_status 
ON orders(status);

-- Index for date-based queries
CREATE INDEX IF NOT EXISTS idx_orders_created_at_desc 
ON orders(created_at DESC);

-- Index for user auth lookup (speeds up RLS)
CREATE INDEX IF NOT EXISTS idx_users_auth_id 
ON users(auth_id);

-- Index for role-based queries
CREATE INDEX IF NOT EXISTS idx_users_role 
ON users(role);

-- Index for doctor lookups
CREATE INDEX IF NOT EXISTS idx_orders_doctor_id 
ON orders(doctor_id);

-- Index for supplier lookups
CREATE INDEX IF NOT EXISTS idx_orders_supplier_id 
ON orders(supplier_id);

-- Index for designer lookups
CREATE INDEX IF NOT EXISTS idx_orders_designer_id 
ON orders(designer_id);

-- =====================================================================
-- PART 2: FIX ORDER_COMMENTS RLS POLICIES
-- =====================================================================
-- Current Issue: DELETE/UPDATE only allowed for owner or admin
-- Fix: Allow anyone who can see the order to manage its comments

-- Drop restrictive policies
DROP POLICY IF EXISTS "order_comments_mod" ON order_comments;
DROP POLICY IF EXISTS "order_comments_del" ON order_comments;

-- Create permissive policies
-- UPDATE: Anyone who can see the order can update comments
CREATE POLICY "order_comments_update" ON order_comments 
FOR UPDATE TO authenticated
USING (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = order_comments.order_id)
)
WITH CHECK (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = order_comments.order_id)
);

-- DELETE: Anyone who can see the order can delete comments
CREATE POLICY "order_comments_delete" ON order_comments 
FOR DELETE TO authenticated
USING (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = order_comments.order_id)
);

-- =====================================================================
-- PART 3: OPTIMIZE get_my_role() FUNCTION
-- =====================================================================
-- Make function STABLE so PostgreSQL can cache the result within a query

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role FROM users WHERE auth_id = auth.uid() LIMIT 1
$$;

-- Also optimize get_my_user_id()
CREATE OR REPLACE FUNCTION get_my_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id FROM users WHERE auth_id = auth.uid() LIMIT 1
$$;

-- Also optimize get_my_entity_id()
CREATE OR REPLACE FUNCTION get_my_entity_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT entity_id FROM users WHERE auth_id = auth.uid() LIMIT 1
$$;

-- =====================================================================
-- SUMMARY
-- =====================================================================
-- 1. Added 7 performance indexes
-- 2. Fixed order_comments RLS to allow all authenticated users
-- 3. Optimized helper functions with STABLE keyword for caching
-- =====================================================================
