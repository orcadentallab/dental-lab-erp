BEGIN;
DO $$
DECLARE definition text; anchor text;
BEGIN
    definition:=pg_get_functiondef('public.set_production_doctor_wait(uuid,boolean,text)'::regprocedure);
    anchor:='actor NOT IN (''admin'',''coordinator'',''production_manager'')';
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected doctor wait authorization'; END IF;
    definition:=replace(definition,anchor,'actor NOT IN (''admin'',''coordinator'',''production_manager'',''designer'')');
    anchor:='IF p_wait THEN';
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected doctor wait action'; END IF;
    definition:=replace(definition,anchor,$check$
    IF actor='designer' AND (p_wait IS DISTINCT FROM true
        OR order_row.designer_id IS DISTINCT FROM public.get_my_user_id()
        OR order_row.workflow_type IS DISTINCT FROM 'split' OR coalesce(order_row.is_archived,false)
        OR order_row.production_status NOT IN ('not_started','designing')
        OR order_row.technician_status='Rejected') THEN
        RAISE EXCEPTION 'طلب التفاصيل متاح للمصمم المكلّف أثناء التصميم' USING ERRCODE='42501';
    END IF;
    $check$||anchor);
    definition:=replace(definition,'IF NOT EXISTS (',$eligibility$IF NOT (
        order_row.workflow_type='split' AND order_row.designer_id IS NOT NULL
        AND order_row.production_status IN ('not_started','designing')
    ) AND NOT EXISTS ($eligibility$);
    EXECUTE definition;

    definition:=pg_get_functiondef('public.get_designer_workspace(uuid,boolean)'::regprocedure);
    anchor:='''technician_status'',o.technician_status';
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected designer workspace projection'; END IF;
    EXECUTE replace(definition,anchor,anchor||$projection$,
      'doctor_wait_reason',(SELECT replace(replace(w.reason,coalesce(nullif(s.name,''),chr(1)),'[المورد]'),
        coalesce(nullif(s.phone,''),chr(1)),'[بيانات خاصة]')
        FROM public.production_doctor_waits w WHERE w.order_id=o.id AND w.ended_at IS NULL)$projection$);

    definition:=pg_get_functiondef('public.submit_design_delivery(uuid,uuid,text,text,text)'::regprocedure);
    anchor:='SELECT * INTO existing FROM public.design_revisions WHERE id=p_revision_id;';
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected design submission validation'; END IF;
    definition:=replace(definition,anchor,$wait$
    IF EXISTS (SELECT 1 FROM public.production_doctor_waits WHERE order_id=o.id AND ended_at IS NULL) THEN
        RAISE EXCEPTION 'الحالة On Hold. استأنفها بعد وصول التفاصيل قبل رفع التصميم' USING ERRCODE='23514';
    END IF;
    $wait$||anchor);
    anchor:='design_status=''completed'',design_submitted_at';
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected design submission update'; END IF;
    definition:=replace(definition,anchor,$accept$design_status='completed',
        technician_status=CASE WHEN technician_status IS NULL OR technician_status IN ('Pending','NeedDetails')
            THEN 'Approved' ELSE technician_status END,design_submitted_at$accept$);
    anchor:='CASE WHEN NOT enabled AND production_status=''designing'' THEN ''in_production'' ELSE production_status END';
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Unexpected design release transition'; END IF;
    EXECUTE replace(definition,anchor,$release$CASE
        WHEN NOT enabled AND production_status IN ('not_started','designing') THEN 'in_production'
        WHEN enabled AND production_status='not_started' THEN 'designing'
        ELSE production_status END$release$);
END;
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
