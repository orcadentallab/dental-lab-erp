-- Fix search_path security warning for functions
-- This prevents potential SQL injection through search_path manipulation

-- Fix sync_design_status_on_order_update function
CREATE OR REPLACE FUNCTION public.sync_design_status_on_order_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- When order status changes, ensure design task status is synchronized
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- If order is cancelled, cancel any pending design tasks
    IF NEW.status = 'cancelled' THEN
      UPDATE public.design_tasks 
      SET status = 'cancelled', updated_at = NOW()
      WHERE order_id = NEW.id AND status NOT IN ('completed', 'cancelled');
    END IF;
    
    -- If order status moves to 'Under Design', ensure design task exists
    IF NEW.status = 'Under Design' AND OLD.status = 'New Case' THEN
      -- Design task should already exist from order creation
      -- Just log if it doesn't for debugging
      IF NOT EXISTS (SELECT 1 FROM public.design_tasks WHERE order_id = NEW.id) THEN
        RAISE WARNING 'Order % moved to Under Design but no design task exists', NEW.id;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Fix log_design_status_inconsistency function
CREATE OR REPLACE FUNCTION public.log_design_status_inconsistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Log when design_status doesn't match computed value
  -- This helps identify synchronization issues
  IF NEW.design_status IS DISTINCT FROM OLD.design_status THEN
    INSERT INTO public.audit_log (
      table_name,
      record_id,
      action,
      old_values,
      new_values,
      performed_by,
      performed_at
    ) VALUES (
      'orders',
      NEW.id,
      'design_status_change',
      jsonb_build_object('design_status', OLD.design_status),
      jsonb_build_object('design_status', NEW.design_status),
      auth.uid(),
      NOW()
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.sync_design_status_on_order_update() TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_design_status_inconsistency() TO authenticated;
