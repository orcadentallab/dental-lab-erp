-- Support genuinely open-ended analytics ranges.
--
-- The privileged reporting functions historically use predicates shaped as:
--   p_start_date IS NULL OR value_date BETWEEN p_start_date AND p_end_date
-- Consequently, an end-only filter (NULL, end_date) matched every row and
-- silently ignored the supplied end date. They also default a missing end to
-- CURRENT_DATE, which is not the requested "through the last record" meaning.
--
-- Keep the guarded public RPC boundary and normalize only one-sided ranges:
--   (NULL, end)  -> (-infinity, end)
--   (start, NULL)-> (start, infinity)
--   (NULL, NULL) -> unchanged all-time behavior

CREATE OR REPLACE FUNCTION public.get_analytics_summary(
    p_start_date DATE DEFAULT NULL,
    p_end_date   DATE DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_start_date DATE;
    v_end_date   DATE;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;

    IF p_start_date IS NULL AND p_end_date IS NULL THEN
        v_start_date := NULL;
        v_end_date := NULL;
    ELSE
        v_start_date := COALESCE(p_start_date, '-infinity'::DATE);
        v_end_date := COALESCE(p_end_date, 'infinity'::DATE);
    END IF;

    RETURN public.get_analytics_summary_privileged_20260801(v_start_date, v_end_date);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_top_doctors(
    p_start_date DATE DEFAULT NULL,
    p_end_date   DATE DEFAULT NULL,
    p_limit      INTEGER DEFAULT 5
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_start_date DATE;
    v_end_date   DATE;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;

    IF p_start_date IS NULL AND p_end_date IS NULL THEN
        v_start_date := NULL;
        v_end_date := NULL;
    ELSE
        v_start_date := COALESCE(p_start_date, '-infinity'::DATE);
        v_end_date := COALESCE(p_end_date, 'infinity'::DATE);
    END IF;

    RETURN public.get_top_doctors_privileged_20260801(v_start_date, v_end_date, p_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_top_services(
    p_start_date DATE DEFAULT NULL,
    p_end_date   DATE DEFAULT NULL,
    p_limit      INTEGER DEFAULT 5
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_start_date DATE;
    v_end_date   DATE;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;

    IF p_start_date IS NULL AND p_end_date IS NULL THEN
        v_start_date := NULL;
        v_end_date := NULL;
    ELSE
        v_start_date := COALESCE(p_start_date, '-infinity'::DATE);
        v_end_date := COALESCE(p_end_date, 'infinity'::DATE);
    END IF;

    RETURN public.get_top_services_privileged_20260801(v_start_date, v_end_date, p_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_top_expense_categories(
    p_start_date DATE DEFAULT NULL,
    p_end_date   DATE DEFAULT NULL,
    p_limit      INTEGER DEFAULT 5
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_start_date DATE;
    v_end_date   DATE;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;

    IF p_start_date IS NULL AND p_end_date IS NULL THEN
        v_start_date := NULL;
        v_end_date := NULL;
    ELSE
        v_start_date := COALESCE(p_start_date, '-infinity'::DATE);
        v_end_date := COALESCE(p_end_date, 'infinity'::DATE);
    END IF;

    RETURN public.get_top_expense_categories_privileged_20260801(v_start_date, v_end_date, p_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.get_analytics_summary(DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_top_doctors(DATE, DATE, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_top_services(DATE, DATE, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_top_expense_categories(DATE, DATE, INTEGER) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_analytics_summary(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_doctors(DATE, DATE, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_services(DATE, DATE, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_expense_categories(DATE, DATE, INTEGER) TO authenticated;
