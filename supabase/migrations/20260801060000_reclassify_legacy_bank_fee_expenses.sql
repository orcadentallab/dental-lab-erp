-- Reclassify the four pre-cashbox bank-fee expenses without attaching them to
-- a cashbox or changing any financial amount/date.
DO $$
DECLARE
    v_updated_count integer;
BEGIN
    -- A fresh local database has no historical transactions to reclassify.
    -- Keep the exact four-row assertion for every populated database.
    IF NOT EXISTS (SELECT 1 FROM transactions) THEN
        RETURN;
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
    IF v_updated_count <> 4 THEN
        RAISE EXCEPTION 'Expected to reclassify exactly 4 legacy bank-fee expenses, but matched %. No changes were applied.', v_updated_count;
    END IF;
    RAISE NOTICE 'Reclassified % legacy cashboxless expenses as bank fees; cashbox data was unchanged.', v_updated_count;
END;
$$;
