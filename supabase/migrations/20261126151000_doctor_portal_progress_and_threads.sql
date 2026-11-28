BEGIN;

CREATE FUNCTION public.get_doctor_portal_case_progress()
RETURNS TABLE(order_id uuid, has_try_in boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT o.id, o.delivery_type = 'TryIn' OR o.production_status IN ('try_in_ready', 'waiting_doctor')
    FROM public.orders o
    WHERE public.get_my_role() = 'doctor'
      AND o.doctor_id IN (SELECT public.doctor_portal_scope())
      AND NOT coalesce(o.is_deleted, false)
$$;

CREATE TABLE public.doctor_support_threads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id uuid NOT NULL REFERENCES public.doctors(id),
    order_id uuid REFERENCES public.orders(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz,
    closed_by uuid REFERENCES public.users(id)
);
CREATE TABLE public.doctor_support_posts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id uuid NOT NULL REFERENCES public.doctor_support_threads(id),
    sender_id uuid NOT NULL REFERENCES public.users(id),
    from_lab boolean NOT NULL,
    body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX doctor_support_posts_thread_time ON public.doctor_support_posts(thread_id, created_at);
CREATE INDEX doctor_support_threads_doctor ON public.doctor_support_threads(doctor_id, created_at DESC);
CREATE UNIQUE INDEX doctor_support_one_open_thread ON public.doctor_support_threads(doctor_id, order_id)
    NULLS NOT DISTINCT WHERE closed_at IS NULL;
ALTER TABLE public.doctor_support_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_support_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_support_threads, public.doctor_support_posts FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_doctor_support_threads()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'case_id', o.case_id, 'order_id', t.order_id, 'doctor_name', d.name,
        'closed_at', t.closed_at, 'posts', conversation.posts
    ) ORDER BY conversation.last_post DESC), '[]'::jsonb)
    FROM public.doctor_support_threads t
    JOIN public.doctors d ON d.id = t.doctor_id
    LEFT JOIN public.orders o ON o.id = t.order_id
    JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('id', m.id, 'from_lab', m.from_lab,
            'body', m.body, 'created_at', m.created_at) ORDER BY m.created_at, m.id) AS posts,
            max(m.created_at) AS last_post
        FROM public.doctor_support_posts m WHERE m.thread_id = t.id
    ) conversation ON conversation.last_post IS NOT NULL
    WHERE public.get_my_role() IN ('admin', 'coordinator')
        OR (public.get_my_role() = 'doctor' AND t.doctor_id = public.get_my_entity_id())
$$;

CREATE FUNCTION public.write_doctor_support_thread(
    p_action text, p_thread_id uuid DEFAULT NULL, p_order_id uuid DEFAULT NULL, p_body text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    actor_role text := public.get_my_role();
    actor_id uuid := public.get_my_user_id();
    actor_doctor uuid := public.get_my_entity_id();
    thread public.doctor_support_threads%ROWTYPE;
BEGIN
    IF actor_id IS NULL OR actor_role IS NULL OR actor_role NOT IN ('doctor', 'admin', 'coordinator') THEN
        RAISE EXCEPTION 'Support access denied' USING ERRCODE = '42501';
    END IF;
    IF p_action IS NULL OR p_action NOT IN ('start', 'reply', 'close') THEN
        RAISE EXCEPTION 'Invalid support action' USING ERRCODE = '22023';
    END IF;
    IF p_action <> 'close' AND coalesce(length(trim(p_body)), 0) NOT BETWEEN 1 AND 4000 THEN
        RAISE EXCEPTION 'Message is required' USING ERRCODE = '22023';
    END IF;
    IF p_action = 'start' THEN
        IF actor_role <> 'doctor' OR actor_doctor IS NULL OR
           (p_order_id IS NOT NULL AND NOT public.doctor_portal_can_access_order(p_order_id)) THEN
            RAISE EXCEPTION 'Support access denied' USING ERRCODE = '42501';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended(actor_doctor::text || ':' || coalesce(p_order_id::text, ''), 0));
        SELECT t.* INTO thread FROM public.doctor_support_threads t
        WHERE t.doctor_id = actor_doctor AND t.order_id IS NOT DISTINCT FROM p_order_id AND t.closed_at IS NULL
        FOR UPDATE;
        IF NOT FOUND THEN
            INSERT INTO public.doctor_support_threads(doctor_id, order_id)
            VALUES (actor_doctor, p_order_id) RETURNING * INTO thread;
        END IF;
    ELSE
        SELECT * INTO thread FROM public.doctor_support_threads WHERE id = p_thread_id FOR UPDATE;
        IF NOT FOUND OR (actor_role = 'doctor' AND thread.doctor_id IS DISTINCT FROM actor_doctor) THEN
            RAISE EXCEPTION 'Support access denied' USING ERRCODE = '42501';
        END IF;
        IF p_action = 'close' THEN
            UPDATE public.doctor_support_threads SET closed_at = clock_timestamp(), closed_by = actor_id
            WHERE id = thread.id AND closed_at IS NULL;
            RETURN thread.id;
        END IF;
        IF thread.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Conversation is closed' USING ERRCODE = '23514'; END IF;
    END IF;
    INSERT INTO public.doctor_support_posts(thread_id, sender_id, from_lab, body)
    VALUES (thread.id, actor_id, actor_role <> 'doctor', trim(p_body));
    RETURN thread.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_doctor_portal_case_progress(), public.get_doctor_support_threads(),
    public.write_doctor_support_thread(text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_doctor_portal_case_progress(), public.get_doctor_support_threads(),
    public.write_doctor_support_thread(text, uuid, uuid, text) TO authenticated;

COMMIT;
