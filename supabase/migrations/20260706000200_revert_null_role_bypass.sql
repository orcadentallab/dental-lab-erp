-- Migration: Revert NULL role bypass to restore strict RLS security
-- Date: 2026-07-06

CREATE OR REPLACE FUNCTION get_doctors_activity_analytics(
    p_representative_id UUID DEFAULT NULL
)
RETURNS TABLE (
    doctor_id UUID,
    doctor_name TEXT,
    doctor_phone TEXT,
    doctor_phone2 TEXT,
    doctor_code TEXT,
    representative_name TEXT,
    representative_id UUID,
    
    -- تواريخ طلبات
    first_order_date DATE,
    last_order_date DATE,
    days_since_last_order INT,
    
    -- حجم الأعمال (العدد والقيمة للأوردرات الصالحة)
    total_orders_count INT,
    valid_orders_count INT,
    average_monthly_orders_count NUMERIC,
    average_monthly_orders_value NUMERIC,
    orders_count_last_30_days INT,
    orders_value_last_30_days NUMERIC,
    orders_count_last_60_days INT,
    orders_value_last_60_days NUMERIC,
    
    -- نسبة التغير (العدد والقيمة التاريخية)
    change_percentage_count NUMERIC,
    change_percentage_value NUMERIC,
    
    -- بيانات المرفوض/الملغي
    rejected_orders_count INT,
    rejected_orders_value NUMERIC,
    rejected_orders_count_30 INT,
    rejected_orders_value_30 NUMERIC,
    rejected_ratio_pct NUMERIC,
    
    -- آخر حالة وآخر متابعة
    last_case_patient TEXT,
    last_case_code TEXT,
    calculated_segment TEXT,
    last_follow_up_date TIMESTAMPTZ,
    last_follow_up_notes TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_one_case_days INT;
    v_new_days INT;
    v_rec_churn_min_days INT;
    v_long_days INT;
    v_dec_pct NUMERIC;
    v_gro_pct NUMERIC;
    v_my_role TEXT;
    v_my_user_id UUID;
BEGIN
    -- جلب قيم الإعدادات المتغيرة
    SELECT 
        one_case_churn_days, new_client_days, recently_churned_min_days, 
        long_term_churn_days, decline_threshold_pct, growth_threshold_pct
    INTO 
        v_one_case_days, v_new_days, v_rec_churn_min_days, 
        v_long_days, v_dec_pct, v_gro_pct
    FROM doctor_retention_settings
    LIMIT 1;

    -- جلب صلاحيات وهوية المستخدم الحالي لعزل البيانات
    v_my_role := get_my_role();
    v_my_user_id := get_my_user_id();

    RETURN QUERY
    WITH doctor_order_stats AS (
        -- احتساب التواريخ والأعداد للأوردرات الصالحة والمرفوضة
        SELECT 
            o.doctor_id,
            -- الطلبات الصالحة (المستثنى منها المرفوض والملغي)
            MIN(o.created_at::date) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled'))::date AS first_date,
            MAX(o.created_at::date) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled'))::date AS last_date,
            
            -- الإجماليات
            COUNT(o.id)::int AS total_cnt,
            COUNT(o.id) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled'))::int AS valid_cnt,
            
            -- إجمالي قيم الطلبات الصالحة تاريخياً بالكامل (تستخدم في المتوسط الشهري المالي التاريخي)
            COALESCE(SUM(o.total_price) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled')), 0)::numeric AS total_val,
            
            -- آخر حالة صالحة
            (ARRAY_AGG(o.patient_name ORDER BY o.created_at DESC) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled')))[1] AS last_patient,
            (ARRAY_AGG(o.case_id ORDER BY o.created_at DESC) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled')))[1] AS last_code,
            
            -- آخر 30 يوم (صالح)
            COUNT(o.id) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled') AND o.created_at >= (NOW() - INTERVAL '30 days'))::int AS last_30_cnt,
            COALESCE(SUM(o.total_price) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled') AND o.created_at >= (NOW() - INTERVAL '30 days')), 0)::numeric AS last_30_val,
            
            -- آخر 60 يوم (صالح)
            COUNT(o.id) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled') AND o.created_at >= (NOW() - INTERVAL '60 days'))::int AS last_60_cnt,
            COALESCE(SUM(o.total_price) FILTER (WHERE o.status NOT IN ('Doctor Rejected', 'Cancelled') AND o.created_at >= (NOW() - INTERVAL '60 days')), 0)::numeric AS last_60_val,
            
            -- الطلبات المرفوضة والملغاة
            COUNT(o.id) FILTER (WHERE o.status IN ('Doctor Rejected', 'Cancelled'))::int AS rej_cnt,
            COALESCE(SUM(o.total_price) FILTER (WHERE o.status IN ('Doctor Rejected', 'Cancelled')), 0)::numeric AS rej_val,
            COUNT(o.id) FILTER (WHERE o.status IN ('Doctor Rejected', 'Cancelled') AND o.created_at >= (NOW() - INTERVAL '30 days'))::int AS rej_30_cnt,
            COALESCE(SUM(o.total_price) FILTER (WHERE o.status IN ('Doctor Rejected', 'Cancelled') AND o.created_at >= (NOW() - INTERVAL '30 days')), 0)::numeric AS rej_30_val
            
        FROM orders o
        WHERE COALESCE(o.is_deleted, false) = false
        GROUP BY o.doctor_id
    ),
    doctor_metrics AS (
        -- تجميع البيانات وتطبيق عزل مناديب المبيعات (RLS) مع حماية COALESCE للأصفار للعملاء الجدد تماماً
        SELECT 
            d.id AS d_id,
            d.name AS d_name,
            d.phone AS d_phone,
            d.phone2 AS d_phone2,
            d.doctor_code AS d_code,
            d.representative_name AS d_rep_name,
            d.representative_id AS d_rep_id,
            stats.first_date,
            stats.last_date,
            (CURRENT_DATE - stats.last_date)::int AS days_idle,
            COALESCE(stats.total_cnt, 0) AS total_cnt,
            COALESCE(stats.valid_cnt, 0) AS valid_cnt,
            COALESCE(stats.total_val, 0)::numeric AS total_val,
            stats.last_patient,
            stats.last_code,
            COALESCE(stats.last_30_cnt, 0)::int AS last_30_cnt,
            COALESCE(stats.last_30_val, 0)::numeric AS last_30_val,
            COALESCE(stats.last_60_cnt, 0)::int AS last_60_cnt,
            COALESCE(stats.last_60_val, 0)::numeric AS last_60_val,
            COALESCE(stats.rej_cnt, 0)::int AS rej_cnt,
            COALESCE(stats.rej_val, 0)::numeric AS rej_val,
            COALESCE(stats.rej_30_cnt, 0)::int AS rej_30_cnt,
            COALESCE(stats.rej_30_val, 0)::numeric AS rej_30_val,
            d.last_follow_up_date AS f_date,
            d.last_follow_up_notes AS f_notes,
            -- حساب الشهور النشطة بناءً على التواريخ الصالحة
            GREATEST(1.0, ROUND((stats.last_date - stats.first_date)::numeric / 30.0, 1)) AS active_months
        FROM doctors d
        LEFT JOIN doctor_order_stats stats ON stats.doctor_id = d.id
        WHERE 
            -- تمت إعادة سلوك الحماية الصارم: إذا كان دور المستخدم غير محدد (NULL) أو غير مصرح له، فلن يرجع أي بيانات
            (v_my_role = 'admin' OR (v_my_role = 'representative' AND d.representative_id = v_my_user_id))
            AND (p_representative_id IS NULL OR d.representative_id = p_representative_id)
    )
    SELECT 
        m.d_id,
        m.d_name,
        m.d_phone,
        m.d_phone2,
        m.d_code,
        m.d_rep_name,
        m.d_rep_id,
        m.first_date,
        m.last_date,
        m.days_idle,
        
        -- حجم الأعمال
        m.total_cnt,
        m.valid_cnt,
        ROUND(m.valid_cnt / m.active_months, 1) AS average_monthly_orders_count,
        ROUND(m.total_val / m.active_months, 2) AS average_monthly_orders_value, -- متوسط تاريخي كامل
        m.last_30_cnt,
        m.last_30_val,
        m.last_60_cnt,
        m.last_60_val,
        
        -- نسبة التغير (العدد والقيمة - محسوبة مقارنة بالمتوسط التاريخي الكامل)
        CASE 
            WHEN m.valid_cnt = 0 THEN 0::numeric
            ELSE ROUND(((m.last_30_cnt - (m.valid_cnt / m.active_months)) / GREATEST((m.valid_cnt / m.active_months), 1.0)) * 100, 1)
        END AS change_percentage_count,
        CASE 
            WHEN m.valid_cnt = 0 OR m.total_val = 0 THEN 0::numeric
            ELSE ROUND(((m.last_30_val - (m.total_val / m.active_months)) / GREATEST((m.total_val / m.active_months), 1.0)) * 100, 1)
        END AS change_percentage_value,
        
        -- المرفوضات
        m.rej_cnt,
        m.rej_val,
        m.rej_30_cnt,
        m.rej_30_val,
        CASE 
            WHEN m.total_cnt = 0 THEN 0::numeric
            ELSE ROUND((m.rej_cnt::numeric / m.total_cnt) * 100, 1)
        END AS rejected_ratio_pct,
        
        m.last_patient,
        m.last_code,
        
        -- تصنيف الشريحة تلقائياً
        CASE 
            WHEN m.total_cnt = 0 THEN 'needs_activation'
            WHEN m.total_cnt > 0 AND m.valid_cnt = 0 THEN 'rejected_only'
            WHEN m.valid_cnt = 1 AND m.days_idle > v_one_case_days THEN 'one_case_churned'
            WHEN m.days_idle > v_long_days THEN 'long_term_churned'
            WHEN m.days_idle >= v_rec_churn_min_days THEN 'recently_churned'
            WHEN m.first_date >= (CURRENT_DATE - v_new_days) THEN 'new'
            
            -- فحص التراجع المؤكد أولاً (تناسق المقياس: تراجع عددي مؤكد في الفترتين أو تراجع مالي مؤكد في الفترتين)
            WHEN (
                (
                    (m.last_30_cnt - (m.valid_cnt / m.active_months)) / GREATEST((m.valid_cnt / m.active_months), 1.0) <= -(v_dec_pct/100.0)
                    AND (m.last_60_cnt - (2 * (m.valid_cnt / m.active_months))) / GREATEST((2 * (m.valid_cnt / m.active_months)), 1.0) <= -(v_dec_pct/100.0)
                ) OR (
                    (m.last_30_val - (m.total_val / m.active_months)) / GREATEST((m.total_val / m.active_months), 1.0) <= -(v_dec_pct/100.0)
                    AND (m.last_60_val - (2 * (m.total_val / m.active_months))) / GREATEST((2 * (m.total_val / m.active_months)), 1.0) <= -(v_dec_pct/100.0)
                )
            ) THEN 'declining_confirmed'
            
            -- فحص التراجع المبكر ثانياً (تناسق المقياس: تراجع عددي أو مالي في آخر 30 يوماً فقط)
            WHEN (
                (m.last_30_cnt - (m.valid_cnt / m.active_months)) / GREATEST((m.valid_cnt / m.active_months), 1.0) <= -(v_dec_pct/100.0)
                OR (m.last_30_val - (m.total_val / m.active_months)) / GREATEST((m.total_val / m.active_months), 1.0) <= -(v_dec_pct/100.0)
            ) THEN 'declining_early'
            
            -- فحص النمو
            WHEN (
                (m.last_30_cnt - (m.valid_cnt / m.active_months)) / GREATEST((m.valid_cnt / m.active_months), 1.0) >= (v_gro_pct/100.0)
                OR (m.last_30_val - (m.total_val / m.active_months)) / GREATEST((m.total_val / m.active_months), 1.0) >= (v_gro_pct/100.0)
            ) THEN 'growing'
            
            ELSE 'stable'
        END AS calculated_segment,
        m.f_date,
        m.f_notes
    FROM doctor_metrics m
    ORDER BY calculated_segment DESC, m.days_idle DESC NULLS LAST;
END;
$$;
