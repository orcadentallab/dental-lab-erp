BEGIN;

ALTER TABLE public.doctor_support_threads ADD COLUMN subject text
    CHECK (subject IS NULL OR length(btrim(subject)) BETWEEN 1 AND 120);

CREATE FUNCTION public.can_address_doctor_support(p_doctor uuid, p_order uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.doctors recipient
        WHERE recipient.id = p_doctor AND recipient.merged_into IS NULL
          AND EXISTS (SELECT 1 FROM public.users u WHERE u.entity_id = recipient.id
                      AND u.role = 'doctor' AND u.is_active AND u.auth_id IS NOT NULL)
          AND (p_order IS NULL OR EXISTS (
              SELECT 1 FROM public.orders o JOIN public.doctors owner ON owner.id = o.doctor_id
              WHERE o.id = p_order AND NOT coalesce(o.is_deleted, false)
                AND (owner.id = recipient.id OR
                    (recipient.is_center AND recipient.parent_id IS NULL AND owner.parent_id = recipient.id))
          ))
    )
$$;

CREATE FUNCTION public.get_lab_support_recipients()
RETURNS TABLE(id uuid, name text, doctor_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT d.id, d.name, d.doctor_code
    FROM public.doctors d
    WHERE public.get_my_role() IN ('admin', 'coordinator')
      AND public.can_address_doctor_support(d.id, NULL)
    ORDER BY d.name, d.id
$$;

CREATE FUNCTION public.get_lab_support_cases(p_doctor uuid)
RETURNS TABLE(id uuid, case_id text, patient_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT o.id, o.case_id, o.patient_name
    FROM public.doctors recipient
    JOIN public.doctors owner ON owner.id = recipient.id OR
         (recipient.is_center AND recipient.parent_id IS NULL AND owner.parent_id = recipient.id)
    JOIN public.orders o ON o.doctor_id = owner.id
    WHERE public.get_my_role() IN ('admin', 'coordinator') AND recipient.id = p_doctor
      AND public.can_address_doctor_support(p_doctor, NULL) AND NOT coalesce(o.is_deleted, false)
    ORDER BY o.created_at DESC, o.id
$$;

CREATE FUNCTION public.find_or_start_doctor_support(p_doctor uuid, p_order uuid, p_subject text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    conversation_id uuid;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_doctor::text || ':' || coalesce(p_order::text, ''), 0));
    SELECT t.id INTO conversation_id
    FROM public.doctor_support_threads t
    WHERE t.doctor_id = p_doctor AND t.order_id IS NOT DISTINCT FROM p_order AND t.closed_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        INSERT INTO public.doctor_support_threads(doctor_id, order_id, subject)
        VALUES (p_doctor, p_order, p_subject) RETURNING id INTO conversation_id;
    END IF;
    RETURN conversation_id;
END;
$$;

-- Preserve the existing doctor start RPC and share the same locking and thread selection.
DO $patch$
DECLARE
    definition text := pg_get_functiondef('public.write_doctor_support_thread(text,uuid,uuid,text)'::regprocedure);
    old_start text := $body$        PERFORM pg_advisory_xact_lock(hashtextextended(actor_doctor::text || ':' || coalesce(p_order_id::text, ''), 0));
        SELECT t.* INTO thread FROM public.doctor_support_threads t
        WHERE t.doctor_id = actor_doctor AND t.order_id IS NOT DISTINCT FROM p_order_id AND t.closed_at IS NULL
        FOR UPDATE;
        IF NOT FOUND THEN
            INSERT INTO public.doctor_support_threads(doctor_id, order_id)
            VALUES (actor_doctor, p_order_id) RETURNING * INTO thread;
        END IF;$body$;
BEGIN
    IF strpos(definition, old_start) = 0 THEN RAISE EXCEPTION 'Doctor conversation start anchor missing'; END IF;
    EXECUTE replace(definition, old_start, '        thread.id := public.find_or_start_doctor_support(actor_doctor, p_order_id, NULL);');
END;
$patch$;

CREATE FUNCTION public.start_lab_doctor_support(p_doctor uuid, p_order uuid, p_subject text, p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    actor_id uuid := public.get_my_user_id();
    conversation_id uuid;
    clean_subject text := nullif(btrim(p_subject),'');
BEGIN
    IF actor_id IS NULL OR coalesce(public.get_my_role(),'') NOT IN ('admin', 'coordinator')
       OR NOT public.can_address_doctor_support(p_doctor, p_order) THEN
        RAISE EXCEPTION 'Support access denied' USING ERRCODE = '42501';
    END IF;
    IF coalesce(length(btrim(p_body)), 0) NOT BETWEEN 1 AND 4000
       OR length(clean_subject) > 120 THEN
        RAISE EXCEPTION 'Invalid support message' USING ERRCODE = '22023';
    END IF;
    conversation_id := public.find_or_start_doctor_support(p_doctor, p_order, clean_subject);
    INSERT INTO public.doctor_support_posts(thread_id, sender_id, from_lab, body)
    VALUES (conversation_id, actor_id, true, btrim(p_body));
    RETURN conversation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_doctor_support_threads()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'case_id', o.case_id, 'order_id', t.order_id, 'doctor_id', t.doctor_id, 'doctor_name', d.name,
        'subject', t.subject, 'closed_at', t.closed_at, 'posts', conversation.posts
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

REVOKE ALL ON FUNCTION public.can_address_doctor_support(uuid,uuid),
    public.find_or_start_doctor_support(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_lab_support_recipients(), public.get_lab_support_cases(uuid),
    public.start_lab_doctor_support(uuid,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lab_support_recipients(), public.get_lab_support_cases(uuid),
    public.start_lab_doctor_support(uuid,uuid,text,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
