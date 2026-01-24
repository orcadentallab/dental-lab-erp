-- ===========================================================================
-- Migration: 038_sync_design_status_trigger.sql
-- Purpose: Database safety net to enforce designStatus sync when status changes
-- For Split Workflows, automatically sync designStatus when status = 'Waiting Dr Approval'
-- ===========================================================================

-- Create the trigger function
CREATE OR REPLACE FUNCTION sync_design_status_on_order_update()
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
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists (idempotent)
DROP TRIGGER IF EXISTS trg_sync_design_status ON orders;

-- Create the BEFORE UPDATE trigger
CREATE TRIGGER trg_sync_design_status
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION sync_design_status_on_order_update();

-- Add comment explaining the trigger
COMMENT ON FUNCTION sync_design_status_on_order_update() IS 
    'Safety net trigger: Automatically synchronizes design_status when status changes for Split Workflow orders. Prevents status/designStatus divergence.';

-- Also add a constraint check as additional safety (won't break inserts, just validates)
-- This ensures that if status = 'Waiting Dr Approval' AND workflow_type = 'split', 
-- then design_status must be 'waiting_approval' (after trigger runs)
-- Note: Using a warning log rather than hard constraint to not break existing data

-- Create a function to log warnings about inconsistent states (for monitoring)
CREATE OR REPLACE FUNCTION log_design_status_inconsistency()
RETURNS TRIGGER AS $$
BEGIN
    -- Log warning if split workflow has mismatched statuses (shouldn't happen with trigger, but safety check)
    IF NEW.workflow_type = 'split' THEN
        IF NEW.status = 'Waiting Dr Approval' AND NEW.design_status != 'waiting_approval' THEN
            RAISE WARNING 'Design status inconsistency detected for order %: status=% but design_status=%', 
                NEW.id, NEW.status, NEW.design_status;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate audit trigger
DROP TRIGGER IF EXISTS trg_audit_design_status ON orders;

CREATE TRIGGER trg_audit_design_status
    AFTER INSERT OR UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION log_design_status_inconsistency();
