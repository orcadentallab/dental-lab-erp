-- Doctor portal lockdown (security fix, additive).
--
-- Found by code review against the migration chain:
--   1. case_files_read (storage) and read_order_attachments (table) accept any
--      signed-in role, so a doctor login could list and download every case
--      file, including kind = 'qc' internal QC photos.
--   2. The production tables (jobs, stage runs, external work orders, routes,
--      calendars, machines) use the same "any role" read policy, so a doctor
--      could read internal production data and external-lab work orders.
--   3. services_select lists 'doctor', so a doctor could read services.cost_price,
--      designer_price and milling_price (internal costs) straight from the API.
--   4. The doctors "view own profile" policy had no role term.
--
-- Not a hole (verified): doctors_select (20260914000000) does NOT include the
-- doctor role, so db.getDoctors() from a doctor login already returns only the
-- doctor's own row through "Doctors view own profile". The UI still asked for
-- the whole list, so the page is changed to stop asking.
--
-- Approach: restrictive policies are a backstop that no later permissive
-- "any role" policy can widen. Existing permissive policies are narrowed too.
-- Nothing is dropped except policies that are re-created in the same migration.

BEGIN;

-- 1. Case files -----------------------------------------------------------
-- Staff keep the broad read. A doctor may open only his own authorised case
-- files: the instruction files of a case in his scope (public.doctor_portal_owns_file
-- from 20261011010000 accepts only <order_id>/instruction/ paths of his own
-- orders). QC, packaging, design and issue files live under other path
-- segments, so they stay closed to doctors. Other buckets stay closed.
DROP POLICY IF EXISTS case_files_read ON storage.objects;
CREATE POLICY case_files_read ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'case-files' AND public.get_my_role() IS NOT NULL);

DROP POLICY IF EXISTS doctor_blocked_internal_buckets ON storage.objects;
CREATE POLICY doctor_blocked_internal_buckets ON storage.objects
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING (public.get_my_role() IS DISTINCT FROM 'doctor'
           OR (bucket_id IN ('case-files', 'case-scans') AND public.doctor_portal_owns_file(name)));

-- Table rows follow the same rule: a doctor sees only kind = 'instruction'
-- rows of a case in his scope. kind = 'qc' (and design, packaging, issue) is never returned.
DROP POLICY IF EXISTS read_order_attachments ON public.order_attachments;
CREATE POLICY read_order_attachments ON public.order_attachments
    FOR SELECT TO authenticated
    USING (public.get_my_role() IS NOT NULL);

-- 2. Backstop on internal tables ------------------------------------------
DROP POLICY IF EXISTS doctor_blocked_order_attachments ON public.order_attachments;
CREATE POLICY doctor_blocked_order_attachments ON public.order_attachments
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING (public.get_my_role() IS DISTINCT FROM 'doctor'
           OR (kind = 'instruction' AND public.doctor_portal_can_access_order(order_id)));

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'production_jobs', 'production_job_items',
        'production_stage_runs', 'external_work_orders', 'production_stages',
        'production_routes', 'production_route_stages', 'work_calendars',
        'work_shifts', 'work_breaks', 'work_exceptions', 'work_sessions',
        'machines', 'machine_downtime', 'doctor_retention_settings']
    LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'doctor_blocked_' || t, t);
            EXECUTE format(
                'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.get_my_role() IS DISTINCT FROM ''doctor'')',
                'doctor_blocked_' || t, t);
        END IF;
    END LOOP;
END $$;

-- 3. Own profile only, and only for a doctor login -------------------------
DROP POLICY IF EXISTS "Doctors view own profile" ON public.doctors;
CREATE POLICY "Doctors view own profile" ON public.doctors
    FOR SELECT TO authenticated
    USING (public.get_my_role() = 'doctor' AND id = public.get_my_entity_id());

-- 4. Services: doctors get a price list, never the cost columns ------------
DROP POLICY IF EXISTS "services_select" ON public.services;
CREATE POLICY "services_select" ON public.services
    AS PERMISSIVE FOR SELECT TO authenticated
    USING (public.get_my_role() = ANY (ARRAY['admin','accountant','coordinator','designer','production_manager','representative']));

CREATE OR REPLACE FUNCTION public.get_my_doctor_service_catalog()
RETURNS TABLE (id uuid, name text, family_id uuid, sort_order integer, price numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
    -- Price = the doctor's own custom price, or the center's when the doctor
    -- belongs to a center (same rule as getPricingDoctor in the client), or the
    -- catalog selling price. Only active services (is_active is read through to_jsonb so this applies whether or not the column exists in the target schema), only these five columns.
    SELECT s.id, s.name, s.family_id, s.sort_order,
           coalesce(
               nullif(pd.custom_prices ->> s.name, '')::numeric,
               s.selling_price)
    FROM public.services s
    JOIN public.doctors me ON me.id = public.get_my_entity_id()
    LEFT JOIN public.doctors pd ON pd.id = coalesce(me.parent_id, me.id)
    WHERE public.get_my_role() = 'doctor'
      AND coalesce((to_jsonb(s) ->> 'is_active')::boolean, true)
    ORDER BY s.sort_order NULLS LAST, s.name;
$$;
REVOKE ALL ON FUNCTION public.get_my_doctor_service_catalog() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_doctor_service_catalog() TO authenticated;

COMMIT;
