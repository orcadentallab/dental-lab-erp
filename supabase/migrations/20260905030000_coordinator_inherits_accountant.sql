-- Production roles, step 2a of 3: the coordinator inherits the accountant.
-- See docs/PRODUCTION_ROLES_PLAN_AR.md decision 3 and section 8.1.
--
-- PURELY ADDITIVE. Every statement below widens a role list by one name.
-- Nothing is revoked, no row is written, and no existing role loses anything
-- -- 'accountant' in particular stays exactly where it was, because decision 5
-- keeps it as a standalone hiring option and keeps Emad on it. A coordinator
-- can now do what an accountant can do; an accountant is unaffected.
--
-- WHY 2a AND 2b, NOT 2
--   Decision 3 makes the coordinator representative + accountant. Splitting
--   that in half is not caution for its own sake -- the two halves are not
--   equally safe to change:
--
--     'accountant' is ALWAYS a role check. Verified across every function in
--     the schema: no line contains the literal outside a v_role / get_my_role
--     comparison. The rewrite below was therefore generated mechanically from
--     the live definitions and is safe to read as uniform.
--
--     'representative' is NOT. It doubles as a DATA value -- transactions
--     .entity_type, order_events.responsibility_party, the 'representative_edit'
--     audit label. The same mechanical pass over those would have rewritten
--     expense categorisation and audit history, silently. Step 2b does that
--     half by hand, and it also carries a question this step does not: whether
--     a coordinator registering a case should be stamped as its representative
--     for commission purposes.
--
-- HOW THIS WAS PRODUCED
--   Generated from pg_policies and pg_get_functiondef on the migrated schema,
--   so each body below is the CURRENT definition with one name added to one
--   list. Two shapes appear:
--       IN ('admin', 'accountant')      ->  IN ('admin', 'accountant', 'coordinator')
--       get_my_role() = 'accountant'    ->  get_my_role() = ANY (ARRAY['accountant', 'coordinator'])
--   The second shape is a widening, not a narrowing: equality against one
--   value becomes membership in two.
--
--   Reviewing this file means reviewing the 13 distinct guard lines that
--   changed, not 2700 lines of unchanged function bodies. To see only those:
--       grep -n "'coordinator'" <this file>
--
-- WHAT THE COORDINATOR STILL CANNOT DO after this step
--   DELETE on transactions, doctors or suppliers -- those policies name
--   'admin' alone and are untouched here, which is decision 3's explicit
--   limit. Production stage runs, route editing and production_status also
--   remain out of reach; those belong to step 3.

BEGIN;

-- ═══ Functions (24) ═══

CREATE OR REPLACE FUNCTION public.add_financial_snapshot_note(p_snapshot_id uuid, p_note text)
 RETURNS financial_report_snapshot_notes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_user_id UUID;
    v_note public.financial_report_snapshot_notes%ROWTYPE;
BEGIN
    IF public.get_my_role() NOT IN ('admin', 'accountant', 'coordinator') THEN
        RAISE EXCEPTION 'Only finance reviewers can add snapshot notes';
    END IF;

    IF NULLIF(btrim(p_note), '') IS NULL THEN
        RAISE EXCEPTION 'Snapshot note is required';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.financial_report_snapshots WHERE id = p_snapshot_id
    ) THEN
        RAISE EXCEPTION 'Snapshot not found';
    END IF;

    SELECT id INTO v_user_id
    FROM public.users
    WHERE auth_id = auth.uid()
    LIMIT 1;

    INSERT INTO public.financial_report_snapshot_notes (
        snapshot_id,
        note,
        created_by
    )
    VALUES (p_snapshot_id, btrim(p_note), v_user_id)
    RETURNING * INTO v_note;

    RETURN v_note;
END;
$function$;
CREATE OR REPLACE FUNCTION public.adjust_material_batch(p_batch_id uuid, p_new_qty numeric, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_batch public.material_batches%ROWTYPE;
    v_diff NUMERIC;
    v_user_id UUID := auth.uid();
    v_role TEXT := public.get_my_role();
BEGIN
    IF v_role NOT IN ('admin', 'accountant', 'coordinator', 'lab') THEN
        RAISE EXCEPTION 'ليس لديك صلاحية تسوية المخزون';
    END IF;

    IF p_new_qty < 0 THEN
        RAISE EXCEPTION 'الكمية لا يمكن أن تكون سالبة';
    END IF;

    SELECT * INTO v_batch FROM public.material_batches WHERE id = p_batch_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'اللوت غير موجود';
    END IF;

    v_diff := p_new_qty - v_batch.qty_remaining;
    IF v_diff = 0 THEN
        RETURN to_jsonb(v_batch);
    END IF;

    -- Record Adjustment Movement
    INSERT INTO public.material_movements (
        batch_id, warehouse_id, movement_type, qty, notes, created_by
    ) VALUES (
        p_batch_id, v_batch.warehouse_id, 'adjust', v_diff,
        COALESCE(p_reason, 'تسوية جردية'), v_user_id
    );

    -- The 'adjust' movement above is what changes the balance; the rebalance
    -- trigger has already applied it. Only the status is decided here.
    UPDATE public.material_batches
       SET status = CASE WHEN p_new_qty = 0 THEN 'depleted' ELSE v_batch.status END,
           depleted_at = CASE WHEN p_new_qty = 0 THEN COALESCE(depleted_at, NOW()) ELSE depleted_at END,
           depleted_by = CASE WHEN p_new_qty = 0 THEN COALESCE(depleted_by, v_user_id) ELSE depleted_by END,
           updated_at = NOW()
     WHERE id = p_batch_id
     RETURNING * INTO v_batch;

    RETURN to_jsonb(v_batch);
END;
$function$;
CREATE OR REPLACE FUNCTION public.append_order_event_v2(p_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := public.get_my_user_id();
    v_order public.orders%ROWTYPE;
    v_event public.order_events%ROWTYPE;
BEGIN
    IF v_role NOT IN ('admin', 'accountant', 'coordinator', 'representative', 'lab', 'designer') OR v_user_id IS NULL THEN
        RAISE EXCEPTION 'Role cannot append order events';
    END IF;
    SELECT * INTO v_order FROM public.orders WHERE id = (p_event->>'order_id')::UUID;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
    IF v_role = 'designer' AND v_order.designer_id IS DISTINCT FROM v_user_id THEN RAISE EXCEPTION 'Order access denied'; END IF;
    IF v_role = 'lab' AND v_order.supplier_id IS DISTINCT FROM public.get_my_entity_id() THEN RAISE EXCEPTION 'Order access denied'; END IF;
    IF COALESCE(p_event->>'approval_status', 'none') <> 'none' THEN
        RAISE EXCEPTION 'Approval workflow events require their dedicated RPC';
    END IF;
    IF p_event->>'event_type' IN (
        'financial_adjustment_approved', 'payment_allocated',
        'manual_allocation_override', 'order_reopened'
    ) AND v_role <> 'admin' THEN
        RAISE EXCEPTION 'Sensitive order event requires admin role';
    END IF;

    INSERT INTO public.order_events(
        order_id, event_type, old_value, new_value, changed_by, actor_role,
        changed_at, reason, notes, severity, responsibility_party,
        approval_status, financial_impact, related_transaction_id,
        related_adjustment_id, related_allocation_id, related_issue_id, metadata
    ) VALUES (
        v_order.id, p_event->>'event_type', p_event->>'old_value', p_event->>'new_value',
        v_user_id, v_role, COALESCE((p_event->>'changed_at')::TIMESTAMPTZ, timezone('utc', now())),
        p_event->>'reason', p_event->>'notes', COALESCE(p_event->>'severity', 'info'),
        p_event->>'responsibility_party', 'none', (p_event->>'financial_impact')::NUMERIC,
        NULLIF(p_event->>'related_transaction_id', '')::UUID,
        NULLIF(p_event->>'related_adjustment_id', '')::UUID,
        NULLIF(p_event->>'related_allocation_id', '')::UUID,
        NULLIF(p_event->>'related_issue_id', '')::UUID,
        COALESCE(p_event->'metadata', '{}'::jsonb)
    ) RETURNING * INTO v_event;
    RETURN to_jsonb(v_event);
END;
$function$;
CREATE OR REPLACE FUNCTION public.cancel_material_purchase(p_purchase_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := auth.uid();
    v_purchase public.material_purchases%ROWTYPE;
    v_touched INT;
    v_batches INT := 0;
BEGIN
    IF v_role NOT IN ('admin', 'accountant', 'coordinator') THEN
        RAISE EXCEPTION 'صلاحية إلغاء فواتير المشتريات للأدمن والمحاسب فقط';
    END IF;

    IF NULLIF(btrim(p_reason), '') IS NULL THEN
        RAISE EXCEPTION 'سبب الإلغاء مطلوب';
    END IF;

    SELECT * INTO v_purchase FROM public.material_purchases WHERE id = p_purchase_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الفاتورة غير موجودة';
    END IF;

    IF v_purchase.status = 'cancelled' THEN
        RETURN jsonb_build_object('success', TRUE, 'message', 'الفاتورة ملغاة بالفعل');
    END IF;

    -- Any movement other than the original purchase_in means the stock has been
    -- issued, consumed, scrapped or counted. Reversing then would rewrite
    -- history that production already depends on.
    SELECT COUNT(*) INTO v_touched
      FROM public.material_movements m
      JOIN public.material_batches b ON b.id = m.batch_id
     WHERE b.purchase_id = p_purchase_id
       AND m.movement_type <> 'purchase_in';

    IF v_touched > 0 THEN
        RAISE EXCEPTION 'لا يمكن إلغاء الفاتورة: الخامات اتحركت في المخزن بالفعل (% حركة). اعمل تسوية جردية بدل الإلغاء', v_touched;
    END IF;

    -- Reverse the stock: a contra movement, never a delete. The ledger stays
    -- auditable and trg_material_movements_rebalance drives the balance to zero.
    INSERT INTO public.material_movements (batch_id, warehouse_id, movement_type, qty, notes, created_by)
    SELECT b.id, b.warehouse_id, 'return', -b.qty_received,
           'إلغاء فاتورة ' || v_purchase.invoice_ref || ': ' || btrim(p_reason), v_user_id
      FROM public.material_batches b
     WHERE b.purchase_id = p_purchase_id;

    GET DIAGNOSTICS v_batches = ROW_COUNT;

    UPDATE public.material_batches
       SET status = 'scrapped', updated_at = NOW()
     WHERE purchase_id = p_purchase_id;

    -- Reverse the money through the same table the purchase used. The original
    -- expense row is kept and a contra row is added, because a deleted
    -- transaction is a hole in the supplier account nobody can explain.
    IF v_purchase.transaction_id IS NOT NULL THEN
        INSERT INTO public.transactions (
            type, amount, category, description, date, effective_date,
            entity_type, entity_id, status, is_approved, is_registered
        )
        SELECT 'income', t.amount, t.category,
               'إلغاء فاتورة خامات: ' || v_purchase.invoice_ref || ' — ' || btrim(p_reason),
               CURRENT_DATE, CURRENT_DATE,
               t.entity_type, t.entity_id, 'approved', TRUE, FALSE
          FROM public.transactions t
         WHERE t.id = v_purchase.transaction_id;
    END IF;

    UPDATE public.material_purchases
       SET status = 'cancelled',
           notes = COALESCE(notes || E'\n', '') || '[إلغاء]: ' || btrim(p_reason),
           updated_at = NOW()
     WHERE id = p_purchase_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'purchase_id', p_purchase_id,
        'batches_reversed', v_batches,
        'transaction_reversed', (v_purchase.transaction_id IS NOT NULL)
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.cancel_shipment(p_shipment_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_shipment public.shipments%ROWTYPE;
BEGIN
    IF v_role NOT IN ('admin', 'lab', 'accountant', 'coordinator') THEN
        RAISE EXCEPTION 'غير مصرح بإلغاء الشحنة';
    END IF;

    SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الشحنة غير موجودة';
    END IF;

    IF v_shipment.status = 'delivered' THEN
        RAISE EXCEPTION 'لا يمكن إلغاء شحنة تم تسليمها بالفعل';
    END IF;

    UPDATE public.shipments
    SET status = 'cancelled',
        notes = CASE 
            WHEN NULLIF(btrim(p_notes), '') IS NOT NULL THEN 
                COALESCE(notes || E'\n', '') || '[إلغاء]: ' || btrim(p_notes)
            ELSE notes 
        END,
        updated_at = now()
    WHERE id = p_shipment_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'shipment_id', p_shipment_id,
        'status', 'cancelled'
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.capture_cutover_baseline(p_period_start date, p_period_end date, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user UUID;
    v_row  public.cutover_financial_baseline%ROWTYPE;
BEGIN
    IF v_role NOT IN ('admin', 'accountant', 'coordinator') THEN
        RAISE EXCEPTION 'التقاط خط الأساس للأدمن والمحاسب فقط' USING ERRCODE = '42501';
    END IF;

    IF p_period_end < p_period_start THEN
        RAISE EXCEPTION 'نهاية الفترة قبل بدايتها';
    END IF;

    SELECT id INTO v_user FROM public.users WHERE auth_id = auth.uid() LIMIT 1;

    WITH scoped AS (
        SELECT
            o.id,
            COALESCE(o.total_price, 0) AS price,
            COALESCE(o.manual_cost, o.cost, 0) AS cost,
            COALESCE((SELECT SUM(GREATEST(COALESCE(oi.count, 1), 1))
                        FROM public.order_items oi WHERE oi.order_id = o.id), 1) AS units,
            o.supplier_id,
            COALESCE(sf.name_ar, sf.name_en, 'غير مصنّف') AS family_name
        FROM public.orders o
        LEFT JOIN LATERAL (
            SELECT s.family_id
              FROM public.order_items oi
              JOIN public.services s ON s.name = oi.product_type
             WHERE oi.order_id = o.id AND s.family_id IS NOT NULL
             LIMIT 1
        ) si ON true
        LEFT JOIN public.service_families sf ON sf.id = si.family_id
        WHERE COALESCE(o.is_deleted, false) = false
          AND o.created_at::date BETWEEN p_period_start AND p_period_end
          -- Never worked, never billed (plan 3).
          AND o.status NOT IN ('Cancelled', 'Lab Rejected')
          AND COALESCE(o.issue_state, 'none') NOT IN ('cancelled', 'lab_rejected')
    ),
    totals AS (
        SELECT COUNT(*)::int AS orders_count,
               COALESCE(SUM(units), 0)::int AS units_count,
               COALESCE(SUM(price), 0) AS revenue,
               COALESCE(SUM(cost), 0)  AS cost
          FROM scoped
    ),
    fam AS (
        SELECT COALESCE(jsonb_agg(f), '[]'::jsonb) AS j FROM (
            SELECT family_name,
                   COUNT(*)::int AS orders,
                   SUM(units)::int AS units,
                   ROUND(SUM(cost), 2) AS cost,
                   ROUND(SUM(price), 2) AS revenue
              FROM scoped GROUP BY family_name ORDER BY SUM(price) DESC
        ) f
    ),
    sup AS (
        SELECT COALESCE(jsonb_agg(s), '[]'::jsonb) AS j FROM (
            SELECT COALESCE(su.name, 'بدون مورد') AS supplier_name,
                   COUNT(*)::int AS orders,
                   SUM(sc.units)::int AS units,
                   ROUND(SUM(sc.cost), 2) AS cost
              FROM scoped sc
              LEFT JOIN public.suppliers su ON su.id = sc.supplier_id
             GROUP BY su.name ORDER BY SUM(sc.cost) DESC
        ) s
    )
    INSERT INTO public.cutover_financial_baseline (
        period_start, period_end, orders_count, units_count,
        total_revenue, total_cost, avg_cost_per_unit, avg_price_per_unit,
        by_family, by_supplier, notes, captured_by
    )
    SELECT
        p_period_start, p_period_end, t.orders_count, t.units_count,
        t.revenue, t.cost,
        ROUND(t.cost    / GREATEST(t.units_count, 1), 2),
        ROUND(t.revenue / GREATEST(t.units_count, 1), 2),
        fam.j, sup.j, p_notes, v_user
    FROM totals t, fam, sup
    RETURNING * INTO v_row;

    RETURN to_jsonb(v_row);
END;
$function$;
CREATE OR REPLACE FUNCTION public.create_shipment(p_courier_id uuid, p_doctor_id uuid, p_tracking_ref text, p_order_ids uuid[], p_packing_proof_urls text[] DEFAULT '{}'::text[], p_recipient_name text DEFAULT NULL::text, p_recipient_phone text DEFAULT NULL::text, p_delivery_address text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := auth.uid();
    v_shipment_id UUID;
    v_shipment_code TEXT;
    v_order_id UUID;
    v_doc_name TEXT;
    v_doc_phone TEXT;
    v_doc_address TEXT;
    v_order_count INT := 0;
    v_conflict_code TEXT;
BEGIN
    IF v_role NOT IN ('admin', 'lab', 'accountant', 'coordinator', 'technician') THEN
        RAISE EXCEPTION 'غير مصرح بإنشاء شحنات';
    END IF;

    IF p_order_ids IS NULL OR array_length(p_order_ids, 1) = 0 THEN
        RAISE EXCEPTION 'يجب تحديد أوردر واحد على الأقل للشحنة';
    END IF;

    -- Check if any of the orders are already in an active non-delivered/non-cancelled shipment
    SELECT s.shipment_code INTO v_conflict_code
    FROM public.shipment_orders so
    JOIN public.shipments s ON s.id = so.shipment_id
    WHERE so.order_id = ANY(p_order_ids)
      AND s.status IN ('packing', 'ready_for_pickup', 'dispatched')
    LIMIT 1;

    IF v_conflict_code IS NOT NULL THEN
        RAISE EXCEPTION 'أحد الأوردرات مسجل بالفعل في الشحنة النشطة رقم %', v_conflict_code;
    END IF;

    -- A shipment is addressed to one doctor. Letting another doctor's case ride
    -- along would deliver it to the wrong clinic and, once delivery bills the
    -- doctor, invoice the wrong one too.
    IF p_doctor_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.orders o
         WHERE o.id = ANY(p_order_ids)
           AND o.doctor_id IS DISTINCT FROM p_doctor_id
    ) THEN
        RAISE EXCEPTION 'الشحنة فيها أوردرات لأطباء مختلفين — اعمل شحنة لكل طبيب';
    END IF;

    -- Resolve doctor info fallback if not explicitly provided
    IF p_doctor_id IS NOT NULL THEN
        SELECT name, phone, address
        INTO v_doc_name, v_doc_phone, v_doc_address
        FROM public.doctors
        WHERE id = p_doctor_id;
    END IF;

    v_shipment_code := public.generate_shipment_code();

    INSERT INTO public.shipments (
        shipment_code,
        courier_id,
        doctor_id,
        tracking_ref,
        status,
        packed_by,
        packed_at,
        packing_proof_urls,
        requested_at,
        recipient_name,
        recipient_phone,
        delivery_address,
        notes,
        created_by
    ) VALUES (
        v_shipment_code,
        p_courier_id,
        p_doctor_id,
        NULLIF(btrim(p_tracking_ref), ''),
        'ready_for_pickup',
        v_user_id,
        now(),
        COALESCE(p_packing_proof_urls, '{}'::TEXT[]),
        now(),
        COALESCE(NULLIF(btrim(p_recipient_name), ''), v_doc_name),
        COALESCE(NULLIF(btrim(p_recipient_phone), ''), v_doc_phone),
        COALESCE(NULLIF(btrim(p_delivery_address), ''), v_doc_address),
        NULLIF(btrim(p_notes), ''),
        v_user_id
    ) RETURNING id INTO v_shipment_id;

    FOREACH v_order_id IN ARRAY p_order_ids LOOP
        INSERT INTO public.shipment_orders (shipment_id, order_id)
        VALUES (v_shipment_id, v_order_id);
        v_order_count := v_order_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', TRUE,
        'shipment_id', v_shipment_id,
        'shipment_code', v_shipment_code,
        'order_count', v_order_count
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.dispatch_shipment(p_shipment_id uuid, p_tracking_ref text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_shipment public.shipments%ROWTYPE;
BEGIN
    IF v_role NOT IN ('admin', 'lab', 'accountant', 'coordinator') THEN
        RAISE EXCEPTION 'غير مصرح بتسليم الشحنة لشركة الشحن';
    END IF;

    SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الشحنة غير موجودة';
    END IF;

    IF v_shipment.status = 'dispatched' THEN
        RETURN jsonb_build_object('success', TRUE, 'message', 'الشحنة مسلمة للمندوب بالفعل');
    END IF;

    IF v_shipment.status IN ('delivered', 'cancelled') THEN
        RAISE EXCEPTION 'لا يمكن شحن شحنة مسلّمة أو ملغاة';
    END IF;

    UPDATE public.shipments
    SET status = 'dispatched',
        dispatched_at = now(),
        tracking_ref = COALESCE(NULLIF(btrim(p_tracking_ref), ''), tracking_ref),
        notes = CASE 
            WHEN NULLIF(btrim(p_notes), '') IS NOT NULL THEN 
                COALESCE(notes || E'\n', '') || '[تسليم للشحن]: ' || btrim(p_notes)
            ELSE notes 
        END,
        updated_at = now()
    WHERE id = p_shipment_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'shipment_id', p_shipment_id,
        'status', 'dispatched'
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.estimate_order_delivery_time(p_service_id uuid, p_units integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT;
    v_route_id UUID;
    v_units INTEGER := GREATEST(COALESCE(p_units, 1), 1);
    v_cursor TIMESTAMPTZ := now();
    v_sample_size INTEGER;
    v_stages_without_history INTEGER := 0;
    v_confidence TEXT;
    v_stage_records JSONB := '[]'::jsonb;
    v_stage_minutes NUMERIC;
    r RECORD;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'lab', 'technician', 'accountant', 'coordinator', 'representative', 'designer', 'doctor') THEN
        RAISE EXCEPTION 'Forbidden: insufficient privileges' USING ERRCODE = '42501';
    END IF;

    SELECT route_id INTO v_route_id FROM public.services WHERE id = p_service_id;
    IF v_route_id IS NULL THEN
        SELECT id INTO v_route_id FROM public.production_routes
         WHERE is_active = true ORDER BY is_fallback DESC, created_at ASC LIMIT 1;
    END IF;

    -- Full-lab, final delivery: no service on record distinguishes split vs
    -- full or try-in vs final, so this is the plain majority case (431 of
    -- 718 classified historical orders) rather than a guess. get_effective_
    -- route_stages -- not a raw production_route_stages scan -- so a
    -- condition that does not match (design on a full-lab context,
    -- doctor_review on a final delivery) is excluded exactly as production
    -- would build it, instead of always being charged to every quote.
    FOR r IN
        WITH chain AS (
            SELECT * FROM public.get_effective_route_stages(
                v_route_id,
                jsonb_build_object('workflow_type', 'full', 'delivery_type', 'Final'))
        ),
        ext_full_samples AS (
            SELECT wall_clock_minutes, units_in
              FROM public.get_reliable_external_lead_time_samples(now() - INTERVAL '180 days')
             WHERE bucket = 'full_lab'
        )
        SELECT
            c.seq, c.stage_id, c.name_ar AS stage_name, c.stage_code, c.execution,
            CASE
                WHEN c.execution = 'external' AND c.stage_code = 'external_full' THEN
                    (SELECT COUNT(*)::int FROM ext_full_samples)
                ELSE
                    (SELECT COUNT(*)::int FROM public.production_stage_runs psr
                      WHERE psr.stage_id = c.stage_id AND psr.status = 'done'
                        AND psr.completed_at > now() - INTERVAL '90 days'
                        AND EXISTS (SELECT 1 FROM public.production_jobs pj
                                     WHERE pj.id = psr.job_id AND pj.route_id = v_route_id))
            END AS samples,
            -- p80 minutes per unit. Internal stages: working minutes, on our
            -- calendar (unchanged, and correct). External stages: WALL CLOCK
            -- (plan rule 3, "المراحل الخارجية مالهاش تقويم") -- a vendor's
            -- weekend is real turnaround time, not time to strip out.
            -- external_full alone also needs the bucket split, because it is
            -- the one stage with a historical split_handoff/full_lab past;
            -- every other external stage (shipping, doctor_review) has no
            -- such history to confuse.
            CASE
                WHEN c.execution = 'external' AND c.stage_code = 'external_full' THEN
                    COALESCE(
                        (SELECT percentile_cont(0.80) WITHIN GROUP (
                             ORDER BY wall_clock_minutes / GREATEST(units_in, 1))
                           FROM ext_full_samples),
                        c.standard_minutes_per_unit, 30)
                WHEN c.execution = 'external' THEN
                    COALESCE(
                        (SELECT percentile_cont(0.80) WITHIN GROUP (
                             ORDER BY EXTRACT(EPOCH FROM (psr.completed_at - psr.queued_at)) / 60.0
                                      / GREATEST(psr.units_in, 1))
                           FROM public.production_stage_runs psr
                          WHERE psr.stage_id = c.stage_id AND psr.status = 'done'
                            AND psr.completed_at > now() - INTERVAL '90 days'
                            AND EXISTS (SELECT 1 FROM public.production_jobs pj
                                         WHERE pj.id = psr.job_id AND pj.route_id = v_route_id)),
                        c.standard_minutes_per_unit, 30)
                ELSE
                    COALESCE(
                        (SELECT percentile_cont(0.80) WITHIN GROUP (
                             ORDER BY GREATEST(1, public.working_minutes_between(psr.queued_at, psr.completed_at))
                                      / GREATEST(psr.units_in, 1))
                           FROM public.production_stage_runs psr
                          WHERE psr.stage_id = c.stage_id AND psr.status = 'done'
                            AND psr.completed_at > now() - INTERVAL '90 days'
                            AND EXISTS (SELECT 1 FROM public.production_jobs pj
                                         WHERE pj.id = psr.job_id AND pj.route_id = v_route_id)),
                        c.standard_minutes_per_unit, 30)
            END AS p80_minutes_per_unit
        FROM chain c
        ORDER BY c.seq
    LOOP
        v_stage_minutes := r.p80_minutes_per_unit * v_units;

        v_sample_size := CASE WHEN v_sample_size IS NULL THEN r.samples
                               ELSE LEAST(v_sample_size, r.samples) END;
        IF r.samples = 0 THEN
            v_stages_without_history := v_stages_without_history + 1;
        END IF;

        v_stage_records := v_stage_records || jsonb_build_array(jsonb_build_object(
            'stage_name', r.stage_name, 'stage_code', r.stage_code, 'execution', r.execution,
            'p80_minutes_per_unit', ROUND(r.p80_minutes_per_unit::numeric, 0),
            'p80_minutes', ROUND(v_stage_minutes::numeric, 0),
            'samples_count', r.samples, 'is_estimated', (r.samples = 0)
        ));

        -- Two different clocks, walked in order rather than blended: internal
        -- work only advances while the lab is open; a vendor's clock runs
        -- through the night and the weekend regardless. Summing both into one
        -- number and running the total through the work calendar would
        -- stretch a 7-day wall-clock vendor wait into many more calendar days.
        IF r.execution = 'internal' THEN
            v_cursor := public.add_working_minutes(v_cursor, v_stage_minutes);
        ELSE
            -- make_interval's mins parameter is integer; seconds is the only
            -- fractional slot, same convention as add_working_minutes above.
            v_cursor := v_cursor + make_interval(secs => (v_stage_minutes * 60)::double precision);
        END IF;

        EXIT WHEN v_cursor IS NULL;  -- no work calendar configured; unmeasurable past this point
    END LOOP;

    v_sample_size := COALESCE(v_sample_size, 0);

    IF v_stages_without_history > 0 OR v_sample_size < 15 THEN
        v_confidence := 'default_estimate';
    ELSIF v_sample_size >= 50 THEN
        v_confidence := 'high';
    ELSE
        v_confidence := 'moderate';
    END IF;

    RETURN jsonb_build_object(
        'service_id', p_service_id,
        'units', v_units,
        -- Elapsed minutes to the promise, not "working minutes": a full-lab
        -- chain here is entirely external, so calling this figure "work" was
        -- never honest for the common case.
        'total_working_minutes', CASE WHEN v_cursor IS NULL THEN NULL
                                       ELSE ROUND(EXTRACT(EPOCH FROM (v_cursor - now())) / 60.0, 0) END,
        'total_working_hours', CASE WHEN v_cursor IS NULL THEN NULL
                                     ELSE ROUND(EXTRACT(EPOCH FROM (v_cursor - now())) / 3600.0, 1) END,
        'estimated_delivery_date', v_cursor::date,
        'estimated_delivery_at', v_cursor,
        'estimated_calendar_days', CASE WHEN v_cursor IS NULL THEN NULL
                                         ELSE GREATEST(1, (v_cursor::date - CURRENT_DATE)) END,
        'confidence_level', v_confidence,
        'sample_size', v_sample_size,
        'stages_without_history', v_stages_without_history,
        'stages_breakdown', v_stage_records
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.freeze_overhead_allocation(p_period_month date, p_total_overhead numeric, p_total_units integer, p_notes text DEFAULT NULL::text, p_refreeze boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT;
    v_norm_period DATE;
    v_user_id UUID;
    v_run RECORD;
    v_existing public.overhead_allocation_runs%ROWTYPE;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'accountant', 'coordinator') THEN
        RAISE EXCEPTION 'Forbidden: only admin or accountant can record overhead allocation'
            USING ERRCODE = '42501';
    END IF;

    IF p_total_overhead < 0 THEN
        RAISE EXCEPTION 'Total overhead cannot be negative' USING ERRCODE = '22003';
    END IF;

    IF p_total_units <= 0 THEN
        RAISE EXCEPTION 'Total units must be greater than zero' USING ERRCODE = '22003';
    END IF;

    v_norm_period := date_trunc('month', p_period_month)::date;

    SELECT * INTO v_existing
      FROM public.overhead_allocation_runs
     WHERE period_month = v_norm_period;

    IF FOUND AND NOT COALESCE(p_refreeze, FALSE) THEN
        RAISE EXCEPTION
            'الشهر % متقفل بالفعل بمعدل %/وحدة منذ %. إعادة التجميد بتغيّر كل تقارير التكلفة التاريخية — ابعت p_refreeze => true لو ده مقصود',
            to_char(v_norm_period, 'YYYY-MM'), v_existing.rate_per_unit, v_existing.frozen_at
            USING ERRCODE = '55006';
    END IF;

    SELECT id INTO v_user_id FROM public.users WHERE auth_id = auth.uid() LIMIT 1;

    INSERT INTO public.overhead_allocation_runs (
        period_month,
        total_overhead,
        total_units,
        notes,
        created_by,
        frozen_at
    )
    VALUES (
        v_norm_period,
        p_total_overhead,
        p_total_units,
        p_notes,
        v_user_id,
        now()
    )
    ON CONFLICT (period_month) DO UPDATE
    SET total_overhead = EXCLUDED.total_overhead,
        total_units    = EXCLUDED.total_units,
        notes          = EXCLUDED.notes,
        frozen_at      = now()
    RETURNING * INTO v_run;

    RETURN jsonb_build_object(
        'id', v_run.id,
        'period_month', v_run.period_month,
        'total_overhead', v_run.total_overhead,
        'total_units', v_run.total_units,
        'rate_per_unit', v_run.rate_per_unit,
        'frozen_at', v_run.frozen_at,
        'was_refreeze', (v_existing.id IS NOT NULL)
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_cost_of_quality_report(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT;
    v_start DATE;
    v_end DATE;
    v_internal_reworks JSONB;
    v_external_issues JSONB;
    v_internal_summary JSONB;
    v_external_summary JSONB;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'accountant', 'coordinator', 'lab') THEN
        RAISE EXCEPTION 'Forbidden: admin, accountant, or lab role required' USING ERRCODE = '42501';
    END IF;

    v_start := COALESCE(p_start_date, (CURRENT_DATE - INTERVAL '30 days')::date);
    v_end   := COALESCE(p_end_date, CURRENT_DATE);

    -- Internal Quality: Rework stage runs caught before delivery
    WITH internal_runs AS (
        SELECT 
            psr.id,
            st.name_ar AS stage_name,
            st.id AS stage_id,
            COALESCE(psr.failure_cause_code, 'internal_qc_fail') AS cause_code,
            COALESCE(u.name, 'غير محدد') AS technician_name,
            COALESCE(psr.units_failed, 1) AS units_failed,
            psr.completed_at,
            COALESCE(lr.rate_per_unit, 0) AS estimated_labor_cost
        FROM public.production_stage_runs psr
        JOIN public.production_stages st ON st.id = psr.stage_id
        LEFT JOIN public.users u ON u.id = psr.assignee_id
        -- Same rate resolution as get_order_cost_breakdown: the rate that was in
        -- force for THAT technician on THAT day. Taking the newest rate of any
        -- employee valued last year's scrap at this year's price.
        LEFT JOIN LATERAL (
            SELECT rate_per_unit
            FROM public.labor_rates
            WHERE stage_id = psr.stage_id
              AND (employee_id = psr.assignee_id OR employee_id IS NULL)
              AND effective_from <= COALESCE(psr.completed_at::date, CURRENT_DATE)
            ORDER BY (employee_id IS NOT NULL) DESC, effective_from DESC
            LIMIT 1
        ) lr ON true
        WHERE psr.rework_of IS NOT NULL
          AND psr.completed_at::date >= v_start
          AND psr.completed_at::date <= v_end
    ),
    internal_grouped AS (
        SELECT 
            stage_name,
            cause_code,
            technician_name,
            COUNT(*) AS incidents_count,
            SUM(units_failed) AS total_units_failed,
            SUM(estimated_labor_cost * units_failed) AS total_labor_loss
        FROM internal_runs
        GROUP BY stage_name, cause_code, technician_name
    )
    SELECT 
        COALESCE(jsonb_agg(row_to_json(internal_grouped)), '[]'::jsonb),
        jsonb_build_object(
            'total_incidents', COALESCE(SUM(incidents_count), 0),
            'total_units_failed', COALESCE(SUM(total_units_failed), 0),
            'total_estimated_labor_loss', COALESCE(SUM(total_labor_loss), 0)
        )
    INTO v_internal_reworks, v_internal_summary
    FROM internal_grouped;

    -- External Quality: Orders with issues returned from doctors / clinics
    WITH external_issues AS (
        SELECT
            oi.id,
            oi.order_id,
            COALESCE(oi.issue_type, 'issue') AS issue_type,
            COALESCE(oi.cause_category, 'unknown') AS cause_code,
            COALESCE(d.name, 'طبيب غير محدد') AS doctor_name,
            COALESCE(o.case_id, '—') AS case_id,
            -- Zero revenue on a case that was cancelled or lab-rejected: it was
            -- never worked and never billed, so it cannot be "affected revenue".
            CASE WHEN COALESCE(o.status, '') IN ('Cancelled', 'Lab Rejected')
                 THEN 0 ELSE COALESCE(o.total_price, 0) END AS order_value,
            CASE WHEN COALESCE(o.status, '') IN ('Cancelled', 'Lab Rejected')
                 THEN 0 ELSE COALESCE(o.rejected_lab_cost, 0) END AS lab_rejection_cost,
            -- One order carries its price once. The flag lands on the order's
            -- earliest issue in the window, so the totals are exact and the
            -- revenue is attributed to the cause that started the trouble.
            (ROW_NUMBER() OVER (PARTITION BY oi.order_id ORDER BY oi.created_at, oi.id) = 1)
                AS is_first_issue_of_order
        FROM public.order_issues oi
        JOIN public.orders o ON o.id = oi.order_id
        LEFT JOIN public.doctors d ON d.id = o.doctor_id
        WHERE oi.created_at::date >= v_start
          AND oi.created_at::date <= v_end
          AND COALESCE(oi.is_voided, false) = false
    ),
    -- An order with three issues is ONE affected order carrying ONE price.
    -- Summing order_value per issue counted the same revenue three times and
    -- inflated "cost of quality" by the rate of repeat problems -- the very
    -- thing the report exists to measure.
    external_grouped AS (
        SELECT
            issue_type,
            cause_code,
            COUNT(*) AS incidents_count,
            COUNT(DISTINCT order_id) AS affected_orders,
            SUM(order_value) FILTER (WHERE is_first_issue_of_order) AS affected_revenue,
            SUM(lab_rejection_cost) FILTER (WHERE is_first_issue_of_order) AS financial_loss
        FROM external_issues
        GROUP BY issue_type, cause_code
    )
    SELECT
        COALESCE(jsonb_agg(row_to_json(external_grouped)), '[]'::jsonb),
        jsonb_build_object(
            'total_issues_count', COALESCE(SUM(incidents_count), 0),
            'total_affected_orders', COALESCE(SUM(affected_orders), 0),
            'total_affected_revenue', COALESCE(SUM(affected_revenue), 0),
            'total_financial_loss', COALESCE(SUM(financial_loss), 0)
        )
    INTO v_external_issues, v_external_summary
    FROM external_grouped;

    RETURN jsonb_build_object(
        'period', jsonb_build_object('start_date', v_start, 'end_date', v_end),
        'internal_quality', jsonb_build_object(
            'summary', COALESCE(v_internal_summary, '{}'::jsonb),
            'breakdown', v_internal_reworks
        ),
        'external_quality', jsonb_build_object(
            'summary', COALESCE(v_external_summary, '{}'::jsonb),
            'breakdown', v_external_issues
        )
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_dashboard_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
    IF NOT COALESCE(
        public.get_my_role() = ANY (ARRAY['admin', 'accountant', 'coordinator', 'representative', 'lab', 'designer']),
        FALSE
    ) THEN
        RAISE EXCEPTION 'forbidden: staff role required' USING ERRCODE = '42501';
    END IF;
    RETURN public.get_dashboard_data_privileged_20260801();
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_dashboard_data_privileged_20260801()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id UUID;
    v_role TEXT;
    v_today DATE := CURRENT_DATE;
    v_entity_id UUID;
    
    -- Filtered Orders CTE
    v_active_orders JSONB;
    v_delayed_orders JSONB;
    v_unassigned_orders JSONB;
    v_new_orders JSONB;
    v_try_in_approved_orders JSONB;
    
    -- Stats
    v_stats JSONB;
    
    -- Supplier Data
    v_suppliers JSONB;
    
    -- Result
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();
    v_role := get_my_role(); 
    v_entity_id := get_my_entity_id(); -- Null if not lab/rep

    -- 1. DEFINE VISIBLE ORDERS (CTE Concept applied via temp table or direct query)
    -- We'll use a dynamic query based on role to get the relevant orders first.
    -- However, for performance in PLPGSQL, direct queries with role checks are okay.
    
    -- 2. GATHER DATA BASED ON ROLE
    
    IF v_role = 'lab' THEN
        -- LAB VIEW
        -- -------------------------------------------------------------
        
        -- My Active Orders (Not Delivered/Completed)
        SELECT jsonb_agg(sub) INTO v_active_orders FROM (
            SELECT 
                id, case_id, patient_name, delivery_date, status, technician_status, 
                items, is_urgent, priority, doctor_id -- needed for UI?
            FROM orders
            WHERE supplier_id = v_entity_id
              AND (status NOT IN ('Delivered', 'Ready', 'Returned for Adjustments'))
              AND (technician_status IS DISTINCT FROM 'Rejected')
            ORDER BY delivery_date ASC
        ) sub;

        -- My Delayed Orders
        SELECT jsonb_agg(sub) INTO v_delayed_orders FROM (
            SELECT id, case_id, patient_name, delivery_date, status
            FROM orders
            WHERE supplier_id = v_entity_id
              AND delivery_date < v_today
              AND (status NOT IN ('Delivered', 'Ready', 'Returned for Adjustments'))
              AND (technician_status IS DISTINCT FROM 'Rejected')
        ) sub;

        -- My Rejected Orders (Count mostly needed, let's get list for consistency if small)
        -- Dashboard.tsx calculates 'myRejected' count from list.
        -- Let's just return stats for counts to save bandwidth, and lists for tables.
        
        -- Stats
        SELECT jsonb_build_object(
            'active_count', (SELECT COUNT(*) FROM orders WHERE supplier_id = v_entity_id AND status NOT IN ('Delivered', 'Ready', 'Returned for Adjustments') AND technician_status IS DISTINCT FROM 'Rejected'),
            'delayed_count', (SELECT COUNT(*) FROM orders WHERE supplier_id = v_entity_id AND delivery_date < v_today AND status NOT IN ('Delivered', 'Ready', 'Returned for Adjustments')),
            'rejected_count', (SELECT COUNT(*) FROM orders WHERE supplier_id = v_entity_id AND (status = 'Returned for Adjustments' OR technician_status = 'Rejected')),
            'ready_today_count', (SELECT COUNT(*) FROM orders WHERE supplier_id = v_entity_id AND status = 'Ready' AND delivery_date = v_today)
        ) INTO v_stats;
        
        -- Try In Approved List
        SELECT jsonb_agg(sub) INTO v_try_in_approved_orders FROM (
             SELECT id, case_id, patient_name, delivery_date, status
             FROM orders
             WHERE supplier_id = v_entity_id AND status = 'Try In Approved'
        ) sub;

        v_result := jsonb_build_object(
            'role', 'lab',
            'stats', v_stats,
            'active_orders', COALESCE(v_active_orders, '[]'::jsonb),
            'delayed_orders', COALESCE(v_delayed_orders, '[]'::jsonb),
            'try_in_approved_orders', COALESCE(v_try_in_approved_orders, '[]'::jsonb)
        );

    ELSIF v_role = 'designer' THEN
        -- DESIGNER VIEW
        -- -------------------------------------------------------------
        SELECT jsonb_agg(sub) INTO v_active_orders FROM (
            SELECT id, case_id, patient_name, delivery_date, status, items
            FROM orders
            WHERE designer_id = v_user_id
              AND status IN ('New Case', 'Under Design', 'Waiting Dr Approval', 'Returned for Adjustments')
        ) sub;

        -- Stats
         SELECT jsonb_build_object(
            'pending_count', (SELECT COUNT(*) FROM orders WHERE designer_id = v_user_id AND status = 'New Case'),
            'in_progress_count', (SELECT COUNT(*) FROM orders WHERE designer_id = v_user_id AND status = 'Under Design'),
            'waiting_approval_count', (SELECT COUNT(*) FROM orders WHERE designer_id = v_user_id AND status = 'Waiting Dr Approval'),
            'returned_count', (SELECT COUNT(*) FROM orders WHERE designer_id = v_user_id AND status = 'Returned for Adjustments')
        ) INTO v_stats;

        v_result := jsonb_build_object(
            'role', 'designer',
            'orders', COALESCE(v_active_orders, '[]'::jsonb), -- Dashboard filters this list in JS
            'stats', v_stats
        );

    ELSE
        -- ADMIN / ACCOUNTANT / REPRESENTATIVE VIEW
        -- -------------------------------------------------------------
        
        -- 1. Active Orders (Global or Rep specific)
        -- Dashboard Active = Status not in (Delivered, Rejected, Cancelled, Returned)
        -- AND TechnicianStatus != Rejected
        
        -- Rep filtering:
        -- Dashboard.tsx logic for Rep is not explicit in filtering fetches (it fetches all).
        -- But RLS restricts Rep to see specific orders.
        -- Since we use SECURITY DEFINER, we MUST manually apply Rep logic if user is Rep.
        -- However, user said Rep sees "All Doctors" now.
        -- So Rep = Admin visibility for Dashboard purposes.
        
        -- Active Orders (Only returning necessary columns for the table)
        SELECT jsonb_agg(sub) INTO v_active_orders FROM (
            SELECT 
                id, case_id, patient_name, delivery_date, status, 
                doctor_id, items, is_urgent, priority, supplier_id,
                technician_status
            FROM orders
            WHERE status NOT IN ('Delivered', 'Rejected', 'Cancelled', 'Returned for Adjustments')
              AND (technician_status IS DISTINCT FROM 'Rejected' OR technician_status IS NULL)
              AND (
                  -- Standard Visibility Logic
                  v_role IN ('admin', 'accountant', 'coordinator', 'representative') -- Rep sees all per latest instruction
                  -- If Rep was restricted: AND (v_role != 'representative' OR doctor_id IN ...)
              )
            ORDER BY delivery_date ASC
            LIMIT 50 -- Optimization: Only show top 50 soonest/active on dashboard?
                     -- Dashboard.tsx currently shows ALL active in "All Cases" table.
                     -- Let's return all active for now, but minimal columns.
        ) sub;

        -- Unassigned
        SELECT jsonb_agg(sub) INTO v_unassigned_orders FROM (
            SELECT id, case_id, patient_name, items, delivery_date, status
            FROM orders
            WHERE supplier_id IS NULL
              AND status NOT IN ('Delivered', 'Rejected', 'Cancelled', 'Returned for Adjustments')
              AND (technician_status IS DISTINCT FROM 'Rejected' OR technician_status IS NULL)
        ) sub;

        -- Delayed
        SELECT jsonb_agg(sub) INTO v_delayed_orders FROM (
            SELECT id, case_id, patient_name, items, delivery_date, status, is_urgent, priority
            FROM orders
            WHERE delivery_date < v_today
              AND status NOT IN ('Delivered', 'Rejected', 'Cancelled', 'Returned for Adjustments')
              AND (technician_status IS DISTINCT FROM 'Rejected' OR technician_status IS NULL)
        ) sub;
        
        -- New Orders (Waiting Acceptance)
        SELECT jsonb_agg(sub) INTO v_new_orders FROM (
            SELECT id, status
            FROM orders
            WHERE status = 'New Case'
        ) sub;

        -- Suppliers & Their Orders
        -- Dashboard maps suppliers to their orders.
        -- We can aggregate this efficiently.
        SELECT jsonb_agg(sup_obj) INTO v_suppliers FROM (
             SELECT 
                s.id, s.name,
                (
                    SELECT jsonb_agg(ord) FROM (
                        SELECT id, case_id, patient_name, items, delivery_date, status
                        FROM orders o
                        WHERE o.supplier_id = s.id
                          AND o.status NOT IN ('Delivered', 'Rejected', 'Cancelled', 'Returned for Adjustments')
                          AND (o.technician_status IS DISTINCT FROM 'Rejected' OR o.technician_status IS NULL)
                    ) ord
                ) as active_orders
             FROM suppliers s
        ) sup_obj;

        -- Stats
        SELECT jsonb_build_object(
            'active_count', (SELECT COUNT(*) FROM orders WHERE status NOT IN ('Delivered', 'Rejected', 'Cancelled', 'Returned for Adjustments') AND (technician_status IS DISTINCT FROM 'Rejected' OR technician_status IS NULL)),
            'delayed_count', jsonb_array_length(COALESCE(v_delayed_orders, '[]'::jsonb)),
            'unassigned_count', jsonb_array_length(COALESCE(v_unassigned_orders, '[]'::jsonb))
        ) INTO v_stats;

        v_result := jsonb_build_object(
            'role', 'admin', -- or rep/accountant, generic "manager" view
            'stats', v_stats,
            'active_orders', COALESCE(v_active_orders, '[]'::jsonb),
            'delayed_orders', COALESCE(v_delayed_orders, '[]'::jsonb),
            'unassigned_orders', COALESCE(v_unassigned_orders, '[]'::jsonb),
            'new_orders', COALESCE(v_new_orders, '[]'::jsonb),
            'suppliers', COALESCE(v_suppliers, '[]'::jsonb)
        );
        
    END IF;

    RETURN v_result;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_finance_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
    IF NOT COALESCE(public.get_my_role() = ANY (ARRAY['admin', 'accountant', 'coordinator']), FALSE) THEN
        RAISE EXCEPTION 'forbidden: finance role required' USING ERRCODE = '42501';
    END IF;
    RETURN public.get_finance_dashboard_privileged_20260801();
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_internal_vs_external_benchmark(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT;
    v_start DATE;
    v_end DATE;
    v_benchmark JSONB;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'accountant', 'coordinator', 'lab') THEN
        RAISE EXCEPTION 'Forbidden: admin, accountant, or lab role required' USING ERRCODE = '42501';
    END IF;

    v_start := COALESCE(p_start_date, (CURRENT_DATE - INTERVAL '90 days')::date);
    v_end   := COALESCE(p_end_date, CURRENT_DATE);

    -- The whole point of this report is to compare TWO DIFFERENT cost numbers
    -- for the same service. Reading COALESCE(manual_cost, cost) on both sides
    -- put the vendor's invoice in the "internal" column too, so the report
    -- compared a number with itself. The internal side is now built from the
    -- real components -- materials + labour + overhead -- and the external side
    -- keeps the vendor's recorded cost.
    WITH order_metrics AS (
        SELECT
            o.id AS order_id,
            COALESCE(sf.name_ar, sf.name_en, 'غير مصنّف') AS family_name,
            -- Internal means somebody here worked a step. Since 20260827000000
            -- every order carries a stage chain, so the mere existence of runs
            -- (or of a design step, which is internal on every route) would
            -- label the entire order base "internal".
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM public.production_jobs pj
                    JOIN public.production_stage_runs psr ON psr.job_id = pj.id
                    WHERE pj.order_id = o.id
                      -- Backfilled history is reconstructed, not worked here.
                      AND NOT pj.is_backfilled
                      AND psr.execution = 'internal'
                      AND psr.driven_by <> 'order_status'
                      AND psr.status = 'done'
                ) THEN 'internal'
                ELSE 'external'
            END AS production_type,
            COALESCE(o.total_price, 0) AS price,
            COALESCE(o.manual_cost, o.cost, 0) AS vendor_cost,
            COALESCE(units.total_units, 1) AS total_units,
            -- Working minutes for the internal side, calendar days for the
            -- vendor: the lab controls its own calendar and not the vendor's
            -- (plan 6.2). Both are reported, neither is mixed into the other.
            public.working_minutes_between(o.created_at,
                COALESCE(o.actual_delivery_date::timestamptz,
                         o.delivery_date::timestamptz)) AS lead_working_minutes,
            GREATEST(
                1,
                (COALESCE(o.actual_delivery_date, o.delivery_date, o.created_at::date) - o.created_at::date)
            ) AS lead_time_days,
            CASE WHEN o.issue_state IS NOT NULL AND o.issue_state != 'none' THEN 1 ELSE 0 END AS has_issue
        FROM public.orders o
        -- Family comes through the normalised order_items -> services join, the
        -- same path every other family report uses. Matching services by name
        -- against the legacy orders.items JSONB left most orders unclassified.
        LEFT JOIN LATERAL (
            SELECT s.family_id
              FROM public.order_items oi
              JOIN public.services s ON s.name = oi.product_type
             WHERE oi.order_id = o.id
               AND s.family_id IS NOT NULL
             LIMIT 1
        ) service_item ON true
        LEFT JOIN public.service_families sf ON sf.id = service_item.family_id
        LEFT JOIN LATERAL (
            SELECT SUM(GREATEST(COALESCE(oi.count, 1), 1))::int AS total_units
              FROM public.order_items oi
             WHERE oi.order_id = o.id
        ) units ON true
        WHERE COALESCE(o.is_deleted, false) = false
          AND o.created_at::date >= v_start
          AND o.created_at::date <= v_end
          -- Never worked, never billed: zero cost and zero revenue (plan 3).
          AND o.status NOT IN ('Cancelled', 'Lab Rejected')
          AND COALESCE(o.issue_state, 'none') NOT IN ('cancelled', 'lab_rejected')
    ),
    costed AS (
        SELECT
            m.*,
            CASE
                WHEN m.production_type = 'internal'
                    THEN COALESCE((public.get_order_cost_breakdown(m.order_id) ->> 'total_cost')::numeric, 0)
                ELSE m.vendor_cost
            END AS true_cost
        FROM order_metrics m
    ),
    aggregated AS (
        SELECT
            family_name,
            production_type,
            COUNT(DISTINCT order_id) AS total_orders,
            SUM(total_units) AS total_units,
            ROUND(AVG(true_cost), 2) AS avg_cost,
            ROUND(SUM(true_cost) / GREATEST(SUM(total_units), 1), 2) AS avg_cost_per_unit,
            ROUND(AVG(price), 2) AS avg_price,
            ROUND(AVG(lead_time_days), 1) AS avg_lead_days,
            ROUND(AVG(lead_working_minutes) / 60.0, 1) AS avg_lead_working_hours,
            ROUND((SUM(has_issue)::numeric / GREATEST(COUNT(*), 1)) * 100, 1) AS issue_rate_pct
        FROM costed
        GROUP BY family_name, production_type
    )
    SELECT COALESCE(jsonb_agg(row_to_json(aggregated)), '[]'::jsonb)
    INTO v_benchmark
    FROM aggregated;

    RETURN jsonb_build_object(
        'period', jsonb_build_object('start_date', v_start, 'end_date', v_end),
        'comparison', v_benchmark
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_order_cost_breakdown(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT;
    v_order RECORD;
    v_materials_cost NUMERIC(10,2) := 0;
    v_labor_cost NUMERIC(10,2) := 0;
    v_external_cost NUMERIC(10,2) := 0;
    v_overhead_cost NUMERIC(10,2) := 0;
    v_overhead_rate NUMERIC(10,2) := 0;
    v_overhead_status TEXT := 'not_allocated';
    v_total_units INTEGER := 1;
    v_order_month DATE;
    v_has_internal_runs BOOLEAN := false;
    v_material_details JSONB := '[]'::jsonb;
    v_labor_details JSONB := '[]'::jsonb;
    v_external_details JSONB := '[]'::jsonb;
    v_total_cost NUMERIC(10,2) := 0;
    v_is_billable BOOLEAN := TRUE;
    v_total_price NUMERIC(12,2) := 0;
    v_estimated_materials BOOLEAN := FALSE;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'accountant', 'coordinator', 'lab') THEN
        RAISE EXCEPTION 'Forbidden: insufficient privileges' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    IF v_order.id IS NULL THEN
        RETURN jsonb_build_object(
            'order_id', p_order_id,
            'case_id', null,
            'total_cost', 0,
            'cost_per_unit', 0,
            'materials_cost', 0,
            'labor_cost', 0,
            'external_cost', 0,
            'overhead_cost', 0
        );
    END IF;

    -- Units come from order_items, the normalised table every other part of the
    -- system uses (0460_normalize_schema). orders.items is the pre-normalisation
    -- JSONB column and is populated on well under half the live order base --
    -- reading it returned 1 unit for most orders and quietly corrupted
    -- cost_per_unit, overhead_cost and margin_percent.
    SELECT COALESCE(SUM(GREATEST(COALESCE(oi.count, 1), 1)), 0)
      INTO v_total_units
      FROM public.order_items oi
     WHERE oi.order_id = p_order_id;

    IF v_total_units IS NULL OR v_total_units <= 0 THEN
        v_total_units := 1;
    END IF;

    v_order_month := date_trunc('month', COALESCE(v_order.delivery_date, v_order.created_at::date))::date;

    -- A cancelled or lab-rejected case was never worked: zero cost AND zero
    -- revenue, everywhere. orders.cost keeps a stale estimate on these rows, so
    -- reading it raw would invent a loss on a case that cost nothing.
    v_is_billable := COALESCE(v_order.issue_state, 'none') NOT IN ('cancelled', 'lab_rejected')
                     AND COALESCE(v_order.status, '') NOT IN ('Cancelled', 'Lab Rejected');

    IF NOT v_is_billable THEN
        RETURN jsonb_build_object(
            'order_id', p_order_id,
            'case_id', v_order.case_id,
            'is_internal_production', FALSE,
            'is_billable', FALSE,
            'zero_reason', 'cancelled_or_lab_rejected',
            'total_units', v_total_units,
            'total_price', 0,
            'materials_cost', 0,
            'labor_cost', 0,
            'external_cost', 0,
            'overhead_cost', 0,
            'overhead_rate_applied', 0,
            'overhead_status', 'not_applicable',
            'total_cost', 0,
            'cost_per_unit', 0,
            'gross_profit', 0,
            'margin_percent', 0,
            'details', jsonb_build_object(
                'materials', '[]'::jsonb, 'labor', '[]'::jsonb, 'external', '[]'::jsonb)
        );
    END IF;

    v_total_price := COALESCE(v_order.total_price, 0);

    -- "Internal" means somebody in this building actually worked a step -- not
    -- merely that a job row exists. Since 20260827000000 every order gets a
    -- stage chain automatically, so testing for the existence of stage runs
    -- classified ordinary outsourced cases as internal, dropped orders.cost,
    -- and reported them at zero cost and 100% margin.
    --
    -- is_backfilled is the other half of that test, and it is not optional.
    -- 20260821003000 reconstructed a chain for 1152 historical orders, 277 of
    -- which carry a completed internal design stage. Those cases were milled
    -- outside; their real cost is the vendor invoice. driven_by alone does not
    -- exclude them -- the column is new and every pre-existing row inherits its
    -- 'my_tasks' default -- so without this they would read as in-house work
    -- done at no cost.
    SELECT EXISTS (
        SELECT 1
          FROM public.production_jobs pj
          JOIN public.production_stage_runs psr ON psr.job_id = pj.id
         WHERE pj.order_id = p_order_id
           AND NOT pj.is_backfilled
           AND psr.execution = 'internal'
           AND psr.driven_by <> 'order_status'
           AND psr.status = 'done'
    ) INTO v_has_internal_runs;

    IF v_has_internal_runs THEN
        -- 1. Direct Materials: Measured usage from material_batch_usage + material_batches
        -- Two clearly separated numbers, exactly as plan 4.7 requires:
        --   actual    = unit_cost / units actually attributed, once the disc is
        --               depleted and the truth is known.
        --   estimated = unit_cost / expected_units_per_batch, while it is open.
        -- When a material has no expected yield recorded, there is no third
        -- option: the cost is NULL and the caller must show "not costed yet".
        -- The previous fallback divided by a hard-coded 15 -- an invented
        -- denominator producing an invented cost, which plan 4.7 forbids.
        SELECT
            COALESCE(SUM(
                CASE
                    WHEN mb.status = 'depleted' THEN
                        ROUND((mb.unit_cost / GREATEST(
                            (SELECT SUM(units_attributed) FROM public.material_batch_usage WHERE batch_id = mb.id),
                            1
                        )) * mbu.units_attributed, 2)
                    WHEN COALESCE(m.expected_units_per_batch, 0) > 0 THEN
                        ROUND((mb.unit_cost / m.expected_units_per_batch) * mbu.units_attributed, 2)
                    ELSE 0
                END
            ), 0),
            COALESCE(jsonb_agg(
                jsonb_build_object(
                    'material_name', m.name_ar,
                    'batch_code', mb.batch_code,
                    'units_attributed', mbu.units_attributed,
                    'is_estimated', (mb.status <> 'depleted'),
                    'is_uncosted', (mb.status <> 'depleted'
                                    AND COALESCE(m.expected_units_per_batch, 0) <= 0),
                    'cost', CASE
                        WHEN mb.status = 'depleted' THEN
                            ROUND((mb.unit_cost / GREATEST(
                                (SELECT SUM(units_attributed) FROM public.material_batch_usage WHERE batch_id = mb.id),
                                1
                            )) * mbu.units_attributed, 2)
                        WHEN COALESCE(m.expected_units_per_batch, 0) > 0 THEN
                            ROUND((mb.unit_cost / m.expected_units_per_batch) * mbu.units_attributed, 2)
                        ELSE NULL
                    END
                )
            ), '[]'::jsonb),
            COALESCE(bool_or(mb.status <> 'depleted'), FALSE)
        INTO v_materials_cost, v_material_details, v_estimated_materials
        FROM public.production_jobs pj
        JOIN public.production_stage_runs psr ON psr.job_id = pj.id
        JOIN public.material_batch_usage mbu ON mbu.stage_run_id = psr.id
        JOIN public.material_batches mb ON mb.id = mbu.batch_id
        JOIN public.materials m ON m.id = mb.material_id
        WHERE pj.order_id = p_order_id;

        -- 2. Direct Labor: Stage runs + labor_rates or standard stage cost
        -- Piece rate is paid on units produced. A run that passed zero units
        -- produced nothing, so it is charged nothing; GREATEST(units,1) used to
        -- invoice a unit of labour for a batch that entirely failed. The waste
        -- itself is reported by get_cost_of_quality_report, where it belongs.
        SELECT
            COALESCE(SUM(
                COALESCE(lr.rate_per_unit, 0) * COALESCE(psr.units_passed, 0)
            ), 0),
            COALESCE(jsonb_agg(
                jsonb_build_object(
                    'stage_name', st.name_ar,
                    'assignee_id', psr.assignee_id,
                    'units_passed', psr.units_passed,
                    'rate_per_unit', COALESCE(lr.rate_per_unit, 0),
                    'has_rate', (lr.rate_per_unit IS NOT NULL),
                    'cost', COALESCE(lr.rate_per_unit, 0) * COALESCE(psr.units_passed, 0)
                )
            ), '[]'::jsonb)
        INTO v_labor_cost, v_labor_details
        FROM public.production_jobs pj
        JOIN public.production_stage_runs psr ON psr.job_id = pj.id
        JOIN public.production_stages st ON st.id = psr.stage_id
        LEFT JOIN LATERAL (
            SELECT rate_per_unit
            FROM public.labor_rates
            WHERE stage_id = psr.stage_id
              AND (employee_id = psr.assignee_id OR employee_id IS NULL)
              AND effective_from <= COALESCE(psr.completed_at::date, CURRENT_DATE)
            ORDER BY (employee_id IS NOT NULL) DESC, effective_from DESC
            LIMIT 1
        ) lr ON true
        WHERE pj.order_id = p_order_id
          AND psr.execution = 'internal'
          AND psr.status = 'done';

        -- 3. External Work: Outsource stages on this job
        SELECT 
            COALESCE(SUM(agreed_cost), 0),
            COALESCE(jsonb_agg(
                jsonb_build_object(
                    'stage_name', st.name_ar,
                    'supplier_name', sup.name,
                    'agreed_cost', ewo.agreed_cost,
                    'status', ewo.status
                )
            ), '[]'::jsonb)
        INTO v_external_cost, v_external_details
        FROM public.production_jobs pj
        JOIN public.production_stage_runs psr ON psr.job_id = pj.id
        JOIN public.production_stages st ON st.id = psr.stage_id
        JOIN public.external_work_orders ewo ON ewo.stage_run_id = psr.id
        LEFT JOIN public.suppliers sup ON sup.id = ewo.supplier_id
        WHERE pj.order_id = p_order_id;

        -- 4. Allocated overhead: the order's OWN month, or nothing.
        -- Borrowing the nearest earlier month silently charged January's rate to
        -- an unallocated March and produced a confident number nobody had
        -- frozen. An unallocated month reports zero overhead and says so, so the
        -- report can show "الأوفرهيد لسه متوزعش للشهر ده" instead of a fiction.
        SELECT rate_per_unit
          INTO v_overhead_rate
          FROM public.overhead_allocation_runs
         WHERE period_month = v_order_month;

        IF v_overhead_rate IS NULL THEN
            v_overhead_rate   := 0;
            v_overhead_status := 'not_allocated';
        ELSE
            v_overhead_status := 'allocated';
        END IF;

        v_overhead_cost := ROUND(v_overhead_rate * v_total_units, 2);
        v_total_cost := v_materials_cost + v_labor_cost + v_external_cost + v_overhead_cost;
    ELSE
        -- Outsourced case: the vendor's agreed cost is the cost, and it keeps
        -- flowing through orders.cost exactly as it does today. Nothing here
        -- writes it back.
        v_external_cost   := COALESCE(v_order.manual_cost, v_order.cost, 0);
        v_total_cost      := v_external_cost;
        v_overhead_status := 'not_applicable';
    END IF;

    RETURN jsonb_build_object(
        'order_id', p_order_id,
        'case_id', v_order.case_id,
        'is_internal_production', v_has_internal_runs,
        'is_billable', TRUE,
        'total_units', v_total_units,
        'total_price', v_total_price,
        'materials_cost', v_materials_cost,
        'materials_are_estimated', v_estimated_materials,
        'labor_cost', v_labor_cost,
        'external_cost', v_external_cost,
        'overhead_cost', v_overhead_cost,
        'overhead_rate_applied', v_overhead_rate,
        'overhead_status', v_overhead_status,
        'total_cost', v_total_cost,
        'cost_per_unit', ROUND(v_total_cost / v_total_units, 2),
        'gross_profit', ROUND(v_total_price - v_total_cost, 2),
        'margin_percent', CASE
            WHEN v_total_price > 0 THEN
                ROUND(((v_total_price - v_total_cost) / v_total_price) * 100, 1)
            ELSE 0
        END,
        'details', jsonb_build_object(
            'materials', v_material_details,
            'labor', v_labor_details,
            'external', v_external_details
        )
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_production_capacity_and_bottlenecks(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT;
    v_start DATE;
    v_end DATE;
    v_stages_json JSONB;
    v_top_bottleneck TEXT := NULL;
    v_total_wip INTEGER := 0;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'lab', 'technician', 'accountant', 'coordinator') THEN
        RAISE EXCEPTION 'Forbidden: insufficient privileges' USING ERRCODE = '42501';
    END IF;

    v_start := COALESCE(p_start_date, (CURRENT_DATE - INTERVAL '30 days')::date);
    v_end   := COALESCE(p_end_date, CURRENT_DATE);

    WITH stage_wip AS (
        -- Real-time active queue and WIP
        SELECT 
            psr.stage_id,
            COUNT(DISTINCT psr.id) AS active_runs_count,
            SUM(GREATEST(COALESCE(psr.units_in, 1), 1)) AS active_wip_units
        FROM public.production_stage_runs psr
        JOIN public.production_jobs pj ON pj.id = psr.job_id
        WHERE psr.status IN ('ready', 'in_progress')
          AND pj.status NOT IN ('completed', 'cancelled')
        GROUP BY psr.stage_id
    ),
    stage_downtime AS (
        -- Downtime hours on machines linked to stages in this date range
        SELECT 
            m.stage_id,
            ROUND(SUM(
                EXTRACT(EPOCH FROM (
                    COALESCE(md.ended_at, now()) - md.started_at
                )) / 3600.0
            )::numeric, 1) AS downtime_hours
        FROM public.machine_downtime md
        JOIN public.machines m ON m.id = md.machine_id
        WHERE m.stage_id IS NOT NULL
          AND md.started_at::date >= v_start
          AND md.started_at::date <= v_end
        GROUP BY m.stage_id
    ),
    stage_durations AS (
        -- Completed stage runs measured in working minutes
        SELECT 
            psr.stage_id,
            COUNT(psr.id) AS completed_runs_count,
            SUM(GREATEST(psr.units_passed, 1)) AS total_units_passed,
            SUM(COALESCE(psr.units_failed, 0)) AS total_units_failed,
            SUM(CASE WHEN psr.rework_of IS NOT NULL THEN 1 ELSE 0 END) AS rework_runs_count,
            -- Working minutes: wait, touch, stage
            AVG(
                CASE 
                    WHEN psr.queued_at IS NOT NULL AND psr.started_at IS NOT NULL 
                         AND psr.started_at > psr.queued_at THEN
                        GREATEST(0, public.working_minutes_between(psr.queued_at, psr.started_at))
                    ELSE 0
                END
            ) AS avg_wait_minutes,
            AVG(
                CASE 
                    WHEN psr.started_at IS NOT NULL AND psr.completed_at IS NOT NULL 
                         AND psr.completed_at > psr.started_at THEN
                        GREATEST(1, public.working_minutes_between(psr.started_at, psr.completed_at))
                    ELSE 15
                END
            ) AS avg_touch_minutes,
            AVG(
                CASE 
                    WHEN psr.queued_at IS NOT NULL AND psr.completed_at IS NOT NULL 
                         AND psr.completed_at > psr.queued_at THEN
                        GREATEST(1, public.working_minutes_between(psr.queued_at, psr.completed_at))
                    ELSE 20
                END
            ) AS avg_stage_minutes
        FROM public.production_stage_runs psr
        WHERE psr.execution = 'internal'
          AND psr.status = 'done'
          AND psr.completed_at::date >= v_start
          AND psr.completed_at::date <= v_end
        GROUP BY psr.stage_id
    ),
    combined AS (
        SELECT 
            st.id AS stage_id,
            st.code AS stage_code,
            st.name_ar AS stage_name,
            st.sequence,
            COALESCE(w.active_wip_units, 0) AS active_wip_units,
            COALESCE(w.active_runs_count, 0) AS active_runs_count,
            COALESCE(d.completed_runs_count, 0) AS completed_runs_count,
            ROUND(COALESCE(d.avg_wait_minutes, 0)::numeric, 1) AS avg_wait_minutes,
            ROUND(COALESCE(d.avg_touch_minutes, 15)::numeric, 1) AS avg_touch_minutes,
            ROUND(COALESCE(d.avg_stage_minutes, 20)::numeric, 1) AS avg_stage_minutes,
            ROUND(
                (COALESCE(d.total_units_passed, 1)::numeric / 
                 GREATEST(COALESCE(d.total_units_passed, 1) + COALESCE(d.total_units_failed, 0), 1)) * 100,
                1
            ) AS first_pass_rate_pct,
            ROUND(
                (COALESCE(d.rework_runs_count, 0)::numeric / GREATEST(COALESCE(d.completed_runs_count, 1), 1)) * 100,
                1
            ) AS rework_rate_pct,
            COALESCE(dt.downtime_hours, 0) AS machine_downtime_hours,
            -- Bottleneck score combines queue wait with active WIP
            ROUND(
                (COALESCE(d.avg_wait_minutes, 0) * (COALESCE(w.active_wip_units, 0) + 1))::numeric,
                0
            ) AS bottleneck_score
        FROM public.production_stages st
        LEFT JOIN stage_wip w ON w.stage_id = st.id
        LEFT JOIN stage_durations d ON d.stage_id = st.id
        LEFT JOIN stage_downtime dt ON dt.stage_id = st.id
        WHERE st.is_active = true
        ORDER BY st.sequence ASC
    )
    SELECT 
        COALESCE(jsonb_agg(row_to_json(combined)), '[]'::jsonb),
        COALESCE(SUM(active_wip_units), 0),
        (
            SELECT stage_name 
            FROM combined 
            ORDER BY bottleneck_score DESC 
            LIMIT 1
        )
    INTO v_stages_json, v_total_wip, v_top_bottleneck
    FROM combined;

    RETURN jsonb_build_object(
        'period', jsonb_build_object('start_date', v_start, 'end_date', v_end),
        'total_active_wip', v_total_wip,
        'top_bottleneck_stage', COALESCE(v_top_bottleneck, '—'),
        'stages', v_stages_json
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_supplier_lead_time_analytics(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT;
    v_start DATE;
    v_end DATE;
    v_suppliers_json JSONB;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'lab', 'accountant', 'coordinator') THEN
        RAISE EXCEPTION 'Forbidden: insufficient privileges' USING ERRCODE = '42501';
    END IF;

    v_start := COALESCE(p_start_date, (CURRENT_DATE - INTERVAL '90 days')::date);
    v_end   := COALESCE(p_end_date, CURRENT_DATE);

    WITH samples AS (
        SELECT * FROM public.get_reliable_external_lead_time_samples(v_start::timestamptz)
         WHERE completed_at::date <= v_end
    ),
    per_bucket AS (
        SELECT
            supplier_id, bucket,
            COUNT(*)::int AS sample_size,
            ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY wall_clock_minutes) / 1440.0)::numeric, 1) AS p50_days,
            ROUND((percentile_cont(0.8) WITHIN GROUP (ORDER BY wall_clock_minutes) / 1440.0)::numeric, 1) AS p80_days,
            ROUND((AVG(wall_clock_minutes) / 1440.0)::numeric, 1) AS avg_days
        FROM samples
        WHERE supplier_id IS NOT NULL
        GROUP BY supplier_id, bucket
    ),
    supplier_rollup AS (
        SELECT
            s.id AS supplier_id,
            s.name AS supplier_name,
            jsonb_build_object(
                'sample_size', COALESCE(hs.sample_size, 0),
                'is_low_sample', COALESCE(hs.sample_size, 0) < 20,
                'p50_days', hs.p50_days, 'p80_days', hs.p80_days, 'avg_days', hs.avg_days
            ) AS split_handoff,
            jsonb_build_object(
                'sample_size', COALESCE(fl.sample_size, 0),
                'is_low_sample', COALESCE(fl.sample_size, 0) < 20,
                'p50_days', fl.p50_days, 'p80_days', fl.p80_days, 'avg_days', fl.avg_days
            ) AS full_lab
        FROM public.suppliers s
        LEFT JOIN per_bucket hs ON hs.supplier_id = s.id AND hs.bucket = 'split_handoff'
        LEFT JOIN per_bucket fl ON fl.supplier_id = s.id AND fl.bucket = 'full_lab'
        WHERE hs.supplier_id IS NOT NULL OR fl.supplier_id IS NOT NULL
    )
    SELECT COALESCE(jsonb_agg(row_to_json(supplier_rollup)), '[]'::jsonb)
      INTO v_suppliers_json
      FROM supplier_rollup;

    RETURN jsonb_build_object(
        'period', jsonb_build_object('start_date', v_start, 'end_date', v_end),
        'note', 'split_handoff = pure vendor time after our own design; full_lab = registration to delivery, includes design the vendor did themselves. Never average the two.',
        'suppliers', v_suppliers_json
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_team_throughput_and_productivity(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT;
    v_start DATE;
    v_end DATE;
    v_team_json JSONB;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'lab', 'accountant', 'coordinator') THEN
        RAISE EXCEPTION 'Forbidden: insufficient privileges' USING ERRCODE = '42501';
    END IF;

    v_start := COALESCE(p_start_date, (CURRENT_DATE - INTERVAL '30 days')::date);
    v_end   := COALESCE(p_end_date, CURRENT_DATE);

    WITH technician_runs AS (
        SELECT 
            u.id AS user_id,
            u.name AS user_name,
            u.role AS user_role,
            st.name_ar AS stage_name,
            GREATEST(COALESCE(psr.units_passed, 1), 1) AS units_passed,
            COALESCE(psr.units_failed, 0) AS units_failed,
            CASE WHEN psr.rework_of IS NOT NULL THEN 1 ELSE 0 END AS is_rework,
            GREATEST(
                1,
                public.working_minutes_between(
                    COALESCE(psr.started_at, psr.queued_at, now() - interval '15 min'), 
                    COALESCE(psr.completed_at, now())
                )
            ) AS touch_minutes
        FROM public.production_stage_runs psr
        JOIN public.users u ON u.id = psr.assignee_id
        JOIN public.production_stages st ON st.id = psr.stage_id
        WHERE psr.status = 'done'
          AND psr.completed_at::date >= v_start
          AND psr.completed_at::date <= v_end
    ),
    aggregated AS (
        SELECT 
            user_id,
            user_name,
            user_role,
            COUNT(*) AS total_runs_completed,
            SUM(units_passed) AS total_units_passed,
            SUM(units_failed) AS total_units_failed,
            SUM(is_rework) AS total_reworks_done,
            ROUND(SUM(touch_minutes)::numeric / 60.0, 1) AS total_touch_hours,
            ROUND(
                SUM(units_passed)::numeric / GREATEST(SUM(touch_minutes)::numeric / 60.0, 1),
                1
            ) AS units_per_hour,
            ROUND(
                (SUM(units_failed)::numeric / GREATEST(SUM(units_passed) + SUM(units_failed), 1)) * 100,
                1
            ) AS error_rate_pct,
            array_to_json(array_agg(DISTINCT stage_name)) AS stages_operated
        FROM technician_runs
        GROUP BY user_id, user_name, user_role
    )
    SELECT COALESCE(jsonb_agg(row_to_json(aggregated)), '[]'::jsonb)
    INTO v_team_json
    FROM aggregated;

    RETURN jsonb_build_object(
        'period', jsonb_build_object('start_date', v_start, 'end_date', v_end),
        'team_productivity', v_team_json
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_technician_material_efficiency(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT;
    v_start DATE;
    v_end DATE;
    v_results JSONB;
BEGIN
    v_role := public.get_my_role();
    IF v_role NOT IN ('admin', 'accountant', 'coordinator', 'lab') THEN
        RAISE EXCEPTION 'Forbidden: admin, accountant, or lab role required' USING ERRCODE = '42501';
    END IF;

    v_start := COALESCE(p_start_date, (CURRENT_DATE - INTERVAL '60 days')::date);
    v_end   := COALESCE(p_end_date, CURRENT_DATE);

    WITH usage_data AS (
        SELECT 
            u.id AS technician_id,
            COALESCE(u.name, 'غير محدد') AS technician_name,
            m.id AS material_id,
            m.name_ar AS material_name,
            m.category AS material_category,
            m.expected_units_per_batch,
            mb.id AS batch_id,
            mb.batch_code,
            mb.status AS batch_status,
            mbu.units_attributed,
            psr.units_failed
        FROM public.material_batch_usage mbu
        JOIN public.material_batches mb ON mb.id = mbu.batch_id
        JOIN public.materials m ON m.id = mb.material_id
        JOIN public.production_stage_runs psr ON psr.id = mbu.stage_run_id
        LEFT JOIN public.users u ON u.id = psr.assignee_id
        WHERE mbu.attributed_at::date >= v_start
          AND mbu.attributed_at::date <= v_end
    ),
    grouped AS (
        SELECT 
            technician_name,
            material_name,
            material_category,
            expected_units_per_batch,
            COUNT(DISTINCT batch_id) AS distinct_batches_used,
            SUM(units_attributed) AS total_units_produced,
            SUM(COALESCE(units_failed, 0)) AS total_units_scrapped,
            ROUND(
                SUM(units_attributed)::numeric / GREATEST(COUNT(DISTINCT batch_id), 1),
                1
            ) AS actual_units_per_batch,
            ROUND(
                (SUM(COALESCE(units_failed, 0))::numeric / GREATEST(SUM(units_attributed) + SUM(COALESCE(units_failed, 0)), 1)) * 100,
                1
            ) AS scrap_rate_pct
        FROM usage_data
        GROUP BY technician_name, material_name, material_category, expected_units_per_batch
    )
    SELECT COALESCE(jsonb_agg(row_to_json(grouped)), '[]'::jsonb)
    INTO v_results
    FROM grouped;

    RETURN jsonb_build_object(
        'period', jsonb_build_object('start_date', v_start, 'end_date', v_end),
        'efficiency', v_results
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.orders_role_field_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_operation TEXT := current_setting('app.order_issue_operation', true);
    v_strict_rep TEXT;
    v_audit_flag TEXT := current_setting('app.rep_audit_in_progress', true);
BEGIN
    IF v_role IS NULL OR v_role = 'admin' THEN RETURN NEW; END IF;

    -- These bypasses are narrow and are revalidated by the V2 transition guard.
    IF v_role = 'representative' AND v_operation IN (
        'cancel_order', 'return_for_adjustment', 'doctor_reject_order',
        'create_redo', 'approve_designer_rejection'
    ) THEN RETURN NEW; END IF;
    IF v_role = 'designer' AND v_operation IN ('submit_design') THEN RETURN NEW; END IF;
    IF v_role = 'lab' AND v_operation IN ('record_final_delivery', 'submit_design') THEN RETURN NEW; END IF;

    IF v_role = 'lab' THEN
        IF NEW.issue_state IN ('doctor_rejected', 'lab_rejected', 'cancelled', 'redo')
           AND OLD.issue_state IS DISTINCT FROM NEW.issue_state THEN
            RAISE EXCEPTION 'lab role cannot apply issue transition %', NEW.issue_state;
        END IF;
        RETURN NEW;
    END IF;

    IF v_role = ANY (ARRAY['accountant', 'coordinator']) THEN
        IF NEW.production_status IS DISTINCT FROM OLD.production_status
           OR NEW.issue_state IS DISTINCT FROM OLD.issue_state
           OR NEW.actual_delivery_date IS DISTINCT FROM OLD.actual_delivery_date
           OR NEW.first_delivered_at IS DISTINCT FROM OLD.first_delivered_at
           OR NEW.design_submitted_at IS DISTINCT FROM OLD.design_submitted_at THEN
            RAISE EXCEPTION 'accountant cannot change workflow or delivery fields';
        END IF;
        RETURN NEW;
    END IF;

    IF v_role = 'designer' THEN
        IF NEW.total_price IS DISTINCT FROM OLD.total_price
           OR NEW.cost IS DISTINCT FROM OLD.cost
           OR NEW.manual_cost IS DISTINCT FROM OLD.manual_cost
           OR NEW.manual_design_price IS DISTINCT FROM OLD.manual_design_price
           OR NEW.discount IS DISTINCT FROM OLD.discount
           OR NEW.rejected_lab_cost IS DISTINCT FROM OLD.rejected_lab_cost
           OR NEW.rejected_designer_cost IS DISTINCT FROM OLD.rejected_designer_cost
           OR NEW.rejected_doctor_amount IS DISTINCT FROM OLD.rejected_doctor_amount
           OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
           OR NEW.representative_id IS DISTINCT FROM OLD.representative_id
           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
           OR NEW.designer_id IS DISTINCT FROM OLD.designer_id
           OR NEW.items IS DISTINCT FROM OLD.items
           OR NEW.delivery_type IS DISTINCT FROM OLD.delivery_type
           OR NEW.actual_delivery_date IS DISTINCT FROM OLD.actual_delivery_date
           OR NEW.first_delivered_at IS DISTINCT FROM OLD.first_delivered_at
           OR NEW.issue_state IS DISTINCT FROM OLD.issue_state THEN
            RAISE EXCEPTION 'designer cannot change protected order fields';
        END IF;
        RETURN NEW;
    END IF;

    IF v_role = 'representative' THEN
        SELECT value INTO v_strict_rep FROM public.app_settings WHERE key = 'workflow_strict_rep';
        IF v_strict_rep IS DISTINCT FROM 'on' THEN RETURN NEW; END IF;

        IF NEW.patient_name IS DISTINCT FROM OLD.patient_name
           OR NEW.stl_url IS DISTINCT FROM OLD.stl_url
           OR NEW.images_url IS DISTINCT FROM OLD.images_url
           OR NEW.delivery_date IS DISTINCT FROM OLD.delivery_date
           OR NEW.is_urgent IS DISTINCT FROM OLD.is_urgent
           OR NEW.priority IS DISTINCT FROM OLD.priority
           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
           OR NEW.designer_id IS DISTINCT FROM OLD.designer_id
           OR NEW.instructions IS DISTINCT FROM OLD.instructions
           OR NEW.items IS DISTINCT FROM OLD.items
           OR NEW.total_price IS DISTINCT FROM OLD.total_price
           OR NEW.cost IS DISTINCT FROM OLD.cost
           OR NEW.design_price IS DISTINCT FROM OLD.design_price
           OR NEW.discount IS DISTINCT FROM OLD.discount
           OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
           OR NEW.representative_id IS DISTINCT FROM OLD.representative_id
           OR NEW.workflow_type IS DISTINCT FROM OLD.workflow_type
           OR NEW.is_archived IS DISTINCT FROM OLD.is_archived
           OR NEW.case_id IS DISTINCT FROM OLD.case_id
           OR NEW.is_registered IS DISTINCT FROM OLD.is_registered
           OR NEW.feedback IS DISTINCT FROM OLD.feedback THEN
            IF v_audit_flag IS DISTINCT FROM 'true' THEN
                RAISE EXCEPTION 'representative protected edits require the audited RPC';
            END IF;
        END IF;

        IF (NEW.total_price IS DISTINCT FROM OLD.total_price
                AND NEW.items IS NOT DISTINCT FROM OLD.items)
           OR (NEW.cost IS DISTINCT FROM OLD.cost
                AND NEW.items IS NOT DISTINCT FROM OLD.items
                AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id
                AND NEW.designer_id IS NOT DISTINCT FROM OLD.designer_id)
           OR (NEW.design_price IS DISTINCT FROM OLD.design_price
                AND NEW.items IS NOT DISTINCT FROM OLD.items
                AND NEW.designer_id IS NOT DISTINCT FROM OLD.designer_id)
           OR NEW.manual_cost IS DISTINCT FROM OLD.manual_cost
           OR NEW.manual_design_price IS DISTINCT FROM OLD.manual_design_price
           OR NEW.discount IS DISTINCT FROM OLD.discount
           OR NEW.rejected_lab_cost IS DISTINCT FROM OLD.rejected_lab_cost
           OR NEW.rejected_designer_cost IS DISTINCT FROM OLD.rejected_designer_cost
           OR NEW.rejected_doctor_amount IS DISTINCT FROM OLD.rejected_doctor_amount
           OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
           OR NEW.representative_id IS DISTINCT FROM OLD.representative_id
           OR NEW.workflow_type IS DISTINCT FROM OLD.workflow_type
           OR NEW.is_archived IS DISTINCT FROM OLD.is_archived
           OR NEW.case_id IS DISTINCT FROM OLD.case_id
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR NEW.is_registered IS DISTINCT FROM OLD.is_registered THEN
            RAISE EXCEPTION 'representative cannot change protected finance or identity fields';
        END IF;
        IF NEW.issue_state IN ('doctor_rejected', 'lab_rejected', 'cancelled', 'redo')
           AND OLD.issue_state IS DISTINCT FROM NEW.issue_state THEN
            RAISE EXCEPTION 'representative issue transitions require a V2 workflow RPC';
        END IF;
        RETURN NEW;
    END IF;

    IF v_role = 'doctor' THEN RAISE EXCEPTION 'doctor role cannot update orders directly'; END IF;
    RAISE EXCEPTION 'role % is not permitted to update orders', v_role;
END;
$function$;
CREATE OR REPLACE FUNCTION public.reconcile_courier_invoice(p_courier_id uuid, p_period_month date, p_invoice_total numeric, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_start DATE;
    v_end DATE;
    v_count INT := 0;
    v_per_shipment NUMERIC;
BEGIN
    IF v_role NOT IN ('admin', 'accountant', 'coordinator') THEN
        RAISE EXCEPTION 'مطابقة فاتورة الشحن للأدمن والمحاسب فقط';
    END IF;

    IF p_invoice_total IS NULL OR p_invoice_total < 0 THEN
        RAISE EXCEPTION 'قيمة الفاتورة لا يمكن أن تكون سالبة';
    END IF;

    v_start := date_trunc('month', p_period_month)::date;
    v_end   := (v_start + INTERVAL '1 month')::date;

    SELECT COUNT(*) INTO v_count
      FROM public.shipments
     WHERE courier_id = p_courier_id
       AND status = 'delivered'
       AND delivered_at >= v_start
       AND delivered_at <  v_end;

    IF v_count = 0 THEN
        RAISE EXCEPTION 'مفيش شحنات مسلّمة لشركة الشحن دي في شهر %', to_char(v_start, 'YYYY-MM');
    END IF;

    v_per_shipment := ROUND(p_invoice_total / v_count, 2);

    UPDATE public.shipments
       SET cost_amount = v_per_shipment,
           notes = COALESCE(notes || E'\n', '')
                   || '[مطابقة فاتورة ' || to_char(v_start, 'YYYY-MM') || ']: '
                   || COALESCE(NULLIF(btrim(p_notes), ''), 'توزيع بالتساوي'),
           updated_at = now()
     WHERE courier_id = p_courier_id
       AND status = 'delivered'
       AND delivered_at >= v_start
       AND delivered_at <  v_end;

    RETURN jsonb_build_object(
        'success', TRUE,
        'period_month', v_start,
        'invoice_total', p_invoice_total,
        'shipments_matched', v_count,
        'cost_per_shipment', v_per_shipment,
        -- Said out loud so no report can present this as a measured per-shipment
        -- price: it is one monthly invoice divided by a count.
        'allocation_basis', 'even_split_of_monthly_invoice'
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.record_material_purchase(p_supplier_id uuid, p_invoice_ref text, p_purchase_date date, p_items jsonb, p_notes text DEFAULT NULL::text, p_cashbox_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_purchase public.material_purchases%ROWTYPE;
    v_supplier public.suppliers%ROWTYPE;
    v_user_id UUID := auth.uid();
    v_role TEXT := public.get_my_role();
    v_item JSONB;
    v_material_id UUID;
    v_warehouse_id UUID;
    v_batch_code TEXT;
    v_qty NUMERIC;
    v_unit_cost NUMERIC;
    v_expiry_date DATE;
    v_attrs JSONB;
    v_total NUMERIC := 0;
    v_batch_id UUID;
    v_tx_id UUID := NULL;
    v_default_warehouse_id UUID;
BEGIN
    IF v_role NOT IN ('admin', 'accountant', 'coordinator') THEN
        RAISE EXCEPTION 'صلاحية تسجيل المشتريات للأدمن والمحاسب فقط';
    END IF;

    SELECT * INTO v_supplier FROM public.suppliers WHERE id = p_supplier_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'المورد غير موجود';
    END IF;

    IF NULLIF(btrim(p_invoice_ref), '') IS NULL THEN
        RAISE EXCEPTION 'رقم الفاتورة مطلوب';
    END IF;

    IF jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'الفاتورة يجب أن تحتوي على صنف واحد على الأقل';
    END IF;

    SELECT id INTO v_default_warehouse_id FROM public.warehouses WHERE is_default = TRUE LIMIT 1;

    -- Compute total
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_qty := (v_item->>'qty')::numeric;
        v_unit_cost := (v_item->>'unit_cost')::numeric;
        IF v_qty <= 0 THEN RAISE EXCEPTION 'الكمية يجب أن تكون أكبر من صفر'; END IF;
        IF v_unit_cost < 0 THEN RAISE EXCEPTION 'سعر الوحدة لا يمكن أن يكون سالباً'; END IF;
        v_total := v_total + (v_qty * v_unit_cost);
    END LOOP;

    -- Create Finance Expense Transaction in transactions table
    IF v_total > 0 THEN
        INSERT INTO public.transactions (
            type, amount, category, description, date, effective_date,
            entity_type, entity_id, cashbox_id, status, is_approved, is_registered
        ) VALUES (
            'expense', v_total, 'خامات ومستهلكات',
            'فاتورة مشتريات خامات: ' || btrim(p_invoice_ref) || ' (' || v_supplier.name || ')',
            p_purchase_date, p_purchase_date,
            'supplier', p_supplier_id, p_cashbox_id, 'approved', TRUE, FALSE
        ) RETURNING id INTO v_tx_id;
    END IF;

    -- Create Purchase header
    INSERT INTO public.material_purchases (
        supplier_id, invoice_ref, purchase_date, total_amount,
        transaction_id, status, notes, created_by
    ) VALUES (
        p_supplier_id, btrim(p_invoice_ref), p_purchase_date, v_total,
        v_tx_id, 'received', p_notes, v_user_id
    ) RETURNING * INTO v_purchase;

    -- Insert Items, Batches & Ledger Movements
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_material_id := (v_item->>'material_id')::uuid;
        v_warehouse_id := COALESCE((v_item->>'warehouse_id')::uuid, v_default_warehouse_id);
        v_batch_code := COALESCE(NULLIF(btrim(v_item->>'batch_code'), ''), 'LOT-' || to_char(NOW(), 'YYYYMMDD-HH24MISS'));
        v_qty := (v_item->>'qty')::numeric;
        v_unit_cost := (v_item->>'unit_cost')::numeric;
        v_expiry_date := (v_item->>'expiry_date')::date;
        v_attrs := COALESCE(v_item->'attributes', '{}'::jsonb);

        -- Create Batch
        INSERT INTO public.material_batches (
            material_id, warehouse_id, batch_code, supplier_id, purchase_id,
            qty_received, qty_remaining, unit_cost, expiry_date, attributes, status
        ) VALUES (
            v_material_id, v_warehouse_id, v_batch_code, p_supplier_id, v_purchase.id,
            v_qty, v_qty, v_unit_cost, v_expiry_date, v_attrs, 'sealed'
        ) RETURNING id INTO v_batch_id;

        -- Create Purchase Item
        INSERT INTO public.material_purchase_items (
            purchase_id, material_id, warehouse_id, batch_code, qty, unit_cost,
            expiry_date, attributes, batch_id
        ) VALUES (
            v_purchase.id, v_material_id, v_warehouse_id, v_batch_code, v_qty, v_unit_cost,
            v_expiry_date, v_attrs, v_batch_id
        );

        -- The receipt movement is written by trg_material_batches_opening_movement
        -- when the batch row is inserted above. Adding it again here would
        -- double the stock. Only the invoice reference is stamped on it.
        UPDATE public.material_movements
           SET notes = 'وارد مشتريات فاتورة ' || btrim(p_invoice_ref),
               created_by = v_user_id
         WHERE batch_id = v_batch_id
           AND movement_type = 'purchase_in';
    END LOOP;

    RETURN jsonb_build_object(
        'purchase', to_jsonb(v_purchase),
        'transaction_id', v_tx_id
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.settle_employee_expenses(p_expense_ids uuid[], p_settled_amount numeric, p_cashbox_id uuid DEFAULT NULL::uuid, p_settlement_date date DEFAULT CURRENT_DATE, p_effective_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_requested_count INT := COALESCE(cardinality(p_expense_ids), 0);
    v_valid_count INT;
    v_employee_count INT;
    v_employee_id UUID;
    v_employee_name TEXT;
    v_claim_total NUMERIC;
    v_category_count INT;
    v_category_index INT := 0;
    v_allocated NUMERIC := 0;
    v_category_amount NUMERIC;
    v_details TEXT;
    v_group RECORD;
    v_inserted transactions%ROWTYPE;
    v_first_transaction_id UUID;
    v_transfer_fee NUMERIC := 0;
    v_created JSONB := '[]'::jsonb;
BEGIN
    IF get_my_role() NOT IN ('admin', 'accountant', 'coordinator') THEN
        RAISE EXCEPTION 'Only admins and accountants can settle employee expenses';
    END IF;
    IF v_requested_count = 0 THEN
        RAISE EXCEPTION 'No expense claims were selected';
    END IF;
    IF p_settled_amount IS NULL OR p_settled_amount < 0 THEN
        RAISE EXCEPTION 'Settlement amount must be zero or greater';
    END IF;

    PERFORM 1 FROM transactions WHERE id = ANY(p_expense_ids) FOR UPDATE;

    SELECT COUNT(*), COUNT(DISTINCT entity_id), MIN(entity_id::text)::uuid, COALESCE(SUM(amount), 0)
    INTO v_valid_count, v_employee_count, v_employee_id, v_claim_total
    FROM transactions
    WHERE id = ANY(p_expense_ids)
      AND type = 'expense'
      AND entity_id IS NOT NULL
      AND entity_type = 'representative'
      AND category NOT IN ('مرتبات وأجور', 'salaries')
      AND status = 'approved';

    IF v_valid_count <> v_requested_count THEN
        RAISE EXCEPTION 'Every selected claim must exist and still be approved';
    END IF;
    IF v_employee_count <> 1 OR v_claim_total <= 0 THEN
        RAISE EXCEPTION 'Selected claims must belong to one employee and have a positive total';
    END IF;

    SELECT name INTO v_employee_name FROM users WHERE id = v_employee_id;
    v_employee_name := COALESCE(v_employee_name, 'موظف غير معروف');

    SELECT COUNT(DISTINCT category) INTO v_category_count
    FROM transactions WHERE id = ANY(p_expense_ids);

    FOR v_group IN
        SELECT category, SUM(amount) AS category_total
        FROM transactions WHERE id = ANY(p_expense_ids)
        GROUP BY category ORDER BY category
    LOOP
        v_category_index := v_category_index + 1;
        IF v_category_index = v_category_count THEN
            v_category_amount := p_settled_amount - v_allocated;
        ELSE
            v_category_amount := ROUND(p_settled_amount * v_group.category_total / v_claim_total, 2);
            v_allocated := v_allocated + v_category_amount;
        END IF;

        SELECT string_agg(description || ' (' || amount || ' ج.م)', '، ' ORDER BY date, id)
        INTO v_details
        FROM transactions
        WHERE id = ANY(p_expense_ids) AND category = v_group.category;

        IF v_category_amount > 0 THEN
            INSERT INTO transactions (
                type, amount, category, date, description, entity_id, entity_type,
                is_registered, is_approved, status, effective_date, cashbox_id
            ) VALUES (
                'expense', v_category_amount, v_group.category, p_settlement_date,
                LEFT('تسوية مصاريف ' || v_employee_name || ' - ' || v_group.category || ': ' || v_details, 500),
                NULL, 'general', false, true, 'approved', p_effective_date, p_cashbox_id
            ) RETURNING * INTO v_inserted;

            v_first_transaction_id := COALESCE(v_first_transaction_id, v_inserted.id);
            v_created := v_created || jsonb_build_array(to_jsonb(v_inserted));
            UPDATE transactions
            SET linked_transaction_id = v_inserted.id
            WHERE id = ANY(p_expense_ids) AND category = v_group.category;
        END IF;
    END LOOP;

    -- Keep the bank/wallet fee in the same atomic operation, calculated once
    -- from the full settlement (not once per expense category).
    IF p_cashbox_id IS NOT NULL AND p_settled_amount > 0 AND v_first_transaction_id IS NOT NULL THEN
        SELECT CASE
            WHEN NOT fee_enabled THEN 0
            WHEN fee_max_amount IS NULL THEN GREATEST(fee_min_amount, ROUND(p_settled_amount * fee_percentage / 100, 2))
            ELSE LEAST(fee_max_amount, GREATEST(fee_min_amount, ROUND(p_settled_amount * fee_percentage / 100, 2)))
        END
        INTO v_transfer_fee
        FROM cashboxes
        WHERE id = p_cashbox_id;

        IF COALESCE(v_transfer_fee, 0) > 0 THEN
            INSERT INTO transactions (
                type, amount, category, date, description, entity_type,
                is_registered, is_approved, status, effective_date, cashbox_id,
                linked_transaction_id, is_system_generated_fee
            ) VALUES (
                'expense', v_transfer_fee, 'transfer_fee', p_settlement_date,
                LEFT('مصاريف بنك/محفظة - تسوية مصاريف ' || v_employee_name, 500), 'general',
                true, true, 'approved', p_effective_date, p_cashbox_id,
                v_first_transaction_id, true
            ) RETURNING * INTO v_inserted;
            v_created := v_created || jsonb_build_array(to_jsonb(v_inserted));
        END IF;
    END IF;

    UPDATE transactions
    SET status = 'settled', is_approved = true,
        description = LEFT(description || ' (تمت التسوية بتاريخ ' || p_settlement_date || ')', 500)
    WHERE id = ANY(p_expense_ids);

    RETURN jsonb_build_object(
        'employee_id', v_employee_id,
        'employee_name', v_employee_name,
        'claim_total', v_claim_total,
        'settled_amount', p_settled_amount,
        'created_transactions', v_created
    );
END;
$function$;
-- ═══ RLS policies (54) ═══

DROP POLICY IF EXISTS "Accountants view account credits" ON public.account_credits;
CREATE POLICY "Accountants view account credits" ON public.account_credits
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Accounting staff view review changes" ON public.accounting_review_changes;
CREATE POLICY "Accounting staff view review changes" ON public.accounting_review_changes
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Admins and Accountants can insert adjustments" ON public.adjustments;
CREATE POLICY "Admins and Accountants can insert adjustments" ON public.adjustments
    AS PERMISSIVE FOR INSERT
    TO public
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Admins and Accountants can update adjustments" ON public.adjustments;
CREATE POLICY "Admins and Accountants can update adjustments" ON public.adjustments
    AS PERMISSIVE FOR UPDATE
    TO public
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Staff can view adjustments" ON public.adjustments;
CREATE POLICY "Staff can view adjustments" ON public.adjustments
    AS PERMISSIVE FOR SELECT
    TO public
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'representative'::text, 'lab'::text])));

DROP POLICY IF EXISTS "Accountants view allocation events" ON public.allocation_events;
CREATE POLICY "Accountants view allocation events" ON public.allocation_events
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "cashbox_reconciliations_insert" ON public.cashbox_reconciliations;
CREATE POLICY "cashbox_reconciliations_insert" ON public.cashbox_reconciliations
    AS PERMISSIVE FOR INSERT
    TO authenticated
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "cashbox_reconciliations_select" ON public.cashbox_reconciliations;
CREATE POLICY "cashbox_reconciliations_select" ON public.cashbox_reconciliations
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "cashbox_transfers_insert" ON public.cashbox_transfers;
CREATE POLICY "cashbox_transfers_insert" ON public.cashbox_transfers
    AS PERMISSIVE FOR INSERT
    TO authenticated
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "cashbox_transfers_select" ON public.cashbox_transfers;
CREATE POLICY "cashbox_transfers_select" ON public.cashbox_transfers
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "cashboxes_select" ON public.cashboxes;
CREATE POLICY "cashboxes_select" ON public.cashboxes
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Finance can read cutover baseline" ON public.cutover_financial_baseline;
CREATE POLICY "Finance can read cutover baseline" ON public.cutover_financial_baseline
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'lab'::text])));

DROP POLICY IF EXISTS "doctors_select" ON public.doctors;
CREATE POLICY "doctors_select" ON public.doctors
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'representative'::text, 'designer'::text])) OR ((get_my_role() = 'lab'::text) AND (EXISTS ( SELECT 1
   FROM orders
  WHERE ((orders.doctor_id = doctors.id) AND (orders.supplier_id = get_my_entity_id())))))));

DROP POLICY IF EXISTS "manage_all_advances" ON public.employee_advances;
CREATE POLICY "manage_all_advances" ON public.employee_advances
    AS PERMISSIVE FOR ALL
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "manage_all_commissions" ON public.employee_commissions;
CREATE POLICY "manage_all_commissions" ON public.employee_commissions
    AS PERMISSIVE FOR ALL
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "manage_all_custody" ON public.employee_custody;
CREATE POLICY "manage_all_custody" ON public.employee_custody
    AS PERMISSIVE FOR ALL
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Accountants view entity billing settings" ON public.entity_billing_settings;
CREATE POLICY "Accountants view entity billing settings" ON public.entity_billing_settings
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Accountants view financial exception reviews" ON public.financial_exception_reviews;
CREATE POLICY "Accountants view financial exception reviews" ON public.financial_exception_reviews
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Accountants manage financial obligations" ON public.financial_obligations;
CREATE POLICY "Accountants manage financial obligations" ON public.financial_obligations
    AS PERMISSIVE FOR ALL
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['accountant'::text, 'coordinator'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Finance reviewers view snapshot notes" ON public.financial_report_snapshot_notes;
CREATE POLICY "Finance reviewers view snapshot notes" ON public.financial_report_snapshot_notes
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Finance reviewers view snapshots" ON public.financial_report_snapshots;
CREATE POLICY "Finance reviewers view snapshots" ON public.financial_report_snapshots
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "labor_rates_read" ON public.labor_rates;
CREATE POLICY "labor_rates_read" ON public.labor_rates
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'lab'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "labor_rates_write" ON public.labor_rates;
CREATE POLICY "labor_rates_write" ON public.labor_rates
    AS PERMISSIVE FOR ALL
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Staff can read batch usage" ON public.material_batch_usage;
CREATE POLICY "Staff can read batch usage" ON public.material_batch_usage
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'lab'::text, 'technician'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Staff can read material batches" ON public.material_batches;
CREATE POLICY "Staff can read material batches" ON public.material_batches
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'lab'::text, 'technician'::text, 'accountant'::text, 'coordinator'::text, 'designer'::text, 'representative'::text])));

DROP POLICY IF EXISTS "Staff can read material movements" ON public.material_movements;
CREATE POLICY "Staff can read material movements" ON public.material_movements
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'lab'::text, 'technician'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Staff can read material purchase items" ON public.material_purchase_items;
CREATE POLICY "Staff can read material purchase items" ON public.material_purchase_items
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'lab'::text])));

DROP POLICY IF EXISTS "Admins and accountants manage purchases" ON public.material_purchases;
CREATE POLICY "Admins and accountants manage purchases" ON public.material_purchases
    AS PERMISSIVE FOR ALL
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Staff can read material purchases" ON public.material_purchases;
CREATE POLICY "Staff can read material purchases" ON public.material_purchases
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'lab'::text])));

DROP POLICY IF EXISTS "Staff can read materials" ON public.materials;
CREATE POLICY "Staff can read materials" ON public.materials
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'lab'::text, 'technician'::text, 'accountant'::text, 'coordinator'::text, 'designer'::text, 'representative'::text])));

DROP POLICY IF EXISTS "Internal staff can insert order events" ON public.order_events;
CREATE POLICY "Internal staff can insert order events" ON public.order_events
    AS PERMISSIVE FOR INSERT
    TO authenticated
    WITH CHECK (((get_my_role() = 'admin'::text) OR ((get_my_role() = ANY (ARRAY['accountant'::text, 'coordinator'::text, 'representative'::text])) AND (event_type <> ALL (ARRAY['financial_adjustment_approved'::text, 'payment_allocated'::text, 'manual_allocation_override'::text, 'order_reopened'::text])))));

DROP POLICY IF EXISTS "Internal staff can view order events" ON public.order_events;
CREATE POLICY "Internal staff can view order events" ON public.order_events
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'representative'::text])));

DROP POLICY IF EXISTS "order_history_select" ON public.order_history;
CREATE POLICY "order_history_select" ON public.order_history
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])) OR (order_id IN ( SELECT orders.id
   FROM orders))));

DROP POLICY IF EXISTS "order_issues_admin_lab_read" ON public.order_issues;
CREATE POLICY "order_issues_admin_lab_read" ON public.order_issues
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'lab'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "orders_insert" ON public.orders;
CREATE POLICY "orders_insert" ON public.orders
    AS PERMISSIVE FOR INSERT
    TO authenticated
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'representative'::text])));

DROP POLICY IF EXISTS "orders_select" ON public.orders;
CREATE POLICY "orders_select" ON public.orders
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])) OR ((get_my_role() = 'designer'::text) AND (designer_id = get_my_user_id())) OR (get_my_role() = 'representative'::text) OR ((get_my_role() = 'lab'::text) AND (supplier_id = get_my_entity_id()))));

DROP POLICY IF EXISTS "orders_update" ON public.orders;
CREATE POLICY "orders_update" ON public.orders
    AS PERMISSIVE FOR UPDATE
    TO authenticated
    USING (((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])) OR ((get_my_role() = 'designer'::text) AND (designer_id = get_my_user_id())) OR ((get_my_role() = 'representative'::text) AND (status <> 'Delivered'::text)) OR ((get_my_role() = 'lab'::text) AND (supplier_id = get_my_entity_id()))))
    WITH CHECK (((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])) OR ((get_my_role() = 'designer'::text) AND (designer_id = get_my_user_id())) OR (get_my_role() = 'representative'::text) OR ((get_my_role() = 'lab'::text) AND (supplier_id = get_my_entity_id()))));

DROP POLICY IF EXISTS "overhead_runs_read" ON public.overhead_allocation_runs;
CREATE POLICY "overhead_runs_read" ON public.overhead_allocation_runs
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Accountants view payment allocations" ON public.payment_allocations;
CREATE POLICY "Accountants view payment allocations" ON public.payment_allocations
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Accountants and admins insert reconciliation flags" ON public.reconciliation_flags;
CREATE POLICY "Accountants and admins insert reconciliation flags" ON public.reconciliation_flags
    AS PERMISSIVE FOR INSERT
    TO authenticated
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Accountants and admins update reconciliation flags" ON public.reconciliation_flags;
CREATE POLICY "Accountants and admins update reconciliation flags" ON public.reconciliation_flags
    AS PERMISSIVE FOR UPDATE
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Accountants and admins view reconciliation flags" ON public.reconciliation_flags;
CREATE POLICY "Accountants and admins view reconciliation flags" ON public.reconciliation_flags
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "services_select" ON public.services;
CREATE POLICY "services_select" ON public.services
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'designer'::text, 'lab'::text, 'representative'::text, 'doctor'::text])));

DROP POLICY IF EXISTS "Admins and lab manage shipment orders" ON public.shipment_orders;
CREATE POLICY "Admins and lab manage shipment orders" ON public.shipment_orders
    AS PERMISSIVE FOR ALL
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'lab'::text, 'accountant'::text, 'coordinator'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'lab'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Staff can read shipment orders" ON public.shipment_orders;
CREATE POLICY "Staff can read shipment orders" ON public.shipment_orders
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'lab'::text, 'accountant'::text, 'coordinator'::text, 'technician'::text, 'receptionist'::text])));

DROP POLICY IF EXISTS "Admins and lab manage shipments" ON public.shipments;
CREATE POLICY "Admins and lab manage shipments" ON public.shipments
    AS PERMISSIVE FOR ALL
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'lab'::text, 'accountant'::text, 'coordinator'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'lab'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Staff can read shipments" ON public.shipments;
CREATE POLICY "Staff can read shipments" ON public.shipments
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'lab'::text, 'accountant'::text, 'coordinator'::text, 'technician'::text, 'receptionist'::text])));

DROP POLICY IF EXISTS "Staff can read stage bindings" ON public.stage_material_bindings;
CREATE POLICY "Staff can read stage bindings" ON public.stage_material_bindings
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'lab'::text, 'technician'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "suppliers_select" ON public.suppliers;
CREATE POLICY "suppliers_select" ON public.suppliers
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'representative'::text, 'designer'::text])) OR ((get_my_role() = 'lab'::text) AND (id = get_my_entity_id()))));

DROP POLICY IF EXISTS "transactions_insert" ON public.transactions;
CREATE POLICY "transactions_insert" ON public.transactions
    AS PERMISSIVE FOR INSERT
    TO authenticated
    WITH CHECK (((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])) OR ((get_my_role() = 'representative'::text) AND (type = 'expense'::text))));

DROP POLICY IF EXISTS "transactions_select" ON public.transactions;
CREATE POLICY "transactions_select" ON public.transactions
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])) OR ((get_my_role() = 'representative'::text) AND ((entity_id = get_my_user_id()) OR (entity_type = 'doctor'::text))) OR ((get_my_role() = 'designer'::text) AND (entity_id = get_my_user_id())) OR ((get_my_role() = 'lab'::text) AND (entity_id = get_my_entity_id()))));

DROP POLICY IF EXISTS "transactions_update" ON public.transactions;
CREATE POLICY "transactions_update" ON public.transactions
    AS PERMISSIVE FOR UPDATE
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "users_select" ON public.users;
CREATE POLICY "users_select" ON public.users
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'representative'::text, 'lab'::text, 'designer'::text])) OR ((get_my_role() = 'doctor'::text) AND (id = get_my_user_id()))));

DROP POLICY IF EXISTS "Staff can read warehouses" ON public.warehouses;
CREATE POLICY "Staff can read warehouses" ON public.warehouses
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'lab'::text, 'technician'::text, 'accountant'::text, 'coordinator'::text, 'designer'::text, 'representative'::text])));
COMMIT;
