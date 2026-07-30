-- Reprice historical Harmony Lab orders after agreeing the supplier price list.
--
-- Accounting behaviour:
--   * updates orders.cost (the historical order snapshot);
--   * clears is_registered and appends an accountant-review system comment;
--   * lets the existing orders financial trigger void/recreate the supplier
--     obligation and transfer any active allocations atomically;
--   * leaves manual-cost and non-default-priced orders untouched.
--
-- HOW TO RUN
-- 1. Run the whole script in Supabase SQL Editor with apply_changes = false.
-- 2. Review the result sets: "eligible", "skipped", and the totals.
-- 3. Change apply_changes to true and run the whole script again.
--
-- The transaction is all-or-nothing. The script deliberately targets the
-- supplier code 10007 as well as the exact name, so a similarly named supplier
-- cannot be changed accidentally.

BEGIN;

CREATE TEMP TABLE harmony_reprice_config (
    apply_changes BOOLEAN NOT NULL,
    supplier_name TEXT NOT NULL,
    supplier_code TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO harmony_reprice_config (apply_changes, supplier_name, supplier_code)
VALUES (
    false,          -- SAFETY SWITCH: change to true only after reviewing preview
    'Harmony Lab',
    '10007'
);

DO $$
DECLARE
    v_supplier_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO v_supplier_count
    FROM public.suppliers supplier
    CROSS JOIN harmony_reprice_config config
    WHERE lower(trim(supplier.name)) = lower(trim(config.supplier_name))
      AND supplier.supplier_code::TEXT = config.supplier_code;

    IF v_supplier_count <> 1 THEN
        RAISE EXCEPTION
            'Safety check failed: expected exactly one supplier named Harmony Lab with code 10007, found %',
            v_supplier_count;
    END IF;
END;
$$;

CREATE TEMP TABLE harmony_reprice_preview ON COMMIT DROP AS
WITH target_supplier AS (
    SELECT
        supplier.id,
        supplier.name,
        supplier.supplier_code,
        COALESCE(supplier.custom_prices, '{}'::jsonb) AS custom_prices,
        COALESCE(supplier.milling_prices, '{}'::jsonb) AS milling_prices
    FROM public.suppliers supplier
    CROSS JOIN harmony_reprice_config config
    WHERE lower(trim(supplier.name)) = lower(trim(config.supplier_name))
      AND supplier.supplier_code::TEXT = config.supplier_code
),
order_units AS (
    -- Current orders use order_items. Fall back to the legacy orders.items JSON
    -- only when an order has no normalized rows.
    SELECT
        item.order_id,
        item.product_type AS service_name,
        GREATEST(
            COALESCE(jsonb_array_length(item.teeth_numbers), 0),
            COALESCE(item.count, 0),
            1
        )::NUMERIC AS units
    FROM public.order_items item

    UNION ALL

    SELECT
        orders.id AS order_id,
        legacy_item->>'serviceType' AS service_name,
        GREATEST(
            COALESCE(jsonb_array_length(legacy_item->'teethNumbers'), 0),
            1
        )::NUMERIC AS units
    FROM public.orders orders
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE
            WHEN jsonb_typeof(orders.items) = 'array' THEN orders.items
            ELSE '[]'::jsonb
        END
    ) legacy_item
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.order_items normalized_item
        WHERE normalized_item.order_id = orders.id
    )
),
price_components AS (
    SELECT
        orders.id AS order_id,
        COUNT(units.service_name) AS item_count,
        COUNT(service.id) AS matched_service_count,
        SUM(
            CASE
                WHEN orders.workflow_type = 'split'
                    THEN COALESCE(NULLIF(service.milling_price, 0), service.cost_price * 0.5) * units.units
                ELSE service.cost_price * units.units
            END
        )::NUMERIC(12, 2) AS old_default_lab_cost,
        SUM(
            CASE
                WHEN orders.workflow_type = 'split' THEN
                    CASE
                        WHEN supplier.milling_prices ? units.service_name
                            THEN (supplier.milling_prices->>units.service_name)::NUMERIC
                        ELSE COALESCE(NULLIF(service.milling_price, 0), service.cost_price * 0.5)
                    END * units.units
                ELSE
                    CASE
                        WHEN supplier.custom_prices ? units.service_name
                            THEN (supplier.custom_prices->>units.service_name)::NUMERIC
                        ELSE service.cost_price
                    END * units.units
            END
        )::NUMERIC(12, 2) AS agreed_lab_cost
    FROM public.orders orders
    JOIN target_supplier supplier ON supplier.id = orders.supplier_id
    LEFT JOIN order_units units ON units.order_id = orders.id
    LEFT JOIN public.services service ON service.name = units.service_name
    GROUP BY orders.id
)
SELECT
    orders.id AS order_id,
    orders.case_id,
    orders.patient_name,
    orders.status,
    orders.production_status,
    orders.issue_state,
    orders.workflow_type,
    orders.created_at,
    orders.cost::NUMERIC(12, 2) AS old_order_cost,
    orders.manual_cost::NUMERIC(12, 2) AS manual_cost,
    components.old_default_lab_cost,
    components.agreed_lab_cost,
    CASE
        -- In split workflow, orders.cost also contains the per-piece designer
        -- amount. Preserve that amount and replace only the lab component.
        WHEN orders.workflow_type = 'split'
            THEN (
                orders.cost
                - COALESCE(components.old_default_lab_cost, 0)
                + COALESCE(components.agreed_lab_cost, 0)
            )::NUMERIC(12, 2)
        ELSE components.agreed_lab_cost::NUMERIC(12, 2)
    END AS new_order_cost,
    orders.is_registered AS was_registered,
    CASE
        WHEN components.item_count = 0 THEN 'no_items'
        WHEN components.matched_service_count <> components.item_count THEN 'unmatched_service'
        WHEN orders.manual_cost IS NOT NULL THEN 'manual_cost'
        WHEN orders.workflow_type NOT IN ('full', 'split') THEN 'unknown_workflow'
        WHEN orders.workflow_type = 'full'
             AND abs(orders.cost - components.old_default_lab_cost) > 0.01
            THEN 'old_cost_not_default'
        WHEN orders.workflow_type = 'split'
             AND orders.cost + 0.01 < components.old_default_lab_cost
            THEN 'invalid_split_cost'
        WHEN components.agreed_lab_cost = components.old_default_lab_cost
            THEN 'no_price_difference'
        ELSE 'eligible'
    END AS decision
FROM public.orders orders
JOIN price_components components ON components.order_id = orders.id
WHERE COALESCE(orders.is_deleted, false) = false;

-- Detailed preview. Every skipped row includes the reason in "decision".
SELECT *
FROM harmony_reprice_preview
ORDER BY
    CASE WHEN decision = 'eligible' THEN 0 ELSE 1 END,
    created_at,
    case_id;

-- Accounting totals before applying.
SELECT
    decision,
    COUNT(*) AS order_count,
    SUM(old_order_cost)::NUMERIC(14, 2) AS old_total_cost,
    SUM(new_order_cost)::NUMERIC(14, 2) AS proposed_total_cost,
    SUM(new_order_cost - old_order_cost)::NUMERIC(14, 2) AS difference
FROM harmony_reprice_preview
GROUP BY decision
ORDER BY decision;

DO $$
DECLARE
    v_apply BOOLEAN;
    v_updated INTEGER;
BEGIN
    SELECT apply_changes INTO v_apply FROM harmony_reprice_config;

    IF NOT v_apply THEN
        RAISE NOTICE 'PREVIEW ONLY: no orders or obligations were changed.';
        RETURN;
    END IF;

    UPDATE public.orders orders
    SET
        cost = preview.new_order_cost,
        is_registered = false,
        comments = COALESCE(orders.comments, '[]'::jsonb) || jsonb_build_array(
            jsonb_build_object(
                'id', gen_random_uuid(),
                'text',
                    '⚠️ تم تعديل سعر تكلفة Harmony Lab بعد اعتماد قائمة الأسعار'
                    || ' (من ' || preview.old_order_cost
                    || ' إلى ' || preview.new_order_cost
                    || ') — تحتاج مراجعة وإعادة تسجيل محاسبي',
                'userId', 'system',
                'userName', 'System',
                'createdAt', timezone('utc', now())
            )
        ),
        updated_at = now()
    FROM harmony_reprice_preview preview
    WHERE orders.id = preview.order_id
      AND preview.decision = 'eligible'
      -- Optimistic guard: abort instead of overwriting a concurrent edit.
      AND orders.cost = preview.old_order_cost;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated <> (
        SELECT COUNT(*)
        FROM harmony_reprice_preview
        WHERE decision = 'eligible'
    ) THEN
        RAISE EXCEPTION
            'Concurrent-change safety check failed: expected to update %, updated %. Transaction rolled back.',
            (SELECT COUNT(*) FROM harmony_reprice_preview WHERE decision = 'eligible'),
            v_updated;
    END IF;

    RAISE NOTICE
        'Applied Harmony Lab repricing to % orders. Existing financial triggers synchronized obligations in this transaction.',
        v_updated;
END;
$$;

-- Post-run verification. In preview mode these are the current values; in apply
-- mode they must equal new_order_cost and registered_after must be false.
SELECT
    preview.case_id,
    preview.old_order_cost,
    preview.new_order_cost,
    orders.cost::NUMERIC(12, 2) AS cost_after,
    orders.is_registered AS registered_after,
    obligation.id AS active_obligation_id,
    obligation.net_amount AS active_obligation_amount,
    obligation.status AS active_obligation_status
FROM harmony_reprice_preview preview
JOIN public.orders orders ON orders.id = preview.order_id
LEFT JOIN public.financial_obligations obligation
    ON obligation.order_id = preview.order_id
   AND obligation.entity_type = 'external_lab'
   AND obligation.direction = 'payable'
   AND obligation.status <> 'void'
WHERE preview.decision = 'eligible'
ORDER BY preview.created_at, preview.case_id;

COMMIT;
