BEGIN;

-- Match the representative's upload scope for the private case-files bucket.
ALTER POLICY case_files_write ON storage.objects WITH CHECK (
    bucket_id = 'case-files'
    AND public.get_my_role() IN ('admin', 'lab', 'technician', 'designer', 'representative', 'coordinator')
);

-- An invoker trigger distinguishes direct API writes (including the generic
-- invoker RPC) from authorized operations inside the audited RPCs.
CREATE FUNCTION public.guard_coordinator_direct_order_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_allowed text[] := ARRAY['updated_at'];
BEGIN
    IF current_user = 'authenticated' AND public.get_my_role() = 'coordinator' THEN
        IF TG_TABLE_NAME = 'order_items' THEN
            RAISE EXCEPTION 'Coordinator order edits require the audited RPC' USING ERRCODE = '42501';
        END IF;

        IF NEW.production_status IS DISTINCT FROM OLD.production_status THEN
            -- The existing workflow trigger still validates the transition.
            v_allowed := v_allowed || ARRAY['production_status', 'design_status', 'status_history'];
        END IF;

        IF (to_jsonb(NEW) - v_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed) THEN
            RAISE EXCEPTION 'Coordinator order edits require the audited RPC' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_protect_coordinator_order_edit
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_coordinator_direct_order_edit();

CREATE TRIGGER guard_coordinator_direct_item_edit
BEFORE INSERT OR UPDATE OR DELETE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.guard_coordinator_direct_order_edit();

-- The coordinator submits items with the new order, so they are created
-- atomically. This trigger has no path to modify an existing order's items.
CREATE FUNCTION public.insert_coordinator_order_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.order_items(order_id, product_type, teeth_numbers, price, shade, count)
    SELECT NEW.id, item->>'serviceType', item->'teethNumbers', (item->>'price')::numeric,
        item->>'shade', greatest(jsonb_array_length(item->'teethNumbers'), 1)
    FROM jsonb_array_elements(NEW.items) AS items(item);
    RETURN NEW;
END;
$$;

CREATE TRIGGER insert_coordinator_order_items
AFTER INSERT ON public.orders
FOR EACH ROW
WHEN (current_user = 'authenticated' AND public.get_my_role() = 'coordinator')
EXECUTE FUNCTION public.insert_coordinator_order_items();

-- Accepting a pending intake is a one-time workflow operation. The editable
-- fields here are limited to what is needed to register and assign the case.
CREATE FUNCTION public.accept_coordinator_order(
    p_order_id uuid, p_case_id text, p_workflow_type text, p_supplier_id uuid,
    p_designer_id uuid, p_received_at timestamptz, p_delivery_date date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor uuid := public.get_my_user_id();
BEGIN
    IF public.get_my_role() IS DISTINCT FROM 'coordinator' OR v_actor IS NULL THEN
        RAISE EXCEPTION 'Coordinator role required' USING ERRCODE = '42501';
    END IF;
    IF NULLIF(btrim(p_case_id), '') IS NULL OR p_workflow_type IS NULL
       OR p_workflow_type NOT IN ('full', 'split') OR p_received_at IS NULL OR p_delivery_date IS NULL THEN
        RAISE EXCEPTION 'Invalid order intake details' USING ERRCODE = '22023';
    END IF;

    UPDATE public.orders SET
        case_id = btrim(p_case_id),
        workflow_type = p_workflow_type,
        supplier_id = p_supplier_id,
        designer_id = CASE WHEN p_workflow_type = 'split' THEN p_designer_id ELSE NULL END,
        created_at = p_received_at,
        delivery_date = p_delivery_date,
        intake_state = 'accepted',
        design_status = CASE WHEN p_workflow_type = 'split' THEN 'pending' ELSE NULL END,
        technician_status = 'Pending'
    WHERE id = p_order_id AND intake_state = 'pending_review' AND production_status = 'not_started'
        AND issue_state = 'none' AND NOT coalesce(is_deleted, false);

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order is not awaiting intake' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.order_events(order_id, event_type, changed_by, actor_role, severity, old_value, new_value)
    VALUES (p_order_id, 'order_intake_accepted', v_actor, 'coordinator', 'info', 'pending_review', 'accepted');
END;
$$;

REVOKE ALL ON FUNCTION public.guard_coordinator_direct_order_edit(),
    public.insert_coordinator_order_items(),
    public.accept_coordinator_order(uuid,text,text,uuid,uuid,timestamptz,date)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_coordinator_order(uuid,text,text,uuid,uuid,timestamptz,date)
TO authenticated;
NOTIFY pgrst, 'reload schema';

COMMIT;
