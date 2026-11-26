-- Doctor Portal Web Push: push_subscriptions table, strict RLS, and notification triggers.
-- Additive migration only.

BEGIN;

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint text UNIQUE NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    preferred_language text CHECK (preferred_language IN ('en', 'ar')),
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
    ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;

DROP POLICY IF EXISTS push_subscriptions_select_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select_own
    ON public.push_subscriptions
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS push_subscriptions_insert_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_insert_own
    ON public.push_subscriptions
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS push_subscriptions_update_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_update_own
    ON public.push_subscriptions
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS push_subscriptions_delete_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete_own
    ON public.push_subscriptions
    FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- Map internal production_status to doctor-level portal stage names only.
CREATE OR REPLACE FUNCTION public._doctor_portal_stage(p_production_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_production_status
        WHEN 'final_delivered' THEN 'delivered'
        WHEN 'final_ready' THEN 'ready'
        WHEN 'in_production' THEN 'production'
        WHEN 'try_in_ready' THEN 'production'
        WHEN 'finalization' THEN 'production'
        WHEN 'designing' THEN 'design'
        ELSE 'received'
    END;
$$;

CREATE OR REPLACE FUNCTION public._dispatch_doctor_push(
    p_doctor_id uuid,
    p_event_type text,
    p_stage text,
    p_case_id text,
    p_order_id uuid,
    p_message_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_ids uuid[];
    v_url text;
    v_secret text;
BEGIN
    IF p_doctor_id IS NULL THEN
        RETURN;
    END IF;

    SELECT array_agg(DISTINCT u.auth_id)
    INTO v_user_ids
    FROM public.users u
    JOIN public.push_subscriptions ps ON ps.user_id = u.auth_id
    WHERE u.role = 'doctor'
      AND u.entity_id = p_doctor_id
      AND u.is_active = true
      AND u.auth_id IS NOT NULL;

    IF coalesce(array_length(v_user_ids, 1), 0) = 0 THEN
        RETURN;
    END IF;

    v_url := nullif(current_setting('app.settings.push_edge_url', true), '');
    IF v_url IS NULL AND to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
        BEGIN
            SELECT decrypted_secret INTO v_url
            FROM vault.decrypted_secrets
            WHERE name = 'push_edge_url'
            LIMIT 1;
        EXCEPTION WHEN OTHERS THEN
            v_url := NULL;
        END;
    END IF;

    IF v_url IS NULL OR to_regproc('net.http_post') IS NULL THEN
        RETURN;
    END IF;

    v_secret := nullif(current_setting('app.settings.push_webhook_secret', true), '');
    IF v_secret IS NULL AND to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
        BEGIN
            SELECT decrypted_secret INTO v_secret
            FROM vault.decrypted_secrets
            WHERE name = 'push_webhook_secret'
            LIMIT 1;
        EXCEPTION WHEN OTHERS THEN
            v_secret := NULL;
        END;
    END IF;

    PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-push-webhook-secret', coalesce(v_secret, '')
        ),
        body := jsonb_build_object(
            'user_ids', v_user_ids,
            'event_type', p_event_type,
            'stage', p_stage,
            'case_id', p_case_id,
            'order_id', p_order_id,
            'message_id', p_message_id
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public._dispatch_doctor_push(uuid, text, text, text, uuid, uuid)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._trg_orders_doctor_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_old_stage text;
    v_new_stage text;
BEGIN
    IF NEW.is_deleted IS TRUE THEN
        RETURN NEW;
    END IF;

    v_new_stage := public._doctor_portal_stage(NEW.production_status);

    IF TG_OP = 'INSERT' THEN
        PERFORM public._dispatch_doctor_push(
            NEW.doctor_id,
            'case_stage',
            v_new_stage,
            NEW.case_id,
            NEW.id,
            NULL
        );
        RETURN NEW;
    END IF;

    v_old_stage := public._doctor_portal_stage(OLD.production_status);
    IF v_new_stage IS DISTINCT FROM v_old_stage THEN
        PERFORM public._dispatch_doctor_push(
            NEW.doctor_id,
            'case_stage',
            v_new_stage,
            NEW.case_id,
            NEW.id,
            NULL
        );
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._trg_orders_doctor_push()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_orders_doctor_push ON public.orders;
CREATE TRIGGER trg_orders_doctor_push
    AFTER INSERT OR UPDATE OF production_status ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public._trg_orders_doctor_push();

CREATE OR REPLACE FUNCTION public._trg_support_reply_doctor_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_case_id text;
BEGIN
    IF NEW.order_id IS NOT NULL THEN
        SELECT o.case_id INTO v_case_id
        FROM public.orders o
        WHERE o.id = NEW.order_id;
    END IF;

    PERFORM public._dispatch_doctor_push(
        NEW.doctor_id,
        'support_reply',
        NULL,
        v_case_id,
        NEW.order_id,
        NEW.id
    );

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._trg_support_reply_doctor_push()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_support_reply_doctor_push ON public.doctor_portal_messages;
CREATE TRIGGER trg_support_reply_doctor_push
    AFTER UPDATE OF reply ON public.doctor_portal_messages
    FOR EACH ROW
    WHEN (OLD.reply IS NULL AND NEW.reply IS NOT NULL)
    EXECUTE FUNCTION public._trg_support_reply_doctor_push();

COMMIT;
