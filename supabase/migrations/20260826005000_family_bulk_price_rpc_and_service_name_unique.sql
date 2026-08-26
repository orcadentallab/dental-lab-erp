-- =====================================================================
-- Batch D: atomic family price adjustment, and a unique service name.
-- =====================================================================

BEGIN;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- D2. One service name, one service.
--
-- Three separate reports join order_items back to the catalogue on the
-- service NAME, not on an id: get_top_families, get_doctor_service_
-- profitability, and the family grouping in DoctorServiceProfitability.tsx.
-- A LEFT JOIN on a non-unique key does not fail, it multiplies -- two
-- services sharing a name would double every unit count and every revenue
-- figure derived from them, quietly and everywhere at once.
--
-- No duplicates exist today (40 services, 40 distinct normalised names), so
-- this is cheap to add now and impossible to add later without a cleanup.
-- Normalised the same way the joins normalise: lower(btrim(name)).
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_services_name_unique_ci
    ON public.services (lower(btrim(name)));

-- ---------------------------------------------------------------------
-- D1. Bulk price adjustment as one statement.
--
-- The TypeScript version read the family's services, then issued one UPDATE
-- per service in a loop. A failure partway through -- a dropped connection,
-- a permission error, a timeout -- left some services repriced and the rest
-- not, with nothing recording which. There is no undo for that: the old
-- prices are gone from the ones that succeeded.
--
-- One UPDATE covering the family fixes both halves of that: it either
-- applies to every service or to none, and it needs no read-then-write
-- round trip that another admin could interleave with.
--
-- p_dry_run returns exactly what would change without changing it, so the
-- UI can show the before/after list and get a confirmation first. Repricing
-- a whole family is not something to discover after the fact.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_family_prices(
    p_family_id       UUID,
    p_adjustment_type TEXT,
    p_value           NUMERIC,
    p_target          TEXT,
    p_dry_run         BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    result JSONB;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;

    IF p_adjustment_type NOT IN ('percentage', 'fixed') THEN
        RAISE EXCEPTION 'adjustment type must be percentage or fixed, got %', p_adjustment_type
            USING ERRCODE = '22023';
    END IF;

    IF p_target NOT IN ('sellingPrice', 'costPrice', 'both') THEN
        RAISE EXCEPTION 'target must be sellingPrice, costPrice or both, got %', p_target
            USING ERRCODE = '22023';
    END IF;

    IF p_value IS NULL THEN
        RAISE EXCEPTION 'adjustment value is required' USING ERRCODE = '22023';
    END IF;

    -- A percentage that would zero or invert prices is a typo, not intent.
    IF p_adjustment_type = 'percentage' AND p_value <= -100 THEN
        RAISE EXCEPTION 'a percentage of % would zero or invert every price', p_value
            USING ERRCODE = '22023';
    END IF;

    IF p_family_id IS NULL OR NOT EXISTS (SELECT 1 FROM service_families WHERE id = p_family_id) THEN
        RAISE EXCEPTION 'service family % does not exist', p_family_id USING ERRCODE = '23503';
    END IF;

    WITH targeted AS (
        SELECT
            s.id,
            s.name,
            COALESCE(s.selling_price, 0) AS selling_before,
            COALESCE(s.cost_price, 0)    AS cost_before,
            CASE WHEN p_target IN ('sellingPrice', 'both') THEN
                GREATEST(0, CASE WHEN p_adjustment_type = 'percentage'
                    THEN round(COALESCE(s.selling_price, 0) * (1 + p_value / 100))
                    ELSE COALESCE(s.selling_price, 0) + p_value
                END)
            ELSE COALESCE(s.selling_price, 0) END AS selling_after,
            CASE WHEN p_target IN ('costPrice', 'both') THEN
                GREATEST(0, CASE WHEN p_adjustment_type = 'percentage'
                    THEN round(COALESCE(s.cost_price, 0) * (1 + p_value / 100))
                    ELSE COALESCE(s.cost_price, 0) + p_value
                END)
            ELSE COALESCE(s.cost_price, 0) END AS cost_after
        FROM services s
        WHERE s.family_id = p_family_id
    ),
    changed AS (
        SELECT * FROM targeted
        WHERE selling_after IS DISTINCT FROM selling_before
           OR cost_after    IS DISTINCT FROM cost_before
    ),
    applied AS (
        UPDATE services s
        SET selling_price = c.selling_after,
            cost_price    = c.cost_after
        FROM changed c
        WHERE s.id = c.id
          AND NOT p_dry_run
        RETURNING s.id
    )
    SELECT jsonb_build_object(
        'dry_run',  p_dry_run,
        'affected', (SELECT count(*) FROM changed),
        'applied',  (SELECT count(*) FROM applied),
        'services', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id',                    c.id,
                'name',                  c.name,
                'selling_price_before',  c.selling_before,
                'selling_price_after',   c.selling_after,
                'cost_price_before',     c.cost_before,
                'cost_price_after',      c.cost_after
            ) ORDER BY c.name)
            FROM changed c
        ), '[]'::jsonb)
    )
    INTO result;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_family_prices(UUID, TEXT, NUMERIC, TEXT, BOOLEAN)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_family_prices(UUID, TEXT, NUMERIC, TEXT, BOOLEAN)
    TO authenticated;

COMMIT;
