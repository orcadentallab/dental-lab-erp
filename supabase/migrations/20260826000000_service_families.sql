-- Migration: Service Families (عوائل الخدمات)
-- Creates service_families table, links services, and provides top_families RPC

BEGIN;

-- 1. Create service_families table
CREATE TABLE IF NOT EXISTS public.service_families (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name_ar            TEXT NOT NULL,
    name_en            TEXT,
    description        TEXT,
    color              TEXT DEFAULT 'emerald', -- Color palette badge: emerald, blue, indigo, amber, purple, rose, slate
    default_service_id UUID,                  -- FK added below with DEFERRABLE
    default_route_id   UUID REFERENCES public.production_routes(id) ON DELETE SET NULL,
    sort_order         INTEGER DEFAULT 0,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add family_id column to services table
ALTER TABLE public.services
    ADD COLUMN IF NOT EXISTS family_id UUID REFERENCES public.service_families(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_services_family ON public.services (family_id)
    WHERE family_id IS NOT NULL;

-- 3. Add deferrable FK for default_service_id to resolve circular dependency
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_sf_default_service'
    ) THEN
        ALTER TABLE public.service_families
            ADD CONSTRAINT fk_sf_default_service
            FOREIGN KEY (default_service_id) REFERENCES public.services(id)
            ON DELETE SET NULL
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;

-- 4. Enable RLS on service_families
ALTER TABLE public.service_families ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sf_select" ON public.service_families;
CREATE POLICY "sf_select" ON public.service_families
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "sf_insert" ON public.service_families;
CREATE POLICY "sf_insert" ON public.service_families
    FOR INSERT TO authenticated
    WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "sf_update" ON public.service_families;
CREATE POLICY "sf_update" ON public.service_families
    FOR UPDATE TO authenticated
    USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "sf_delete" ON public.service_families;
CREATE POLICY "sf_delete" ON public.service_families
    FOR DELETE TO authenticated
    USING (public.get_my_role() = 'admin');

GRANT SELECT ON public.service_families TO authenticated;
GRANT ALL ON public.service_families TO service_role;

-- 5. Privileged implementation for top families RPC (Retroactive analytics via JOIN)
CREATE OR REPLACE FUNCTION public.get_top_families_privileged_20260826(
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
    WITH doctor_orders AS (
        SELECT
            o.id AS order_id,
            o.doctor_id,
            CASE WHEN o.production_status = 'final_delivered'
                THEN COALESCE(o.actual_delivery_date, o.delivery_date, o.created_at::date)
                ELSE COALESCE(o.delivery_date, o.created_at::date)
            END AS statement_date,
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
        FROM orders o
        WHERE COALESCE(o.is_deleted, false) = false
          AND lower(o.status) IN ('delivered', 'completed', 'cancelled', 'rejected', 'doctor rejected', 'lab rejected', 'returned for adjustments')
    ),
    doctor_orders_in_range AS (
        SELECT * FROM doctor_orders
        WHERE p_start_date IS NULL
           OR statement_date BETWEEN p_start_date AND COALESCE(p_end_date, CURRENT_DATE)
    ),
    item_base AS (
        SELECT
            oi.order_id,
            oi.product_type,
            COALESCE(sf.name_ar, oi.product_type) AS family_name,
            COALESCE(sf.color, 'emerald') AS family_color,
            GREATEST(COALESCE(jsonb_array_length(oi.teeth_numbers), 1), 1) AS unit_count,
            oi.price AS item_price,
            COALESCE((pd.custom_prices->>oi.product_type)::numeric, sv.selling_price, 0) AS catalog_price
        FROM order_items oi
        JOIN doctor_orders_in_range do_ ON do_.order_id = oi.order_id
        LEFT JOIN doctors od ON od.id = do_.doctor_id
        LEFT JOIN doctors pd ON pd.id = COALESCE(od.parent_id, od.id)
        LEFT JOIN services sv ON lower(btrim(sv.name)) = lower(btrim(oi.product_type))
        LEFT JOIN service_families sf ON sf.id = sv.family_id
    ),
    item_weights AS (
        SELECT
            order_id,
            family_name,
            family_color,
            unit_count,
            CASE
                WHEN item_price > 0 THEN item_price * unit_count
                WHEN catalog_price > 0 THEN catalog_price * unit_count
                ELSE unit_count
            END AS weight
        FROM item_base
    ),
    order_weight_totals AS (
        SELECT order_id, SUM(weight) AS total_weight
        FROM item_weights
        GROUP BY order_id
    )
    SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
    INTO result
    FROM (
        SELECT jsonb_build_object(
            'name', iw.family_name,
            'color', MAX(iw.family_color),
            'count', SUM(iw.unit_count),
            'revenue', SUM(
                CASE WHEN owt.total_weight > 0
                    THEN do_.receivable_amount * iw.weight / owt.total_weight
                    ELSE 0
                END
            )
        ) AS row_data
        FROM item_weights iw
        JOIN doctor_orders_in_range do_ ON do_.order_id = iw.order_id
        JOIN order_weight_totals owt ON owt.order_id = iw.order_id
        GROUP BY iw.family_name
        ORDER BY SUM(iw.unit_count) DESC
        LIMIT p_limit
    ) sub;

    RETURN result;
END;
$$;

-- 6. Public wrapper RPC for get_top_families
CREATE OR REPLACE FUNCTION public.get_top_families(
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

    RETURN public.get_top_families_privileged_20260826(v_start_date, v_end_date, p_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.get_top_families(DATE, DATE, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_top_families(DATE, DATE, INTEGER) TO authenticated;

COMMIT;
