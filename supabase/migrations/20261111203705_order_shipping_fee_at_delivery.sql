BEGIN;

ALTER TABLE public.orders ADD COLUMN quoted_shipping_fee numeric(12,2)
    CHECK (quoted_shipping_fee IS NULL OR quoted_shipping_fee > 0);

CREATE FUNCTION public.post_order_shipping_fee() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF NEW.production_status='final_delivered' AND NEW.first_delivered_at IS NOT NULL
       AND OLD.first_delivered_at IS NULL AND NEW.quoted_shipping_fee IS NOT NULL AND NEW.doctor_id IS NOT NULL
       AND NOT coalesce(NEW.is_deleted,false) AND coalesce(NEW.issue_state,'none') NOT IN ('cancelled','rejected') THEN
        INSERT INTO public.adjustments(entity_type,entity_id,type,amount,date,reason,created_by,shipping_order_id,service_charge_kind)
        VALUES ('doctor',NEW.doctor_id,'charge',NEW.quoted_shipping_fee,(now() AT TIME ZONE 'Africa/Cairo')::date,
                'رسوم شحن · '||NEW.case_id,auth.uid(),NEW.id,'shipping')
        ON CONFLICT (shipping_order_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.post_order_shipping_fee() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER post_order_shipping_fee AFTER UPDATE OF production_status,first_delivered_at ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.post_order_shipping_fee();

NOTIFY pgrst, 'reload schema';
COMMIT;
