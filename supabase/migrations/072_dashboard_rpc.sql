-- =====================================================================
-- Migration 072: Dashboard Performance RPC
-- Date: 2026-02-17
-- Purpose: 
-- 1. Create `get_dashboard_data` RPC to return aggregated dashboard metrics.
-- 2. Eliminates need for `getAllOrdersUnpaginated` on main landing page.
-- =====================================================================

CREATE OR REPLACE FUNCTION get_dashboard_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Use DEFINER to allow optimized aggregate queries, RLS logic handled inside
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_role TEXT;
    v_today DATE := CURRENT_DATE;
    v_entity_id UUID;
    
    -- Filtered Orders CTE
    v_active_orders JSONB;
    v_delayed_orders JSONB;
    v_unassigned_orders JSONB;
    v_new_orders JSONB;
    v_try_in_approved_orders JSONB;
    
    -- Stats
    v_stats JSONB;
    
    -- Supplier Data
    v_suppliers JSONB;
    
    -- Result
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();
    v_role := get_my_role(); 
    v_entity_id := get_my_entity_id(); -- Null if not lab/rep

    -- 1. DEFINE VISIBLE ORDERS (CTE Concept applied via temp table or direct query)
    -- We'll use a dynamic query based on role to get the relevant orders first.
    -- However, for performance in PLPGSQL, direct queries with role checks are okay.
    
    -- 2. GATHER DATA BASED ON ROLE
    
    IF v_role = 'lab' THEN
        -- LAB VIEW
        -- -------------------------------------------------------------
        
        -- My Active Orders (Not Delivered/Completed)
        SELECT jsonb_agg(sub) INTO v_active_orders FROM (
            SELECT 
                id, case_id, patient_name, delivery_date, status, technician_status, 
                items, is_urgent, priority, doctor_id -- needed for UI?
            FROM orders
            WHERE supplier_id = v_entity_id
              AND (status NOT IN ('Delivered', 'Ready', 'Returned for Adjustments'))
              AND (technician_status IS DISTINCT FROM 'Rejected')
            ORDER BY delivery_date ASC
        ) sub;

        -- My Delayed Orders
        SELECT jsonb_agg(sub) INTO v_delayed_orders FROM (
            SELECT id, case_id, patient_name, delivery_date, status
            FROM orders
            WHERE supplier_id = v_entity_id
              AND delivery_date < v_today
              AND (status NOT IN ('Delivered', 'Ready', 'Returned for Adjustments'))
              AND (technician_status IS DISTINCT FROM 'Rejected')
        ) sub;

        -- My Rejected Orders (Count mostly needed, let's get list for consistency if small)
        -- Dashboard.tsx calculates 'myRejected' count from list.
        -- Let's just return stats for counts to save bandwidth, and lists for tables.
        
        -- Stats
        SELECT jsonb_build_object(
            'active_count', (SELECT COUNT(*) FROM orders WHERE supplier_id = v_entity_id AND status NOT IN ('Delivered', 'Ready', 'Returned for Adjustments') AND technician_status IS DISTINCT FROM 'Rejected'),
            'delayed_count', (SELECT COUNT(*) FROM orders WHERE supplier_id = v_entity_id AND delivery_date < v_today AND status NOT IN ('Delivered', 'Ready', 'Returned for Adjustments')),
            'rejected_count', (SELECT COUNT(*) FROM orders WHERE supplier_id = v_entity_id AND (status = 'Returned for Adjustments' OR technician_status = 'Rejected')),
            'ready_today_count', (SELECT COUNT(*) FROM orders WHERE supplier_id = v_entity_id AND status = 'Ready' AND delivery_date = v_today)
        ) INTO v_stats;
        
        -- Try In Approved List
        SELECT jsonb_agg(sub) INTO v_try_in_approved_orders FROM (
             SELECT id, case_id, patient_name, delivery_date, status
             FROM orders
             WHERE supplier_id = v_entity_id AND status = 'Try In Approved'
        ) sub;

        v_result := jsonb_build_object(
            'role', 'lab',
            'stats', v_stats,
            'active_orders', COALESCE(v_active_orders, '[]'::jsonb),
            'delayed_orders', COALESCE(v_delayed_orders, '[]'::jsonb),
            'try_in_approved_orders', COALESCE(v_try_in_approved_orders, '[]'::jsonb)
        );

    ELSIF v_role = 'designer' THEN
        -- DESIGNER VIEW
        -- -------------------------------------------------------------
        SELECT jsonb_agg(sub) INTO v_active_orders FROM (
            SELECT id, case_id, patient_name, delivery_date, status, items
            FROM orders
            WHERE designer_id = v_user_id
              AND status IN ('New Case', 'Under Design', 'Waiting Dr Approval', 'Returned for Adjustments')
        ) sub;

        -- Stats
         SELECT jsonb_build_object(
            'pending_count', (SELECT COUNT(*) FROM orders WHERE designer_id = v_user_id AND status = 'New Case'),
            'in_progress_count', (SELECT COUNT(*) FROM orders WHERE designer_id = v_user_id AND status = 'Under Design'),
            'waiting_approval_count', (SELECT COUNT(*) FROM orders WHERE designer_id = v_user_id AND status = 'Waiting Dr Approval'),
            'returned_count', (SELECT COUNT(*) FROM orders WHERE designer_id = v_user_id AND status = 'Returned for Adjustments')
        ) INTO v_stats;

        v_result := jsonb_build_object(
            'role', 'designer',
            'orders', COALESCE(v_active_orders, '[]'::jsonb), -- Dashboard filters this list in JS
            'stats', v_stats
        );

    ELSE
        -- ADMIN / ACCOUNTANT / REPRESENTATIVE VIEW
        -- -------------------------------------------------------------
        
        -- 1. Active Orders (Global or Rep specific)
        -- Dashboard Active = Status not in (Delivered, Rejected, Cancelled, Returned)
        -- AND TechnicianStatus != Rejected
        
        -- Rep filtering:
        -- Dashboard.tsx logic for Rep is not explicit in filtering fetches (it fetches all).
        -- But RLS restricts Rep to see specific orders.
        -- Since we use SECURITY DEFINER, we MUST manually apply Rep logic if user is Rep.
        -- However, user said Rep sees "All Doctors" now.
        -- So Rep = Admin visibility for Dashboard purposes.
        
        -- Active Orders (Only returning necessary columns for the table)
        SELECT jsonb_agg(sub) INTO v_active_orders FROM (
            SELECT 
                id, case_id, patient_name, delivery_date, status, 
                doctor_id, items, is_urgent, priority, supplier_id,
                technician_status
            FROM orders
            WHERE status NOT IN ('Delivered', 'Rejected', 'Cancelled', 'Returned for Adjustments')
              AND (technician_status IS DISTINCT FROM 'Rejected' OR technician_status IS NULL)
              AND (
                  -- Standard Visibility Logic
                  v_role IN ('admin', 'accountant', 'representative') -- Rep sees all per latest instruction
                  -- If Rep was restricted: AND (v_role != 'representative' OR doctor_id IN ...)
              )
            ORDER BY delivery_date ASC
            LIMIT 50 -- Optimization: Only show top 50 soonest/active on dashboard?
                     -- Dashboard.tsx currently shows ALL active in "All Cases" table.
                     -- Let's return all active for now, but minimal columns.
        ) sub;

        -- Unassigned
        SELECT jsonb_agg(sub) INTO v_unassigned_orders FROM (
            SELECT id, case_id, patient_name, items, delivery_date, status
            FROM orders
            WHERE supplier_id IS NULL
              AND status NOT IN ('Delivered', 'Rejected', 'Cancelled', 'Returned for Adjustments')
              AND (technician_status IS DISTINCT FROM 'Rejected' OR technician_status IS NULL)
        ) sub;

        -- Delayed
        SELECT jsonb_agg(sub) INTO v_delayed_orders FROM (
            SELECT id, case_id, patient_name, items, delivery_date, status, is_urgent, priority
            FROM orders
            WHERE delivery_date < v_today
              AND status NOT IN ('Delivered', 'Rejected', 'Cancelled', 'Returned for Adjustments')
              AND (technician_status IS DISTINCT FROM 'Rejected' OR technician_status IS NULL)
        ) sub;
        
        -- New Orders (Waiting Acceptance)
        SELECT jsonb_agg(sub) INTO v_new_orders FROM (
            SELECT id, status
            FROM orders
            WHERE status = 'New Case'
        ) sub;

        -- Suppliers & Their Orders
        -- Dashboard maps suppliers to their orders.
        -- We can aggregate this efficiently.
        SELECT jsonb_agg(sup_obj) INTO v_suppliers FROM (
             SELECT 
                s.id, s.name,
                (
                    SELECT jsonb_agg(ord) FROM (
                        SELECT id, case_id, patient_name, items, delivery_date, status
                        FROM orders o
                        WHERE o.supplier_id = s.id
                          AND o.status NOT IN ('Delivered', 'Rejected', 'Cancelled', 'Returned for Adjustments')
                          AND (o.technician_status IS DISTINCT FROM 'Rejected' OR o.technician_status IS NULL)
                    ) ord
                ) as active_orders
             FROM suppliers s
        ) sup_obj;

        -- Stats
        SELECT jsonb_build_object(
            'active_count', (SELECT COUNT(*) FROM orders WHERE status NOT IN ('Delivered', 'Rejected', 'Cancelled', 'Returned for Adjustments') AND (technician_status IS DISTINCT FROM 'Rejected' OR technician_status IS NULL)),
            'delayed_count', jsonb_array_length(COALESCE(v_delayed_orders, '[]'::jsonb)),
            'unassigned_count', jsonb_array_length(COALESCE(v_unassigned_orders, '[]'::jsonb))
        ) INTO v_stats;

        v_result := jsonb_build_object(
            'role', 'admin', -- or rep/accountant, generic "manager" view
            'stats', v_stats,
            'active_orders', COALESCE(v_active_orders, '[]'::jsonb),
            'delayed_orders', COALESCE(v_delayed_orders, '[]'::jsonb),
            'unassigned_orders', COALESCE(v_unassigned_orders, '[]'::jsonb),
            'new_orders', COALESCE(v_new_orders, '[]'::jsonb),
            'suppliers', COALESCE(v_suppliers, '[]'::jsonb)
        );
        
    END IF;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_data() TO authenticated;
