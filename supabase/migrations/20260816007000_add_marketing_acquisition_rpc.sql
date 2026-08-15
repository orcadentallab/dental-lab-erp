-- Migration: acquisition inputs for CAC, from data that already exists.
--
-- NO marketing_spend TABLE. The 'دعاية وتسويق' expense category already
-- carries ad spend in `transactions`, so a dedicated table would be a second
-- place to record the same money. One is added only if the owner later needs
-- CAC split per channel, which today's single-invoice spending does not
-- support anyway.
--
-- EXPENSES ARE RETURNED BY RAW CATEGORY STRING, NOT PRE-FILTERED.
--
-- Legacy rows use several spellings of each category, and the canonical
-- mapping lives in src/constants/expenseCategories.ts — including an alias
-- list and Arabic normalization (hamza forms, ta-marbuta, alef-maqsura,
-- diacritics). Reimplementing that in SQL would create a second classifier
-- that silently drifts from the first. This function therefore returns the
-- raw category totals and the client applies normalizeExpenseCategory(), so
-- there stays exactly one source of truth for what counts as marketing.
--
-- REVENUE uses the same settlement-aware amount as get_analytics_summary,
-- so first-90-day revenue is comparable with every other revenue figure.
--
-- Archived orders are included (rule 0-A); soft-deleted ones are not.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_marketing_acquisition(
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

    WITH cohort AS (
        SELECT d.id AS doctor_id, d.created_at
        FROM doctors d
        WHERE p_start_date IS NULL
           OR d.created_at::date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
    ),
    cohort_orders AS (
        SELECT
            c.doctor_id,
            o.id AS order_id,
            o.created_at AS order_created_at,
            c.created_at AS doctor_created_at,
            CASE
                WHEN COALESCE(o.issue_state, 'none') IN ('doctor_rejected', 'lab_rejected', 'redo') THEN
                    CASE WHEN o.rejection_doctor_decision IS NOT NULL
                        THEN GREATEST(COALESCE(o.rejected_doctor_amount, 0), 0)
                        ELSE 0
                    END
                WHEN o.production_status = 'final_delivered' AND COALESCE(o.issue_state, 'none') = 'none'
                    THEN COALESCE(o.total_price, 0)
                ELSE 0
            END AS receivable_amount
        FROM cohort c
        JOIN orders o ON o.doctor_id = c.doctor_id
        WHERE COALESCE(o.is_deleted, false) = false
    ),
    expense_totals AS (
        SELECT
            COALESCE(NULLIF(btrim(t.category), ''), 'مصروفات أخرى') AS category,
            SUM(t.amount) AS total
        FROM transactions t
        WHERE t.type = 'expense'
          AND (
              p_start_date IS NULL
              OR COALESCE(t.effective_date, t.date)::date
                 BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
          )
        GROUP BY 1
    )
    SELECT jsonb_build_object(
        'new_doctors', (SELECT COUNT(*) FROM cohort),
        -- "Activated" means they actually sent work. A registered doctor who
        -- never ordered cost money to acquire but produced nothing, so
        -- dividing spend by registrations would understate CAC.
        'activated_doctors', (SELECT COUNT(DISTINCT doctor_id) FROM cohort_orders),
        'first_90_day_revenue', (
            SELECT round(COALESCE(SUM(receivable_amount), 0)::numeric, 2)
            FROM cohort_orders
            WHERE order_created_at < doctor_created_at + INTERVAL '90 days'
        ),
        'expense_by_category', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'category', et.category,
                'total', round(et.total::numeric, 2)
            ) ORDER BY et.total DESC)
            FROM expense_totals et
        ), '[]'::jsonb)
    )
    INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_marketing_acquisition(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_marketing_acquisition(DATE, DATE) TO authenticated;

COMMIT;
