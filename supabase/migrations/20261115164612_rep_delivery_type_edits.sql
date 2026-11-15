-- Delivery type edits stay within the representative audit/proposal transaction.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

CREATE OR REPLACE FUNCTION public.delivery_type_transition_status(
    p_status TEXT, p_previous_type TEXT, p_target_type TEXT
)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
    IF p_target_type IS NULL OR p_target_type NOT IN ('Final', 'TryIn') THEN
        RAISE EXCEPTION 'نوع التسليم يجب أن يكون Final أو TryIn' USING ERRCODE = '22023';
    END IF;
    IF p_previous_type IS NOT DISTINCT FROM p_target_type THEN RETURN p_status; END IF;
    IF p_target_type = 'Final' AND p_status IN ('try_in_ready','waiting_doctor','finalization') THEN
        RETURN 'in_production';
    END IF;
    IF p_target_type = 'TryIn' AND p_status = 'final_ready' THEN RETURN 'try_in_ready'; END IF;
    -- Never undo delivery evidence or invent a completed final stage.
    RETURN p_status;
END;
$$;

-- These route templates lock delivery_type once an order is created.
CREATE FUNCTION pg_temp.delivery_type_locked_routes()
RETURNS uuid[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[
    'ba100000-0000-4000-8000-000000000001'::uuid,
    'ba500000-0000-4000-8000-000000000001'::uuid,
    'ba500000-0000-4000-8000-000000000002'::uuid
] $$;

CREATE FUNCTION pg_temp.patch_delivery_type(p_source TEXT, p_old TEXT, p_new TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
    IF strpos(p_source, p_old) = 0 THEN
        RAISE EXCEPTION 'Delivery-type migration anchor missing: %', p_old;
    END IF;
    RETURN replace(p_source, p_old, p_new);
END;
$$;

DO $patch$
DECLARE
    d TEXT := pg_get_functiondef('public.rep_update_order_fields_with_audit(uuid,jsonb,text,text)'::regprocedure);
BEGIN
    d := pg_temp.patch_delivery_type(d,
        '''patient_name'',''stl_url'',''images_url'',''delivery_date'',',
        '''delivery_type'',''patient_name'',''stl_url'',''images_url'',''delivery_date'',');
    d := pg_temp.patch_delivery_type(d, '''is_urgent'',''priority'',', '');
    d := pg_temp.patch_delivery_type(d, '-- 5b. Snapshot', $new$
    IF p_changes ? 'delivery_type' THEN
        IF v_role IS NULL OR v_role NOT IN ('admin','representative','coordinator','production_manager') THEN
            RAISE EXCEPTION 'غير مصرح بتغيير نوع التسليم' USING ERRCODE = '42501';
        END IF;
        PERFORM public.delivery_type_transition_status(v_old.production_status, v_old.delivery_type, p_changes->>'delivery_type');
        IF COALESCE(v_old.is_deleted, false) OR COALESCE(v_old.issue_state, 'none') <> 'none' THEN
            RAISE EXCEPTION 'لا يمكن تغيير نوع التسليم أثناء وجود مشكلة أو بعد حذف الطلب';
        END IF;
        IF v_old.route_override_id = ANY (ARRAY[$locked_routes$]) THEN
            RAISE EXCEPTION 'نوع التسليم ثابت في خريطة الإنتاج الخاصة بالأوردر';
        END IF;
    END IF;
    -- 5b. Snapshot$new$);
    d := pg_temp.patch_delivery_type(d, '''patient_name'', v_old.patient_name,',
        '''delivery_type'', v_old.delivery_type, ''production_status'', v_old.production_status, ''patient_name'', v_old.patient_name,');
    d := pg_temp.patch_delivery_type(d,
        'WHEN ''delivery_date''  THEN ''delivery_date_changed''',
        'WHEN ''delivery_type'' THEN ''delivery_type_changed'' WHEN ''delivery_date''  THEN ''delivery_date_changed''');
    d := pg_temp.patch_delivery_type(d,
        'WHEN ''delivery_date''  THEN v_old.delivery_date::TEXT',
        'WHEN ''delivery_type'' THEN v_old.delivery_type WHEN ''delivery_date''  THEN v_old.delivery_date::TEXT');
    d := pg_temp.patch_delivery_type(d, 'IF v_key = ''supplier_id'' THEN', $new$
        IF v_key = 'delivery_type' THEN
            v_metadata := v_metadata || jsonb_build_object(
                'previousProductionStatus', v_old.production_status,
                'productionStatus', public.delivery_type_transition_status(v_old.production_status, v_old.delivery_type, p_changes->>'delivery_type'));
        END IF;
        IF v_key = 'supplier_id' THEN$new$);
    d := pg_temp.patch_delivery_type(d, 'UPDATE orders SET', $new$UPDATE orders SET
        delivery_type = CASE WHEN p_changes ? 'delivery_type' THEN p_changes->>'delivery_type' ELSE delivery_type END,
        production_status = CASE WHEN p_changes ? 'delivery_type' THEN public.delivery_type_transition_status(production_status, delivery_type, p_changes->>'delivery_type') ELSE production_status END,$new$);
    EXECUTE replace(d, '$locked_routes$',
        (SELECT string_agg(quote_literal(route_id) || '::uuid', ',') FROM unnest(pg_temp.delivery_type_locked_routes()) route_id));
END;
$patch$;

DO $patch$
DECLARE
    d TEXT := pg_get_functiondef('public.admin_review_order_edit(uuid,text,text)'::regprocedure);
BEGIN
    d := pg_temp.patch_delivery_type(d, '-- Set auditing bypass flag', $new$
        PERFORM 1 FROM public.orders WHERE id = v_order_id FOR UPDATE;
        IF v_changes ? 'delivery_type' AND EXISTS (
            SELECT 1 FROM public.orders WHERE id = v_order_id
            AND (COALESCE(is_deleted,false) OR COALESCE(issue_state,'none') <> 'none')
        ) THEN RAISE EXCEPTION 'لا يمكن تغيير نوع التسليم أثناء وجود مشكلة أو بعد حذف الطلب'; END IF;
        IF v_changes ? 'delivery_type' AND EXISTS (
            SELECT 1 FROM public.orders WHERE id = v_order_id
            AND route_override_id = ANY (ARRAY[$locked_routes$])
        ) THEN RAISE EXCEPTION 'نوع التسليم ثابت في خريطة الإنتاج الخاصة بالأوردر'; END IF;
        -- Set auditing bypass flag$new$);
    d := pg_temp.patch_delivery_type(d, 'UPDATE orders SET', $new$UPDATE orders SET
            delivery_type = CASE WHEN v_changes ? 'delivery_type' THEN v_changes->>'delivery_type' ELSE delivery_type END,
            production_status = CASE WHEN v_changes ? 'delivery_type' THEN public.delivery_type_transition_status(production_status, delivery_type, v_changes->>'delivery_type') ELSE production_status END,$new$);
    d := pg_temp.patch_delivery_type(d,
        'WHEN ''delivery_date''  THEN ''delivery_date_changed''',
        'WHEN ''delivery_type'' THEN ''delivery_type_changed'' WHEN ''delivery_date''  THEN ''delivery_date_changed''');
    EXECUTE replace(d, '$locked_routes$',
        (SELECT string_agg(quote_literal(route_id) || '::uuid', ',') FROM unnest(pg_temp.delivery_type_locked_routes()) route_id));
END;
$patch$;

DO $patch$
DECLARE
    d TEXT := pg_get_functiondef('public.orders_role_field_guard()'::regprocedure);
BEGIN
    -- Always require the audited RPC, even when workflow_strict_rep is off.
    d := pg_temp.patch_delivery_type(d, 'IF v_role IS NULL OR v_role = ''admin'' THEN RETURN NEW; END IF;', $new$
    IF v_role IN ('representative','coordinator')
       AND NEW.delivery_type IS DISTINCT FROM OLD.delivery_type
       AND v_audit_flag IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Delivery type changes require the audited representative RPC' USING ERRCODE = '42501';
    END IF;
    IF v_role IS NULL OR v_role = 'admin' THEN RETURN NEW; END IF;$new$);
    -- Coordinators retain the accountant guard except for this exact derived
    -- production change; no other workflow or delivery field is unlocked.
    d := pg_temp.patch_delivery_type(d,
        'IF NEW.production_status IS DISTINCT FROM OLD.production_status', $new$IF (NEW.production_status IS DISTINCT FROM OLD.production_status AND NOT (
            v_role = 'coordinator' AND v_audit_flag = 'true'
            AND NEW.delivery_type IS DISTINCT FROM OLD.delivery_type
            AND NEW.production_status IS NOT DISTINCT FROM public.delivery_type_transition_status(OLD.production_status, OLD.delivery_type, NEW.delivery_type)
        ))$new$);
    EXECUTE d;
END;
$patch$;

-- production_status is included in both UPDATE statements so the existing
-- synchronization and financial triggers can handle the derived transition.
NOTIFY pgrst, 'reload schema';
COMMIT;
