-- Guarded production backfill for the 17 reviewed supplier/designer payments.
-- Preview approved on 2026-08-01:
--   payment total:       333,285.00
--   FIFO allocation:     325,895.00 across 320 allocation rows
--   EZ settlement close:   7,390.00 (resolved by adjustment)
--   AB settlement close:     465.00 (written off against adjustment)

DO $$
DECLARE
    v_target_ids UUID[] := ARRAY[
        'd79feb70-a62f-487c-8573-4c487239b60a'::UUID,
        '22b40b85-4347-4483-b703-08bf37f2e1f9'::UUID,
        '8aaa5c37-1323-4fc7-9f95-a854715bf088'::UUID,
        '7504c7a3-b2f5-4f63-bbfe-3a4f1b8d85e9'::UUID,
        '10990982-72a7-4c47-b537-c3a4c40f8ef1'::UUID,
        '75198803-73b5-4282-9858-17f1284a444c'::UUID,
        '77cb4484-642a-4972-b895-70d676bd023f'::UUID,
        'cd00ad26-16f8-4ad4-a78e-a1bae3dafb53'::UUID,
        '8f98db5f-378f-4593-af62-a872f6770601'::UUID,
        '055924e7-2116-493d-8663-e1a085e0adbc'::UUID,
        '06eafab9-a3a0-40b5-9edc-ad5a1942a9fa'::UUID,
        '354f5f9c-ab3d-448f-bf02-c24ca6442522'::UUID,
        '37d5bad4-d9a3-4719-bacd-942ced209fe0'::UUID,
        'c9607dd0-7a1e-4b31-909d-c19c03b31553'::UUID,
        '81ff0a2d-375f-43db-9ce2-7312927547bd'::UUID,
        '91bc3d05-e4ac-4da7-aa8e-76db6139500b'::UUID,
        'efebb95c-8ff6-4b85-9246-692c23d46892'::UUID
    ];
    v_ez_transaction_id CONSTANT UUID := 'd79feb70-a62f-487c-8573-4c487239b60a';
    v_ez_adjustment_id CONSTANT UUID := 'ae0f72ae-e883-4022-94ba-974691844d6f';
    v_ab_obligation_id CONSTANT UUID := '45d09bdf-4219-4054-b2f2-99c87c9ae188';
    v_ab_adjustment_id CONSTANT UUID := '1d4ed38c-60ce-43d2-a786-5b1ba7e9295f';
    v_target_count INTEGER;
    v_unallocated_total NUMERIC(12, 2);
    v_active_allocation_total NUMERIC(12, 2);
    v_active_allocation_count INTEGER;
    v_ez_review_id UUID;
    v_row RECORD;
BEGIN
    -- A fresh local database has none of these production UUIDs. Keep schema setup usable
    -- there, but reject every partial/ambiguous production match.
    SELECT COUNT(*)
    INTO v_target_count
    FROM public.transactions
    WHERE id = ANY(v_target_ids);

    IF v_target_count = 0 THEN
        RAISE NOTICE 'Reviewed payable payment rows are absent; guarded backfill skipped';
        RETURN;
    END IF;

    IF v_target_count <> 17 THEN
        RAISE EXCEPTION 'Guard failed: expected 17 reviewed payments, found %', v_target_count;
    END IF;

    SELECT COUNT(*), COALESCE(SUM(allocated_amount), 0)
    INTO v_active_allocation_count, v_active_allocation_total
    FROM public.payment_allocations
    WHERE payment_transaction_id = ANY(v_target_ids)
      AND status = 'active';

    IF v_active_allocation_count = 320
       AND v_active_allocation_total = 325895.00
       AND EXISTS (
           SELECT 1
           FROM public.financial_obligations
           WHERE id = v_ab_obligation_id
             AND status = 'written_off'
             AND remaining_amount = 465.00
             AND metadata->>'adjustmentId' = v_ab_adjustment_id::TEXT
       )
       AND EXISTS (
           SELECT 1
           FROM public.financial_exception_reviews
           WHERE transaction_id = v_ez_transaction_id
             AND review_type = 'supplier_overpayment'
             AND status = 'resolved'
             AND amount = 7390.00
             AND metadata->>'adjustmentId' = v_ez_adjustment_id::TEXT
       ) THEN
        RAISE NOTICE 'Reviewed payable payment backfill is already complete; skipping';
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.transactions
        WHERE id = ANY(v_target_ids)
          AND NOT (
              type = 'expense'
              AND status = 'approved'
              AND (
                  (entity_type = 'supplier' AND category = 'supplier_payment')
                  OR (entity_type = 'designer' AND category = 'designer_payment')
              )
          )
    ) THEN
        RAISE EXCEPTION 'Guard failed: one or more reviewed transactions changed type, category, entity type, or approval status';
    END IF;

    SELECT COALESCE(SUM(t.amount - COALESCE(a.allocated, 0)), 0)
    INTO v_unallocated_total
    FROM public.transactions t
    LEFT JOIN (
        SELECT payment_transaction_id, SUM(allocated_amount) AS allocated
        FROM public.payment_allocations
        WHERE status = 'active'
        GROUP BY payment_transaction_id
    ) a ON a.payment_transaction_id = t.id
    WHERE t.id = ANY(v_target_ids);

    IF v_unallocated_total <> 333285.00 THEN
        RAISE EXCEPTION 'Guard failed: expected 333285.00 unallocated, found %', v_unallocated_total;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.adjustments
        WHERE id = v_ez_adjustment_id
          AND type = 'credit'
          AND amount = 7390.00
          AND reason = 'تسوية الحساب (اختلاف اسعار خدمات وتراى ان وحالات مرفوضة)'
    ) THEN
        RAISE EXCEPTION 'Guard failed: EZ 7390.00 closing adjustment changed or is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.adjustments
        WHERE id = v_ab_adjustment_id
          AND type = 'charge'
          AND amount = 465.00
          AND reason = 'تقفيل الحساب'
    ) THEN
        RAISE EXCEPTION 'Guard failed: AB 465.00 closing adjustment changed or is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.financial_obligations
        WHERE id = v_ab_obligation_id
          AND status IN ('unpaid', 'partially_paid')
          AND remaining_amount = 5100.00
    ) THEN
        RAISE EXCEPTION 'Guard failed: AB target obligation no longer has the verified 5100.00 remaining';
    END IF;

    FOR v_row IN
        SELECT id
        FROM public.transactions
        WHERE id = ANY(v_target_ids)
        ORDER BY date, id
    LOOP
        PERFORM public.allocate_payable_transaction_fifo(v_row.id, NULL);
    END LOOP;

    SELECT COUNT(*), COALESCE(SUM(allocated_amount), 0)
    INTO v_active_allocation_count, v_active_allocation_total
    FROM public.payment_allocations
    WHERE payment_transaction_id = ANY(v_target_ids)
      AND status = 'active';

    IF v_active_allocation_count <> 320 OR v_active_allocation_total <> 325895.00 THEN
        RAISE EXCEPTION
            'Post-allocation guard failed: expected 320 rows / 325895.00, found % rows / %',
            v_active_allocation_count,
            v_active_allocation_total;
    END IF;

    SELECT id
    INTO v_ez_review_id
    FROM public.financial_exception_reviews
    WHERE transaction_id = v_ez_transaction_id
      AND review_type = 'supplier_overpayment'
      AND status IN ('open', 'in_review')
      AND amount = 7390.00
    ORDER BY created_at DESC, id
    LIMIT 1
    FOR UPDATE;

    IF v_ez_review_id IS NULL THEN
        RAISE EXCEPTION 'Post-allocation guard failed: EZ 7390.00 settlement review was not created';
    END IF;

    UPDATE public.financial_exception_reviews
    SET status = 'resolved',
        resolved_at = timezone('utc'::text, now()),
        resolution_notes = 'Closed by the approved 7390.00 account-settlement adjustment; not a future supplier credit.',
        metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
            'resolutionType', 'settled_by_adjustment',
            'adjustmentId', v_ez_adjustment_id,
            'closedAmount', 7390.00,
            'productionBackfill', '20260801050000'
        )
    WHERE id = v_ez_review_id;

    IF NOT EXISTS (
        SELECT 1
        FROM public.financial_obligations
        WHERE id = v_ab_obligation_id
          AND status = 'partially_paid'
          AND remaining_amount = 465.00
    ) THEN
        RAISE EXCEPTION 'Post-allocation guard failed: AB target obligation did not reach the previewed 465.00 residual';
    END IF;

    UPDATE public.financial_obligations
    SET status = 'written_off',
        notes = concat_ws(
            E'\n',
            NULLIF(notes, ''),
            'Remaining 465.00 closed by approved account-closing adjustment on 2026-07-18.'
        ),
        metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
            'settlementStatus', 'settled_by_adjustment',
            'adjustmentId', v_ab_adjustment_id,
            'writtenOffAmount', 465.00,
            'productionBackfill', '20260801050000'
        )
    WHERE id = v_ab_obligation_id;

    IF EXISTS (
        SELECT 1
        FROM public.financial_obligations fo
        JOIN public.suppliers s ON s.id = fo.entity_id
        WHERE fo.entity_type = 'external_lab'
          AND s.name IN ('AB Lab', 'EZ Lab')
          AND fo.status IN ('unpaid', 'partially_paid')
          AND fo.remaining_amount > 0
    ) THEN
        RAISE EXCEPTION 'Final guard failed: AB Lab or EZ Lab still has an open payable obligation';
    END IF;
END;
$$;
