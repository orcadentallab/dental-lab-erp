-- =====================================================================
-- Backfill legacy order_items.price (unit price) for historical orders
-- =====================================================================
--
-- WHY
-- Orders created between 2026-01-31 and 2026-04-06 were written with
-- `order_items.price = 0`: the create path of that era only persisted the
-- order-level `total_price` and never resolved a per-item unit price.
-- The regression was fixed in the app on 2026-04-06 (OrderForm now resolves
-- `resolvedUnitPrice` before submit), so no order created after that date is
-- affected. 174 legacy orders (187 items) still carry price = 0.
--
-- The visible symptom: reopening such an order in the edit form found no
-- stored unit price and fell back to *today's* catalog price, so an order
-- saved at 7,850 displayed as 8,100.
--
-- WHAT THIS DOES
-- Reconstructs the per-item unit price from the order's own stored total,
-- which is the financially binding number and is NEVER modified here:
--
--   target = total_price + discount - SUM(price * teeth) of already-priced items
--
-- `target` is then split across the unpriced items proportionally to their
-- *relative* catalog weight (doctor custom price, parent-aware, else the
-- service selling price) x teeth count -- so a service that costs 1,100 today
-- keeps a proportionally larger share than one that costs 200, instead of
-- every line being flattened to the same number.
--
-- Rounding: units are rounded to 2 decimals; one item per order absorbs the
-- rounding residual so that SUM(price * teeth) - discount = total_price
-- EXACTLY, to the piaster. The absorber is the item with the fewest teeth
-- (ties broken by largest weight) because a residual spread over 1 unit is
-- always representable at 2 decimals.
--
-- For the 159 single-item orders the reconstruction is exact by definition
-- (unit = target / teeth); the proportional split only ever kicks in for the
-- 15 multi-item orders.
--
-- SAFETY
-- - orders.total_price, orders.discount, orders.cost and every financial
--   obligation / snapshot are left untouched. Only order_items.price changes.
-- - The previous value of every touched row is recorded in
--   order_item_price_backfill_audit (rollback = restore old_price by item_id).
-- - The migration verifies the invariant for every touched order and raises,
--   rolling the whole thing back, if a single order fails to reconcile.
-- - Idempotent: items already carrying a price are never re-priced.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS order_item_price_backfill_audit (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id     uuid NOT NULL,
    order_id    uuid NOT NULL,
    old_price   numeric(10, 2) NOT NULL,
    new_price   numeric(10, 2) NOT NULL,
    method      text NOT NULL,
    filled_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE order_item_price_backfill_audit IS
    'Audit trail for the 2026-08-23 backfill of legacy order_items.price (unit prices lost by the Jan-Apr 2026 create path). Restore with: UPDATE order_items SET price = a.old_price FROM order_item_price_backfill_audit a WHERE order_items.id = a.item_id.';

CREATE INDEX IF NOT EXISTS idx_order_item_price_backfill_audit_order
    ON order_item_price_backfill_audit (order_id);

WITH affected AS (
    SELECT o.id, o.total_price, o.discount, o.doctor_id
    FROM orders o
    WHERE EXISTS (
        SELECT 1 FROM order_items x
        WHERE x.order_id = o.id AND COALESCE(x.price, 0) = 0
    )
),
item_ctx AS (
    -- teeth count mirrors the app: one unit per tooth number
    SELECT
        oi.id AS item_id,
        oi.order_id,
        GREATEST(COALESCE(jsonb_array_length(oi.teeth_numbers), 0), 1)::numeric AS cnt,
        COALESCE(oi.price, 0)::numeric AS price,
        -- catalog weight mirrors getDoctorServicePrice(): the pricing doctor is
        -- the parent centre when the order's doctor is a branch/child.
        COALESCE(
            (COALESCE(pd.custom_prices, d.custom_prices) ->> oi.product_type)::numeric,
            s.selling_price,
            0
        )::numeric AS catalog_unit
    FROM order_items oi
    JOIN affected a ON a.id = oi.order_id
    JOIN doctors d ON d.id = a.doctor_id
    LEFT JOIN doctors pd ON pd.id = d.parent_id
    LEFT JOIN services s ON s.name = oi.product_type
),
order_ctx AS (
    SELECT
        a.id AS order_id,
        (a.total_price + a.discount
            - COALESCE(SUM(CASE WHEN ic.price > 0 THEN ic.price * ic.cnt ELSE 0 END), 0)
        )::numeric AS target,
        SUM(CASE WHEN ic.price = 0 THEN ic.catalog_unit * ic.cnt ELSE 0 END)::numeric AS weight_total
    FROM affected a
    JOIN item_ctx ic ON ic.order_id = a.id
    GROUP BY a.id, a.total_price, a.discount
),
unknown_items AS (
    SELECT
        ic.item_id,
        ic.order_id,
        ic.cnt,
        GREATEST(oc.target, 0) AS target,
        -- when no catalog price is known for any line, fall back to an even
        -- per-tooth split so the total still reconciles
        CASE WHEN oc.weight_total > 0 THEN ic.catalog_unit * ic.cnt ELSE ic.cnt END AS weight,
        CASE WHEN oc.weight_total > 0 THEN 'weighted_by_catalog_price' ELSE 'even_per_tooth' END AS method,
        -- rn = 1 is the residual absorber: fewest teeth first so the leftover
        -- piasters land on a line where 2 decimals can express them exactly
        ROW_NUMBER() OVER (
            PARTITION BY ic.order_id
            ORDER BY ic.cnt ASC,
                     (CASE WHEN oc.weight_total > 0 THEN ic.catalog_unit * ic.cnt ELSE ic.cnt END) DESC,
                     ic.item_id
        ) AS rn
    FROM item_ctx ic
    JOIN order_ctx oc ON oc.order_id = ic.order_id
    WHERE ic.price = 0
),
sized AS (
    SELECT
        u.*,
        ROUND(
            u.target * u.weight
            / NULLIF(SUM(u.weight) OVER (PARTITION BY u.order_id), 0)
            / u.cnt
        , 2) AS unit_prop
    FROM unknown_items u
),
resolved AS (
    SELECT
        s.item_id,
        s.order_id,
        s.method,
        CASE WHEN s.rn = 1
            THEN ROUND(
                (s.target - COALESCE(
                    SUM(s.unit_prop * s.cnt) FILTER (WHERE s.rn > 1) OVER (PARTITION BY s.order_id),
                    0
                )) / s.cnt
            , 2)
            ELSE s.unit_prop
        END AS unit_final
    FROM sized s
),
updated AS (
    UPDATE order_items oi
    SET price = r.unit_final
    FROM resolved r
    WHERE oi.id = r.item_id
      AND COALESCE(oi.price, 0) = 0
    RETURNING oi.id AS item_id, oi.order_id, 0::numeric(10,2) AS old_price, oi.price AS new_price, r.method
)
INSERT INTO order_item_price_backfill_audit (item_id, order_id, old_price, new_price, method)
SELECT item_id, order_id, old_price, new_price, method FROM updated;

-- ---------------------------------------------------------------------
-- Verification: every touched order must still reconcile to the penny.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_bad_orders integer;
    v_touched    integer;
    v_sample     text;
BEGIN
    SELECT COUNT(DISTINCT order_id) INTO v_touched
    FROM order_item_price_backfill_audit;

    SELECT COUNT(*), COALESCE(string_agg(case_id, ', ' ORDER BY case_id), '')
    INTO v_bad_orders, v_sample
    FROM (
        SELECT o.case_id
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        WHERE o.id IN (SELECT DISTINCT order_id FROM order_item_price_backfill_audit)
        GROUP BY o.id, o.case_id, o.total_price, o.discount
        HAVING SUM(oi.price * GREATEST(COALESCE(jsonb_array_length(oi.teeth_numbers), 0), 1))
               - o.discount <> o.total_price
        LIMIT 20
    ) bad;

    IF v_bad_orders > 0 THEN
        RAISE EXCEPTION
            'Backfill aborted: % order(s) do not reconcile to their stored total (sample: %)',
            v_bad_orders, v_sample;
    END IF;

    RAISE NOTICE 'Legacy order item prices backfilled for % order(s); all totals reconcile exactly.', v_touched;
END $$;

COMMIT;
