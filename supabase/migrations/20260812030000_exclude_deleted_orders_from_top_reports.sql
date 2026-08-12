-- Migration: exclude soft-deleted orders from get_top_services / get_top_doctors
--
-- Both RPCs filtered `is_archived` but never `is_deleted`, unlike every other
-- reporting query in the codebase (get_analytics_summary's receivables/
-- payables sections, isDoctorStatementIncluded on the frontend, etc. all
-- treat is_deleted as a hard exclusion). A soft-deleted order that still has
-- status Delivered/Completed and order_items rows was silently counted as
-- real sold volume/revenue here, which can badly inflate "المبيعات" /
-- service-mix unit counts on the Overview tab relative to the Service
-- Analysis tab (whose client-side calculation already excludes deleted
-- orders via isDoctorStatementIncluded) for any period with deleted rows.

CREATE OR REPLACE FUNCTION public.get_top_services_privileged_20260801(
    p_start_date DATE DEFAULT NULL,
    p_end_date   DATE DEFAULT NULL,
    p_limit      INT  DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
    INTO result
    FROM (
        SELECT jsonb_build_object(
            'name', oi.product_type,
            'count', SUM(COALESCE(jsonb_array_length(oi.teeth_numbers), 1)),
            'revenue', SUM(oi.price * GREATEST(COALESCE(jsonb_array_length(oi.teeth_numbers), 1), 1))
        ) AS row_data
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.status IN ('Delivered', 'Completed')
          AND COALESCE(o.is_archived, false) = false
          AND COALESCE(o.is_deleted, false) = false
          AND (
            p_start_date IS NULL
            OR COALESCE(o.delivery_date, o.created_at::date)
                BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
          )
        GROUP BY oi.product_type
        ORDER BY SUM(COALESCE(jsonb_array_length(oi.teeth_numbers), 1)) DESC
        LIMIT p_limit
    ) sub;

    RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_top_doctors_privileged_20260801(
    p_start_date DATE DEFAULT NULL,
    p_end_date   DATE DEFAULT NULL,
    p_limit      INT  DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
    INTO result
    FROM (
        SELECT jsonb_build_object(
            'name', d.name,
            'revenue', SUM(o.total_price),
            'count', COUNT(*)
        ) AS row_data
        FROM orders o
        JOIN doctors d ON d.id = o.doctor_id
        WHERE o.status IN ('Delivered', 'Completed')
          AND COALESCE(o.is_archived, false) = false
          AND COALESCE(o.is_deleted, false) = false
          AND (
            p_start_date IS NULL
            OR COALESCE(o.delivery_date, o.created_at::date)
                BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
          )
        GROUP BY d.id, d.name
        ORDER BY SUM(o.total_price) DESC
        LIMIT p_limit
    ) sub;

    RETURN result;
END;
$$;
