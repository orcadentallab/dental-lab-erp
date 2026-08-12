-- Migration: adopt get_doctor_receivables_breakdown into the tracked chain
--
-- Root cause this closes:
--   This RPC was only ever defined in supabase/temp_migrations/088, outside
--   supabase/migrations/. It is live in production, but because it sat outside
--   the chain it was invisible to the 20260801 security hardening pass -- which
--   is precisely how it stayed anon-callable until 20260812080000, leaking
--   every doctor's name, phone, balance and aging buckets to anyone holding the
--   public anon key.
--
-- The body below is production's CURRENT definition, captured verbatim via
-- `supabase db dump --linked` on 2026-08-12, then wrapped in the hardened
-- privileged + admin-gated pair from 20260812080000. Written directly in its
-- final shape so a fresh database lands on the hardened state in one step;
-- against production every statement is a CREATE OR REPLACE no-op.
--
-- NOTE -- production had already drifted from temp_migrations/088:
--   088 computes `oldest_order_date` / `newest_order_date` in the doctor_sales
--   CTE; production's deployed version does not. Those two columns were never
--   selected downstream and are referenced nowhere in the application, i.e.
--   dead code that production had already dropped. Production's (cleaner)
--   version is what is codified here. This drift is itself an argument for the
--   chain: nothing in the repo reflected the deployed truth.

BEGIN;

CREATE OR REPLACE FUNCTION "public"."get_doctor_receivables_breakdown_privileged_20260812"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    result jsonb;
BEGIN
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
            COUNT(*) AS order_count
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
            GREATEST(0, LEAST(dob.total_price, dob.running_total - COALESCE(dp.total_paid, 0))) AS remaining
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

REVOKE ALL ON FUNCTION public.get_doctor_receivables_breakdown_privileged_20260812()
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_doctor_receivables_breakdown()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;
    RETURN public.get_doctor_receivables_breakdown_privileged_20260812();
END;
$$;

REVOKE ALL ON FUNCTION public.get_doctor_receivables_breakdown() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_doctor_receivables_breakdown() TO authenticated;

COMMIT;
