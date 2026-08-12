-- Migration: adopt out-of-chain marketing/contact schema into the tracked chain
--
-- Root cause this closes:
--   `marketing_events` + get_marketing_summary were only ever defined in
--   supabase/manual/marketing_events.sql, and `contact_inquiries` had no
--   definition anywhere in the repo. Both are live in production. Because they
--   sat outside supabase/migrations/, they were invisible to the 20260801
--   security hardening pass (which is exactly how get_marketing_summary stayed
--   anon-callable) and cannot be reproduced by `supabase db reset`, so no test
--   or local environment ever exercised them.
--
-- This migration codifies PRODUCTION'S CURRENT STATE verbatim, as captured by
-- `supabase db dump --linked` on 2026-08-12. It is deliberately a no-op against
-- production and a full create against a fresh database, so that local == prod.
--
--   It intentionally does NOT change any policy or grant, even though two are
--   weaker than the repo suggested (documented below). Reconciling the chain
--   and changing security posture in one migration would make it impossible to
--   verify that this one is a true no-op. Tightening is proposed separately.
--
-- KNOWN DIVERGENCES FOUND WHILE WRITING THIS -- carried over as-is, NOT fixed:
--
--   1. Policy "Admin read marketing_events" is NOT admin-restricted in prod.
--      supabase/manual/marketing_events.sql declares
--          USING (EXISTS (SELECT 1 FROM users u
--                         WHERE u.id = auth.uid() AND u.role = 'admin'))
--      but the deployed policy is USING (true) -- every authenticated user can
--      read marketing_events, contradicting the policy's own name.
--
--   2. contact_inquiries is readable and updatable by ANY authenticated user
--      (auth_select / auth_update are both USING (true)). Doctor-portal users
--      authenticate too, so a doctor can read and modify every marketing lead:
--      name, clinic, phone, message.
--
--   Both are access-control decisions for the owner, not silent fixes.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. marketing_events  (was: supabase/manual/marketing_events.sql)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketing_events (
    id          uuid        DEFAULT gen_random_uuid() NOT NULL,
    event_name  text        NOT NULL,
    source      text,
    page_type   text        DEFAULT 'marketing_landing'::text,
    device_type text,
    plan_title  text,
    plan_price  text,
    session_id  text,
    created_at  timestamptz DEFAULT now() NOT NULL
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'marketing_events_pkey'
    ) THEN
        ALTER TABLE ONLY public.marketing_events
            ADD CONSTRAINT marketing_events_pkey PRIMARY KEY (id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_marketing_events_created_at
    ON public.marketing_events USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_events_name
    ON public.marketing_events USING btree (event_name);

ALTER TABLE public.marketing_events ENABLE ROW LEVEL SECURITY;

-- Mirrors production exactly. See KNOWN DIVERGENCE 1 above: despite the name,
-- this policy is USING (true) in production, not admin-restricted.
DROP POLICY IF EXISTS "Admin read marketing_events" ON public.marketing_events;
CREATE POLICY "Admin read marketing_events" ON public.marketing_events
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Public insert marketing_events" ON public.marketing_events;
CREATE POLICY "Public insert marketing_events" ON public.marketing_events
    FOR INSERT TO authenticated, anon WITH CHECK (true);

GRANT ALL ON TABLE public.marketing_events TO anon;
GRANT ALL ON TABLE public.marketing_events TO authenticated;
GRANT ALL ON TABLE public.marketing_events TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. contact_inquiries  (previously undefined anywhere in the repo)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_inquiries (
    id           uuid        DEFAULT gen_random_uuid() NOT NULL,
    doctor_name  text        NOT NULL,
    clinic_name  text        DEFAULT ''::text,
    phone        text        NOT NULL,
    message      text        DEFAULT ''::text,
    status       text        DEFAULT 'new'::text,
    responded_by text,
    responded_at timestamptz,
    notes        text,
    created_at   timestamptz DEFAULT now(),
    CONSTRAINT contact_inquiries_status_check
        CHECK (status = ANY (ARRAY['new'::text, 'contacted'::text, 'closed'::text]))
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'contact_inquiries_pkey'
    ) THEN
        ALTER TABLE ONLY public.contact_inquiries
            ADD CONSTRAINT contact_inquiries_pkey PRIMARY KEY (id);
    END IF;
END $$;

ALTER TABLE public.contact_inquiries ENABLE ROW LEVEL SECURITY;

-- Mirrors production exactly. See KNOWN DIVERGENCE 2 above: auth_select and
-- auth_update are USING (true), so any authenticated role -- including
-- doctor-portal users -- can read and modify every lead.
DROP POLICY IF EXISTS "anon_insert" ON public.contact_inquiries;
CREATE POLICY "anon_insert" ON public.contact_inquiries
    FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "auth_insert" ON public.contact_inquiries;
CREATE POLICY "auth_insert" ON public.contact_inquiries
    FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_select" ON public.contact_inquiries;
CREATE POLICY "auth_select" ON public.contact_inquiries
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_update" ON public.contact_inquiries;
CREATE POLICY "auth_update" ON public.contact_inquiries
    FOR UPDATE TO authenticated USING (true);

GRANT ALL ON TABLE public.contact_inquiries TO anon;
GRANT ALL ON TABLE public.contact_inquiries TO authenticated;
GRANT ALL ON TABLE public.contact_inquiries TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. get_marketing_summary -- privileged body + admin-gated wrapper
--
--    Created directly in its post-20260812080000 shape (privileged inner +
--    admin wrapper) rather than replaying the pre-hardening version and then
--    renaming it, so a fresh database lands on the hardened state in one step.
--    In production both already exist and these are CREATE OR REPLACE no-ops.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_marketing_summary_privileged_20260812(
    p_start_date timestamptz DEFAULT (now() - INTERVAL '30 days'),
    p_end_date   timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result jsonb;
BEGIN
    SELECT jsonb_build_object(
        'total_clicks', (
            SELECT jsonb_object_agg(event_name, cnt)
            FROM (
                SELECT event_name, COUNT(*) AS cnt
                FROM marketing_events
                WHERE created_at BETWEEN p_start_date AND p_end_date
                GROUP BY event_name
            ) t
        ),
        'conversion_rate', (
            SELECT CASE
                WHEN COALESCE(SUM(CASE WHEN event_name = 'pricing_cta_click' THEN 1 END), 0) = 0 THEN 0
                ELSE ROUND(
                    (SUM(CASE WHEN event_name = 'whatsapp_click' THEN 1 END)::numeric /
                     SUM(CASE WHEN event_name = 'pricing_cta_click' THEN 1 END)::numeric) * 100,
                    1
                )
            END
            FROM marketing_events
            WHERE created_at BETWEEN p_start_date AND p_end_date
        ),
        'daily_trend', (
            SELECT jsonb_agg(row_to_json(t) ORDER BY t.day DESC)
            FROM (
                SELECT
                    DATE(created_at) AS day,
                    SUM(CASE WHEN event_name = 'whatsapp_click' THEN 1 ELSE 0 END) AS whatsapp_clicks,
                    SUM(CASE WHEN event_name = 'pricing_cta_click' THEN 1 ELSE 0 END) AS pricing_clicks
                FROM marketing_events
                WHERE created_at BETWEEN p_start_date AND p_end_date
                GROUP BY DATE(created_at)
                ORDER BY DATE(created_at) DESC
                LIMIT 30
            ) t
        ),
        'device_breakdown', (
            SELECT jsonb_object_agg(COALESCE(device_type, 'unknown'), pct)
            FROM (
                SELECT
                    device_type,
                    ROUND(COUNT(*)::numeric / NULLIF((
                        SELECT COUNT(*) FROM marketing_events
                        WHERE created_at BETWEEN p_start_date AND p_end_date
                    ), 0) * 100, 1) AS pct
                FROM marketing_events
                WHERE created_at BETWEEN p_start_date AND p_end_date
                GROUP BY device_type
            ) t
        )
    ) INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_marketing_summary_privileged_20260812(timestamptz, timestamptz)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_marketing_summary(
    p_start_date timestamptz DEFAULT (now() - INTERVAL '30 days'),
    p_end_date   timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'forbidden: admin role required' USING ERRCODE = '42501';
    END IF;
    RETURN public.get_marketing_summary_privileged_20260812(p_start_date, p_end_date);
END;
$$;

REVOKE ALL ON FUNCTION public.get_marketing_summary(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_marketing_summary(timestamptz, timestamptz) TO authenticated;

COMMIT;
