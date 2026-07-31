-- Restore the seven non-archived rows from the reviewed 73-row legacy batch.
-- Exact UUIDs and amount guards prevent any newer accounting change from being
-- hidden. No financial column is modified.

DO $$
DECLARE
    v_count BIGINT;
    v_total_price NUMERIC;
    v_effective_lab_cost NUMERIC;
    v_effective_design_price NUMERIC;
    v_updated_count BIGINT;
BEGIN
    SELECT
        COUNT(*),
        COALESCE(SUM(COALESCE(total_price, 0)), 0),
        COALESCE(SUM(COALESCE(manual_cost, cost, 0)), 0),
        COALESCE(SUM(COALESCE(manual_design_price, design_price, 0)), 0)
    INTO v_count, v_total_price, v_effective_lab_cost, v_effective_design_price
    FROM public.orders
    WHERE id IN (
        '6468e77a-f222-409e-9afd-c8ce024315d2',
        '1f3ede2f-6c4e-408a-9442-e31fa9d4e788',
        '23707af0-190a-4890-b7b7-6f23c81515a5',
        'd9221659-7177-49c8-8b13-c23f119e6dcc',
        'e40bb1b2-4317-4e1c-a8a7-d00f010236d4',
        '42b923e5-286e-4b9d-a2d9-8690a63d419c',
        '9bc2eb13-8f0a-4758-ac93-413a49d20afd'
    )
      AND needs_accounting_reregistration = TRUE
      AND is_registered = FALSE
      AND COALESCE(is_deleted, FALSE) = FALSE
      AND updated_at = '2026-07-30T18:39:03.882929+00:00'::timestamptz;

    IF v_count = 0 THEN
        RETURN;
    END IF;

    IF v_count <> 7
       OR v_total_price <> 11200
       OR v_effective_lab_cost <> 6340
       OR v_effective_design_price <> 500 THEN
        RAISE EXCEPTION
            'Remaining legacy cleanup no longer matches reviewed rows (count %, price %, lab %, design %)',
            v_count, v_total_price, v_effective_lab_cost, v_effective_design_price;
    END IF;

    UPDATE public.orders
    SET is_registered = TRUE,
        needs_accounting_reregistration = FALSE
    WHERE id IN (
        '6468e77a-f222-409e-9afd-c8ce024315d2',
        '1f3ede2f-6c4e-408a-9442-e31fa9d4e788',
        '23707af0-190a-4890-b7b7-6f23c81515a5',
        'd9221659-7177-49c8-8b13-c23f119e6dcc',
        'e40bb1b2-4317-4e1c-a8a7-d00f010236d4',
        '42b923e5-286e-4b9d-a2d9-8690a63d419c',
        '9bc2eb13-8f0a-4758-ac93-413a49d20afd'
    )
      AND needs_accounting_reregistration = TRUE
      AND is_registered = FALSE
      AND COALESCE(is_deleted, FALSE) = FALSE
      AND updated_at = '2026-07-30T18:39:03.882929+00:00'::timestamptz;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count <> 7 THEN
        RAISE EXCEPTION 'Remaining legacy cleanup updated % rows instead of 7', v_updated_count;
    END IF;
END;
$$;
