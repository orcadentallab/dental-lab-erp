BEGIN;

CREATE TABLE public.doctor_invoice_identities (
    document_key text PRIMARY KEY,
    invoice_number text NOT NULL,
    doctor_id uuid NOT NULL REFERENCES public.doctors(id),
    doctor_code text NOT NULL,
    issued_on date NOT NULL
);
ALTER TABLE public.doctor_invoice_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_invoice_identities FROM PUBLIC,anon,authenticated;
CREATE SEQUENCE public.doctor_period_invoice_number;
REVOKE ALL ON SEQUENCE public.doctor_period_invoice_number FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_or_issue_doctor_invoice_identity(
    p_doctor uuid DEFAULT NULL, p_order uuid DEFAULT NULL,
    p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_monthly boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    role_name text:=coalesce(public.get_my_role(),'');
    invoice public.doctor_invoice_identities%ROWTYPE;
    account public.doctors%ROWTYPE;
    case_code text;
    invoice_key text;
    account_id uuid;
BEGIN
    IF p_order IS NOT NULL AND p_doctor IS NULL AND p_from IS NULL AND p_to IS NULL THEN
        IF role_name NOT IN ('admin','accountant','coordinator','representative','production_manager') THEN
            RAISE EXCEPTION 'غير مسموح بإصدار فاتورة الحالة' USING ERRCODE='42501';
        END IF;
        SELECT o.doctor_id,o.case_id INTO account_id,case_code FROM public.orders o WHERE o.id=p_order;
        invoice_key:='order:'||p_order;
    ELSIF p_order IS NULL AND p_doctor IS NOT NULL AND p_from IS NOT NULL AND p_to IS NOT NULL AND p_from<=p_to THEN
        IF role_name NOT IN ('admin','accountant','coordinator') THEN
            RAISE EXCEPTION 'غير مسموح بإصدار فاتورة الفترة' USING ERRCODE='42501';
        END IF;
        account_id:=p_doctor;
        invoice_key:=(CASE WHEN p_monthly THEN 'monthly:' ELSE 'period:' END)||p_doctor||':'||p_from||':'||p_to;
    ELSE
        RAISE EXCEPTION 'راجع بيانات الفاتورة';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(invoice_key,0));
    SELECT * INTO invoice FROM public.doctor_invoice_identities WHERE document_key=invoice_key;
    IF NOT FOUND THEN
        SELECT * INTO account FROM public.doctors WHERE id=account_id FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'حساب الفاتورة غير موجود'; END IF;
        INSERT INTO public.doctor_invoice_identities(document_key,invoice_number,doctor_id,doctor_code,issued_on)
        VALUES(invoice_key,CASE WHEN p_order IS NOT NULL THEN 'INV-'||case_code
            ELSE 'INV-DR-'||nextval('public.doctor_period_invoice_number') END,
            account.id,account.doctor_code,(now() AT TIME ZONE 'Africa/Cairo')::date)
        RETURNING * INTO invoice;
    END IF;
    RETURN jsonb_build_object('invoiceNumber',invoice.invoice_number,'doctorCode',invoice.doctor_code,'issuedOn',invoice.issued_on);
END $$;
REVOKE ALL ON FUNCTION public.get_or_issue_doctor_invoice_identity(uuid,uuid,date,date,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_issue_doctor_invoice_identity(uuid,uuid,date,date,boolean) TO authenticated;

CREATE FUNCTION public.add_shipping_area(p_name text,p_prefix integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE area_name text:=btrim(regexp_replace(p_name,'[[:space:]]+',' ','g'));
BEGIN
    IF coalesce(public.get_my_role(),'') NOT IN ('admin','representative','coordinator') THEN
        RAISE EXCEPTION 'إضافة المناطق تتطلب صلاحية إضافة طبيب' USING ERRCODE='42501';
    END IF;
    IF p_prefix IS NULL OR p_prefix NOT IN (1,2,3,5,6) THEN RAISE EXCEPTION 'اختار نطاق كود المنطقة'; END IF;
    PERFORM public.add_shipping_area(p_name);
    UPDATE public.shipping_areas SET doctor_code_prefix=p_prefix WHERE name=area_name AND doctor_code_prefix IS NULL;
    IF NOT EXISTS (SELECT FROM public.shipping_areas WHERE name=area_name AND doctor_code_prefix=p_prefix) THEN
        RAISE EXCEPTION 'المنطقة مسجلة بنطاق مختلف';
    END IF;
END $$;
REVOKE ALL ON FUNCTION public.add_shipping_area(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.add_shipping_area(text,integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.add_shipping_area(text) FROM authenticated;
NOTIFY pgrst,'reload schema';

COMMIT;
