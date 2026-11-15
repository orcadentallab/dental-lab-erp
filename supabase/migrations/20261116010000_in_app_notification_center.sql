-- Migration: In-app Notification Center (Decisions 81-85, B09, B14, B16)
-- Provides recipient-scoped notifications, idempotency, role-based starters, and privacy guards.
BEGIN;

CREATE TABLE IF NOT EXISTS public.in_app_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    recipient_role text NOT NULL,
    event_type text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    dedup_key text NOT NULL UNIQUE,
    title text NOT NULL,
    summary text NOT NULL,
    action_url text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_read boolean NOT NULL DEFAULT false,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_in_app_notifications_recipient_read
    ON public.in_app_notifications(recipient_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_in_app_notifications_dedup
    ON public.in_app_notifications(dedup_key);

ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own notifications" ON public.in_app_notifications;
CREATE POLICY "Users view own notifications"
    ON public.in_app_notifications
    FOR SELECT
    TO authenticated
    USING (recipient_id = public.get_my_user_id());

DROP POLICY IF EXISTS "Users update own notifications read state" ON public.in_app_notifications;
CREATE POLICY "Users update own notifications read state"
    ON public.in_app_notifications
    FOR UPDATE
    TO authenticated
    USING (recipient_id = public.get_my_user_id())
    WITH CHECK (recipient_id = public.get_my_user_id());

-- Security Definer Notification Core Helper
CREATE OR REPLACE FUNCTION public.create_in_app_notification(
    p_recipient_id uuid,
    p_recipient_role text,
    p_event_type text,
    p_entity_type text,
    p_entity_id uuid,
    p_dedup_key text,
    p_title text,
    p_summary text,
    p_action_url text,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_active boolean;
    v_clean_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
    v_clean_summary text := btrim(p_summary);
    v_notification_id uuid;
BEGIN
    -- Check recipient exists and is active (deactivated accounts receive no notifications)
    SELECT is_active INTO v_active FROM public.users WHERE id = p_recipient_id;
    IF NOT FOUND OR NOT coalesce(v_active, true) THEN
        RETURN NULL;
    END IF;

    -- Strict Privacy Guard: If recipient is designer, forbid supplier name, lab costs, selling prices
    IF p_recipient_role = 'designer' THEN
        v_clean_metadata := v_clean_metadata - 'supplier_name' - 'supplier_id' - 'lab_cost' - 'selling_price' - 'total_price' - 'cost';
        v_clean_summary := regexp_replace(v_clean_summary, 'معمل [^\s]+', 'المعمل', 'gi');
    END IF;

    INSERT INTO public.in_app_notifications (
        recipient_id, recipient_role, event_type, entity_type, entity_id,
        dedup_key, title, summary, action_url, metadata
    )
    VALUES (
        p_recipient_id, p_recipient_role, p_event_type, p_entity_type, p_entity_id,
        p_dedup_key, btrim(p_title), v_clean_summary, btrim(p_action_url), v_clean_metadata
    )
    ON CONFLICT (dedup_key) DO NOTHING
    RETURNING id INTO v_notification_id;

    RETURN v_notification_id;
END;
$$;

-- Security Definer Role Broadcaster Helper
CREATE OR REPLACE FUNCTION public.emit_role_notifications(
    p_role text,
    p_event_type text,
    p_entity_type text,
    p_entity_id uuid,
    p_dedup_suffix text,
    p_title text,
    p_summary text,
    p_action_url text,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    u record;
    v_count integer := 0;
    v_dedup text;
BEGIN
    FOR u IN
        SELECT id, role FROM public.users
        WHERE role = p_role AND coalesce(is_active, true)
    LOOP
        v_dedup := p_event_type || ':' || u.id::text || ':' || p_entity_id::text || ':' || coalesce(p_dedup_suffix, '');
        PERFORM public.create_in_app_notification(
            u.id, u.role, p_event_type, p_entity_type, p_entity_id,
            v_dedup, p_title, p_summary, p_action_url, p_metadata
        );
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;

-- Read API for Client
CREATE OR REPLACE FUNCTION public.get_in_app_notifications(
    p_limit integer DEFAULT 50,
    p_unread_only boolean DEFAULT false
)
RETURNS TABLE (
    id uuid,
    event_type text,
    entity_type text,
    entity_id uuid,
    title text,
    summary text,
    action_url text,
    metadata jsonb,
    is_read boolean,
    read_at timestamptz,
    created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid uuid := public.get_my_user_id();
BEGIN
    IF v_uid IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT n.id, n.event_type, n.entity_type, n.entity_id, n.title, n.summary,
           n.action_url, n.metadata, n.is_read, n.read_at, n.created_at
    FROM public.in_app_notifications n
    WHERE n.recipient_id = v_uid
      AND (NOT p_unread_only OR NOT n.is_read)
    ORDER BY n.created_at DESC
    LIMIT greatest(1, least(p_limit, 100));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_unread_notification_count()
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid uuid := public.get_my_user_id();
    v_count integer;
BEGIN
    IF v_uid IS NULL THEN
        RETURN 0;
    END IF;

    SELECT count(*)::integer INTO v_count
    FROM public.in_app_notifications
    WHERE recipient_id = v_uid AND NOT is_read;

    RETURN coalesce(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid uuid := public.get_my_user_id();
BEGIN
    IF v_uid IS NULL THEN
        RETURN false;
    END IF;

    UPDATE public.in_app_notifications
    SET is_read = true, read_at = now()
    WHERE id = p_notification_id AND recipient_id = v_uid;

    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid uuid := public.get_my_user_id();
    v_count integer;
BEGIN
    IF v_uid IS NULL THEN
        RETURN 0;
    END IF;

    WITH updated AS (
        UPDATE public.in_app_notifications
        SET is_read = true, read_at = now()
        WHERE recipient_id = v_uid AND NOT is_read
        RETURNING id
    )
    SELECT count(*)::integer INTO v_count FROM updated;

    RETURN coalesce(v_count, 0);
END;
$$;

-- Starter Event Hooks:
-- 1. Failed / returned delivery -> Coordinator
CREATE OR REPLACE FUNCTION pg_temp.hook_failed_shipment_notification() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    d text := pg_get_functiondef('public.close_shipping_attempt(uuid,text,text,numeric,uuid)'::regprocedure);
BEGIN
    IF strpos(d, 'emit_role_notifications') = 0 THEN
        d := replace(d, 'WHERE id=p_id;', $hook$WHERE id=p_id;
    IF p_outcome IN ('failed', 'returned') THEN
        PERFORM public.emit_role_notifications(
            'coordinator', 'delivery_failed_or_returned', 'shipment', p_id, p_outcome || ':' || coalesce(trip.attempt_closed_at, now())::text,
            'فشل توصيل شحنة', 'محاولة الشحن ' || trip.shipment_code || ' (' || CASE WHEN p_outcome='returned' THEN 'مرتجع' ELSE 'فشل تسليم' END || ') — سبب: ' || btrim(p_reason),
            '/production/shipments', jsonb_build_object('shipment_code', trip.shipment_code, 'outcome', p_outcome, 'reason', btrim(p_reason))
        );
    END IF;$hook$);
        EXECUTE d;
    END IF;
END;
$$;
SELECT pg_temp.hook_failed_shipment_notification();

-- 2. Courier Monthly Invoice Draft -> Admin
CREATE OR REPLACE FUNCTION pg_temp.hook_courier_invoice_notification() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    d text := pg_get_functiondef('public.save_courier_monthly_invoice(uuid,date,text,numeric,numeric,jsonb,boolean,integer,text)'::regprocedure);
BEGIN
    IF strpos(d, 'emit_role_notifications') = 0 THEN
        d := replace(d, 'RETURN saved.id;', $hook$
    IF NOT p_confirm THEN
        PERFORM public.emit_role_notifications(
            'admin', 'courier_invoice_reconciliation_pending', 'courier_monthly_invoice', saved.id, saved.version::text,
            'فاتورة شحن بانتظار المطابقة', 'فاتورة شركة الشحن لشهر ' || to_char(month_start, 'YYYY-MM') || ' برقم ' || saved.invoice_ref || ' جاهزة للمطابقة والاعتماد.',
            '/finance/couriers', jsonb_build_object('invoice_id', saved.id, 'invoice_ref', saved.invoice_ref, 'month', month_start)
        );
    END IF;
    RETURN saved.id;$hook$);
        EXECUTE d;
    END IF;
END;
$$;
SELECT pg_temp.hook_courier_invoice_notification();

-- 3. Design QC Bypass & Review Hooks
CREATE OR REPLACE FUNCTION pg_temp.hook_design_qc_notifications() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    d text;
BEGIN
    -- Hook bypass_and_release_design_revision: emit bypass to admin
    d := pg_get_functiondef('public.bypass_and_release_design_revision(uuid,text,uuid)'::regprocedure);
    IF strpos(d, 'design_qc_bypassed') = 0 THEN
        d := replace(d, 'PERFORM public.release_design_revision(v_rev.order_id);', $hook$
        PERFORM public.release_design_revision(v_rev.order_id);
        PERFORM public.emit_role_notifications(
            'admin', 'design_qc_bypassed', 'order', v_rev.order_id, v_rev.id::text,
            'تجاوز فحص التصميم', 'تم تجاوز فحص التصميم للنسخة رقم ' || v_rev.revision_no || ' — سبب: ' || btrim(p_note),
            '/production/design-qc?orderId=' || v_rev.order_id::text, jsonb_build_object('order_id', v_rev.order_id, 'revision_id', v_rev.id, 'reason', btrim(p_note))
        );$hook$);
        EXECUTE d;
    END IF;

    -- Hook decide_design_revision: decision to submitting designer
    d := pg_get_functiondef('public.decide_design_revision(uuid,text,text,uuid)'::regprocedure);
    IF strpos(d, 'design_review_decision') = 0 THEN
        d := replace(d, 'RETURN p_event_id::text;', $hook$
        IF v_order.designer_id IS NOT NULL THEN
            PERFORM public.create_in_app_notification(
                v_order.designer_id, 'designer', 'design_review_decision', 'order', v_rev.order_id,
                'design_review_decision:' || v_order.designer_id::text || ':' || v_rev.id::text || ':' || p_action,
                'نتيجة مراجعة التصميم', 'تم ' || CASE WHEN p_action='approved' THEN 'اعتماد' WHEN p_action='rejected' THEN 'رفض' ELSE 'تجاوز' END || ' تصميم الحالة #' || coalesce(v_order.case_id, ''),
                '/dashboard', jsonb_build_object('order_id', v_rev.order_id, 'case_id', v_order.case_id, 'action', p_action)
            );
        END IF;
        RETURN p_event_id::text;$hook$);
        EXECUTE d;
    END IF;
END;
$$;
SELECT pg_temp.hook_design_qc_notifications();

-- 4. Physical QC Bypass Hook -> Admin
CREATE OR REPLACE FUNCTION pg_temp.hook_physical_qc_notifications() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    d text := pg_get_functiondef('public.mixed_physical_qc_action(uuid,text,text)'::regprocedure);
BEGIN
    IF strpos(d, 'physical_qc_bypassed') = 0 THEN
        d := replace(d, 'VALUES (target_order,CASE WHEN p_action=''bypass'' THEN ''physical_qc_bypassed''', $hook$
        IF p_action = 'bypass' THEN
            PERFORM public.emit_role_notifications(
                'admin', 'physical_qc_bypassed', 'order', target_order, p_run::text,
                'تجاوز الفحص الفعلي', 'تم تجاوز الفحص الفعلي للأوردر — سبب: ' || btrim(p_reason),
                '/production/board', jsonb_build_object('order_id', target_order, 'run_id', p_run, 'reason', btrim(p_reason))
            );
        END IF;
        INSERT INTO public.order_events(order_id,event_type,changed_by,actor_role,notes,severity,metadata)
        VALUES (target_order,CASE WHEN p_action='bypass' THEN 'physical_qc_bypassed'$hook$);
        EXECUTE d;
    END IF;
END;
$$;
SELECT pg_temp.hook_physical_qc_notifications();

-- 5. Trigger for Print Task Assignment and Reprint Requests
CREATE OR REPLACE FUNCTION public.trigger_stage_run_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_stage_code text;
    v_stage_name text;
    v_case_id text;
    v_order_id uuid;
BEGIN
    SELECT code, name_ar INTO v_stage_code, v_stage_name
    FROM public.production_stages WHERE id = NEW.stage_id;

    SELECT o.id, o.case_id INTO v_order_id, v_case_id
    FROM public.production_jobs j JOIN public.orders o ON o.id = j.order_id
    WHERE j.id = NEW.job_id;

    -- Print task assigned to internal assignee
    IF (v_stage_code = 'cast_print' OR v_stage_name LIKE '%طباعة%')
       AND NEW.assignee_id IS NOT NULL AND (OLD.assignee_id IS DISTINCT FROM NEW.assignee_id) THEN
        PERFORM public.create_in_app_notification(
            NEW.assignee_id, 'technician', 'print_task_assigned', 'order', v_order_id,
            'print_task_assigned:' || NEW.assignee_id::text || ':' || NEW.id::text,
            'مهمة طباعة مسندة إليك', 'تم إسناد مهمة طباعة للحالة #' || coalesce(v_case_id, ''),
            '/production/tasks', jsonb_build_object('order_id', v_order_id, 'case_id', v_case_id, 'stage_id', NEW.stage_id)
        );
    END IF;

    -- Reprint requested (rework run created)
    IF (v_stage_code = 'cast_print' OR v_stage_name LIKE '%طباعة%')
       AND NEW.rework_of IS NOT NULL AND TG_OP = 'INSERT' THEN
        IF NEW.assignee_id IS NOT NULL THEN
            PERFORM public.create_in_app_notification(
                NEW.assignee_id, 'technician', 'print_reprint_requested', 'order', v_order_id,
                'print_reprint_requested:' || NEW.assignee_id::text || ':' || NEW.id::text,
                'طلب إعادة طباعة', 'مطلوب إعادة طباعة للحالة #' || coalesce(v_case_id, ''),
                '/production/tasks', jsonb_build_object('order_id', v_order_id, 'case_id', v_case_id, 'rework_of', NEW.rework_of)
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stage_run_notifications ON public.production_stage_runs;
CREATE TRIGGER trg_stage_run_notifications
    AFTER INSERT OR UPDATE OF assignee_id ON public.production_stage_runs
    FOR EACH ROW EXECUTE FUNCTION public.trigger_stage_run_notifications();

-- 6. Trigger for Order Assignment to Designer and Shipping Ready
CREATE OR REPLACE FUNCTION public.trigger_order_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    -- Designer Assignment
    IF NEW.designer_id IS NOT NULL AND (OLD.designer_id IS DISTINCT FROM NEW.designer_id) THEN
        PERFORM public.create_in_app_notification(
            NEW.designer_id, 'designer', 'designer_assigned', 'order', NEW.id,
            'designer_assigned:' || NEW.designer_id::text || ':' || NEW.id::text,
            'تم إسناد تصميم حالة جديدة إليك', 'تم إسناد تصميم الحالة #' || coalesce(NEW.case_id, '') || ' إليك.',
            '/dashboard', jsonb_build_object('order_id', NEW.id, 'case_id', NEW.case_id)
        );
    END IF;

    -- Shipping Ready -> Coordinator
    IF (NEW.production_status IN ('final_ready', 'ready_for_shipping') OR NEW.status = 'Ready')
       AND (OLD.production_status IS DISTINCT FROM NEW.production_status OR OLD.status IS DISTINCT FROM NEW.status) THEN
        PERFORM public.emit_role_notifications(
            'coordinator', 'shipping_ready', 'order', NEW.id,
            coalesce(NEW.production_status, NEW.status, 'ready'),
            'طلب جاهز للشحن', 'الحالة #' || coalesce(NEW.case_id, '') || ' أصبحت جاهزة للشحن والتجهيز.',
            '/production/shipments', jsonb_build_object('order_id', NEW.id, 'case_id', NEW.case_id, 'delivery_type', NEW.delivery_type)
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_notifications ON public.orders;
CREATE TRIGGER trg_order_notifications
    AFTER INSERT OR UPDATE OF designer_id, production_status, status ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.trigger_order_notifications();

REVOKE ALL ON TABLE public.in_app_notifications FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON TABLE public.in_app_notifications TO authenticated;

REVOKE ALL ON FUNCTION public.create_in_app_notification(uuid, text, text, text, uuid, text, text, text, text, jsonb),
    public.emit_role_notifications(text, text, text, uuid, text, text, text, text, jsonb),
    public.get_in_app_notifications(integer, boolean),
    public.get_unread_notification_count(),
    public.mark_notification_read(uuid),
    public.mark_all_notifications_read() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_in_app_notifications(integer, boolean),
    public.get_unread_notification_count(),
    public.mark_notification_read(uuid),
    public.mark_all_notifications_read() TO authenticated;

COMMIT;
