-- Migration 088: Doctor Receivables Breakdown RPC
-- Purpose:
--   Per-doctor breakdown of accounts receivable with aging.
--   READ-ONLY RPC. Does NOT alter any data, transactions, or balances.
--   Groups child doctors under their parent center for financial reporting.
--   A doctor with parent_id belongs to the center (parent); independent doctors report as themselves.

CREATE OR REPLACE FUNCTION get_doctor_receivables_breakdown()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result jsonb;
BEGIN
    -- Map each doctor to their financial reporting entity:
    -- child doctors -> parent center, independent doctors -> themselves
    WITH doctor_entities AS (
        SELECT 
            id AS doctor_id,
            COALESCE(parent_id, id) AS financial_entity_id
        FROM doctors
    ),
    doctor_sales AS (
        SELECT
            de.financial_entity_id,
            SUM(o.total_price) AS total_billed,
            COUNT(*) AS order_count,
            MIN(COALESCE(o.delivery_date, o.created_at::date)) AS oldest_order_date,
            MAX(COALESCE(o.delivery_date, o.created_at::date)) AS newest_order_date
        FROM orders o
        JOIN doctor_entities de ON de.doctor_id = o.doctor_id
        WHERE o.status IN ('Delivered', 'Completed')
          AND COALESCE(o.is_archived, false) = false
          AND o.doctor_id IS NOT NULL
        GROUP BY de.financial_entity_id
    ),
    doctor_payments AS (
        SELECT
            de.financial_entity_id,
            SUM(t.amount) AS total_paid
        FROM transactions t
        JOIN doctor_entities de ON de.doctor_id = t.entity_id
        WHERE t.type = 'income' AND t.entity_type = 'doctor'
        GROUP BY de.financial_entity_id
    ),
    -- Per-order aging buckets: each delivered order contributes its full price
    -- to an aging bucket based on its delivery_date. We then subtract total
    -- payments proportionally starting from oldest (FIFO-style allocation).
    doctor_order_buckets AS (
        SELECT
            de.financial_entity_id,
            o.id AS order_id,
            o.total_price,
            COALESCE(o.delivery_date, o.created_at::date) AS order_date,
            CURRENT_DATE - COALESCE(o.delivery_date, o.created_at::date) AS days_old
        FROM orders o
        JOIN doctor_entities de ON de.doctor_id = o.doctor_id
        WHERE o.status IN ('Delivered', 'Completed')
          AND COALESCE(o.is_archived, false) = false
          AND o.doctor_id IS NOT NULL
    ),
    -- FIFO allocate payments to oldest orders first
    doctor_order_with_running_sum AS (
        SELECT
            financial_entity_id,
            order_id,
            total_price,
            order_date,
            days_old,
            SUM(total_price) OVER (
                PARTITION BY financial_entity_id
                ORDER BY order_date ASC, order_id ASC
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS running_total
        FROM doctor_order_buckets
    ),
    doctor_order_remaining AS (
        SELECT
            dob.financial_entity_id,
            dob.order_id,
            dob.total_price,
            dob.order_date,
            dob.days_old,
            dob.running_total,
            COALESCE(dp.total_paid, 0) AS entity_total_paid,
            -- How much of this order remains after FIFO allocation
            GREATEST(
                0,
                LEAST(
                    dob.total_price,
                    dob.running_total - COALESCE(dp.total_paid, 0)
                )
            ) AS remaining
        FROM doctor_order_with_running_sum dob
        LEFT JOIN doctor_payments dp ON dp.financial_entity_id = dob.financial_entity_id
    ),
    doctor_aged AS (
        SELECT
            financial_entity_id,
            SUM(remaining) AS total_balance,
            SUM(remaining) FILTER (WHERE days_old BETWEEN 0 AND 30) AS aging_0_30,
            SUM(remaining) FILTER (WHERE days_old BETWEEN 31 AND 60) AS aging_31_60,
            SUM(remaining) FILTER (WHERE days_old BETWEEN 61 AND 90) AS aging_61_90,
            SUM(remaining) FILTER (WHERE days_old > 90) AS aging_90_plus,
            MIN(order_date) FILTER (WHERE remaining > 0) AS oldest_unpaid_date,
            MAX(days_old) FILTER (WHERE remaining > 0) AS max_days_overdue,
            COUNT(*) FILTER (WHERE remaining > 0) AS unpaid_order_count
        FROM doctor_order_remaining
        GROUP BY financial_entity_id
    ),
    enriched AS (
        SELECT
            da.financial_entity_id AS doctor_id,
            d.name AS doctor_name,
            d.phone AS doctor_phone,
            ds.total_billed,
            COALESCE(dp.total_paid, 0) AS total_paid,
            COALESCE(da.total_balance, 0) AS balance,
            COALESCE(da.aging_0_30, 0) AS aging_0_30,
            COALESCE(da.aging_31_60, 0) AS aging_31_60,
            COALESCE(da.aging_61_90, 0) AS aging_61_90,
            COALESCE(da.aging_90_plus, 0) AS aging_90_plus,
            ds.order_count,
            da.unpaid_order_count,
            da.oldest_unpaid_date,
            da.max_days_overdue
        FROM doctor_aged da
        LEFT JOIN doctors d ON d.id = da.financial_entity_id
        LEFT JOIN doctor_sales ds ON ds.financial_entity_id = da.financial_entity_id
        LEFT JOIN doctor_payments dp ON dp.financial_entity_id = da.financial_entity_id
        WHERE COALESCE(da.total_balance, 0) > 0.01
    )
    SELECT jsonb_agg(
        jsonb_build_object(
            'doctorId', doctor_id,
            'doctorName', COALESCE(doctor_name, 'غير معروف'),
            'doctorPhone', doctor_phone,
            'totalBilled', ROUND(total_billed::numeric, 2),
            'totalPaid', ROUND(total_paid::numeric, 2),
            'balance', ROUND(balance::numeric, 2),
            'aging_0_30', ROUND(aging_0_30::numeric, 2),
            'aging_31_60', ROUND(aging_31_60::numeric, 2),
            'aging_61_90', ROUND(aging_61_90::numeric, 2),
            'aging_90_plus', ROUND(aging_90_plus::numeric, 2),
            'orderCount', order_count,
            'unpaidOrderCount', unpaid_order_count,
            'oldestUnpaidDate', oldest_unpaid_date,
            'maxDaysOverdue', max_days_overdue
        )
        ORDER BY balance DESC
    )
    INTO result
    FROM enriched;

    RETURN COALESCE(result, '[]'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION get_doctor_receivables_breakdown() TO authenticated;

COMMENT ON FUNCTION get_doctor_receivables_breakdown() IS
    'Per-doctor breakdown of accounts receivable grouped by financial entity (centers include their child doctors).';
