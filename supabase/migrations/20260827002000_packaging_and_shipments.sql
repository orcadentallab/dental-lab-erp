-- Migration: 20260827002000_packaging_and_shipments.sql
-- Description: Phase 4: Packaging, Shipments, and Delivery Integration
--
-- This migration implements:
--   1. shipments: shipments metadata, courier assignment, tracking, proof photos, timestamps.
--   2. shipment_orders: N:1 and M:N linkage between orders and shipments.
--   3. RPCs for atomic shipment creation, dispatch, and delivery confirmation.
--   4. RLS policies and role-based access control with anon exclusion.

BEGIN;

-- ─── 1. Shipments Table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_code TEXT NOT NULL UNIQUE,
    courier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL,
    tracking_ref TEXT,
    status TEXT NOT NULL DEFAULT 'ready_for_pickup'
        CHECK (status IN ('packing', 'ready_for_pickup', 'dispatched', 'delivered', 'returned', 'cancelled')),
    packed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    packed_at TIMESTAMPTZ DEFAULT now(),
    packing_proof_urls TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    requested_at TIMESTAMPTZ DEFAULT now(),
    dispatched_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    delivery_proof_url TEXT,
    cost_amount NUMERIC(12,2) DEFAULT NULL,
    recipient_name TEXT,
    recipient_phone TEXT,
    delivery_address TEXT,
    notes TEXT,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 2. Shipment Orders Linkage ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shipment_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_shipment_order UNIQUE (shipment_id, order_id)
);

-- ─── 3. Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_shipments_status ON public.shipments(status);
CREATE INDEX IF NOT EXISTS idx_shipments_courier_id ON public.shipments(courier_id);
CREATE INDEX IF NOT EXISTS idx_shipments_doctor_id ON public.shipments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_shipments_created_at ON public.shipments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipment_orders_shipment_id ON public.shipment_orders(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_orders_order_id ON public.shipment_orders(order_id);

-- Sequence for human-readable shipment codes
CREATE SEQUENCE IF NOT EXISTS public.shipment_code_seq START WITH 1001;

CREATE OR REPLACE FUNCTION public.generate_shipment_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN 'SHP-' || to_char(now(), 'YYMM') || '-' || lpad(nextval('public.shipment_code_seq')::text, 4, '0');
END;
$$;

-- ─── 4. RPC: Create Shipment ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_shipment(
    p_courier_id UUID,
    p_doctor_id UUID,
    p_tracking_ref TEXT,
    p_order_ids UUID[],
    p_packing_proof_urls TEXT[] DEFAULT '{}'::TEXT[],
    p_recipient_name TEXT DEFAULT NULL,
    p_recipient_phone TEXT DEFAULT NULL,
    p_delivery_address TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    IF v_role NOT IN ('admin', 'lab', 'accountant', 'technician') THEN
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
$$;

-- ─── 5. RPC: Dispatch Shipment ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dispatch_shipment(
    p_shipment_id UUID,
    p_tracking_ref TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_shipment public.shipments%ROWTYPE;
BEGIN
    IF v_role NOT IN ('admin', 'lab', 'accountant') THEN
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
$$;

-- ─── 6. RPC: Confirm Shipment Delivery ───────────────────────────────────────────
-- ⚠️ THE MOST FINANCIALLY DANGEROUS STEP IN THE PLAN (section 4.5).
--
-- Confirming a shipment delivered is what creates the doctor's receivable. It
-- MUST travel the existing route -- record_order_final_delivery_v2, which sets
-- first_delivered_at and lets sync_order_financial_obligations raise the
-- doctor_delivered obligation -- and never a parallel one. An earlier draft
-- updated only the shipment row, so the screen said "تم تأكيد التسليم بنجاح"
-- while the order stayed undelivered and the doctor was never billed.
--
-- Roles are admin/lab only, matching record_order_final_delivery_v2. An
-- accountant confirming here would have hit that RPC's own role check midway
-- and aborted the whole shipment.
CREATE OR REPLACE FUNCTION public.confirm_shipment_delivery(
    p_shipment_id UUID,
    p_delivery_proof_url TEXT DEFAULT NULL,
    p_delivered_at TIMESTAMPTZ DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    IF v_role NOT IN ('admin', 'lab') THEN
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
$$;

COMMENT ON FUNCTION public.confirm_shipment_delivery(UUID, TEXT, TIMESTAMPTZ, TEXT) IS
'Confirms delivery of a shipment and bills each order through record_order_final_delivery_v2 -- the existing first_delivered_at -> doctor_delivered path (plan 4.5). Never writes financial_obligations directly. Idempotent per (shipment, order).';

-- ─── 6b. RPC: Reconcile the courier's monthly invoice ───────────────────────────
--
-- Plan 4.5: shipments.cost_amount stays NULL until the courier's monthly
-- invoice arrives, because the real cost is monthly and not per-shipment. That
-- left a nullable column with nothing able to fill it. This spreads one invoice
-- across the delivered shipments of one courier in one month, which is the only
-- allocation the data actually supports -- and it says so, rather than pretending
-- each shipment was separately priced.
CREATE OR REPLACE FUNCTION public.reconcile_courier_invoice(
    p_courier_id UUID,
    p_period_month DATE,
    p_invoice_total NUMERIC,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_start DATE;
    v_end DATE;
    v_count INT := 0;
    v_per_shipment NUMERIC;
BEGIN
    IF v_role NOT IN ('admin', 'accountant') THEN
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
$$;

-- ─── 7. RPC: Cancel Shipment ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_shipment(
    p_shipment_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_shipment public.shipments%ROWTYPE;
BEGIN
    IF v_role NOT IN ('admin', 'lab', 'accountant') THEN
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
$$;

-- ─── 8. RLS Policies ─────────────────────────────────────────────────────────────
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_orders ENABLE ROW LEVEL SECURITY;

-- 'doctor' is deliberately NOT on this list.
--
-- A shipment row carries the courier, the cost, and the recipient name, phone
-- and address of whoever it is going to. The role was listed here unscoped,
-- which would have let any logged-in doctor read every other doctor's contact
-- details -- and there is no doctor scoping to lean on: users has no doctor_id
-- and orders has no doctor RLS policy, so there is no honest way to write
-- "their own shipments" today.
--
-- The doctor portal is plan section 8, and it says the doctor sees the STAGE
-- only -- no technicians, no costs, no suppliers. When it is built it gets a
-- purpose-shaped view, not this table.
DROP POLICY IF EXISTS "Staff can read shipments" ON public.shipments;
CREATE POLICY "Staff can read shipments" ON public.shipments
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'lab', 'accountant', 'technician', 'receptionist'));

DROP POLICY IF EXISTS "Admins and lab manage shipments" ON public.shipments;
CREATE POLICY "Admins and lab manage shipments" ON public.shipments
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('admin', 'lab', 'accountant'))
    WITH CHECK (public.get_my_role() IN ('admin', 'lab', 'accountant'));

DROP POLICY IF EXISTS "Staff can read shipment orders" ON public.shipment_orders;
-- Same reasoning as the shipments policy above: no doctor scoping exists, so
-- no doctor read.
CREATE POLICY "Staff can read shipment orders" ON public.shipment_orders
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'lab', 'accountant', 'technician', 'receptionist'));

DROP POLICY IF EXISTS "Admins and lab manage shipment orders" ON public.shipment_orders;
CREATE POLICY "Admins and lab manage shipment orders" ON public.shipment_orders
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('admin', 'lab', 'accountant'))
    WITH CHECK (public.get_my_role() IN ('admin', 'lab', 'accountant'));

-- ─── 9. Security Definer Grants Hardening ───────────────────────────────────────
REVOKE ALL ON FUNCTION public.create_shipment(UUID, UUID, TEXT, UUID[], TEXT[], TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dispatch_shipment(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_shipment_delivery(UUID, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_shipment(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reconcile_courier_invoice(UUID, DATE, NUMERIC, TEXT) FROM PUBLIC, anon;
-- Burns a sequence value on every call; not something anon should be able to do.
REVOKE ALL ON FUNCTION public.generate_shipment_code() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_shipment(UUID, UUID, TEXT, UUID[], TEXT[], TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_shipment(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_shipment_delivery(UUID, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_shipment(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_courier_invoice(UUID, DATE, NUMERIC, TEXT) TO authenticated;

COMMIT;
