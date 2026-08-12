-- Restore only the exact legacy batch reopened by the 20260730050000 blanket
-- backfill. This changes workflow flags only; no financial columns are updated.
-- The guard deliberately fails if production no longer matches the reviewed
-- preview, so genuinely newer edits cannot be hidden accidentally.

DO $$
DECLARE
    v_count BIGINT;
    v_total_price NUMERIC;
    v_discount NUMERIC;
    v_effective_lab_cost NUMERIC;
    v_rejected_lab_cost NUMERIC;
    v_effective_design_price NUMERIC;
    v_updated_count BIGINT;
BEGIN
    SELECT
        COUNT(*),
        COALESCE(SUM(COALESCE(total_price, 0)), 0),
        COALESCE(SUM(COALESCE(discount, 0)), 0),
        COALESCE(SUM(COALESCE(manual_cost, cost, 0)), 0),
        COALESCE(SUM(COALESCE(rejected_lab_cost, 0)), 0),
        COALESCE(SUM(COALESCE(manual_design_price, design_price, 0)), 0)
    INTO
        v_count,
        v_total_price,
        v_discount,
        v_effective_lab_cost,
        v_rejected_lab_cost,
        v_effective_design_price
    FROM public.orders
    WHERE needs_accounting_reregistration = TRUE
      AND is_registered = FALSE
      AND is_archived = TRUE
      AND COALESCE(is_deleted, FALSE) = FALSE
      AND updated_at = '2026-07-30T18:39:03.882929+00:00'::timestamptz;

    -- Fresh/empty databases legitimately have no legacy production batch.
    IF v_count = 0 THEN
        RETURN;
    END IF;

    -- Restore the 66 archived rows from the reviewed batch. The seven
    -- non-archived rows are restored by the following corrective migration so
    -- accounting cleanup does not depend on operational archive state.
    IF v_count <> 66
       OR v_total_price <> 178800
       OR v_discount <> 150
       OR v_effective_lab_cost <> 100890
       OR v_rejected_lab_cost <> 21410
       OR v_effective_design_price <> 1900 THEN
        RAISE EXCEPTION
            'Legacy accounting cleanup no longer matches approved preview (count %, price %, discount %, lab %, rejected lab %, design %)',
            v_count,
            v_total_price,
            v_discount,
            v_effective_lab_cost,
            v_rejected_lab_cost,
            v_effective_design_price;
    END IF;

    UPDATE public.orders
    SET is_registered = TRUE,
        needs_accounting_reregistration = FALSE
    WHERE needs_accounting_reregistration = TRUE
      AND is_registered = FALSE
      AND is_archived = TRUE
      AND COALESCE(is_deleted, FALSE) = FALSE
      AND updated_at = '2026-07-30T18:39:03.882929+00:00'::timestamptz;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count <> 66 THEN
        RAISE EXCEPTION 'Legacy accounting cleanup updated % rows instead of 66', v_updated_count;
    END IF;
END;
$$;
