BEGIN;

DO $$
DECLARE
    definition text := pg_get_functiondef('public.get_or_issue_doctor_invoice_identity(uuid,uuid,date,date,boolean)'::regprocedure);
    old_return text := $old$RETURN jsonb_build_object('invoiceNumber',invoice.invoice_number,'doctorCode',invoice.doctor_code,'issuedOn',invoice.issued_on);$old$;
BEGIN
    IF strpos(definition,old_return)=0 THEN RAISE EXCEPTION 'Unexpected invoice function definition'; END IF;
    EXECUTE replace(definition,old_return,$new$
    SELECT current_account.doctor_code INTO account.doctor_code
    FROM public.doctors original_account
    JOIN public.doctors current_account ON current_account.id=coalesce(original_account.merged_into,original_account.id)
    WHERE original_account.id=invoice.doctor_id;
    RETURN jsonb_build_object('invoiceNumber',invoice.invoice_number,'doctorCode',account.doctor_code,'issuedOn',invoice.issued_on);
$new$);
END $$;

DO $$
DECLARE
    definition text := pg_get_functiondef('public.assign_new_doctor_code()'::regprocedure);
    old_floor text := 'floor_number := CASE prefix WHEN 1 THEN 1061 WHEN 2 THEN 2030 ELSE prefix*1000 END;';
    old_filter text := 'WHERE left(r.code,1)=prefix::text';
BEGIN
    IF strpos(definition,old_floor)=0 OR strpos(definition,old_filter)=0 THEN
        RAISE EXCEPTION 'Unexpected doctor code allocator definition';
    END IF;
    definition := replace(definition,old_floor,'floor_number := prefix*1000;');
    definition := replace(definition,old_filter,'WHERE left(r.code,1)=prefix::text AND right(r.code,3)<>''000''');
    EXECUTE definition;
END $$;

COMMIT;
