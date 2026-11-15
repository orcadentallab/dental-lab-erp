BEGIN;

CREATE TABLE public.released_doctor_codes (
    code text PRIMARY KEY CHECK (code ~ '^[12356][0-9]{3}$'),
    original_doctor_id uuid NOT NULL REFERENCES public.doctors(id),
    released_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.released_doctor_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.released_doctor_codes FROM public,anon,authenticated;

CREATE FUNCTION public.record_released_doctor_code() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF OLD.doctor_code ~ '^[12356][0-9]{3}$' AND OLD.doctor_code IS DISTINCT FROM NEW.doctor_code THEN
        INSERT INTO public.released_doctor_codes(code,original_doctor_id) VALUES (OLD.doctor_code,OLD.id)
        ON CONFLICT (code) DO UPDATE SET original_doctor_id=excluded.original_doctor_id,released_at=now();
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_released_doctor_code() FROM public,anon,authenticated;
CREATE TRIGGER record_released_doctor_code AFTER UPDATE OF doctor_code ON public.doctors
FOR EACH ROW EXECUTE FUNCTION public.record_released_doctor_code();

DO $$
DECLARE definition text := pg_get_functiondef('public.assign_new_doctor_code()'::regprocedure);
    anchor text := '        floor_number := CASE prefix';
BEGIN
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected allocator definition'; END IF;
    EXECUTE replace(definition,anchor,$patch$
        SELECT min(r.code::integer) INTO next_number FROM public.released_doctor_codes r
        WHERE left(r.code,1)=prefix::text
          AND NOT EXISTS (SELECT FROM public.doctors d WHERE d.doctor_code=r.code);
        IF next_number IS NOT NULL THEN
            DELETE FROM public.released_doctor_codes WHERE code=next_number::text;
            NEW.doctor_code := next_number::text;
            RETURN NEW;
        END IF;
$patch$||anchor);
END $$;

COMMIT;
