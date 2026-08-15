-- Migration: per-doctor inputs for the A/B/C/D profitability grading.
--
-- Returns ONLY the facts the grading needs that no existing RPC provides:
-- order volume, how many of those orders carried a problem, and how long the
-- doctor has been a customer. Gross profit and margin come from
-- get_doctor_service_profitability; the aging split comes from
-- get_doctor_receivables_breakdown. Nothing is recomputed here that one of
-- those already answers, so the three cannot drift apart.
--
-- The score itself is deliberately NOT computed in SQL. The weights and
-- thresholds are owner-facing policy that must be visible and reviewable in
-- the UI (see REPORTS_IMPLEMENTATION_PLAN_AR.md task 4.3); burying them in a
-- function body would hide the one part of this report the owner most needs
-- to argue with.
--
-- GROUPING: COALESCE(doctors.parent_id, doctors.id), identical to
-- get_doctor_receivables_breakdown and get_doctor_service_profitability, so
-- all three keys join cleanly.
--
-- ARCHIVED ORDERS ARE INCLUDED (rule 0-A) — for the remake rate this matters
-- twice over, since archiving a closed case would otherwise erase exactly the
-- problems the rate is meant to count.
--
-- ISSUE SOURCE is order_issues (rule 5), never orders.status, and voided
-- rows are excluded: a mis-logged issue that an admin voided through
-- void_order_issue is not evidence against the doctor.
--
-- The numerator counts DISTINCT orders, not issue rows, so one order with
-- three logged problems cannot push a doctor's remake rate above 100%.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_doctor_segmentation_inputs(
    p_start_date DATE DEFAULT NULL,
    p_end_date   DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;

    WITH scoped_orders AS (
        SELECT
            o.id AS order_id,
            COALESCE(d.parent_id, o.doctor_id) AS billing_doctor_id,
            CASE WHEN o.production_status = 'final_delivered'
                THEN COALESCE(o.actual_delivery_date, o.delivery_date, o.created_at::date)
                ELSE COALESCE(o.delivery_date, o.created_at::date)
            END AS statement_date
        FROM orders o
        LEFT JOIN doctors d ON d.id = o.doctor_id
        WHERE COALESCE(o.is_deleted, false) = false
          AND o.doctor_id IS NOT NULL
          AND lower(o.status) IN (
              'delivered', 'completed', 'cancelled', 'rejected',
              'doctor rejected', 'lab rejected', 'returned for adjustments'
          )
    ),
    orders_in_range AS (
        SELECT * FROM scoped_orders
        WHERE p_start_date IS NULL
           OR statement_date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
    ),
    per_doctor AS (
        SELECT
            oir.billing_doctor_id,
            COUNT(*) AS order_count,
            COUNT(*) FILTER (
                WHERE EXISTS (
                    SELECT 1 FROM order_issues oi
                    WHERE oi.order_id = oir.order_id
                      AND COALESCE(oi.is_voided, false) = false
                )
            ) AS orders_with_issues
        FROM orders_in_range oir
        GROUP BY oir.billing_doctor_id
    ),
    -- Tenure is measured from the earliest record in the billing group: a
    -- center that predates one of its branches is as old as the center.
    doctor_tenure AS (
        SELECT
            COALESCE(d.parent_id, d.id) AS billing_doctor_id,
            MIN(d.created_at) AS first_registered_at
        FROM doctors d
        GROUP BY COALESCE(d.parent_id, d.id)
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'doctor_id',           pd.billing_doctor_id,
        'doctor_name',         COALESCE(dd.name, 'غير معروف'),
        'order_count',         pd.order_count,
        'orders_with_issues',  pd.orders_with_issues,
        'first_registered_at', dt.first_registered_at,
        'days_since_first_registered',
            CASE WHEN dt.first_registered_at IS NULL THEN NULL
                 ELSE (CURRENT_DATE - dt.first_registered_at::date)
            END
    )), '[]'::jsonb)
    INTO v_result
    FROM per_doctor pd
    LEFT JOIN doctors dd ON dd.id = pd.billing_doctor_id
    LEFT JOIN doctor_tenure dt ON dt.billing_doctor_id = pd.billing_doctor_id;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_doctor_segmentation_inputs(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_doctor_segmentation_inputs(DATE, DATE) TO authenticated;

COMMIT;
