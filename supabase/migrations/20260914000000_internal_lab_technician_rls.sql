-- Migration: 20260914000000_internal_lab_technician_rls.sql
-- Purpose: Unblock technician and production manager visibility for internal lab execution.
--
-- RUN_CARD_SELECT (src/services/supabase/production.ts:458) embeds orders, doctors,
-- users, and suppliers. Supabase evaluates RLS per embed and returns NULL silently
-- if any table is blocked.
--
-- Changes:
--   1. orders_select: Add production_manager (full visibility) and technician (orders
--      with a job in 'queued', 'active', 'blocked', 'done').
--   2. doctors_select: Add production_manager and technician.
--   3. suppliers_select: Add production_manager and technician.
--   4. users_select: Add technician (production_manager was already added).
-- Note: orders_update deliberately excludes technician and production_manager;
-- stage movements occur via SECURITY DEFINER RPCs (start_stage_run / complete_stage_run).

BEGIN;

-- 1. orders_select
DROP POLICY IF EXISTS "orders_select" ON public.orders;
CREATE POLICY "orders_select" ON public.orders
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (
        (get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'production_manager'::text]))
        OR ((get_my_role() = 'designer'::text) AND (designer_id = get_my_user_id()))
        OR (get_my_role() = ANY (ARRAY['representative'::text, 'coordinator'::text]))
        OR ((get_my_role() = 'lab'::text) AND (supplier_id = get_my_entity_id()))
        OR (
            (get_my_role() = 'technician'::text)
            AND EXISTS (
                SELECT 1 FROM public.production_jobs pj
                WHERE pj.order_id = orders.id
                  AND pj.status IN ('queued', 'active', 'blocked', 'done')
            )
        )
    );

-- 2. doctors_select
DROP POLICY IF EXISTS "doctors_select" ON public.doctors;
CREATE POLICY "doctors_select" ON public.doctors
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (
        (get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'representative'::text, 'designer'::text, 'production_manager'::text, 'technician'::text]))
        OR (
            (get_my_role() = 'lab'::text)
            AND EXISTS (
                SELECT 1 FROM public.orders
                WHERE orders.doctor_id = doctors.id
                  AND orders.supplier_id = get_my_entity_id()
            )
        )
    );

-- 3. suppliers_select
DROP POLICY IF EXISTS "suppliers_select" ON public.suppliers;
CREATE POLICY "suppliers_select" ON public.suppliers
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (
        (get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'representative'::text, 'designer'::text, 'production_manager'::text, 'technician'::text]))
        OR ((get_my_role() = 'lab'::text) AND (id = get_my_entity_id()))
    );

-- 4. users_select
DROP POLICY IF EXISTS "users_select" ON public.users;
CREATE POLICY "users_select" ON public.users
    AS PERMISSIVE FOR SELECT
    TO authenticated
    USING (
        (get_my_role() = ANY (ARRAY['admin'::text, 'accountant'::text, 'coordinator'::text, 'representative'::text, 'production_manager'::text, 'designer'::text, 'technician'::text]))
        OR ((get_my_role() = 'doctor'::text) AND (id = get_my_user_id()))
    );

COMMIT;
