BEGIN;

ALTER TABLE public.doctor_support_threads ADD COLUMN context text
    CHECK (context IN ('general', 'design', 'try_in'));
ALTER TABLE public.doctor_support_posts
    ADD COLUMN context text CHECK (context IN ('general', 'design', 'try_in')),
    ADD COLUMN attachment_path text,
    ADD COLUMN attachment_name text,
    ADD COLUMN designer_missing boolean;
CREATE INDEX doctor_support_threads_order ON public.doctor_support_threads(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX doctor_support_posts_incoming_time ON public.doctor_support_posts(created_at) WHERE NOT from_lab;
CREATE UNIQUE INDEX doctor_support_posts_attachment ON public.doctor_support_posts(attachment_path) WHERE attachment_path IS NOT NULL;

CREATE TABLE public.doctor_support_reads (
    thread_id uuid REFERENCES public.doctor_support_threads(id),
    user_id uuid REFERENCES public.users(id),
    read_through timestamptz NOT NULL,
    PRIMARY KEY (thread_id, user_id)
);
CREATE TABLE public.doctor_support_reviews (
    post_id uuid PRIMARY KEY REFERENCES public.doctor_support_posts(id),
    reviewed_by uuid NOT NULL REFERENCES public.users(id),
    reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.doctor_support_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_support_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_support_reads, public.doctor_support_reviews FROM PUBLIC, anon, authenticated;

CREATE POLICY order_comments_exclude_doctors ON public.order_comments AS RESTRICTIVE
    FOR ALL TO authenticated USING (public.get_my_role() IS DISTINCT FROM 'doctor')
    WITH CHECK (public.get_my_role() IS DISTINCT FROM 'doctor');

CREATE FUNCTION public.doctor_chat_coordinator_roles() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT ARRAY['admin', 'coordinator']::text[] $$;

CREATE FUNCTION public.doctor_chat_assigned_to(p_order uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.orders o JOIN public.users u ON u.id = o.designer_id
        WHERE o.id = p_order AND u.id = p_user AND u.is_active
          AND NOT coalesce(o.is_deleted, false) AND NOT coalesce(o.is_archived, false)
          AND (u.role = 'designer' OR (u.role IN ('representative', 'coordinator')
               AND u.custom_permissions->>'secondary_designer' = 'true'))
    )
$$;

CREATE FUNCTION public.can_read_doctor_chat(p_thread uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.doctor_support_threads t
        WHERE t.id = p_thread AND CASE public.get_my_role()
            WHEN 'doctor' THEN t.doctor_id = public.get_my_entity_id()
                AND (t.order_id IS NULL OR public.doctor_portal_can_access_order(t.order_id))
            ELSE public.get_my_role() = ANY(public.doctor_chat_coordinator_roles())
                OR public.doctor_chat_assigned_to(t.order_id, public.get_my_user_id())
        END
    )
$$;

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('doctor-chat-files', 'doctor-chat-files', false, 10485760,
    ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

CREATE FUNCTION public.can_read_doctor_chat_attachment(p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (SELECT 1 FROM public.doctor_support_posts m
                   WHERE m.attachment_path = p_path AND public.can_read_doctor_chat(m.thread_id))
$$;

CREATE FUNCTION public.is_unlinked_doctor_chat_attachment(p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT split_part(p_path, '/', 1) = auth.uid()::text AND NOT EXISTS (
        SELECT 1 FROM public.doctor_support_posts WHERE attachment_path = p_path)
$$;

CREATE POLICY doctor_chat_attachment_read ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'doctor-chat-files' AND (public.can_read_doctor_chat_attachment(name) OR public.is_unlinked_doctor_chat_attachment(name)));
CREATE POLICY doctor_chat_attachment_upload ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'doctor-chat-files' AND (storage.foldername(name))[1] = auth.uid()::text
                AND public.get_my_user_id() IS NOT NULL
                AND (public.get_my_role() = ANY(public.doctor_chat_coordinator_roles())
                     OR public.get_my_role() IN ('doctor', 'designer')
                     OR public.get_my_custom_permission('secondary_designer')));
CREATE POLICY doctor_chat_attachment_discard ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'doctor-chat-files' AND public.is_unlinked_doctor_chat_attachment(name));

-- Preserve the existing portal bucket guards and admit only scoped chat objects.
DO $policies$
DECLARE policy record;
BEGIN
    FOR policy IN SELECT policyname, qual, with_check, cmd FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects' AND permissive = 'RESTRICTIVE'
          AND policyname IN ('doctor_blocked_internal_buckets', 'portal_storage_read_scope', 'portal_storage_write_scope')
    LOOP
        IF policy.cmd = 'SELECT' THEN
            EXECUTE format('ALTER POLICY %I ON storage.objects USING ((%s) OR (bucket_id = %L
                AND (public.can_read_doctor_chat_attachment(name) OR public.is_unlinked_doctor_chat_attachment(name))))',
                policy.policyname, policy.qual, 'doctor-chat-files');
        ELSIF policy.cmd = 'INSERT' THEN
            EXECUTE format('ALTER POLICY %I ON storage.objects WITH CHECK ((%s) OR (bucket_id = %L
                AND (storage.foldername(name))[1] = auth.uid()::text AND public.get_my_role() = %L))',
                policy.policyname, policy.with_check, 'doctor-chat-files', 'doctor');
        END IF;
    END LOOP;
END;
$policies$;

CREATE POLICY doctor_chat_attachment_scope ON storage.objects AS RESTRICTIVE
    FOR SELECT TO authenticated USING (bucket_id <> 'doctor-chat-files'
        OR public.can_read_doctor_chat_attachment(name) OR public.is_unlinked_doctor_chat_attachment(name));
CREATE POLICY doctor_chat_attachment_no_replace ON storage.objects AS RESTRICTIVE
    FOR UPDATE TO authenticated USING (bucket_id <> 'doctor-chat-files') WITH CHECK (bucket_id <> 'doctor-chat-files');
CREATE POLICY doctor_chat_attachment_delete_scope ON storage.objects AS RESTRICTIVE
    FOR DELETE TO authenticated USING (bucket_id <> 'doctor-chat-files' OR public.is_unlinked_doctor_chat_attachment(name));

CREATE FUNCTION public.get_doctor_chat(p_order uuid DEFAULT NULL, p_thread uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'case_id', o.case_id, 'order_id', t.order_id, 'doctor_id', t.doctor_id,
        'doctor_name', d.name, 'subject', t.subject, 'closed_at', t.closed_at, 'context', t.context,
        'unread', conversation.unread, 'posts', conversation.posts
    ) ORDER BY conversation.last_post DESC, t.id), '[]'::jsonb)
    FROM public.doctor_support_threads t
    JOIN public.doctors d ON d.id = t.doctor_id
    LEFT JOIN public.orders o ON o.id = t.order_id
    LEFT JOIN public.doctor_support_reads receipt ON receipt.thread_id = t.id AND receipt.user_id = public.get_my_user_id()
    JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('id', m.id, 'from_lab', m.from_lab,
            'body', m.body, 'created_at', m.created_at, 'attachment_path', m.attachment_path,
            'attachment_name', m.attachment_name) ORDER BY m.created_at, m.id) AS posts,
            max(m.created_at) AS last_post,
            count(*) FILTER (WHERE m.from_lab = (public.get_my_role() = 'doctor')
                AND m.created_at > coalesce(receipt.read_through, '-infinity')) AS unread
        FROM public.doctor_support_posts m WHERE m.thread_id = t.id
    ) conversation ON conversation.last_post IS NOT NULL
    WHERE (p_order IS NULL OR t.order_id = p_order)
      AND (p_thread IS NULL OR t.id = p_thread)
      AND (p_order IS NOT NULL OR p_thread IS NOT NULL
           OR public.get_my_role() = 'doctor' OR public.get_my_role() = ANY(public.doctor_chat_coordinator_roles()))
      AND public.can_read_doctor_chat(t.id)
$$;

CREATE OR REPLACE FUNCTION public.get_doctor_support_threads() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT public.get_doctor_chat()
$$;

CREATE FUNCTION public.get_doctor_chat_unread() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT count(*)::integer
    FROM public.doctor_support_posts m
    LEFT JOIN public.doctor_support_reads r ON r.thread_id = m.thread_id AND r.user_id = public.get_my_user_id()
    WHERE public.get_my_role() = ANY(public.doctor_chat_coordinator_roles()) AND NOT m.from_lab
      AND m.created_at > coalesce(r.read_through, '-infinity')
$$;

CREATE FUNCTION public.get_case_doctor_chat_unread(p_orders uuid[]) RETURNS TABLE(order_id uuid, unread integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT t.order_id, count(*)::integer FROM public.doctor_support_threads t
    JOIN public.doctor_support_posts m ON m.thread_id = t.id
    LEFT JOIN public.doctor_support_reads r ON r.thread_id = t.id AND r.user_id = public.get_my_user_id()
    WHERE t.order_id = ANY(p_orders) AND public.get_my_role() IS DISTINCT FROM 'doctor'
      AND public.can_read_doctor_chat(t.id) AND NOT m.from_lab
      AND m.created_at > coalesce(r.read_through, '-infinity')
    GROUP BY t.order_id
$$;

CREATE FUNCTION public.mark_doctor_chat_read(p_thread uuid, p_post uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    cutoff timestamptz;
    actor uuid := public.get_my_user_id();
BEGIN
    IF actor IS NULL OR NOT public.can_read_doctor_chat(p_thread) THEN
        RAISE EXCEPTION 'Support access denied' USING ERRCODE = '42501';
    END IF;
    SELECT created_at INTO cutoff FROM public.doctor_support_posts WHERE id = p_post AND thread_id = p_thread;
    IF NOT FOUND THEN RETURN; END IF;
    INSERT INTO public.doctor_support_reads(thread_id, user_id, read_through)
    VALUES (p_thread, actor, cutoff)
    ON CONFLICT (thread_id, user_id) DO UPDATE
        SET read_through = greatest(public.doctor_support_reads.read_through, excluded.read_through);
    UPDATE public.in_app_notifications n SET is_read = true, read_at = clock_timestamp()
    WHERE n.recipient_id = actor AND n.entity_type = 'doctor_chat' AND n.entity_id = p_thread AND NOT n.is_read
      AND EXISTS (SELECT 1 FROM public.doctor_support_posts m
          WHERE m.thread_id = p_thread AND m.created_at <= cutoff
            AND n.dedup_key = concat_ws(':', n.event_type, actor, p_thread, m.id));
END;
$$;

CREATE FUNCTION public.write_doctor_chat(
    p_action text, p_thread uuid DEFAULT NULL, p_order uuid DEFAULT NULL, p_doctor uuid DEFAULT NULL,
    p_subject text DEFAULT NULL, p_body text DEFAULT NULL, p_attachment text DEFAULT NULL,
    p_attachment_name text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    actor_role text := public.get_my_role();
    actor uuid := public.get_my_user_id();
    recipient uuid := p_doctor;
    thread public.doctor_support_threads%ROWTYPE;
    conversation uuid := p_thread;
    clean_subject text := nullif(btrim(p_subject), '');
    clean_body text := nullif(btrim(p_body), '');
BEGIN
    IF actor IS NULL OR actor_role IS NULL THEN
        RAISE EXCEPTION 'Support access denied' USING ERRCODE = '42501';
    END IF;
    IF p_action IS NULL OR p_action NOT IN ('start', 'reply', 'close') THEN
        RAISE EXCEPTION 'Invalid support action' USING ERRCODE = '22023';
    END IF;
    IF p_action = 'start' THEN
        IF actor_role = 'doctor' THEN
            recipient := public.get_my_entity_id();
            IF recipient IS NULL OR (p_order IS NOT NULL AND NOT public.doctor_portal_can_access_order(p_order)) THEN
                RAISE EXCEPTION 'Support access denied' USING ERRCODE = '42501';
            END IF;
        ELSE
            IF NOT (actor_role = ANY(public.doctor_chat_coordinator_roles()) OR public.doctor_chat_assigned_to(p_order, actor)) THEN
                RAISE EXCEPTION 'Support access denied' USING ERRCODE = '42501';
            END IF;
            IF recipient IS NULL THEN SELECT o.doctor_id INTO recipient FROM public.orders o WHERE o.id = p_order; END IF;
            IF NOT public.can_address_doctor_support(recipient, p_order) THEN
                RAISE EXCEPTION 'Support access denied' USING ERRCODE = '42501';
            END IF;
        END IF;
        IF length(clean_subject) > 120 THEN RAISE EXCEPTION 'Invalid subject' USING ERRCODE = '22023'; END IF;
        conversation := public.find_or_start_doctor_support(recipient, p_order, clean_subject);
        UPDATE public.doctor_support_threads SET context = 'general' WHERE id = conversation AND context IS NULL;
    END IF;
    SELECT * INTO thread FROM public.doctor_support_threads WHERE id = conversation FOR UPDATE;
    IF NOT FOUND OR NOT public.can_read_doctor_chat(thread.id) THEN
        RAISE EXCEPTION 'Support access denied' USING ERRCODE = '42501';
    END IF;
    IF p_action = 'close' THEN
        UPDATE public.doctor_support_threads SET closed_at = clock_timestamp(), closed_by = actor
        WHERE id = thread.id AND closed_at IS NULL;
        RETURN thread.id;
    END IF;
    IF thread.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Conversation is closed' USING ERRCODE = '23514'; END IF;
    IF length(clean_body) > 4000 OR (clean_body IS NULL AND p_attachment IS NULL) THEN
        RAISE EXCEPTION 'Message is required' USING ERRCODE = '22023';
    END IF;
    IF p_attachment IS NOT NULL AND (
        coalesce(length(btrim(p_attachment_name)), 0) NOT BETWEEN 1 AND 240 OR
        split_part(p_attachment, '/', 1) IS DISTINCT FROM auth.uid()::text OR
        NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'doctor-chat-files' AND name = p_attachment)
    ) THEN RAISE EXCEPTION 'Invalid attachment' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.doctor_support_posts(thread_id, sender_id, from_lab, body, attachment_path, attachment_name)
    VALUES (thread.id, actor, actor_role <> 'doctor', coalesce(clean_body, '📎'), p_attachment,
        CASE WHEN p_attachment IS NOT NULL THEN btrim(p_attachment_name) END);
    RETURN thread.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.write_doctor_support_thread(
    p_action text, p_thread_id uuid DEFAULT NULL, p_order_id uuid DEFAULT NULL, p_body text DEFAULT NULL
) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    SELECT public.write_doctor_chat(p_action, p_thread_id, p_order_id, p_body => p_body)
$$;

CREATE OR REPLACE FUNCTION public.start_lab_doctor_support(p_doctor uuid, p_order uuid, p_subject text, p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT coalesce(public.get_my_role() = ANY(public.doctor_chat_coordinator_roles()), false) THEN
        RAISE EXCEPTION 'Support access denied' USING ERRCODE = '42501';
    END IF;
    RETURN public.write_doctor_chat('start', p_order => p_order, p_doctor => p_doctor, p_subject => p_subject, p_body => p_body);
END;
$$;

CREATE FUNCTION public.prepare_doctor_chat_post() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    thread public.doctor_support_threads%ROWTYPE;
    assignee uuid;
BEGIN
    SELECT * INTO thread FROM public.doctor_support_threads WHERE id = NEW.thread_id;
    NEW.context := coalesce(NEW.context, thread.context, 'general');
    IF NOT NEW.from_lab AND NEW.context IN ('design', 'try_in') THEN
        SELECT designer_id INTO assignee FROM public.orders WHERE id = thread.order_id;
        NEW.designer_missing := NOT public.doctor_chat_assigned_to(thread.order_id, assignee);
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.notify_doctor_chat_post() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    thread public.doctor_support_threads%ROWTYPE;
    case_number text;
    assignee uuid;
    staff_role text;
    destination text;
    title text;
BEGIN
    SELECT * INTO thread FROM public.doctor_support_threads WHERE id = NEW.thread_id;
    SELECT o.case_id, o.designer_id INTO case_number, assignee FROM public.orders o WHERE o.id = thread.order_id;
    IF NEW.from_lab THEN
        PERFORM public._dispatch_doctor_push(thread.doctor_id, 'support_reply', NULL, case_number, thread.order_id, NEW.id);
        RETURN NEW;
    END IF;
    destination := '/directory/doctor-chat?thread=' || thread.id;
    title := CASE NEW.context WHEN 'design' THEN 'رد الطبيب على التصميم'
        WHEN 'try_in' THEN 'رد الطبيب على البروفة' ELSE 'رسالة من طبيب' END;
    FOREACH staff_role IN ARRAY public.doctor_chat_coordinator_roles() LOOP
        PERFORM public.emit_workflow_notification(staff_role, NULL, 'doctor_chat_message', 'doctor_chat',
            thread.id, NEW.id::text, title, coalesce('الحالة ' || case_number, 'محادثة عامة'), destination);
    END LOOP;
    IF NEW.context IN ('design', 'try_in') AND NOT NEW.designer_missing THEN
        PERFORM public.emit_workflow_notification(NULL, assignee, 'doctor_chat_message', 'doctor_chat',
            thread.id, NEW.id::text, title, 'الحالة ' || case_number, destination);
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER prepare_doctor_chat_post BEFORE INSERT ON public.doctor_support_posts
    FOR EACH ROW EXECUTE FUNCTION public.prepare_doctor_chat_post();
CREATE TRIGGER notify_doctor_chat_post AFTER INSERT ON public.doctor_support_posts
    FOR EACH ROW EXECUTE FUNCTION public.notify_doctor_chat_post();

CREATE FUNCTION public.record_doctor_chat_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    thread_id uuid;
    message_context text;
    message_body text;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'doctor' THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'doctor_design_reviews' THEN
        IF NEW.state NOT IN ('approved', 'changes') OR NEW.state IS NOT DISTINCT FROM OLD.state THEN RETURN NEW; END IF;
        message_context := 'design';
        message_body := CASE NEW.state WHEN 'approved' THEN 'تمت الموافقة على التصميم'
            ELSE 'طُلب تعديل التصميم' END;
    ELSE
        message_context := 'try_in';
        message_body := CASE NEW.action WHEN 'approve' THEN 'تمت الموافقة على البروفة'
            ELSE 'طُلب تعديل البروفة' END;
    END IF;
    thread_id := public.find_or_start_doctor_support(public.get_my_entity_id(), NEW.order_id, NULL);
    UPDATE public.doctor_support_threads SET context = message_context WHERE id = thread_id;
    INSERT INTO public.doctor_support_posts(thread_id, sender_id, from_lab, body, context)
    VALUES (thread_id, public.get_my_user_id(), false,
        left(concat_ws(E'\n', message_body, nullif(btrim(NEW.note), '')), 4000), message_context);
    RETURN NEW;
END;
$$;
CREATE TRIGGER record_doctor_chat_design_decision AFTER UPDATE OF state ON public.doctor_design_reviews
    FOR EACH ROW EXECUTE FUNCTION public.record_doctor_chat_decision();
CREATE TRIGGER record_doctor_chat_try_in_decision AFTER INSERT ON public.doctor_portal_try_in_responses
    FOR EACH ROW EXECUTE FUNCTION public.record_doctor_chat_decision();

CREATE POLICY doctor_chat_notification_scope ON public.in_app_notifications AS RESTRICTIVE
    FOR SELECT TO authenticated USING (public.get_my_role() IS DISTINCT FROM 'doctor'
        AND (event_type <> 'doctor_chat_message' OR public.can_read_doctor_chat(entity_id)));

CREATE FUNCTION public.get_doctor_chat_log(p_day date, p_context text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501'; END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'thread_id', t.id, 'time', m.created_at, 'context', coalesce(m.context, 'general'),
        'doctor', d.name, 'case_id', o.case_id, 'designer_missing', m.designer_missing,
        'recipients', coalesce(recipients.names, '[]'::jsonb), 'first_reply_at', reply.time,
        'reviewed_by', reviewer.name, 'reviewed_at', r.reviewed_at) ORDER BY m.created_at DESC, m.id), '[]'::jsonb)
    INTO result
    FROM public.doctor_support_posts m
    JOIN public.doctor_support_threads t ON t.id = m.thread_id
    JOIN public.doctors d ON d.id = t.doctor_id
    LEFT JOIN public.orders o ON o.id = t.order_id
    LEFT JOIN public.doctor_support_reviews r ON r.post_id = m.id
    LEFT JOIN public.users reviewer ON reviewer.id = r.reviewed_by
    LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('name', u.name, 'role', n.recipient_role) ORDER BY u.name) AS names
        FROM public.in_app_notifications n JOIN public.users u ON u.id = n.recipient_id
        WHERE n.entity_type = 'doctor_chat' AND n.entity_id = t.id
          AND n.dedup_key = concat_ws(':', n.event_type, n.recipient_id, t.id, m.id)
    ) recipients ON true
    LEFT JOIN LATERAL (
        SELECT min(x.created_at) AS time FROM public.doctor_support_posts x
        WHERE x.thread_id = t.id AND x.from_lab AND (x.created_at, x.id) > (m.created_at, m.id)
    ) reply ON true
    WHERE NOT m.from_lab AND m.created_at >= (p_day::timestamp AT TIME ZONE 'Africa/Cairo')
      AND m.created_at < ((p_day + 1)::timestamp AT TIME ZONE 'Africa/Cairo')
      AND (p_context IS NULL OR p_context = coalesce(m.context, 'general'));
    RETURN result;
END;
$$;

CREATE FUNCTION public.review_doctor_chat_log(p_day date, p_post uuid DEFAULT NULL, p_context text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE marked integer;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Admin required' USING ERRCODE = '42501'; END IF;
    INSERT INTO public.doctor_support_reviews(post_id, reviewed_by)
    SELECT m.id, public.get_my_user_id() FROM public.doctor_support_posts m
    WHERE NOT m.from_lab AND m.created_at >= (p_day::timestamp AT TIME ZONE 'Africa/Cairo')
      AND m.created_at < ((p_day + 1)::timestamp AT TIME ZONE 'Africa/Cairo')
      AND (p_post IS NULL OR p_post = m.id)
      AND (p_context IS NULL OR p_context = coalesce(m.context, 'general'))
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS marked = ROW_COUNT;
    RETURN marked;
END;
$$;

REVOKE ALL ON FUNCTION public.doctor_chat_coordinator_roles(), public.doctor_chat_assigned_to(uuid,uuid),
    public.can_read_doctor_chat(uuid), public.can_read_doctor_chat_attachment(text), public.is_unlinked_doctor_chat_attachment(text),
    public.get_doctor_chat(uuid,uuid), public.get_doctor_chat_unread(), public.get_case_doctor_chat_unread(uuid[]),
    public.mark_doctor_chat_read(uuid,uuid), public.write_doctor_chat(text,uuid,uuid,uuid,text,text,text,text),
    public.prepare_doctor_chat_post(), public.notify_doctor_chat_post(), public.record_doctor_chat_decision(),
    public.get_doctor_chat_log(date,text), public.review_doctor_chat_log(date,uuid,text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.doctor_chat_coordinator_roles(), public.can_read_doctor_chat(uuid),
    public.can_read_doctor_chat_attachment(text), public.is_unlinked_doctor_chat_attachment(text), public.get_doctor_chat(uuid,uuid), public.get_doctor_chat_unread(),
    public.get_case_doctor_chat_unread(uuid[]), public.mark_doctor_chat_read(uuid,uuid),
    public.write_doctor_chat(text,uuid,uuid,uuid,text,text,text,text), public.get_doctor_chat_log(date,text),
    public.review_doctor_chat_log(date,uuid,text)
TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;

