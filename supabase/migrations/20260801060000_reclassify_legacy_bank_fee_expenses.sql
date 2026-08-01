-- Reclassify the four pre-cashbox bank-fee expenses without attaching them to
-- a cashbox or changing any financial amount/date.
DO $$
DECLARE
    v_empty_database boolean;
    v_source_count integer;
    v_target_count integer;
    v_updated_count integer;
BEGIN
    SELECT NOT EXISTS (SELECT 1 FROM transactions)
    INTO v_empty_database;

    SELECT
        count(*) FILTER (WHERE category = 'مصروفات أخرى'),
        count(*) FILTER (WHERE category = 'عمولات ورسوم بنكية')
    INTO v_source_count, v_target_count
    FROM transactions
    WHERE type = 'expense'
      AND cashbox_id IS NULL
      AND (
          (date::date = DATE '2026-07-02' AND amount = 1310 AND description ILIKE '%عمولة البنك%')
          OR
          (date::date = DATE '2026-05-18' AND amount = 2500 AND description ILIKE '%جامعة الدلتا%')
          OR
          (date::date = DATE '2026-05-17' AND amount = 805 AND description ILIKE '%عمولة البنك%ماكينة الفيزا%')
          OR
          (date::date = DATE '2026-05-10' AND amount = 686 AND description ILIKE '%عمولة البنك%33300%')
      );

    IF v_empty_database THEN
        RAISE NOTICE 'Fresh database detected; no legacy bank-fee expenses require reclassification.';
        RETURN;
    END IF;

    IF v_source_count = 0 AND v_target_count = 4 THEN
        RAISE NOTICE 'The 4 legacy bank-fee expenses are already reclassified; no changes were applied.';
        RETURN;
    END IF;

    IF v_source_count <> 4 OR v_target_count <> 0 THEN
        RAISE EXCEPTION 'Expected 4 legacy bank-fee expenses awaiting reclassification (source %, target %). No changes were applied.', v_source_count, v_target_count;
    END IF;

    UPDATE transactions
    SET category = 'عمولات ورسوم بنكية'
    WHERE type = 'expense'
      AND cashbox_id IS NULL
      AND category = 'مصروفات أخرى'
      AND (
          (date::date = DATE '2026-07-02' AND amount = 1310 AND description ILIKE '%عمولة البنك%')
          OR
          (date::date = DATE '2026-05-18' AND amount = 2500 AND description ILIKE '%جامعة الدلتا%')
          OR
          (date::date = DATE '2026-05-17' AND amount = 805 AND description ILIKE '%عمولة البنك%ماكينة الفيزا%')
          OR
          (date::date = DATE '2026-05-10' AND amount = 686 AND description ILIKE '%عمولة البنك%33300%')
      );

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count <> v_source_count THEN
        RAISE EXCEPTION 'Expected to reclassify % legacy bank-fee expenses, but updated %. No changes were applied.', v_source_count, v_updated_count;
    END IF;
    RAISE NOTICE 'Reclassified % legacy cashboxless expenses as bank fees; cashbox data was unchanged.', v_updated_count;
END;
$$;
