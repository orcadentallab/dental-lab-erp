BEGIN;

-- A courier invoice has no single order. Keep its payable in the courier
-- statement and link the existing cash transaction instead of creating one.
CREATE TABLE public.courier_monthly_invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    courier_id uuid NOT NULL REFERENCES public.suppliers(id),
    period_month date NOT NULL CHECK (extract(day FROM period_month)=1),
    invoice_ref text NOT NULL,
    minimum_amount numeric(12,2) NOT NULL CHECK (minimum_amount>=0),
    invoice_amount numeric(12,2) NOT NULL CHECK (invoice_amount>=0),
    shipment_amount numeric(12,2) NOT NULL CHECK (shipment_amount>=0),
    shipment_charges jsonb NOT NULL,
    status text NOT NULL CHECK (status IN ('draft','confirmed')),
    notes text,
    version integer NOT NULL DEFAULT 1,
    updated_by uuid REFERENCES public.users(id),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(courier_id,period_month),
    UNIQUE(courier_id,invoice_ref)
);

CREATE TABLE public.courier_invoice_payments (
    invoice_id uuid NOT NULL REFERENCES public.courier_monthly_invoices(id),
    transaction_id uuid NOT NULL REFERENCES public.transactions(id),
    amount numeric(12,2) NOT NULL CHECK(amount>0),
    linked_by uuid REFERENCES public.users(id),
    linked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(invoice_id,transaction_id)
);
CREATE INDEX courier_invoice_payments_transaction_idx ON public.courier_invoice_payments(transaction_id);

CREATE TABLE public.courier_invoice_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id uuid NOT NULL REFERENCES public.courier_monthly_invoices(id),
    action text NOT NULL,
    before_data jsonb,
    after_data jsonb NOT NULL,
    reason text,
    actor_id uuid REFERENCES public.users(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.courier_monthly_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_invoice_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.courier_monthly_invoices,public.courier_invoice_payments,public.courier_invoice_events FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_courier_statement(p_courier uuid DEFAULT NULL,p_month date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE month_start date:=date_trunc('month',p_month)::date;
BEGIN
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','accountant','coordinator') THEN
        RAISE EXCEPTION 'كشف شركة الشحن لفريق الحسابات والتنسيق' USING ERRCODE='42501';
    END IF;
    RETURN jsonb_build_object(
        'couriers',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'active',s.is_active) ORDER BY s.name)
            FROM public.suppliers s WHERE s.supplier_type='courier'
                OR EXISTS(SELECT 1 FROM public.courier_monthly_invoices i WHERE i.courier_id=s.id)),'[]'),
        'invoices',coalesce((SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('paid',(
                SELECT coalesce(sum(p.amount),0) FROM public.courier_invoice_payments p WHERE p.invoice_id=i.id),
                'payments',coalesce((SELECT jsonb_agg(jsonb_build_object('transaction_id',p.transaction_id,'amount',p.amount,
                    'date',t.date,'description',t.description) ORDER BY t.date,p.transaction_id)
                    FROM public.courier_invoice_payments p JOIN public.transactions t ON t.id=p.transaction_id WHERE p.invoice_id=i.id),'[]'))
                ORDER BY i.period_month DESC) FROM public.courier_monthly_invoices i WHERE i.courier_id=p_courier),'[]'),
        'shipments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'code',s.shipment_code,'tracking',s.tracking_ref,
                'status',s.status,'previous_cost',s.cost_amount) ORDER BY s.created_at,s.id)
            FROM public.shipments s WHERE s.courier_id=p_courier
                AND date_trunc('month',coalesce(s.dispatched_at,s.delivered_at,s.created_at) AT TIME ZONE 'Africa/Cairo')::date=month_start),'[]'),
        'available_payments',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.date DESC,t.id) FROM (
            SELECT t.id,t.date,t.description,t.amount,t.amount-coalesce(used.total,0)-coalesce(other.total,0) AS available
            FROM public.transactions t LEFT JOIN LATERAL (
                SELECT sum(p.amount) AS total FROM public.courier_invoice_payments p WHERE p.transaction_id=t.id
            ) used ON true
            LEFT JOIN LATERAL (
                SELECT sum(a.allocated_amount) AS total FROM public.payment_allocations a
                WHERE a.payment_transaction_id=t.id AND a.status='active'
            ) other ON true
            WHERE t.entity_id=p_courier AND t.entity_type='supplier' AND t.type='expense'
                AND t.category='supplier_payment' AND coalesce(t.status,CASE WHEN t.is_approved THEN 'approved' END)='approved'
                AND t.amount>coalesce(used.total,0)+coalesce(other.total,0)
        ) t),'[]')
    );
END $$;

CREATE FUNCTION public.save_courier_monthly_invoice(
    p_courier uuid,p_month date,p_ref text,p_minimum numeric,p_invoice numeric,p_charges jsonb,
    p_confirm boolean,p_version integer,p_reason text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    actor text:=public.get_my_role();
    month_start date:=date_trunc('month',p_month)::date;
    prior public.courier_monthly_invoices%ROWTYPE;
    saved public.courier_monthly_invoices%ROWTYPE;
    entry record;
    charge numeric;
    total numeric:=0;
    snapshots jsonb:='{}';
    cases jsonb;
    shipment_code text;
BEGIN
    IF coalesce(actor,'') NOT IN ('admin','accountant','coordinator') OR (p_confirm AND actor<>'admin') THEN
        RAISE EXCEPTION 'اعتماد فاتورة الشحن للأدمن فقط' USING ERRCODE='42501';
    END IF;
    IF p_month IS NULL OR p_ref IS NULL OR length(btrim(p_ref)) NOT BETWEEN 1 AND 120
       OR p_minimum IS NULL OR p_invoice IS NULL OR p_minimum<0 OR p_invoice<0
       OR p_minimum>=10000000000 OR p_invoice>=10000000000
       OR p_minimum<>round(p_minimum,2) OR p_invoice<>round(p_invoice,2)
       OR jsonb_typeof(p_charges) IS DISTINCT FROM 'object' OR p_confirm IS NULL OR p_version IS NULL THEN
        RAISE EXCEPTION 'راجع الشهر ورقم الفاتورة والمبالغ';
    END IF;
    PERFORM 1 FROM public.suppliers WHERE id=p_courier AND supplier_type='courier' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'اختار شركة شحن'; END IF;
    SELECT * INTO prior FROM public.courier_monthly_invoices WHERE courier_id=p_courier AND period_month=month_start FOR UPDATE;
    IF coalesce(prior.version,0)<>p_version THEN RAISE EXCEPTION 'الفاتورة اتغيرت، أعد تحميلها' USING ERRCODE='40001'; END IF;
    IF prior.status='confirmed' AND (actor<>'admin' OR NOT p_confirm OR nullif(btrim(p_reason),'') IS NULL) THEN
        RAISE EXCEPTION 'تعديل فاتورة معتمدة للأدمن مع كتابة السبب' USING ERRCODE='42501';
    END IF;
    FOR entry IN SELECT key,value FROM jsonb_each(p_charges) LOOP
        IF jsonb_typeof(entry.value)<>'number' THEN RAISE EXCEPTION 'تكلفة الشحنة لازم تكون رقم'; END IF;
        charge:=(entry.value#>>'{}')::numeric;
        IF charge<0 OR charge>=10000000000 OR charge<>round(charge,2) THEN RAISE EXCEPTION 'راجع تكلفة الشحنة'; END IF;
        SELECT s.shipment_code INTO shipment_code FROM public.shipments s
        WHERE s.id=entry.key::uuid AND s.courier_id=p_courier
          AND date_trunc('month',coalesce(s.dispatched_at,s.delivered_at,s.created_at) AT TIME ZONE 'Africa/Cairo')::date=month_start
        FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'في شحنة لا تخص الشركة أو الشهر'; END IF;
        SELECT coalesce(jsonb_agg(jsonb_build_object('order_id',x.order_id,'case_id',x.case_id,
                'allocated',((charge*100)::bigint/x.case_count + CASE WHEN x.position<=(charge*100)::bigint%x.case_count THEN 1 ELSE 0 END)/100.0)
                ORDER BY x.position),'[]') INTO cases
        FROM (SELECT o.id AS order_id,o.case_id,count(*) OVER () AS case_count,row_number() OVER (ORDER BY o.id) AS position
              FROM public.shipment_orders l JOIN public.orders o ON o.id=l.order_id WHERE l.shipment_id=entry.key::uuid) x;
        total:=total+charge;
        snapshots:=snapshots||jsonb_build_object(entry.key,jsonb_build_object('amount',charge,'code',shipment_code,'cases',cases));
    END LOOP;
    IF p_confirm AND nullif(btrim(p_reason),'') IS NULL AND (
        p_invoice<>greatest(p_minimum,total) OR EXISTS (
            SELECT 1 FROM public.shipments s WHERE s.courier_id=p_courier
            AND date_trunc('month',coalesce(s.dispatched_at,s.delivered_at,s.created_at) AT TIME ZONE 'Africa/Cairo')::date=month_start
            AND NOT p_charges ? s.id::text
        )) THEN RAISE EXCEPTION 'اكتب سبب فرق المطابقة أو الشحنات بدون تكلفة'; END IF;
    IF prior.id IS NOT NULL AND p_invoice<(SELECT coalesce(sum(amount),0) FROM public.courier_invoice_payments WHERE invoice_id=prior.id) THEN
        RAISE EXCEPTION 'مبلغ الفاتورة أقل من السداد المرتبط';
    END IF;
    INSERT INTO public.courier_monthly_invoices(courier_id,period_month,invoice_ref,minimum_amount,invoice_amount,
        shipment_amount,shipment_charges,status,notes,updated_by)
    VALUES(p_courier,month_start,btrim(p_ref),p_minimum,p_invoice,total,snapshots,
        CASE WHEN p_confirm THEN 'confirmed' ELSE 'draft' END,nullif(btrim(p_reason),''),public.get_my_user_id())
    ON CONFLICT (courier_id,period_month) DO UPDATE SET invoice_ref=excluded.invoice_ref,minimum_amount=excluded.minimum_amount,
        invoice_amount=excluded.invoice_amount,shipment_amount=excluded.shipment_amount,shipment_charges=excluded.shipment_charges,
        status=excluded.status,notes=excluded.notes,updated_by=excluded.updated_by,updated_at=now(),
        version=public.courier_monthly_invoices.version+1
    RETURNING * INTO saved;
    INSERT INTO public.courier_invoice_events(invoice_id,action,before_data,after_data,reason,actor_id)
    VALUES(saved.id,CASE WHEN prior.status='confirmed' THEN 'corrected' WHEN p_confirm THEN 'confirmed' ELSE 'draft_saved' END,
        CASE WHEN prior.id IS NOT NULL THEN to_jsonb(prior) END,to_jsonb(saved),saved.notes,public.get_my_user_id());
    RETURN saved.id;
END $$;

CREATE FUNCTION public.link_courier_invoice_payment(p_invoice uuid,p_transaction uuid,p_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    invoice public.courier_monthly_invoices%ROWTYPE;
    payment public.transactions%ROWTYPE;
    prior numeric;
BEGIN
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','accountant','coordinator') THEN
        RAISE EXCEPTION 'غير مسموح بربط سداد الشحن' USING ERRCODE='42501';
    END IF;
    IF p_amount IS NULL OR p_amount<=0 OR p_amount>=10000000000 OR p_amount<>round(p_amount,2) THEN
        RAISE EXCEPTION 'مبلغ الربط غير صحيح';
    END IF;
    SELECT * INTO invoice FROM public.courier_monthly_invoices WHERE id=p_invoice AND status='confirmed' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'اعتمد الفاتورة قبل ربط السداد'; END IF;
    SELECT * INTO payment FROM public.transactions WHERE id=p_transaction AND entity_type='supplier' AND entity_id=invoice.courier_id
        AND type='expense' AND category='supplier_payment'
        AND coalesce(status,CASE WHEN is_approved THEN 'approved' END)='approved' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'اختار سداد معتمد لنفس الشركة'; END IF;
    SELECT amount INTO prior FROM public.courier_invoice_payments WHERE invoice_id=p_invoice AND transaction_id=p_transaction;
    IF prior=p_amount THEN RETURN; END IF;
    IF prior IS NOT NULL THEN RAISE EXCEPTION 'السداد ده مرتبط بالفعل بالفاتورة'; END IF;
    IF p_amount>invoice.invoice_amount-(SELECT coalesce(sum(amount),0) FROM public.courier_invoice_payments WHERE invoice_id=p_invoice)
       OR p_amount>payment.amount-(SELECT coalesce(sum(amount),0) FROM public.courier_invoice_payments WHERE transaction_id=p_transaction)
           -(SELECT coalesce(sum(allocated_amount),0) FROM public.payment_allocations WHERE payment_transaction_id=p_transaction AND status='active') THEN
        RAISE EXCEPTION 'المبلغ أكبر من المتبقي على الفاتورة أو المتاح من السداد';
    END IF;
    INSERT INTO public.courier_invoice_payments(invoice_id,transaction_id,amount,linked_by)
    VALUES(p_invoice,p_transaction,p_amount,public.get_my_user_id());
    INSERT INTO public.courier_invoice_events(invoice_id,action,after_data,actor_id)
    VALUES(p_invoice,'payment_linked',jsonb_build_object('transaction_id',p_transaction,'amount',p_amount),public.get_my_user_id());
END $$;

CREATE FUNCTION public.guard_linked_courier_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE allocated numeric;
BEGIN
    SELECT sum(amount) INTO allocated FROM public.courier_invoice_payments WHERE transaction_id=OLD.id;
    IF allocated IS NOT NULL AND (NEW.entity_id IS DISTINCT FROM OLD.entity_id OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
        OR NEW.type IS DISTINCT FROM OLD.type OR NEW.category IS DISTINCT FROM OLD.category
        OR coalesce(NEW.status,CASE WHEN NEW.is_approved THEN 'approved' END) IS DISTINCT FROM 'approved'
        OR NEW.amount<allocated+(SELECT coalesce(sum(allocated_amount),0) FROM public.payment_allocations
            WHERE payment_transaction_id=OLD.id AND status='active')) THEN
        RAISE EXCEPTION 'السداد مرتبط بفاتورة شحن، راجع الربط قبل تغيير الحساب أو المبلغ';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER guard_linked_courier_payment BEFORE UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.guard_linked_courier_payment();

CREATE FUNCTION public.guard_courier_allocation_overlap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE paid numeric; courier_used numeric;
BEGIN
    IF NEW.status<>'active' THEN RETURN NEW; END IF;
    SELECT amount INTO paid FROM public.transactions WHERE id=NEW.payment_transaction_id FOR UPDATE;
    SELECT sum(amount) INTO courier_used FROM public.courier_invoice_payments WHERE transaction_id=NEW.payment_transaction_id;
    IF courier_used IS NOT NULL AND paid<courier_used+NEW.allocated_amount+(
        SELECT coalesce(sum(allocated_amount),0) FROM public.payment_allocations
        WHERE payment_transaction_id=NEW.payment_transaction_id AND status='active' AND id IS DISTINCT FROM NEW.id
    ) THEN
        RAISE EXCEPTION 'جزء من السداد مرتبط بفاتورة شركة الشحن';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER guard_courier_allocation_overlap BEFORE INSERT OR UPDATE ON public.payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.guard_courier_allocation_overlap();

DO $$
DECLARE
    definition text:=pg_get_functiondef('public.allocate_approved_payable_payment_trigger()'::regprocedure);
    anchor text:=$q$(NEW.entity_type = 'supplier' AND NEW.category = 'supplier_payment')$q$;
BEGIN
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected payable allocation trigger'; END IF;
    EXECUTE replace(definition,anchor, $q$(NEW.entity_type = 'supplier' AND NEW.category = 'supplier_payment'
           AND NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id=NEW.entity_id AND s.supplier_type='courier'))$q$);
END $$;

CREATE FUNCTION public.unlink_courier_invoice_payment(p_invoice uuid,p_transaction uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior public.courier_invoice_payments%ROWTYPE;
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'فك ربط سداد الشحن للأدمن فقط' USING ERRCODE='42501';
    END IF;
    IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'اكتب سبب فك الربط'; END IF;
    PERFORM 1 FROM public.courier_monthly_invoices WHERE id=p_invoice FOR UPDATE;
    PERFORM 1 FROM public.transactions WHERE id=p_transaction FOR UPDATE;
    DELETE FROM public.courier_invoice_payments WHERE invoice_id=p_invoice AND transaction_id=p_transaction RETURNING * INTO prior;
    IF NOT FOUND THEN RETURN; END IF;
    INSERT INTO public.courier_invoice_events(invoice_id,action,before_data,after_data,reason,actor_id)
    VALUES(p_invoice,'payment_unlinked',to_jsonb(prior),'{}',btrim(p_reason),public.get_my_user_id());
END $$;

REVOKE ALL ON FUNCTION public.get_courier_statement(uuid,date),
    public.save_courier_monthly_invoice(uuid,date,text,numeric,numeric,jsonb,boolean,integer,text),
    public.link_courier_invoice_payment(uuid,uuid,numeric),public.unlink_courier_invoice_payment(uuid,uuid,text),
    public.guard_linked_courier_payment(),public.guard_courier_allocation_overlap() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_courier_statement(uuid,date),
    public.save_courier_monthly_invoice(uuid,date,text,numeric,numeric,jsonb,boolean,integer,text),
    public.link_courier_invoice_payment(uuid,uuid,numeric),public.unlink_courier_invoice_payment(uuid,uuid,text) TO authenticated;
-- The old endpoint divided the full invoice (including the minimum gap)
-- across shipments. Keep its definition for compatibility and retire client use.
REVOKE EXECUTE ON FUNCTION public.reconcile_courier_invoice(uuid,date,numeric,text) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
