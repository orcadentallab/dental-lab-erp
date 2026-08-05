-- Close confirmed authorization gaps without changing business or financial data.

-- order_issues is an audit/reporting table. Its rows are created by the order
-- trigger; only admins need direct read/update access in the current UI.
ALTER TABLE public.order_issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "order_issues_admin_select" ON public.order_issues;
DROP POLICY IF EXISTS "order_issues_admin_update" ON public.order_issues;
CREATE POLICY "order_issues_admin_select"
ON public.order_issues FOR SELECT TO authenticated
USING (public.get_my_role() = 'admin');
CREATE POLICY "order_issues_admin_update"
ON public.order_issues FOR UPDATE TO authenticated
USING (public.get_my_role() = 'admin')
WITH CHECK (public.get_my_role() = 'admin');
REVOKE ALL ON TABLE public.order_issues FROM anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.order_issues TO authenticated;
GRANT ALL ON TABLE public.order_issues TO service_role;
-- AI analytics is an admin-only application area. The old policy trusted the
-- frontend and allowed every authenticated user to read and mutate all reports.
DROP POLICY IF EXISTS "ai_insights_allow_all" ON public.ai_insights;
DROP POLICY IF EXISTS "ai_insights_authenticated_all" ON public.ai_insights;
DROP POLICY IF EXISTS "ai_insights_select" ON public.ai_insights;
DROP POLICY IF EXISTS "ai_insights_insert" ON public.ai_insights;
DROP POLICY IF EXISTS "ai_insights_update" ON public.ai_insights;
DROP POLICY IF EXISTS "ai_insights_delete" ON public.ai_insights;
CREATE POLICY "ai_insights_admin_select"
ON public.ai_insights FOR SELECT TO authenticated
USING (public.get_my_role() = 'admin');
CREATE POLICY "ai_insights_admin_insert"
ON public.ai_insights FOR INSERT TO authenticated
WITH CHECK (public.get_my_role() = 'admin');
CREATE POLICY "ai_insights_admin_update"
ON public.ai_insights FOR UPDATE TO authenticated
USING (public.get_my_role() = 'admin')
WITH CHECK (public.get_my_role() = 'admin');
CREATE POLICY "ai_insights_admin_delete"
ON public.ai_insights FOR DELETE TO authenticated
USING (public.get_my_role() = 'admin');
REVOKE ALL ON TABLE public.ai_insights FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_insights TO authenticated;
GRANT ALL ON TABLE public.ai_insights TO service_role;
-- Trigger functions are never valid client RPCs. PostgreSQL grants new
-- functions to PUBLIC by default, so remove that unnecessary attack surface.
DO $$
DECLARE
    v_function regprocedure;
BEGIN
    FOR v_function IN
        SELECT p.oid::regprocedure
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef
          AND p.prorettype = 'trigger'::regtype
    LOOP
        EXECUTE format(
            'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
            v_function
        );
    END LOOP;
END;
$$;
-- These user-facing SECURITY DEFINER RPCs already validate auth/role in their
-- bodies (or filter by role), but historical blanket grants still exposed them
-- to anon. Keep authenticated access only.
REVOKE ALL ON FUNCTION public.admin_review_order_edit(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rep_update_order_fields_with_audit(UUID, JSONB, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_employee_expenses(UUID[], NUMERIC, UUID, DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_doctors_activity_analytics(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_todays_follow_ups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_order_edit(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rep_update_order_fields_with_audit(UUID, JSONB, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_employee_expenses(UUID[], NUMERIC, UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_doctors_activity_analytics(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_todays_follow_ups() TO authenticated;
-- The reporting functions intentionally bypass table RLS for consistent
-- aggregates. Preserve their public names, but move the original bodies behind
-- guarded SECURITY DEFINER wrappers so app roles are checked server-side.
ALTER FUNCTION public.get_analytics_summary(DATE, DATE)
    RENAME TO get_analytics_summary_privileged_20260801;
ALTER FUNCTION public.get_top_doctors(DATE, DATE, INTEGER)
    RENAME TO get_top_doctors_privileged_20260801;
ALTER FUNCTION public.get_top_services(DATE, DATE, INTEGER)
    RENAME TO get_top_services_privileged_20260801;
ALTER FUNCTION public.get_top_expense_categories(DATE, DATE, INTEGER)
    RENAME TO get_top_expense_categories_privileged_20260801;
ALTER FUNCTION public.get_finance_dashboard()
    RENAME TO get_finance_dashboard_privileged_20260801;
ALTER FUNCTION public.get_dashboard_data()
    RENAME TO get_dashboard_data_privileged_20260801;
REVOKE ALL ON FUNCTION public.get_analytics_summary_privileged_20260801(DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_top_doctors_privileged_20260801(DATE, DATE, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_top_services_privileged_20260801(DATE, DATE, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_top_expense_categories_privileged_20260801(DATE, DATE, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_finance_dashboard_privileged_20260801() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_dashboard_data_privileged_20260801() FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.get_analytics_summary(
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;
    RETURN public.get_analytics_summary_privileged_20260801(p_start_date, p_end_date);
END;
$$;
CREATE FUNCTION public.get_top_doctors(
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL,
    p_limit INTEGER DEFAULT 5
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;
    RETURN public.get_top_doctors_privileged_20260801(p_start_date, p_end_date, p_limit);
END;
$$;
CREATE FUNCTION public.get_top_services(
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL,
    p_limit INTEGER DEFAULT 5
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;
    RETURN public.get_top_services_privileged_20260801(p_start_date, p_end_date, p_limit);
END;
$$;
CREATE FUNCTION public.get_top_expense_categories(
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL,
    p_limit INTEGER DEFAULT 5
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;
    RETURN public.get_top_expense_categories_privileged_20260801(p_start_date, p_end_date, p_limit);
END;
$$;
CREATE FUNCTION public.get_finance_dashboard()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NOT COALESCE(public.get_my_role() = ANY (ARRAY['admin', 'accountant']), FALSE) THEN
        RAISE EXCEPTION 'forbidden: finance role required' USING ERRCODE = '42501';
    END IF;
    RETURN public.get_finance_dashboard_privileged_20260801();
END;
$$;
CREATE FUNCTION public.get_dashboard_data()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NOT COALESCE(
        public.get_my_role() = ANY (ARRAY['admin', 'accountant', 'representative', 'lab', 'designer']),
        FALSE
    ) THEN
        RAISE EXCEPTION 'forbidden: staff role required' USING ERRCODE = '42501';
    END IF;
    RETURN public.get_dashboard_data_privileged_20260801();
END;
$$;
REVOKE ALL ON FUNCTION public.get_analytics_summary(DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_top_doctors(DATE, DATE, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_top_services(DATE, DATE, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_top_expense_categories(DATE, DATE, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_finance_dashboard() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_dashboard_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_summary(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_doctors(DATE, DATE, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_services(DATE, DATE, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_expense_categories(DATE, DATE, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_finance_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_data() TO authenticated;
