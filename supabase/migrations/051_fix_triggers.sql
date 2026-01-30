-- ===========================================================================
-- Migration: 051_fix_triggers.sql
-- Purpose: Fix broken trigger functions from migration 039 that reference
--          missing tables 'public.design_tasks' and 'public.audit_log'.
--          Restores the safe logic from migration 038.
-- ===========================================================================

-- 1. Fix sync_design_status_on_order_update
-- Reverts to column-only logic, removing dependency on design_tasks table
CREATE OR REPLACE FUNCTION public.sync_design_status_on_order_update()
RETURNS TRIGGER AS $$
BEGIN
    -- Only apply to Split Workflow orders (workflow_type = 'split')
    IF NEW.workflow_type = 'split' THEN
        -- When status changes to 'Waiting Dr Approval', enforce designStatus = 'waiting_approval'
        IF NEW.status = 'Waiting Dr Approval' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
            NEW.design_status := 'waiting_approval';
        END IF;
        
        -- When status changes to 'Under Design', enforce designStatus = 'in_progress'
        IF NEW.status = 'Under Design' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
            NEW.design_status := 'in_progress';
        END IF;
        
        -- When status changes to production-related statuses, enforce designStatus = 'completed'
        IF NEW.status IN ('Under Production', 'Try In', 'Try In Approved', 'Ready', 'Ready for Delivery', 'Delivered') 
           AND (OLD.status IS DISTINCT FROM NEW.status) THEN
            NEW.design_status := 'completed';
        END IF;
        
        -- When status changes to 'Returned for Adjustments', enforce designStatus = 'returned'
        IF NEW.status = 'Returned for Adjustments' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
            NEW.design_status := 'returned';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Fix log_design_status_inconsistency
-- Reverts to RAISE WARNING, removing dependency on audit_log table
CREATE OR REPLACE FUNCTION public.log_design_status_inconsistency()
RETURNS TRIGGER AS $$
BEGIN
    -- Log warning if split workflow has mismatched statuses
    IF NEW.workflow_type = 'split' THEN
        IF NEW.status = 'Waiting Dr Approval' AND NEW.design_status != 'waiting_approval' THEN
            RAISE WARNING 'Design status inconsistency detected for order %: status=% but design_status=%', 
                NEW.id, NEW.status, NEW.design_status;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions again just in case
GRANT EXECUTE ON FUNCTION public.sync_design_status_on_order_update() TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_design_status_inconsistency() TO authenticated;
