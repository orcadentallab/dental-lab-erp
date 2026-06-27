-- =====================================================================
-- Migration 097: Enable Strict Representative Workflow
-- Date: 2026-06-27
-- Dependency Verification:
--   We have manually searched the codebase and verified that all
--   representative-role UI paths update order fields via the audited
--   RPC `rep_update_order_fields_with_audit` (using the JS helper
--   `repUpdateOrderWithAudit`) and never bypass the audit system.
-- =====================================================================

-- Set the strict workflow flag for representatives to 'on'
ALTER DATABASE postgres SET app.workflow_strict_rep = 'on';
