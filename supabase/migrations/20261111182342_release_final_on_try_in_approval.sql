BEGIN;

DO $$
DECLARE
    definition text := pg_get_functiondef('public.mixed_try_in_doctor_action(uuid,text,text)'::regprocedure);
    pending_check text := $old$IF NOT FOUND OR run.status<>'ready' THEN RAISE EXCEPTION 'الحالة ليست بانتظار رد الطبيب'; END IF;$old$;
    approval_end text := $old$        RETURN;
    END IF;

    IF p_action IN ('request_design_change','reprint') AND run.doctor_approved_at IS NULL THEN$old$;
BEGIN
    IF strpos(definition, pending_check) = 0 OR strpos(definition, approval_end) = 0 THEN
        RAISE EXCEPTION 'Unexpected doctor approval workflow definition';
    END IF;

    definition := replace(definition, pending_check, $new$IF FOUND AND run.status='done' AND run.doctor_approved_at IS NOT NULL
       AND p_action IN ('approve','send_final') THEN RETURN; END IF;
    IF NOT FOUND OR run.status<>'ready' THEN RAISE EXCEPTION 'الحالة ليست بانتظار رد الطبيب'; END IF;$new$);

    -- The approve branch now falls through to the existing atomic stage advancement.
    EXECUTE replace(definition, approval_end,
        $new$    ELSIF p_action IN ('request_design_change','reprint') AND run.doctor_approved_at IS NULL THEN$new$);
END;
$$;

COMMIT;
