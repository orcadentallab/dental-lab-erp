-- Incident: imported CASE orders displaying 2026-07-30, investigated 2026-10-19.
-- SELECT only. Do not repair delivery dates: original dates remain in orders.

SELECT case_id, delivery_date, actual_delivery_date,
       first_delivered_at, first_delivered_source, accounting_registered_at
FROM public.orders
WHERE case_id IN (
    'CASE-1769820310810-18', 'CASE-1769820310810-17',
    'CASE-1768129706977-159', 'CASE-1771126616124-0',
    'CASE-1771119936390-4'
)
ORDER BY case_id;

-- Compare final-delivered statement dates before and after commit 70d9107.
-- Counts describe changed date selection, not necessarily billable/visible rows.
WITH dates AS (
    SELECT *,
        COALESCE(actual_delivery_date, delivery_date, created_at::date) AS original_date,
        COALESCE(actual_delivery_date, first_delivered_at::date, delivery_date, created_at::date) AS regressed_date
    FROM public.orders
)
SELECT case_id LIKE 'CASE-%' AS legacy_code, first_delivered_source,
       production_status, issue_state, count(*) AS cases,
       count(*) FILTER (WHERE original_date <> regressed_date) AS shifted_cases,
       count(*) FILTER (WHERE original_date <> regressed_date
                        AND regressed_date = '2026-07-30') AS shifted_to_july_30
FROM dates
GROUP BY 1, 2, 3, 4
ORDER BY shifted_cases DESC, cases DESC;

SELECT count(*) AS legacy_cases,
       count(*) FILTER (WHERE delivery_date IS NULL) AS missing_imported_date,
       count(*) FILTER (WHERE delivery_date = '2026-07-30') AS imported_date_july30,
       count(*) FILTER (WHERE actual_delivery_date = '2026-07-30') AS actual_date_july30,
       count(*) FILTER (WHERE updated_at >= '2026-10-19T00:00:00+03'::timestamptz) AS updated_since_incident_day
FROM public.orders WHERE case_id LIKE 'CASE-%';

SELECT count(*) AS obligations,
       count(*) FILTER (WHERE f.trigger_date = '2026-07-30') AS july30_trigger,
       count(*) FILTER (WHERE f.updated_at >= '2026-10-19T00:00:00+03'::timestamptz) AS updated_since_incident_day,
       count(*) FILTER (
           WHERE f.entity_type = 'doctor' AND f.status NOT IN ('void', 'written_off')
             AND f.trigger_date <> COALESCE(o.actual_delivery_date, o.delivery_date, o.created_at::date)
       ) AS active_doctor_date_mismatches
FROM public.financial_obligations f
JOIN public.orders o ON o.id = f.order_id
WHERE o.case_id LIKE 'CASE-%';

SELECT e.event_type, count(*) AS events,
       min(e.created_at) AS first_event, max(e.created_at) AS last_event
FROM public.order_events e JOIN public.orders o ON o.id = e.order_id
WHERE o.case_id LIKE 'CASE-%'
GROUP BY e.event_type ORDER BY events DESC;

SELECT version FROM supabase_migrations.schema_migrations
WHERE version IN ('20260808002000', '20260825001000', '20260828003000')
ORDER BY version;
