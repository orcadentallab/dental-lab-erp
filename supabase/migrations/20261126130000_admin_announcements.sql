-- Admin Announcements (Promotional Push):
--   1. Add promotional_enabled opt-out flag to push_subscriptions
--   2. Create announcement_sends audit log table with admin-only RLS
--   3. Add get_promotional_push_preview RPC for exact recipient preview & 24h guard
-- Additive migration only.

BEGIN;

ALTER TABLE public.push_subscriptions
    ADD COLUMN IF NOT EXISTS promotional_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.announcement_sends (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sent_by uuid NOT NULL REFERENCES auth.users(id),
    sent_at timestamptz NOT NULL DEFAULT now(),
    title_en text NOT NULL,
    title_ar text NOT NULL,
    body_en text NOT NULL,
    body_ar text NOT NULL,
    audience_kind text NOT NULL CHECK (audience_kind IN ('single', 'selection', 'group', 'all')),
    audience_summary text NOT NULL,
    recipient_count int NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
    delivered_count int NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
    failed_count int NOT NULL DEFAULT 0 CHECK (failed_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_announcement_sends_sent_at
    ON public.announcement_sends(sent_at DESC);

ALTER TABLE public.announcement_sends ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.announcement_sends FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.announcement_sends TO authenticated;

DROP POLICY IF EXISTS announcement_sends_admin_select ON public.announcement_sends;
CREATE POLICY announcement_sends_admin_select
    ON public.announcement_sends
    FOR SELECT TO authenticated
    USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS announcement_sends_admin_insert ON public.announcement_sends;
CREATE POLICY announcement_sends_admin_insert
    ON public.announcement_sends
    FOR INSERT TO authenticated
    WITH CHECK (public.get_my_role() = 'admin' AND sent_by = auth.uid());

CREATE OR REPLACE FUNCTION public.get_promotional_push_preview(
    p_audience_kind text,
    p_doctor_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_recipient_count int := 0;
    v_doctors jsonb := '[]'::jsonb;
    v_recent_all jsonb := NULL;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'غير مصرح';
    END IF;

    IF p_audience_kind NOT IN ('single', 'selection', 'all') THEN
        RAISE EXCEPTION 'نوع الجمهور غير مدعوم';
    END IF;

    WITH eligible AS (
        SELECT
            d.id AS doctor_id,
            d.name AS doctor_name,
            count(DISTINCT ps.id)::int AS subscription_count
        FROM public.doctors d
        JOIN public.users u
            ON u.entity_id = d.id
           AND u.role = 'doctor'
           AND u.is_active = true
           AND u.auth_id IS NOT NULL
        JOIN public.push_subscriptions ps
            ON ps.user_id = u.auth_id
           AND ps.promotional_enabled = true
        WHERE (
            p_audience_kind = 'all'
            OR (p_doctor_ids IS NOT NULL AND d.id = ANY(p_doctor_ids))
        )
        GROUP BY d.id, d.name
        ORDER BY d.name ASC
    )
    SELECT
        coalesce(sum(subscription_count), 0)::int,
        coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'id', doctor_id,
                    'name', doctor_name,
                    'subscription_count', subscription_count
                )
            ),
            '[]'::jsonb
        )
    INTO v_recipient_count, v_doctors
    FROM eligible;

    IF p_audience_kind = 'all' THEN
        SELECT jsonb_build_object(
            'id', a.id,
            'sent_at', a.sent_at,
            'title_ar', a.title_ar,
            'title_en', a.title_en,
            'recipient_count', a.recipient_count
        )
        INTO v_recent_all
        FROM public.announcement_sends a
        WHERE a.audience_kind = 'all'
          AND a.sent_at >= now() - interval '24 hours'
        ORDER BY a.sent_at DESC
        LIMIT 1;
    END IF;

    RETURN jsonb_build_object(
        'recipient_count', v_recipient_count,
        'doctors', v_doctors,
        'recent_all_send', v_recent_all
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_promotional_push_preview(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_promotional_push_preview(text, uuid[]) TO authenticated;

COMMIT;
