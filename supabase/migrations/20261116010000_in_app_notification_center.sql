-- In-app notifications from committed workflow changes. No historical backfill.
BEGIN;

CREATE TABLE public.in_app_notifications (
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
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX in_app_notifications_recipient_time
    ON public.in_app_notifications(recipient_id, created_at DESC, id DESC);

ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.in_app_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.in_app_notifications TO authenticated;

-- The designer workspace uses a projection, so access checks for its
-- notifications cannot rely on the caller being able to SELECT raw orders.
CREATE FUNCTION public.notification_matches_current_access(
    p_recipient uuid, p_role text, p_event text, p_entity uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT CASE
        WHEN p_recipient IS DISTINCT FROM public.get_my_user_id()
          OR p_role IS DISTINCT FROM public.get_my_role() THEN false
        WHEN p_event IN ('designer_assigned', 'design_returned_notes', 'design_review_decision') THEN EXISTS (
            SELECT 1 FROM public.orders o WHERE o.id = p_entity AND o.designer_id = p_recipient
                AND NOT coalesce(o.is_deleted, false) AND NOT coalesce(o.is_archived, false)
        )
        WHEN p_event IN ('print_task_assigned', 'print_reprint_requested') THEN EXISTS (
            SELECT 1 FROM public.production_stage_runs r
            JOIN public.production_jobs j ON j.id = r.job_id
            JOIN public.orders o ON o.id = j.order_id
            WHERE r.id = p_entity AND r.assignee_id = p_recipient
              AND NOT coalesce(o.is_deleted, false) AND NOT coalesce(o.is_archived, false)
        )
        ELSE true
    END;
$$;
REVOKE ALL ON FUNCTION public.notification_matches_current_access(uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_matches_current_access(uuid,text,text,uuid) TO authenticated;

CREATE POLICY notification_recipient_read ON public.in_app_notifications
    FOR SELECT TO authenticated
    USING (recipient_id = (SELECT public.get_my_user_id())
        AND public.notification_matches_current_access(recipient_id, recipient_role, event_type, entity_id));

CREATE FUNCTION public.get_in_app_notifications(p_limit integer DEFAULT 50, p_unread_only boolean DEFAULT false)
RETURNS TABLE (
    id uuid, event_type text, entity_type text, entity_id uuid, title text, summary text,
    action_url text, metadata jsonb, is_read boolean, read_at timestamptz, created_at timestamptz
)
LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT n.id, n.event_type, n.entity_type, n.entity_id, n.title, n.summary,
           n.action_url, n.metadata, n.is_read, n.read_at, n.created_at
    FROM public.in_app_notifications n
    WHERE NOT coalesce(p_unread_only, false) OR NOT n.is_read
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT greatest(1, least(coalesce(p_limit, 50), 100));
$$;

CREATE FUNCTION public.get_unread_notification_count()
RETURNS integer LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT count(*)::integer FROM public.in_app_notifications WHERE NOT is_read;
$$;

CREATE FUNCTION public.mark_notification_read(p_notification_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    UPDATE public.in_app_notifications n SET is_read = true, read_at = coalesce(read_at, clock_timestamp())
    WHERE n.id = p_notification_id AND n.recipient_id = (SELECT public.get_my_user_id())
      AND public.notification_matches_current_access(n.recipient_id, n.recipient_role, n.event_type, n.entity_id);
    RETURN FOUND;
END;
$$;

CREATE FUNCTION public.mark_all_notifications_read()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE marked integer;
BEGIN
    UPDATE public.in_app_notifications n SET is_read = true, read_at = clock_timestamp()
    WHERE NOT n.is_read AND n.recipient_id = (SELECT public.get_my_user_id())
      AND public.notification_matches_current_access(n.recipient_id, n.recipient_role, n.event_type, n.entity_id);
    GET DIAGNOSTICS marked = ROW_COUNT;
    RETURN marked;
END;
$$;

-- Only the trigger owner can call this function. Templates are built from
-- known fields; designer notifications never carry notes or cost metadata.
CREATE FUNCTION public.emit_workflow_notification(
    p_role text, p_recipient uuid, p_event text, p_type text, p_id uuid,
    p_occurrence text, p_title text, p_summary text, p_url text
) RETURNS void LANGUAGE sql SET search_path = '' AS $$
    INSERT INTO public.in_app_notifications
        (recipient_id, recipient_role, event_type, entity_type, entity_id, dedup_key, title, summary, action_url)
    SELECT u.id, u.role, p_event, p_type, p_id,
        concat_ws(':', p_event, u.id, p_id, p_occurrence), p_title, p_summary, p_url
    FROM public.users u
    WHERE coalesce(u.is_active, true) AND (p_role IS NULL OR u.role = p_role)
      AND (p_recipient IS NULL OR u.id = p_recipient)
      AND (p_type <> 'stage_run' OR u.role IN ('admin', 'coordinator', 'technician', 'production_manager'))
    ON CONFLICT (dedup_key) DO NOTHING;
$$;

CREATE FUNCTION public.notify_order_workflow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    entity text := 'الحالة ' || NEW.case_id;
    occurrence text := clock_timestamp()::text;
BEGIN
    IF coalesce(NEW.is_deleted, false) OR coalesce(NEW.is_archived, false) THEN RETURN NEW; END IF;

    IF NEW.designer_id IS NOT NULL AND NEW.designer_id IS DISTINCT FROM OLD.designer_id THEN
        PERFORM public.emit_workflow_notification('designer', NEW.designer_id, 'designer_assigned', 'order', NEW.id,
            occurrence, 'تم إسناد تصميم حالة إليك', entity, '/dashboard?order=' || NEW.id);
    END IF;

    IF NEW.production_status IN ('try_in_ready', 'final_ready')
       AND NEW.production_status IS DISTINCT FROM OLD.production_status THEN
        PERFORM public.emit_workflow_notification('coordinator', NULL, 'shipping_ready', 'order', NEW.id,
            occurrence, CASE WHEN NEW.production_status = 'try_in_ready' THEN 'بروفة جاهزة للشحن' ELSE 'حالة جاهزة للشحن النهائي' END,
            entity, '/production/shipments?order=' || NEW.id);
    END IF;

    IF NEW.issue_state = 'lab_rejected' AND NEW.issue_state IS DISTINCT FROM OLD.issue_state THEN
        PERFORM public.emit_workflow_notification('coordinator', NULL, 'rejection_followup', 'order', NEW.id,
            occurrence, 'رفض المعمل يحتاج متابعة', entity, '/orders?notificationOrder=' || NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.notify_design_qc_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    o public.orders%ROWTYPE;
    r public.design_revisions%ROWTYPE;
    reviewed_bypass boolean;
    notification_title text;
BEGIN
    SELECT * INTO o FROM public.orders WHERE id = NEW.order_id;
    IF NOT FOUND OR coalesce(o.is_deleted, false) OR coalesce(o.is_archived, false) THEN RETURN NEW; END IF;
    SELECT * INTO r FROM public.design_revisions WHERE id = NEW.revision_id AND order_id = o.id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    IF NEW.action = 'submitted' AND NEW.id = r.id AND r.requires_qc
       AND EXISTS (SELECT 1 FROM public.design_qc_control WHERE id AND enabled) THEN
        PERFORM public.emit_workflow_notification('admin', NULL, 'pending_design_qc', 'order', o.id,
            r.id::text, 'تصميم بانتظار المراجعة', 'الحالة ' || o.case_id, '/design-qc?order=' || o.id);
    ELSIF NEW.action = 'bypassed' THEN
        PERFORM public.emit_workflow_notification('admin', NULL, 'design_qc_bypassed', 'order', o.id,
            r.id::text, 'تم تجاوز فحص التصميم', 'الحالة ' || o.case_id, '/design-qc?order=' || o.id);
    ELSIF NEW.action = 'rejected' THEN
        SELECT EXISTS (SELECT 1 FROM public.design_qc_events e
            WHERE e.revision_id = r.id AND e.action = 'bypassed') INTO reviewed_bypass;
        PERFORM public.emit_workflow_notification('coordinator', NULL,
            CASE WHEN reviewed_bypass THEN 'admin_bypass_rejection' ELSE 'rejection_followup' END,
            'order', o.id, r.id::text, CASE WHEN reviewed_bypass THEN 'تم رفض تصميم بعد تجاوزه' ELSE 'رفض تصميم يحتاج متابعة' END,
            'الحالة ' || o.case_id, '/orders?notificationOrder=' || o.id);
    END IF;

    IF NEW.action = 'returned' AND o.designer_id IS NOT NULL THEN
        PERFORM public.emit_workflow_notification('designer', o.designer_id, 'design_returned_notes', 'order', o.id,
            r.id::text, 'مطلوب تعديل التصميم', 'الحالة ' || o.case_id || ' · راجع الملاحظات في الحالة', '/dashboard?order=' || o.id);
    ELSIF NEW.action IN ('approved', 'rejected', 'bypassed') AND r.submitted_by = o.designer_id THEN
        notification_title := CASE NEW.action WHEN 'approved' THEN 'تم اعتماد التصميم'
            WHEN 'rejected' THEN 'تم رفض التصميم' ELSE 'تم تجاوز فحص التصميم' END;
        PERFORM public.emit_workflow_notification('designer', o.designer_id, 'design_review_decision', 'order', o.id,
            r.id::text || ':' || NEW.action, notification_title, 'الحالة ' || o.case_id, '/dashboard?order=' || o.id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.notify_production_run()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    stage_code text;
    case_order public.orders%ROWTYPE;
    task_event text;
    occurrence text := clock_timestamp()::text;
BEGIN
    SELECT s.code INTO stage_code FROM public.production_stages s WHERE s.id = NEW.stage_id;
    IF stage_code NOT IN ('printing', 'cast_print', 'qc') THEN RETURN NEW; END IF;

    SELECT o.* INTO case_order FROM public.production_jobs j JOIN public.orders o ON o.id = j.order_id WHERE j.id = NEW.job_id;
    IF NOT FOUND OR coalesce(case_order.is_deleted, false) OR coalesce(case_order.is_archived, false) THEN RETURN NEW; END IF;

    IF stage_code = 'qc' THEN
        IF NEW.status = 'ready' AND NEW.status IS DISTINCT FROM OLD.status THEN
            PERFORM public.emit_workflow_notification('admin', NULL, 'pending_physical_qc', 'order', case_order.id,
                NEW.id::text || ':' || occurrence, 'حالة بانتظار الفحص الفعلي', 'الحالة ' || case_order.case_id,
                '/production/board?order=' || case_order.id);
        ELSIF NEW.physical_qc_bypassed_at IS NOT NULL AND NEW.physical_qc_bypassed_at IS DISTINCT FROM OLD.physical_qc_bypassed_at THEN
            PERFORM public.emit_workflow_notification('admin', NULL, 'physical_qc_bypassed', 'order', case_order.id,
                NEW.id::text || ':' || NEW.physical_qc_bypassed_at::text, 'تم تجاوز الفحص الفعلي', 'الحالة ' || case_order.case_id,
                '/production/board?order=' || case_order.id);
        ELSIF NEW.status = 'done' AND NEW.units_passed = 0 AND NEW.failure_cause_code IS NOT NULL
              AND NEW.status IS DISTINCT FROM OLD.status THEN
            PERFORM public.emit_workflow_notification('coordinator', NULL, 'rejection_followup', 'order', case_order.id,
                NEW.id::text || ':' || occurrence, 'حالة راسبة في الفحص الفعلي', 'الحالة ' || case_order.case_id,
                '/production/board?order=' || case_order.id);
        END IF;
    ELSIF NEW.assignee_id IS NOT NULL AND NEW.execution = 'internal' AND NEW.driven_by = 'my_tasks' AND NEW.status = 'ready'
          AND (NEW.assignee_id IS DISTINCT FROM OLD.assignee_id OR NEW.status IS DISTINCT FROM OLD.status) THEN
        task_event := CASE WHEN NEW.rework_of IS NULL THEN 'print_task_assigned' ELSE 'print_reprint_requested' END;
        PERFORM public.emit_workflow_notification(NULL, NEW.assignee_id, task_event, 'stage_run', NEW.id,
            occurrence, CASE WHEN NEW.rework_of IS NULL THEN 'مهمة طباعة مسندة إليك' ELSE 'طلب إعادة طباعة' END,
            'الحالة ' || case_order.case_id, '/production/my-tasks?run=' || NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.notify_shipping_attempt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.status IN ('failed', 'returned') AND NEW.status IS DISTINCT FROM OLD.status THEN
        PERFORM public.emit_workflow_notification('coordinator', NULL, 'delivery_failed_or_returned', 'shipment', NEW.id,
            coalesce(NEW.attempt_closed_at::text, NEW.status),
            CASE WHEN NEW.status = 'returned' THEN 'شحنة مرتجعة' ELSE 'تعذّر توصيل شحنة' END,
            'الشحنة ' || NEW.shipment_code, '/production/shipments?attempt=' || NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.notify_courier_invoice_draft()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.status = 'draft' AND (NEW.version IS DISTINCT FROM OLD.version OR NEW.status IS DISTINCT FROM OLD.status) THEN
        PERFORM public.emit_workflow_notification('admin', NULL, 'courier_invoice_reconciliation_pending', 'courier_monthly_invoice', NEW.id,
            NEW.version::text, 'فاتورة شحن بانتظار المطابقة', 'فاتورة ' || NEW.invoice_ref,
            '/accounts?tab=couriers&courier=' || NEW.courier_id || '&month=' || to_char(NEW.period_month, 'YYYY-MM'));
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER notify_order_workflow AFTER INSERT OR UPDATE OF designer_id, production_status, issue_state ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.notify_order_workflow();
CREATE TRIGGER notify_design_qc_event AFTER INSERT ON public.design_qc_events
    FOR EACH ROW EXECUTE FUNCTION public.notify_design_qc_event();
CREATE TRIGGER notify_production_run AFTER INSERT OR UPDATE OF assignee_id, status, physical_qc_bypassed_at ON public.production_stage_runs
    FOR EACH ROW EXECUTE FUNCTION public.notify_production_run();
CREATE TRIGGER notify_shipping_attempt AFTER UPDATE OF status ON public.shipments
    FOR EACH ROW EXECUTE FUNCTION public.notify_shipping_attempt();
CREATE TRIGGER notify_courier_invoice_draft AFTER INSERT OR UPDATE OF status, version ON public.courier_monthly_invoices
    FOR EACH ROW EXECUTE FUNCTION public.notify_courier_invoice_draft();

REVOKE ALL ON FUNCTION public.emit_workflow_notification(text,uuid,text,text,uuid,text,text,text,text),
    public.notify_order_workflow(), public.notify_design_qc_event(), public.notify_production_run(),
    public.notify_shipping_attempt(), public.notify_courier_invoice_draft(),
    public.get_in_app_notifications(integer,boolean), public.get_unread_notification_count(),
    public.mark_notification_read(uuid), public.mark_all_notifications_read()
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_in_app_notifications(integer,boolean), public.get_unread_notification_count(),
    public.mark_notification_read(uuid), public.mark_all_notifications_read() TO authenticated;

COMMIT;
