-- Production roles, step 3 of 3: 'lab' gives the floor back.
-- See docs/PRODUCTION_ROLES_PLAN_AR.md sections 3 and 4.2.
--
-- This is the only step that TAKES anything away, which is why it lands last
-- and alone. Steps 1, 2a and 2b were additive; if any of them was wrong, the
-- symptom was somebody having more than intended. Here the symptom is
-- somebody having less, so it is the step that can stop work.
--
-- WHAT THIS UNDOES
--   20260821006000 wrote, in a comment, "'lab' is the production manager."
--   The UI has always called the same role "معمل خارجي" -- external lab. Both
--   were true, which is the problem: one role was simultaneously the outside
--   supplier we owe money to and the person who closes a finishing stage.
--   Every 'lab' below in a PRODUCTION, inventory, shipment, work-session or
--   analytics guard becomes 'production_manager'. can_work_production() is
--   the centre of it:
--       ('admin', 'lab', 'technician', 'designer')
--    -> ('admin', 'production_manager', 'technician', 'designer')
--
-- WHAT KEEPS 'lab', AND WHY
--   Three functions and six policies scope rows by get_my_entity_id() -- "the
--   supplier I am" -- rather than by what someone is allowed to do:
--       append_order_event_v2, check_lab_column_updates,
--       check_order_update_permissions
--       financial_obligations "Labs manage own payable obligations",
--       doctors_select, orders_select, orders_update, suppliers_select,
--       transactions_select
--   Those are identity, not authority. The plan's hard constraint is that no
--   record belonging to the six external-lab rows changes meaning, and
--   rewriting these would do exactly that: an obligation we owe an outside
--   lab would stop being readable as theirs. They keep the role and simply
--   stop being reachable once those logins are switched off.
--
-- THE LOGINS ARE NOT SWITCHED OFF HERE
--   Decision 1 is to lock the six 'lab' accounts out while touching none of
--   their data. That is now a single toggle per account in the Users screen
--   (20260905020000 made is_active actually gate sign-in), so it belongs to
--   whoever deploys this, not to a migration: flipping four live accounts is
--   a data write, it needs to happen when somebody is watching, and it is
--   undone with one click if it turns out to be premature. Removing their
--   PERMISSIONS -- which is what this file does -- is already enough to keep
--   them away from production.
--
-- ERROR MESSAGES MOVED TOO
--   Nine RAISE strings still named 'lab' as the role required. A message that
--   names a role which can no longer reach the function sends the reader
--   looking in the wrong place, so they now name the roles that can.
--
-- To review only what changed:  grep -n "production_manager" <this file>

BEGIN;

-- ═══ Functions (29) ═══

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
    IF v_role NOT IN ('admin', 'accountant', 'coordinator', 'production_manager') THEN
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

CREATE OR REPLACE FUNCTION public.can_work_production()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
    SELECT public.get_my_role() IN ('admin', 'production_manager', 'technician', 'designer');
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
    IF v_role NOT IN ('admin', 'production_manager', 'accountant', 'coordinator') THEN
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

CREATE OR REPLACE FUNCTION public.close_stale_work_sessions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_count INTEGER := 0;
    r       RECORD;
    v_close TIMESTAMPTZ;
BEGIN
    IF public.get_my_role() NOT IN ('admin', 'production_manager') THEN
        RAISE EXCEPTION 'forbidden: admin or production manager role required' USING ERRCODE = '42501';
    END IF;

    FOR r IN
        SELECT ws.id, ws.opened_at, ws.calendar_id, wc.timezone
          FROM public.work_sessions ws
          JOIN public.work_calendars wc ON wc.id = ws.calendar_id
         WHERE ws.closed_at IS NULL
           AND (ws.opened_at AT TIME ZONE wc.timezone)::date
               < (NOW() AT TIME ZONE wc.timezone)::date
    LOOP
        v_close := public.planned_day_close(
                       r.calendar_id,
                       (r.opened_at AT TIME ZONE r.timezone)::date);

        -- A session opened after the planned close, or on a day off, still has
        -- to end somewhere. One minute is the smallest honest non-zero span:
        -- it records that the day happened without inventing hours of work.
        v_close := GREATEST(COALESCE(v_close, r.opened_at + INTERVAL '1 minute'),
                            r.opened_at + INTERVAL '1 minute');

        UPDATE public.work_sessions
           SET closed_at  = v_close,
               source     = 'auto_inferred',
               is_flagged = TRUE,
               notes      = COALESCE(notes || ' | ', '')
                            || 'auto-closed: no close was recorded'
         WHERE id = r.id;

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_work_session(p_calendar_id uuid DEFAULT NULL::uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_cal     UUID;
    v_at      TIMESTAMPTZ := COALESCE(p_at, NOW());
    v_id      UUID;
    v_opened  TIMESTAMPTZ;
BEGIN
    IF public.get_my_role() NOT IN ('admin', 'production_manager') THEN
        RAISE EXCEPTION 'forbidden: admin or production manager role required' USING ERRCODE = '42501';
    END IF;

    v_cal := COALESCE(
        p_calendar_id,
        (SELECT wc.id FROM public.work_calendars wc
          WHERE wc.is_default AND wc.is_active LIMIT 1));

    SELECT ws.id, ws.opened_at INTO v_id, v_opened
      FROM public.work_sessions ws
     WHERE ws.calendar_id = v_cal AND ws.closed_at IS NULL
     FOR UPDATE;

    -- Idempotent in the same spirit as open_work_session.
    IF v_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF v_at <= v_opened THEN
        RAISE EXCEPTION 'close time % is not after open time %', v_at, v_opened
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.work_sessions
       SET closed_at = v_at,
           closed_by = public.get_my_user_id(),
           notes     = COALESCE(p_notes, notes)
     WHERE id = v_id;

    RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_shipment_delivery(p_shipment_id uuid, p_delivery_proof_url text DEFAULT NULL::text, p_delivered_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_shipment public.shipments%ROWTYPE;
    v_delivered_time TIMESTAMPTZ := COALESCE(p_delivered_at, now());
    v_order RECORD;
    v_order_count INT := 0;
    v_delivered_count INT := 0;
    v_skipped JSONB := '[]'::jsonb;
    v_is_production_v1 BOOLEAN := FALSE;
    v_idem UUID;
BEGIN
    IF v_role NOT IN ('admin', 'production_manager', 'coordinator') THEN
        RAISE EXCEPTION 'تأكيد تسليم الشحنة للأدمن وإدارة المعمل فقط (بيولّد مستحق الطبيب)';
    END IF;

    SELECT * INTO v_shipment FROM public.shipments WHERE id = p_shipment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الشحنة غير موجودة';
    END IF;

    IF v_shipment.status = 'delivered' THEN
        RETURN jsonb_build_object('success', TRUE, 'message', 'الشحنة مسلّمة بالفعل');
    END IF;

    IF v_shipment.status = 'cancelled' THEN
        RAISE EXCEPTION 'لا يمكن تأكيد تسليم شحنة ملغاة';
    END IF;

    v_is_production_v1 := public.workflow_flag_enabled('production_v1');

    UPDATE public.shipments
    SET status = 'delivered',
        delivered_at = v_delivered_time,
        delivery_proof_url = COALESCE(NULLIF(btrim(p_delivery_proof_url), ''), delivery_proof_url),
        notes = CASE 
            WHEN NULLIF(btrim(p_notes), '') IS NOT NULL THEN 
                COALESCE(notes || E'\n', '') || '[تأكيد التسليم]: ' || btrim(p_notes)
            ELSE notes 
        END,
        updated_at = now()
    WHERE id = p_shipment_id;

    FOR v_order IN
        SELECT so.order_id, o.case_id, o.status, o.production_status,
               o.issue_state, o.first_delivered_at
        FROM public.shipment_orders so
        JOIN public.orders o ON o.id = so.order_id
        WHERE so.shipment_id = p_shipment_id
    LOOP
        v_order_count := v_order_count + 1;

        -- ── The money. Same path the delivery button has always used. ──
        -- Skipped, never forced, in the two cases record_order_final_delivery_v2
        -- itself refuses: an order with an open issue, and one already
        -- delivered. Both are reported back so the screen can say which cases
        -- were left behind instead of implying the whole shipment billed.
        IF v_order.first_delivered_at IS NOT NULL THEN
            v_skipped := v_skipped || jsonb_build_object(
                'order_id', v_order.order_id, 'case_id', v_order.case_id,
                'reason', 'already_delivered');
        ELSIF COALESCE(v_order.issue_state, 'none') <> 'none' THEN
            v_skipped := v_skipped || jsonb_build_object(
                'order_id', v_order.order_id, 'case_id', v_order.case_id,
                'reason', 'open_issue');
        ELSE
            -- Deterministic key: confirming the same shipment twice must bill
            -- the doctor once. Hashing (shipment, order) gives the same key on
            -- every retry, which is what the command log behind
            -- record_order_final_delivery_v2 expects. md5 is core Postgres --
            -- uuid_generate_v5 lives in the extensions schema and is not on this
            -- function's search_path.
            v_idem := md5(p_shipment_id::text || ':' || v_order.order_id::text)::uuid;
            PERFORM public.record_order_final_delivery_v2(
                v_order.order_id, v_delivered_time, v_idem);
            v_delivered_count := v_delivered_count + 1;
        END IF;

        -- ── The floor. Close the shipping step once the cutover is live. ──
        -- 'done' is the value production_stage_runs.status actually allows;
        -- 'completed' is not in the CHECK and would have thrown on cutover day.
        -- The stage lookup is a subquery, not a FROM-join: Postgres rejects a
        -- reference to the UPDATE target inside a FROM-clause join condition
        -- (42P01), so the original statement could never have run at all.
        IF v_is_production_v1 THEN
            UPDATE public.production_stage_runs psr
               SET status       = 'done',
                   completed_at = v_delivered_time,
                   updated_at   = now()
             WHERE psr.job_id IN (
                       SELECT pj.id FROM public.production_jobs pj
                        WHERE pj.order_id = v_order.order_id)
               AND psr.stage_id IN (
                       SELECT ps.id FROM public.production_stages ps
                        WHERE ps.code = 'shipping')
               -- 'ready' and 'waiting_external' are where a stage run actually
               -- sits; the original filter matched neither.
               AND psr.status IN ('pending', 'ready', 'in_progress', 'waiting_external');
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', TRUE,
        'shipment_id', p_shipment_id,
        'status', 'delivered',
        'orders_in_shipment', v_order_count,
        'orders_delivered', v_delivered_count,
        'orders_skipped', v_skipped,
        'delivered_at', v_delivered_time
    );
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
    IF v_role NOT IN ('admin', 'production_manager', 'accountant', 'coordinator', 'technician') THEN
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

CREATE OR REPLACE FUNCTION public.deplete_material_batch(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_batch public.material_batches%ROWTYPE;
    v_user_id UUID := auth.uid();
    v_role TEXT := public.get_my_role();
    v_total_units NUMERIC;
BEGIN
    IF v_role NOT IN ('admin', 'production_manager', 'technician') THEN
        RAISE EXCEPTION 'ليس لديك صلاحية إغلاق خامة';
    END IF;

    SELECT * INTO v_batch FROM public.material_batches WHERE id = p_batch_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'اللوت غير موجود';
    END IF;

    IF v_batch.status = 'depleted' THEN
        RETURN to_jsonb(v_batch);
    END IF;

    -- Record consumption movement for remaining qty
    IF v_batch.qty_remaining > 0 THEN
        INSERT INTO public.material_movements (
            batch_id, warehouse_id, movement_type, qty, notes, created_by
        ) VALUES (
            p_batch_id, v_batch.warehouse_id, 'consume', -v_batch.qty_remaining,
            'استنفاد الديسك بالكامل', v_user_id
        );
    END IF;

    -- qty_remaining is not set here. The 'consume' movement above already
    -- drives it to zero through trg_material_movements_rebalance; writing it
    -- again would be the second source of truth this design exists to avoid.
    UPDATE public.material_batches
       SET status = 'depleted',
           depleted_at = NOW(),
           depleted_by = v_user_id,
           updated_at = NOW()
     WHERE id = p_batch_id
     RETURNING * INTO v_batch;

    -- Calculate total units attributed
    SELECT COALESCE(SUM(units_attributed), 0) INTO v_total_units
      FROM public.material_batch_usage
     WHERE batch_id = p_batch_id;

    RETURN jsonb_build_object(
        'batch', to_jsonb(v_batch),
        'total_units_produced', v_total_units,
        'effective_unit_cost', CASE WHEN v_total_units > 0 THEN ROUND(v_batch.unit_cost / v_total_units, 2) ELSE v_batch.unit_cost END
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
    IF v_role NOT IN ('admin', 'production_manager', 'accountant', 'coordinator') THEN
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
    IF v_role NOT IN ('admin', 'production_manager', 'technician', 'accountant', 'coordinator', 'representative', 'designer', 'doctor') THEN
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
    IF v_role NOT IN ('admin', 'accountant', 'coordinator', 'production_manager') THEN
        RAISE EXCEPTION 'Forbidden: admin, accountant, coordinator, or production manager role required' USING ERRCODE = '42501';
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
        public.get_my_role() = ANY (ARRAY['admin', 'accountant', 'coordinator', 'representative', 'production_manager', 'designer']),
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
    
    IF v_role = 'production_manager' THEN
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
    IF v_role NOT IN ('admin', 'accountant', 'coordinator', 'production_manager') THEN
        RAISE EXCEPTION 'Forbidden: admin, accountant, coordinator, or production manager role required' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION public.get_open_system_warnings(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_rows JSONB;
    v_total INTEGER;
BEGIN
    IF public.get_my_role() NOT IN ('admin', 'production_manager') THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    SELECT COUNT(*) INTO v_total
      FROM public.system_warnings WHERE acknowledged_at IS NULL;

    SELECT COALESCE(jsonb_agg(w), '[]'::jsonb) INTO v_rows FROM (
        SELECT source, ref_id, message, sqlstate, occurred_at
          FROM public.system_warnings
         WHERE acknowledged_at IS NULL
         ORDER BY occurred_at DESC
         LIMIT GREATEST(COALESCE(p_limit, 100), 1)
    ) w;

    RETURN jsonb_build_object('open_count', v_total, 'warnings', v_rows);
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
    IF v_role NOT IN ('admin', 'accountant', 'coordinator', 'production_manager') THEN
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
    IF v_role NOT IN ('admin', 'production_manager', 'technician', 'accountant', 'coordinator') THEN
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

CREATE OR REPLACE FUNCTION public.get_production_shadow_report()
 RETURNS TABLE(order_id uuid, case_id text, actual_status text, computed_status text, agrees boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
    SELECT o.id, o.case_id, o.production_status,
           public.compute_production_status_from_stages(o.id),
           o.production_status IS NOT DISTINCT FROM
               public.compute_production_status_from_stages(o.id)
      FROM public.orders o
     WHERE public.get_my_role() IN ('admin', 'production_manager')
       AND COALESCE(o.is_deleted, FALSE) = FALSE
       AND EXISTS (SELECT 1 FROM public.production_jobs j
                    WHERE j.order_id = o.id AND NOT j.is_backfilled)
     ORDER BY (o.production_status IS NOT DISTINCT FROM
               public.compute_production_status_from_stages(o.id)), o.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_production_shadow_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_total INTEGER;
    v_agree INTEGER;
BEGIN
    IF public.get_my_role() NOT IN ('admin', 'production_manager') THEN
        RAISE EXCEPTION 'forbidden: admin or production manager role required' USING ERRCODE = '42501';
    END IF;

    SELECT COUNT(*), COUNT(*) FILTER (WHERE agrees)
      INTO v_total, v_agree
      FROM public.get_production_shadow_report();

    RETURN jsonb_build_object(
        'total',       v_total,
        'agreeing',    v_agree,
        'disagreeing', v_total - v_agree,
        -- NULL, not 100%, when there is nothing to compare. An empty sample
        -- that reports perfect agreement is how a bad cutover gets approved.
        'agreementPct', CASE WHEN v_total = 0 THEN NULL
                             ELSE ROUND((v_agree::numeric / v_total) * 100, 1) END,
        'flagEnabled', public.workflow_flag_enabled('production_v1'));
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
    IF v_role NOT IN ('admin', 'production_manager', 'accountant', 'coordinator') THEN
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
    IF v_role NOT IN ('admin', 'production_manager', 'accountant', 'coordinator') THEN
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
    IF v_role NOT IN ('admin', 'accountant', 'coordinator', 'production_manager') THEN
        RAISE EXCEPTION 'Forbidden: admin, accountant, coordinator, or production manager role required' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION public.open_material_batch(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_batch public.material_batches%ROWTYPE;
    v_user_id UUID := auth.uid();
    v_role TEXT := public.get_my_role();
BEGIN
    IF v_role NOT IN ('admin', 'production_manager', 'technician') THEN
        RAISE EXCEPTION 'ليس لديك صلاحية فتح خامة';
    END IF;

    SELECT * INTO v_batch FROM public.material_batches WHERE id = p_batch_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'اللوت غير موجود';
    END IF;

    IF v_batch.status = 'open' THEN
        RETURN to_jsonb(v_batch);
    END IF;

    IF v_batch.status IN ('depleted', 'scrapped') THEN
        RAISE EXCEPTION 'لا يمكن فتح لوت منتهي أو تالف';
    END IF;

    UPDATE public.material_batches
       SET status = 'open',
           opened_at = COALESCE(opened_at, NOW()),
           opened_by = COALESCE(opened_by, v_user_id),
           updated_at = NOW()
     WHERE id = p_batch_id
     RETURNING * INTO v_batch;

    RETURN to_jsonb(v_batch);
END;
$function$;

CREATE OR REPLACE FUNCTION public.open_work_session(p_calendar_id uuid DEFAULT NULL::uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_source text DEFAULT 'manual'::text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_cal     UUID;
    v_at      TIMESTAMPTZ := COALESCE(p_at, NOW());
    v_open_id UUID;
    v_new_id  UUID;
BEGIN
    IF public.get_my_role() NOT IN ('admin', 'production_manager') THEN
        RAISE EXCEPTION 'forbidden: admin or production manager role required' USING ERRCODE = '42501';
    END IF;

    IF p_source NOT IN ('manual', 'auto_inferred') THEN
        RAISE EXCEPTION 'invalid source: %', p_source USING ERRCODE = '22023';
    END IF;

    v_cal := COALESCE(
        p_calendar_id,
        (SELECT wc.id FROM public.work_calendars wc
          WHERE wc.is_default AND wc.is_active LIMIT 1));

    IF v_cal IS NULL THEN
        RAISE EXCEPTION 'no active work calendar configured' USING ERRCODE = '22023';
    END IF;

    -- Idempotent: pressing "we opened" twice returns the running session
    -- rather than erroring. A blocked button on the lab floor reads as a
    -- broken system and trains people to stop using it.
    SELECT ws.id INTO v_open_id
      FROM public.work_sessions ws
     WHERE ws.calendar_id = v_cal AND ws.closed_at IS NULL
     LIMIT 1;

    IF v_open_id IS NOT NULL THEN
        RETURN v_open_id;
    END IF;

    INSERT INTO public.work_sessions
        (calendar_id, opened_at, opened_by, source, is_flagged, notes)
    VALUES
        (v_cal, v_at, public.get_my_user_id(), p_source,
         p_source = 'auto_inferred', p_notes)
    RETURNING id INTO v_new_id;

    RETURN v_new_id;
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
    IF v_role = ANY (ARRAY['representative', 'coordinator']) AND v_operation IN (
        'cancel_order', 'return_for_adjustment', 'doctor_reject_order',
        'create_redo', 'approve_designer_rejection'
    ) THEN RETURN NEW; END IF;
    IF v_role = 'designer' AND v_operation IN ('submit_design') THEN RETURN NEW; END IF;
    IF v_role = 'production_manager' AND v_operation IN ('record_final_delivery', 'submit_design') THEN RETURN NEW; END IF;

    IF v_role = 'production_manager' THEN
        IF NEW.issue_state IN ('doctor_rejected', 'lab_rejected', 'cancelled', 'redo')
           AND OLD.issue_state IS DISTINCT FROM NEW.issue_state THEN
            RAISE EXCEPTION 'production manager cannot apply issue transition %', NEW.issue_state;
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

CREATE OR REPLACE FUNCTION public.record_order_final_delivery_v2(p_order_id uuid, p_delivered_at timestamp with time zone, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := public.get_my_user_id();
    v_order public.orders%ROWTYPE;
    v_result JSONB;
    v_payload JSONB := jsonb_build_object('deliveredAt', p_delivered_at);
    v_command public.order_transition_commands%ROWTYPE;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN RAISE EXCEPTION 'Workflow V2 writes are disabled'; END IF;
    IF v_role NOT IN ('admin', 'production_manager', 'representative', 'coordinator') OR v_user_id IS NULL THEN
        RAISE EXCEPTION 'Only admin, lab, or representative can record final delivery';
    END IF;
    INSERT INTO public.order_transition_commands(idempotency_key, order_id, operation, requested_by, request_payload)
    VALUES (p_idempotency_key, p_order_id, 'record_final_delivery', v_user_id, v_payload)
    ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT * INTO v_command FROM public.order_transition_commands WHERE idempotency_key = p_idempotency_key FOR UPDATE;
    IF v_command.order_id IS DISTINCT FROM p_order_id OR v_command.operation <> 'record_final_delivery'
       OR v_command.request_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Idempotency key reuse mismatch'; END IF;
    IF v_command.completed_at IS NOT NULL THEN RETURN v_command.result_payload; END IF;
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
    IF COALESCE(v_order.issue_state, 'none') <> 'none' THEN
        RAISE EXCEPTION 'Cannot deliver an order with an active issue';
    END IF;
    IF v_order.production_status = 'final_delivered' AND v_order.first_delivered_at IS NOT NULL THEN
        v_result := jsonb_build_object('orderId', p_order_id, 'productionStatus', 'final_delivered', 'alreadyApplied', TRUE);
        UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
        RETURN v_result;
    END IF;
    PERFORM set_config('app.order_issue_operation', 'record_final_delivery', true);
    UPDATE public.orders SET
        status = 'Delivered', production_status = 'final_delivered',
        actual_delivery_date = COALESCE(p_delivered_at, timezone('utc', now()))::date,
        first_delivered_at = COALESCE(first_delivered_at, p_delivered_at, timezone('utc', now())),
        first_delivered_source = COALESCE(first_delivered_source, 'direct_transition'),
        updated_at = timezone('utc', now())
    WHERE id = p_order_id;
    INSERT INTO public.order_events(order_id, event_type, old_value, new_value, changed_by, actor_role, severity, metadata)
    VALUES (p_order_id, 'order_delivered', v_order.production_status, 'final_delivered', v_user_id, v_role, 'info',
        jsonb_build_object('idempotencyKey', p_idempotency_key, 'workflowVersion', 2));
    v_result := jsonb_build_object('orderId', p_order_id, 'productionStatus', 'final_delivered', 'alreadyApplied', FALSE);
    UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rep_update_order_fields_with_audit(p_order_id uuid, p_changes jsonb, p_reason_code text, p_reason_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := get_my_role();
    v_user_id UUID;
    v_old orders%ROWTYPE;
    v_old_items JSONB;
    v_changed_keys TEXT[] := ARRAY(SELECT jsonb_object_keys(p_changes));
    -- Allowed keys.
    v_allowed_keys CONSTANT TEXT[] := ARRAY[
        'patient_name','stl_url','images_url','delivery_date',
        'is_urgent','priority','supplier_id','designer_id',
        'instructions','items','total_price','cost','design_price'
    ];
    v_allowed_reasons CONSTANT TEXT[] := ARRAY[
        'doctor_requested','wrong_intake_data','missing_info_completed',
        'scan_updated','images_updated','items_corrected','teeth_corrected',
        'delivery_rescheduled_doctor','delivery_rescheduled_lab',
        'urgent_doctor_requested','external_lab_reassigned',
        'designer_reassigned','internal_correction','other'
    ];
    v_key TEXT;
    v_event_type TEXT;
    v_old_text TEXT;
    v_new_text TEXT;
    v_metadata JSONB;
    v_severity TEXT;
    v_responsibility TEXT;
    v_prev_supplier_name TEXT;
    v_new_supplier_name TEXT;
    v_prev_designer_name TEXT;
    v_new_designer_name TEXT;
    v_new_value JSONB;
    v_pending_event_id UUID;
BEGIN
    -- 1. Auth.
    SELECT id INTO v_user_id FROM users WHERE auth_id = auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'unauthenticated';
    END IF;

    -- 2. Role check.
    IF v_role NOT IN ('representative', 'coordinator','admin','production_manager') THEN
        RAISE EXCEPTION 'role % cannot use this RPC', v_role;
    END IF;

    -- 3. Reason validation.
    IF p_reason_code IS NULL OR NOT (p_reason_code = ANY(v_allowed_reasons)) THEN
        RAISE EXCEPTION 'invalid reason_code: %', p_reason_code;
    END IF;
    IF p_reason_code = 'other' AND coalesce(btrim(p_reason_note),'') = '' THEN
        RAISE EXCEPTION 'reason_note required when reason_code=other';
    END IF;

    -- 4. Allow-list check.
    IF v_changed_keys IS NULL OR array_length(v_changed_keys, 1) IS NULL THEN
        RAISE EXCEPTION 'no changes provided';
    END IF;
    FOREACH v_key IN ARRAY v_changed_keys LOOP
        IF NOT (v_key = ANY(v_allowed_keys)) THEN
            RAISE EXCEPTION 'field % not in audited rep allow-list', v_key;
        END IF;
    END LOOP;

    -- 5. Lock OLD row.
    SELECT * INTO v_old FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'order % not found', p_order_id;
    END IF;

    -- 5b. Snapshot the services as they stand BEFORE the update.
    -- orders.items is a legacy JSON mirror that stays '[]' for every order created
    -- through the order_items table, so reading it straight made the audit's
    -- "before" column blank while "after" showed the new services. Prefer the
    -- order_items rows and fall back to the legacy column, exactly like
    -- dbToOrder() does on the client.
    SELECT COALESCE(
        (
            SELECT jsonb_agg(
                       jsonb_strip_nulls(jsonb_build_object(
                           'serviceType',  oi.product_type,
                           'teethNumbers', oi.teeth_numbers,
                           'price',        oi.price,
                           'shade',        oi.shade
                       ))
                       ORDER BY oi.created_at, oi.id
                   )
            FROM order_items oi
            WHERE oi.order_id = p_order_id
        ),
        v_old.items
    ) INTO v_old_items;

    -- 6. INTERCEPT IF DELIVERED & actor is representative.
    -- If delivered/completed, save/upsert pending proposal event.
    IF v_role = ANY (ARRAY['representative', 'coordinator']) AND (v_old.status IN ('Delivered', 'Completed') OR v_old.production_status = 'final_delivered') THEN
        v_metadata := jsonb_build_object(
            'changes', p_changes,
            'oldValues', jsonb_build_object(
                'patient_name', v_old.patient_name,
                'delivery_date', v_old.delivery_date::TEXT,
                'supplier_id', v_old.supplier_id::TEXT,
                'designer_id', v_old.designer_id::TEXT,
                'stl_url', v_old.stl_url,
                'images_url', v_old.images_url,
                'instructions', v_old.instructions,
                'items', v_old_items,
                'total_price', v_old.total_price::TEXT,
                'cost', v_old.cost::TEXT,
                'design_price', v_old.design_price::TEXT,
                'priority', v_old.priority,
                'is_urgent', v_old.is_urgent::TEXT
            ),
            'reasonCode', p_reason_code,
            'note', p_reason_note,
            'actorUserId', v_user_id,
            'actorRole', v_role
        );
        
        -- Check if there is already a pending proposal for this order
        SELECT id INTO v_pending_event_id 
        FROM order_events 
        WHERE order_id = p_order_id 
          AND event_type = 'order_edit_proposed' 
          AND approval_status = 'pending';
          
        IF v_pending_event_id IS NOT NULL THEN
            UPDATE order_events SET
                reason = p_reason_code,
                notes = p_reason_note,
                metadata = v_metadata,
                changed_at = now(),
                changed_by = v_user_id
            WHERE id = v_pending_event_id;
        ELSE
            INSERT INTO order_events (
                order_id, event_type, approval_status, changed_by, actor_role, reason, notes, metadata
            ) VALUES (
                p_order_id, 'order_edit_proposed', 'pending', v_user_id, v_role, p_reason_code, p_reason_note, v_metadata
            );
        END IF;
        
        RETURN p_order_id;
    END IF;

    -- 7. State guards for undelivered (representative only; admin/lab bypass).
    IF v_role = ANY (ARRAY['representative', 'coordinator']) THEN
        IF v_old.issue_state <> 'none' THEN
            RAISE EXCEPTION 'representative cannot edit while issue_state=%', v_old.issue_state;
        END IF;
        IF p_changes ? 'supplier_id'
           AND v_old.production_status IN ('final_ready','final_delivered') THEN
            RAISE EXCEPTION 'representative cannot reassign supplier after final_ready';
        END IF;
        IF p_changes ? 'designer_id' THEN
            IF v_old.production_status IN ('finalization','final_ready','final_delivered') THEN
                RAISE EXCEPTION 'representative cannot reassign designer after finalization';
            END IF;
            IF v_old.workflow_type IS DISTINCT FROM 'split' THEN
                RAISE EXCEPTION 'representative can only reassign designer in split workflow';
            END IF;
        END IF;
    END IF;

    -- 8. Resolve display names for assignment changes.
    IF p_changes ? 'supplier_id' THEN
        SELECT name INTO v_prev_supplier_name FROM suppliers WHERE id = v_old.supplier_id;
        SELECT name INTO v_new_supplier_name  FROM suppliers WHERE id = (p_changes->>'supplier_id')::UUID;
    END IF;
    IF p_changes ? 'designer_id' THEN
        SELECT name INTO v_prev_designer_name FROM users WHERE id = v_old.designer_id;
        SELECT name INTO v_new_designer_name  FROM users WHERE id = (p_changes->>'designer_id')::UUID;
    END IF;

    -- 9. Write one order_events row per changed field.
    FOREACH v_key IN ARRAY v_changed_keys LOOP
        -- Skip price/cost events directly, or log them as info if items is updated.
        IF v_key IN ('total_price', 'cost', 'design_price') THEN
            CONTINUE;
        END IF;

        v_event_type := CASE v_key
            WHEN 'patient_name'   THEN 'patient_name_changed'
            WHEN 'stl_url'        THEN 'stl_url_changed'
            WHEN 'images_url'     THEN 'images_url_changed'
            WHEN 'delivery_date'  THEN 'delivery_date_changed'
            WHEN 'is_urgent'      THEN 'urgency_changed'
            WHEN 'priority'       THEN 'priority_changed'
            WHEN 'supplier_id'    THEN 'supplier_changed'
            WHEN 'designer_id'    THEN 'designer_changed'
            WHEN 'instructions'   THEN 'instructions_changed'
            WHEN 'items'          THEN 'items_changed'
            ELSE 'order_field_changed'
        END;

        v_severity := CASE WHEN v_key IN ('supplier_id','designer_id') THEN 'warning' ELSE 'info' END;
        v_responsibility := CASE WHEN v_role = 'representative' THEN 'representative' ELSE NULL END;

        -- Scalar repr for the timeline UI.
        v_old_text := CASE v_key
            WHEN 'patient_name'   THEN v_old.patient_name
            WHEN 'stl_url'        THEN v_old.stl_url
            WHEN 'images_url'     THEN v_old.images_url
            WHEN 'delivery_date'  THEN v_old.delivery_date::TEXT
            WHEN 'is_urgent'      THEN v_old.is_urgent::TEXT
            WHEN 'priority'       THEN v_old.priority
            WHEN 'supplier_id'    THEN v_old.supplier_id::TEXT
            WHEN 'designer_id'    THEN v_old.designer_id::TEXT
            WHEN 'instructions'   THEN v_old.instructions
            WHEN 'items'          THEN v_old_items::TEXT
            ELSE NULL
        END;

        v_new_value := p_changes -> v_key;
        v_new_text := CASE jsonb_typeof(v_new_value)
            WHEN 'string'  THEN v_new_value #>> '{}'
            WHEN 'null'    THEN NULL
            WHEN 'boolean' THEN v_new_value::TEXT
            WHEN 'number'  THEN v_new_value::TEXT
            ELSE v_new_value::TEXT
        END;

        v_metadata := jsonb_build_object(
            'fieldName',   v_key,
            'oldValue',    to_jsonb(v_old_text),
            'newValue',    v_new_value,
            'reasonCode',  p_reason_code,
            'note',        p_reason_note,
            'source',      CASE v_role
                              WHEN 'representative' THEN 'representative_edit'
                              WHEN 'coordinator' THEN 'coordinator_edit'
                              WHEN 'admin' THEN 'admin_correction'
                              WHEN 'lab' THEN 'lab_operation'
                           END,
            'rpcVersion',  1,
            'actorUserId', v_user_id,
            'actorRole',   v_role
        );

        IF v_key = 'supplier_id' THEN
            v_metadata := v_metadata
                || jsonb_build_object(
                    'previousSupplierId',   v_old.supplier_id,
                    'newSupplierId',        (p_changes->>'supplier_id')::UUID,
                    'previousSupplierName', v_prev_supplier_name,
                    'newSupplierName',      v_new_supplier_name
                );
        ELSIF v_key = 'designer_id' THEN
            v_metadata := v_metadata
                || jsonb_build_object(
                    'previousDesignerId',   v_old.designer_id,
                    'newDesignerId',        (p_changes->>'designer_id')::UUID,
                    'previousDesignerName', v_prev_designer_name,
                    'newDesignerName',      v_new_designer_name
                );
        END IF;

        INSERT INTO order_events (
            order_id, event_type, old_value, new_value,
            changed_by, actor_role, reason, notes, severity,
            responsibility_party, metadata
        ) VALUES (
            p_order_id, v_event_type,
            CASE WHEN v_old_text IS NOT NULL THEN substring(v_old_text from 1 for 4000) ELSE NULL END,
            CASE WHEN v_new_text IS NOT NULL THEN substring(v_new_text from 1 for 4000) ELSE NULL END,
            v_user_id, v_role, p_reason_code, p_reason_note, v_severity,
            v_responsibility, v_metadata
        );
    END LOOP;

    -- Write a combined 'order_edit_applied' event for undelivered cases.
    v_metadata := jsonb_build_object(
        'changes', p_changes,
        'oldValues', jsonb_build_object(
            'patient_name', v_old.patient_name,
            'delivery_date', v_old.delivery_date::TEXT,
            'supplier_id', v_old.supplier_id::TEXT,
            'designer_id', v_old.designer_id::TEXT,
            'stl_url', v_old.stl_url,
            'images_url', v_old.images_url,
            'instructions', v_old.instructions,
            'items', v_old_items,
            'total_price', v_old.total_price::TEXT,
            'cost', v_old.cost::TEXT,
            'design_price', v_old.design_price::TEXT,
            'priority', v_old.priority,
            'is_urgent', v_old.is_urgent::TEXT
        ),
        'reasonCode', p_reason_code,
        'note', p_reason_note,
        'actorUserId', v_user_id,
        'actorRole', v_role
    );
    
    INSERT INTO order_events (
        order_id, event_type, approval_status, changed_by, actor_role, reason, notes, metadata
    ) VALUES (
        p_order_id, 'order_edit_applied', 'none', v_user_id, v_role, p_reason_code, p_reason_note, v_metadata
    );

    -- 10. Set tx-local audit flag for the trigger and apply UPDATE.
    PERFORM set_config('app.rep_audit_in_progress', 'true', true);

    UPDATE orders SET
        patient_name  = CASE WHEN p_changes ? 'patient_name'  THEN p_changes->>'patient_name'                       ELSE patient_name  END,
        stl_url       = CASE WHEN p_changes ? 'stl_url'       THEN NULLIF(p_changes->>'stl_url','')                 ELSE stl_url       END,
        images_url    = CASE WHEN p_changes ? 'images_url'    THEN NULLIF(p_changes->>'images_url','')              ELSE images_url    END,
        delivery_date = CASE WHEN p_changes ? 'delivery_date' THEN (p_changes->>'delivery_date')::DATE              ELSE delivery_date END,
        is_urgent     = CASE WHEN p_changes ? 'is_urgent'     THEN (p_changes->>'is_urgent')::BOOLEAN               ELSE is_urgent     END,
        priority      = CASE WHEN p_changes ? 'priority'      THEN p_changes->>'priority'                           ELSE priority      END,
        supplier_id   = CASE WHEN p_changes ? 'supplier_id'   THEN NULLIF(p_changes->>'supplier_id','')::UUID       ELSE supplier_id   END,
        designer_id   = CASE WHEN p_changes ? 'designer_id'   THEN NULLIF(p_changes->>'designer_id','')::UUID       ELSE designer_id   END,
        instructions  = CASE WHEN p_changes ? 'instructions'  THEN NULLIF(p_changes->>'instructions','')            ELSE instructions  END,
        items         = CASE WHEN p_changes ? 'items'         THEN p_changes->'items'                               ELSE items         END,
        total_price   = CASE WHEN p_changes ? 'total_price'   THEN (p_changes->>'total_price')::NUMERIC              ELSE total_price   END,
        cost          = CASE WHEN p_changes ? 'cost'          THEN (p_changes->>'cost')::NUMERIC                     ELSE cost          END,
        design_price  = CASE WHEN p_changes ? 'design_price'  THEN (p_changes->>'design_price')::NUMERIC             ELSE design_price  END
    WHERE id = p_order_id;

    -- Sync items to order_items table if present
    IF p_changes ? 'items' THEN
        DELETE FROM order_items WHERE order_id = p_order_id;

        IF jsonb_array_length(p_changes->'items') > 0 THEN
            INSERT INTO order_items (
                order_id,
                product_type,
                teeth_numbers,
                price,
                shade,
                count
            )
            SELECT
                p_order_id,
                COALESCE(x->>'product_type', x->>'serviceType'),
                COALESCE(x->'teeth_numbers', x->'teethNumbers'),
                (COALESCE(x->>'price', '0'))::numeric,
                x->>'shade',
                COALESCE(
                    (x->>'count')::int,
                    jsonb_array_length(COALESCE(x->'teeth_numbers', x->'teethNumbers')),
                    1
                )
            FROM jsonb_array_elements(p_changes->'items') t(x);
        END IF;
    END IF;

    -- 11. Reset flag (defense in depth; tx-local already self-clears).
    PERFORM set_config('app.rep_audit_in_progress', 'false', true);

    RETURN p_order_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_production_for_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_fallback UUID;
    v_jobs     UUID[] := ARRAY[]::UUID[];
    v_job      UUID;
    v_units    INTEGER;
    r          RECORD;
BEGIN
    IF public.get_my_role() NOT IN ('admin', 'production_manager') THEN
        RAISE EXCEPTION 'forbidden: admin or production manager role required' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id) THEN
        RAISE EXCEPTION 'order % not found', p_order_id USING ERRCODE = '22023';
    END IF;

    -- Idempotent: a second press returns what already exists rather than
    -- building the case twice.
    SELECT array_agg(id) INTO v_jobs
      FROM public.production_jobs
     WHERE order_id = p_order_id AND NOT is_backfilled;

    IF COALESCE(array_length(v_jobs, 1), 0) > 0 THEN
        RETURN jsonb_build_object('orderId', p_order_id, 'jobIds', v_jobs,
                                  'alreadyStarted', TRUE);
    END IF;

    v_jobs := ARRAY[]::UUID[];

    SELECT id INTO v_fallback FROM public.production_routes
     WHERE is_fallback AND is_active LIMIT 1;

    -- Group the order's lines by the route their service points at. Lines with
    -- no mapped service fall to the fallback, which is today's fully outsourced
    -- behaviour -- so a half-mapped order still produces a complete case.
    FOR r IN
        SELECT COALESCE(sv.route_id, v_fallback) AS route_id,
               SUM(COALESCE(oi.count, 1))::int   AS units,
               array_agg(oi.id)                  AS item_ids
          FROM public.order_items oi
          LEFT JOIN public.services sv ON sv.name = oi.product_type
         WHERE oi.order_id = p_order_id
         GROUP BY COALESCE(sv.route_id, v_fallback)
    LOOP
        IF r.route_id IS NULL THEN
            RAISE EXCEPTION 'no route for part of order % and no fallback route exists', p_order_id
                USING ERRCODE = '22023';
        END IF;

        v_units := GREATEST(r.units, 1);
        v_job := public.materialize_job_from_route(
            p_order_id, r.route_id, v_units,
            1 + COALESCE(array_length(v_jobs, 1), 0));

        -- materialize_job_from_route attaches every line on the order; keep
        -- only the ones that belong to this route's group.
        DELETE FROM public.production_job_items
         WHERE job_id = v_job AND NOT (order_item_id = ANY (r.item_ids));

        v_jobs := v_jobs || v_job;
    END LOOP;

    -- An order with no lines at all still needs a chain, or it can never be
    -- worked on and would silently disappear from the floor.
    IF COALESCE(array_length(v_jobs, 1), 0) = 0 THEN
        v_job := public.materialize_job_from_route(p_order_id, NULL, NULL, 1);
        v_jobs := ARRAY[v_job];
    END IF;

    RETURN jsonb_build_object('orderId', p_order_id, 'jobIds', v_jobs,
                              'jobCount', array_length(v_jobs, 1));
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_order_design_v2(p_order_id uuid, p_design_url text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := public.get_my_user_id();
    v_acts_as_designer BOOLEAN := public.get_my_role() = 'designer'
        OR (public.get_my_role() = 'representative' AND public.get_my_custom_permission('secondary_designer'));
    v_order public.orders%ROWTYPE;
    v_payload JSONB := jsonb_build_object('designUrl', btrim(p_design_url));
    v_command public.order_transition_commands%ROWTYPE;
    v_result JSONB;
BEGIN
    IF NOT public.workflow_flag_enabled('workflow_issue_v2_write') THEN RAISE EXCEPTION 'Workflow V2 writes are disabled'; END IF;
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authenticated user is required'; END IF;
    INSERT INTO public.order_transition_commands(idempotency_key, order_id, operation, requested_by, request_payload)
    VALUES (p_idempotency_key, p_order_id, 'submit_design', v_user_id, v_payload)
    ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT * INTO v_command FROM public.order_transition_commands WHERE idempotency_key = p_idempotency_key FOR UPDATE;
    IF v_command.order_id IS DISTINCT FROM p_order_id OR v_command.operation <> 'submit_design'
       OR v_command.request_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Idempotency key reuse mismatch'; END IF;
    IF v_command.completed_at IS NOT NULL THEN RETURN v_command.result_payload; END IF;
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
    IF v_acts_as_designer AND v_order.designer_id IS DISTINCT FROM v_user_id THEN
        RAISE EXCEPTION 'Designer is not assigned to this order';
    END IF;
    IF v_role NOT IN ('admin', 'production_manager') AND NOT v_acts_as_designer THEN
        RAISE EXCEPTION 'Role cannot submit a design';
    END IF;
    IF NULLIF(btrim(p_design_url), '') IS NULL THEN RAISE EXCEPTION 'Design URL is required'; END IF;
    IF v_order.design_submitted_at IS NOT NULL AND v_order.design_url = btrim(p_design_url) THEN
        v_result := jsonb_build_object('orderId', p_order_id, 'designSubmitted', TRUE, 'alreadyApplied', TRUE);
        UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
        RETURN v_result;
    END IF;
    IF v_order.production_status <> 'designing' OR COALESCE(v_order.issue_state, 'none') <> 'none' THEN
        RAISE EXCEPTION 'Order is not available for design submission';
    END IF;
    PERFORM set_config('app.order_issue_operation', 'submit_design', true);
    UPDATE public.orders SET
        design_url = btrim(p_design_url), design_status = 'completed',
        design_submitted_at = COALESCE(design_submitted_at, timezone('utc', now())),
        technician_status = 'Pending', production_status = 'in_production',
        status = 'Under Production', updated_at = timezone('utc', now())
    WHERE id = p_order_id;
    INSERT INTO public.order_events(order_id, event_type, changed_by, actor_role, severity, metadata)
    VALUES (p_order_id, 'design_submitted_to_lab', v_user_id, v_role, 'info',
        jsonb_build_object('idempotencyKey', p_idempotency_key, 'workflowVersion', 2));
    v_result := jsonb_build_object('orderId', p_order_id, 'designSubmitted', TRUE, 'alreadyApplied', FALSE);
    UPDATE public.order_transition_commands SET result_payload = v_result, completed_at = timezone('utc', now()) WHERE idempotency_key = p_idempotency_key;
    RETURN v_result;
END;
$function$;

-- ═══ RLS policies (24) ═══

DROP POLICY IF EXISTS "Staff can view adjustments" ON public.adjustments;
CREATE POLICY "Staff can view adjustments" ON public.adjustments
    AS PERMISSIVE FOR SELECT
    TO public
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'representative'::text, 'production_manager'::text])));

DROP POLICY IF EXISTS "Finance can read cutover baseline" ON public.cutover_financial_baseline;
CREATE POLICY "Finance can read cutover baseline" ON public.cutover_financial_baseline
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'production_manager'::text])));

DROP POLICY IF EXISTS "manage_external_work_orders" ON public.external_work_orders;
CREATE POLICY "manage_external_work_orders" ON public.external_work_orders
    AS PERMISSIVE FOR ALL
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text])));

DROP POLICY IF EXISTS "labor_rates_read" ON public.labor_rates;
CREATE POLICY "labor_rates_read" ON public.labor_rates
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "lab_manage_machine_downtime" ON public.machine_downtime;
CREATE POLICY "lab_manage_machine_downtime" ON public.machine_downtime
    AS PERMISSIVE FOR ALL
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text])));

DROP POLICY IF EXISTS "Staff can read batch usage" ON public.material_batch_usage;
CREATE POLICY "Staff can read batch usage" ON public.material_batch_usage
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text, 'technician'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Staff can read material batches" ON public.material_batches;
CREATE POLICY "Staff can read material batches" ON public.material_batches
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text, 'technician'::text, 'accountant'::text, 'coordinator'::text, 'designer'::text, 'representative'::text])));

DROP POLICY IF EXISTS "Staff can read material movements" ON public.material_movements;
CREATE POLICY "Staff can read material movements" ON public.material_movements
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text, 'technician'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Staff can read material purchase items" ON public.material_purchase_items;
CREATE POLICY "Staff can read material purchase items" ON public.material_purchase_items
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'production_manager'::text])));

DROP POLICY IF EXISTS "Staff can read material purchases" ON public.material_purchases;
CREATE POLICY "Staff can read material purchases" ON public.material_purchases
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'production_manager'::text])));

DROP POLICY IF EXISTS "Staff can read materials" ON public.materials;
CREATE POLICY "Staff can read materials" ON public.materials
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text, 'technician'::text, 'accountant'::text, 'coordinator'::text, 'designer'::text, 'representative'::text])));

DROP POLICY IF EXISTS "write_order_attachments" ON public.order_attachments;
CREATE POLICY "write_order_attachments" ON public.order_attachments
    AS PERMISSIVE FOR INSERT
    TO authenticated
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text, 'technician'::text, 'designer'::text, 'representative'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "order_issues_admin_lab_read" ON public.order_issues;
CREATE POLICY "order_issues_admin_lab_read" ON public.order_issues
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "order_issues_admin_lab_write" ON public.order_issues;
CREATE POLICY "order_issues_admin_lab_write" ON public.order_issues
    AS PERMISSIVE FOR ALL
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text])));

DROP POLICY IF EXISTS "manage_production_job_items" ON public.production_job_items;
CREATE POLICY "manage_production_job_items" ON public.production_job_items
    AS PERMISSIVE FOR ALL
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text])));

DROP POLICY IF EXISTS "services_select" ON public.services;
CREATE POLICY "services_select" ON public.services
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'designer'::text, 'production_manager'::text, 'representative'::text, 'doctor'::text])));

DROP POLICY IF EXISTS "Admins and lab manage shipment orders" ON public.shipment_orders;
CREATE POLICY "Admins and lab manage shipment orders" ON public.shipment_orders
    AS PERMISSIVE FOR ALL
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text, 'accountant'::text, 'coordinator'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Staff can read shipment orders" ON public.shipment_orders;
CREATE POLICY "Staff can read shipment orders" ON public.shipment_orders
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text, 'accountant'::text, 'coordinator'::text, 'technician'::text, 'receptionist'::text])));

DROP POLICY IF EXISTS "Admins and lab manage shipments" ON public.shipments;
CREATE POLICY "Admins and lab manage shipments" ON public.shipments
    AS PERMISSIVE FOR ALL
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text, 'accountant'::text, 'coordinator'::text])))
    WITH CHECK ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Staff can read shipments" ON public.shipments;
CREATE POLICY "Staff can read shipments" ON public.shipments
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text, 'accountant'::text, 'coordinator'::text, 'technician'::text, 'receptionist'::text])));

DROP POLICY IF EXISTS "Staff can read stage bindings" ON public.stage_material_bindings;
CREATE POLICY "Staff can read stage bindings" ON public.stage_material_bindings
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text, 'technician'::text, 'accountant'::text, 'coordinator'::text])));

DROP POLICY IF EXISTS "Admins read system warnings" ON public.system_warnings;
CREATE POLICY "Admins read system warnings" ON public.system_warnings
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text])));

DROP POLICY IF EXISTS "users_select" ON public.users;
CREATE POLICY "users_select" ON public.users
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (((get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'representative'::text, 'production_manager'::text, 'designer'::text])) OR ((get_my_role() = 'doctor'::text) AND (id = get_my_user_id()))));

DROP POLICY IF EXISTS "Staff can read warehouses" ON public.warehouses;
CREATE POLICY "Staff can read warehouses" ON public.warehouses
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING ((get_my_role() = ANY (ARRAY['admin'::text, 'production_manager'::text, 'technician'::text, 'accountant'::text, 'coordinator'::text, 'designer'::text, 'representative'::text])));

-- ═══ Route editing (decision 2) ═══
-- These two never mentioned 'lab', so the generated pass above did not
-- reach them. They were admin-only; the plan gives route design to the
-- production manager, because designing the chain of stages is what the
-- job is. Their refusal messages named 'admin' alone and now name both.

CREATE OR REPLACE FUNCTION public.create_production_stage(p_name_ar text, p_description_ar text DEFAULT NULL::text, p_execution text DEFAULT 'internal'::text, p_driven_by text DEFAULT 'my_tasks'::text, p_is_qc_gate boolean DEFAULT false, p_is_batch_stage boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_code TEXT;
    v_id   UUID;
    v_seq  INTEGER;
BEGIN
    IF public.get_my_role() NOT IN ('admin', 'production_manager') THEN
        RAISE EXCEPTION 'forbidden: admin or production manager role required' USING ERRCODE = '42501';
    END IF;

    IF COALESCE(TRIM(p_name_ar), '') = '' THEN
        RAISE EXCEPTION 'stage name is required' USING ERRCODE = '22023';
    END IF;

    -- A generated, collision-proof code. Never reuses a catalogue code, so the
    -- historical issue vocabulary keeps pointing at what it always pointed at.
    v_code := left('custom_' || replace(gen_random_uuid()::text, '-', ''), 20);

    -- New stages land after everything in the catalogue. Position inside a
    -- route comes from the route's own step order, not from this number.
    SELECT COALESCE(MAX(sequence), 0) + 10 INTO v_seq FROM public.production_stages;

    INSERT INTO public.production_stages
        (code, name_ar, description_ar, sequence, scope, default_execution,
         driven_by, is_qc_gate, is_batch_stage, required_fields)
    VALUES
        (v_code, TRIM(p_name_ar), NULLIF(TRIM(COALESCE(p_description_ar, '')), ''),
         v_seq, 'optional',
         CASE WHEN p_execution = 'external' THEN 'external' ELSE 'internal' END,
         CASE WHEN p_driven_by IN ('my_tasks', 'designer_dashboard', 'external_wo')
              THEN p_driven_by ELSE 'my_tasks' END,
         COALESCE(p_is_qc_gate, FALSE), COALESCE(p_is_batch_stage, FALSE),
         '[]'::jsonb)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_route_steps(p_route_id uuid, p_steps jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    e        JSONB;
    n        INTEGER := 0;
    v_stage  UUID;
    v_roles  TEXT[];
    v_count  INTEGER;
BEGIN
    IF public.get_my_role() NOT IN ('admin', 'production_manager') THEN
        RAISE EXCEPTION 'forbidden: admin or production manager role required' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.production_routes
                    WHERE id = p_route_id AND is_active) THEN
        RAISE EXCEPTION 'route % not found or inactive', p_route_id USING ERRCODE = '22023';
    END IF;

    IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' THEN
        RAISE EXCEPTION 'steps must be a JSON array' USING ERRCODE = '22023';
    END IF;

    IF jsonb_array_length(p_steps) = 0 THEN
        RAISE EXCEPTION 'a route must keep at least one step' USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.production_route_stages WHERE route_id = p_route_id;

    FOR e IN SELECT * FROM jsonb_array_elements(p_steps)
    LOOP
        n := n + 10;
        v_stage := NULLIF(e ->> 'stage_id', '')::uuid;

        IF v_stage IS NULL OR NOT EXISTS (
               SELECT 1 FROM public.production_stages
                WHERE id = v_stage AND is_active) THEN
            RAISE EXCEPTION 'step % refers to an unknown or inactive stage', n / 10
                USING ERRCODE = '22023';
        END IF;

        IF e ? 'condition' AND e -> 'condition' <> 'null'::jsonb
           AND jsonb_typeof(e -> 'condition') <> 'object' THEN
            RAISE EXCEPTION 'step % condition must be a JSON object', n / 10
                USING ERRCODE = '22023';
        END IF;

        v_roles := COALESCE(
            (SELECT array_agg(x) FROM jsonb_array_elements_text(
                 CASE WHEN jsonb_typeof(e -> 'allowed_roles') = 'array'
                      THEN e -> 'allowed_roles' ELSE '[]'::jsonb END) x),
            '{}'::text[]);

        INSERT INTO public.production_route_stages
            (route_id, stage_id, mode, step_no, variant_label, name_override,
             allowed_roles, driven_by, condition, execution_override, supplier_override,
             advance_mode, on_fail_goto_stage_id, parallel_group,
             standard_minutes_per_unit, standard_cost_per_unit)
        VALUES
            (p_route_id, v_stage, 'included', n,
             NULLIF(e ->> 'variant_label', ''),
             NULLIF(e ->> 'name_override', ''),
             v_roles,
             NULLIF(e ->> 'driven_by', ''),
             CASE WHEN e -> 'condition' IS NOT NULL
                   AND e -> 'condition' <> 'null'::jsonb
                  THEN e -> 'condition' END,
             NULLIF(e ->> 'execution', ''),
             NULLIF(e ->> 'supplier_id', '')::uuid,
             NULLIF(e ->> 'advance_mode', ''),
             NULLIF(e ->> 'on_fail_goto_stage_id', '')::uuid,
             NULLIF(e ->> 'parallel_group', '')::integer,
             NULLIF(e ->> 'standard_minutes_per_unit', '')::numeric,
             NULLIF(e ->> 'standard_cost_per_unit', '')::numeric);
    END LOOP;

    SELECT COUNT(*)::int INTO v_count
      FROM public.production_route_stages WHERE route_id = p_route_id;

    UPDATE public.production_routes
       SET version = version + 1
     WHERE id = p_route_id;

    RETURN v_count;
END;
$function$;

COMMIT;
