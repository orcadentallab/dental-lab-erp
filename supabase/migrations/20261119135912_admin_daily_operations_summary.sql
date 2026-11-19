BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE FUNCTION public.send_admin_daily_operations_summary(p_report_date date)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    window_start timestamptz := ((p_report_date - 1) + time '23:00') AT TIME ZONE 'Africa/Cairo';
    window_end timestamptz := (p_report_date + time '23:00') AT TIME ZONE 'Africa/Cairo';
    new_cases bigint;
    delivered_cases bigint;
    staff_actions bigint;
BEGIN
    IF p_report_date IS NULL THEN RETURN; END IF;

    SELECT count(*) INTO new_cases FROM public.orders
    WHERE created_at >= window_start AND created_at < window_end
      AND NOT coalesce(is_deleted, false);

    SELECT count(*) INTO delivered_cases FROM public.orders
    WHERE first_delivered_at >= window_start AND first_delivered_at < window_end
      AND first_delivered_source IN ('direct_transition', 'order_event', 'status_history', 'actual_delivery_date')
      AND NOT coalesce(is_deleted, false) AND issue_state IS DISTINCT FROM 'cancelled';

    -- Count recorded staff events; a single user interaction can write more
    -- than one business event (for example an order edit with multiple fields).
    SELECT count(*) INTO staff_actions
    FROM (
        SELECT e.changed_by AS actor_id
        FROM public.order_events e
        WHERE e.changed_at >= window_start AND e.changed_at < window_end
          AND e.actor_role IN ('admin','accountant','coordinator','designer','representative','production_manager','technician','employee')
        UNION ALL
        SELECT e.actor_id
        FROM public.design_qc_events e
        WHERE e.created_at >= window_start AND e.created_at < window_end
          AND e.actor_role IN ('admin','coordinator','designer','representative','production_manager','technician')
        UNION ALL
        SELECT e.actor_id
        FROM public.courier_invoice_events e
        WHERE e.created_at >= window_start AND e.created_at < window_end
    ) actions
    WHERE actions.actor_id IS NOT NULL;

    PERFORM public.emit_workflow_notification(
        'admin', NULL, 'daily_operations_summary', 'operations_day',
        md5('operations-summary:' || to_char(p_report_date, 'YYYY-MM-DD'))::uuid, '',
        'ملخص اليوم · ' || to_char(p_report_date, 'DD/MM/YYYY'),
        format('%s حالة جديدة · %s تسليم نهائي · %s حركة مسجّلة للموظفين',
            new_cases, delivered_cases, staff_actions),
        '/dashboard');
END;
$$;

REVOKE ALL ON FUNCTION public.send_admin_daily_operations_summary(date) FROM PUBLIC, anon, authenticated;

-- Check Cairo's local hour so the job follows daylight-saving transitions
-- regardless of the scheduler's configured timezone.
SELECT cron.schedule('erp-admin-daily-operations-summary', '0 * * * *', $job$
    SELECT public.send_admin_daily_operations_summary(cairo_now::date)
    FROM (SELECT statement_timestamp() AT TIME ZONE 'Africa/Cairo' AS cairo_now) clock
    WHERE extract(hour FROM cairo_now) = 23;
$job$);

COMMIT;
