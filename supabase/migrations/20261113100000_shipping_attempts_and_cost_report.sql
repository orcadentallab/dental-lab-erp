BEGIN;
ALTER TABLE public.shipments DROP CONSTRAINT shipments_status_check;
ALTER TABLE public.shipments ADD CONSTRAINT shipments_status_check
    CHECK (status IN ('packing','ready_for_pickup','dispatched','delivered','failed','returned','cancelled'));
ALTER TABLE public.shipments ADD COLUMN attempt_outcome_reason text,
    ADD COLUMN attempt_closed_at timestamptz,
    ADD COLUMN attempt_closed_by uuid REFERENCES public.users(id),
    ADD COLUMN retry_of uuid UNIQUE REFERENCES public.shipments(id);

CREATE FUNCTION public.close_shipping_attempt(p_id uuid,p_outcome text,p_reason text,p_amount numeric DEFAULT NULL,p_cashbox uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE trip public.shipments%ROWTYPE; payment jsonb;
BEGIN
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','accountant','coordinator','production_manager') THEN
        RAISE EXCEPTION 'غير مسموح بتحديث محاولة الشحن' USING ERRCODE='42501';
    END IF;
    IF p_outcome IS NULL OR p_outcome NOT IN ('failed','returned','cancelled')
        OR nullif(btrim(p_reason),'') IS NULL OR length(btrim(p_reason))>1000 THEN
        RAISE EXCEPTION 'اختار النتيجة واكتب السبب';
    END IF;
    SELECT * INTO trip FROM public.shipments WHERE id=p_id AND status IN ('packing','ready_for_pickup','dispatched') FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'المحاولة مش مفتوحة'; END IF;
    IF p_amount IS NOT NULL OR p_cashbox IS NOT NULL THEN
        IF public.get_my_role() NOT IN ('admin','accountant','coordinator') OR NOT trip.scooter_payment_pending
           OR p_amount IS NULL OR p_amount<=0 OR p_amount>=10000000000 OR p_amount<>round(p_amount,2)
           OR NOT EXISTS(SELECT 1 FROM public.cashboxes WHERE id=p_cashbox AND is_active) THEN
            RAISE EXCEPTION 'راجع مبلغ مصروف المحاولة ومحفظة السداد';
        END IF;
        payment:=public.create_finance_transaction_atomic('expense',p_amount,'شحن وتوصيل','محاولة شحن · '||trip.shipment_code,
            (now() AT TIME ZONE 'Africa/Cairo')::date,NULL,'general',NULL,p_cashbox,'approved',0,NULL);
    END IF;
    UPDATE public.shipments SET status=p_outcome,attempt_outcome_reason=btrim(p_reason),
        immediate_expense_id=coalesce((payment->>'id')::uuid,trip.immediate_expense_id),
        cost_amount=CASE WHEN payment IS NULL THEN trip.cost_amount ELSE p_amount END,
        scooter_payment_pending=trip.scooter_payment_pending AND payment IS NULL,
        attempt_closed_at=now(),attempt_closed_by=public.get_my_user_id(),updated_at=now()
    WHERE id=p_id;
END $$;

CREATE FUNCTION public.retry_shipping_attempt(p_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_trip public.shipments%ROWTYPE; new_id uuid; orders uuid[]; result jsonb;
BEGIN
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','accountant','coordinator','production_manager') THEN
        RAISE EXCEPTION 'غير مسموح بإعادة محاولة الشحن' USING ERRCODE='42501';
    END IF;
    SELECT * INTO old_trip FROM public.shipments WHERE id=p_id FOR UPDATE;
    IF NOT FOUND OR old_trip.status NOT IN ('failed','returned','cancelled') THEN
        RAISE EXCEPTION 'اختار محاولة شحن مقفولة';
    END IF;
    SELECT id INTO new_id FROM public.shipments WHERE retry_of=p_id;
    IF FOUND THEN RETURN new_id; END IF;
    SELECT coalesce(array_agg(order_id ORDER BY order_id),'{}') INTO orders FROM public.shipment_orders WHERE shipment_id=p_id;
    result:=public.create_routed_shipping_request(gen_random_uuid(),old_trip.courier_id,old_trip.doctor_id,NULL,orders,'{}',
        old_trip.recipient_name,old_trip.recipient_phone,old_trip.delivery_address,NULL,
        CASE WHEN old_trip.hub_leg THEN 'العاشر من رمضان' ELSE old_trip.shipping_area END,
        CASE WHEN old_trip.hub_leg THEN 'to_doctor' ELSE old_trip.direction END,NULL,
        (old_trip.cash_carrier IS NOT NULL OR old_trip.immediate_expense_id IS NOT NULL OR old_trip.scooter_payment_pending),
        old_trip.intake_patient_name,old_trip.intake_branch_name,
        coalesce(old_trip.cash_carrier,CASE WHEN old_trip.immediate_expense_id IS NOT NULL THEN 'scooter' END),old_trip.hub_leg);
    new_id:=(result->>'shipment_id')::uuid;
    UPDATE public.shipments SET retry_of=p_id WHERE id=new_id;
    RETURN new_id;
END $$;

-- Terminal attempts cannot be dispatched or confirmed through older entry points.
CREATE FUNCTION public.guard_closed_shipping_attempt() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
    IF OLD.status IN ('failed','returned','cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'المحاولة مقفولة. اعمل محاولة جديدة';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER guard_closed_shipping_attempt BEFORE UPDATE OF status ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.guard_closed_shipping_attempt();

DO $$
DECLARE d text:=pg_get_functiondef('public.create_routed_shipping_request(uuid,uuid,uuid,text,uuid[],text[],text,text,text,text,text,text,uuid,boolean,text,text,text,boolean)'::regprocedure);
BEGIN
    EXECUTE replace(d,$q$NOT IN ('returned','cancelled')$q$,$q$NOT IN ('failed','returned','cancelled')$q$);
    d:=pg_get_functiondef('public.link_mixed_try_in_shipment()'::regprocedure);
    EXECUTE replace(d,$q$NOT IN ('cancelled','returned')$q$,$q$NOT IN ('cancelled','returned','failed')$q$);
END $$;

CREATE FUNCTION public.get_shipping_cost_report(p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE month_start date:=date_trunc('month',p_month)::date;
BEGIN
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','accountant','coordinator') THEN
        RAISE EXCEPTION 'تكلفة الشحن لفريق الحسابات والتنسيق' USING ERRCODE='42501';
    END IF;
    RETURN coalesce((WITH trips AS (
        SELECT s.*, CASE WHEN t.id IS NOT NULL THEN t.amount WHEN c.charge IS NOT NULL THEN c.charge
            WHEN s.previous_shipping_leg IS NOT NULL AND s.cash_carrier IS NULL AND s.courier_id IS NULL AND s.status='delivered' THEN 0 END actual,
            s.base_shipping_cost AS estimate
        FROM public.shipments s LEFT JOIN public.transactions t ON t.id=s.immediate_expense_id
        LEFT JOIN LATERAL (SELECT (i.shipment_charges->s.id::text->>'amount')::numeric AS charge
            FROM public.courier_monthly_invoices i WHERE i.courier_id=s.courier_id AND i.status='confirmed'
            AND i.shipment_charges ? s.id::text LIMIT 1) c ON true
        WHERE date_trunc('month',coalesce(s.dispatched_at,s.delivered_at,s.created_at) AT TIME ZONE 'Africa/Cairo')::date=month_start
    ), links AS (
        SELECT s.id,s.shipping_area,s.actual,s.estimate,coalesce(o.doctor_id,s.doctor_id) doctor_id,
            o.id order_id,o.case_id,count(*) OVER (PARTITION BY s.id) n,
            row_number() OVER (PARTITION BY s.id ORDER BY o.id) pos
        FROM trips s LEFT JOIN public.shipment_orders l ON l.shipment_id=s.id LEFT JOIN public.orders o ON o.id=l.order_id
    ), amounts AS (
        SELECT l.*,d.name doctor,
            ((actual*100)::bigint/n+CASE WHEN pos<=(actual*100)::bigint%n THEN 1 ELSE 0 END)/100.0 AS actual_share,
            ((estimate*100)::bigint/n+CASE WHEN pos<=(estimate*100)::bigint%n THEN 1 ELSE 0 END)/100.0 AS estimate_share
        FROM links l LEFT JOIN public.doctors d ON d.id=l.doctor_id
    ) SELECT jsonb_agg(to_jsonb(row)) FROM (
        SELECT order_id,case_id,doctor_id,doctor,shipping_area,sum(actual_share) actual,
            sum(estimate_share) FILTER (WHERE actual IS NULL) estimated,
            count(*) FILTER (WHERE actual IS NULL AND estimate IS NULL) unknown,
            count(*) attempts FROM amounts GROUP BY order_id,case_id,doctor_id,doctor,shipping_area
    ) row),'[]');
END $$;

REVOKE ALL ON FUNCTION public.close_shipping_attempt(uuid,text,text,numeric,uuid),public.retry_shipping_attempt(uuid),
    public.get_shipping_cost_report(date),public.guard_closed_shipping_attempt() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.close_shipping_attempt(uuid,text,text,numeric,uuid),public.retry_shipping_attempt(uuid),
    public.get_shipping_cost_report(date) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
