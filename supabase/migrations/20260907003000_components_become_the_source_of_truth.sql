-- Phase 3: the components become the source of truth; cost becomes their sum.
--
-- Phases 1 and 2 kept cost as the written value and derived lab_cost and
-- designer_cost from it.  That was the safe direction while the readers were
-- being moved, but it left the original disease in place: what the lab charges
-- and what the designer earns still arrived as one number that had to be taken
-- apart using a permission flag stored on another table.
--
-- From here a writer records the two amounts it actually knows -- the milling
-- price and the designer fee, each either manually entered or automatic -- and
-- orders.cost is their sum.  All four combinations (both automatic, one manual,
-- the other manual, both manual) are just two numbers being added.
--
-- WHY cost IS NOT A GENERATED COLUMN
-- ----------------------------------
-- GENERATED ALWAYS would be the tidiest expression of the rule, but it would
-- make every existing writer that sets cost fail instantly: update_order_atomic,
-- create_redo_order_atomic(_v2), apply_workflow_v2_backfill, the rep-edit
-- approval RPCs, the Excel importer, and both order forms.  Instead the trigger
-- accepts either direction and reconciles them:
--
--   caller wrote the components    ->  cost := lab_cost + designer_cost
--   caller wrote only cost         ->  components derived from it (phase 1)
--   caller wrote both, disagreeing ->  the write is rejected
--
-- so a legacy writer keeps working unchanged, a component-aware writer gets the
-- new behaviour, and the one genuinely ambiguous case is refused rather than
-- silently resolved in favour of one side.
--
-- TWO SUPPORTING CHANGES
-- ----------------------
-- update_order_atomic now accepts lab_cost and designer_cost in p_updates.
-- Every client order update goes through that RPC, so without this the columns
-- are unreachable from the app.
--
-- orders_role_field_guard now protects the components exactly as it protects
-- cost.  This matters because of trigger order: the guard is
-- trigger_orders_role_field_guard and the reconciler is
-- zy_sync_order_cost_components, so the guard runs FIRST and judges the change
-- set the caller actually sent.  A designer who sent only lab_cost would have
-- shown an unchanged cost to the guard, and the reconciler would have raised
-- cost afterwards -- editing the very field the guard exists to protect.

CREATE OR REPLACE FUNCTION public.update_order_atomic(
    p_order_id UUID,
    p_updates JSONB,
    p_items JSONB DEFAULT NULL,
    p_comments JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_order_exists BOOLEAN;
    v_result JSONB;
    v_existing_items JSONB := '[]'::jsonb;
    v_requested_items JSONB := '[]'::jsonb;
    v_items_changed BOOLEAN := FALSE;
BEGIN
    SELECT EXISTS(SELECT 1 FROM orders WHERE id = p_order_id) INTO v_order_exists;
    IF NOT v_order_exists THEN
        RAISE EXCEPTION 'Order not found or access denied: %', p_order_id;
    END IF;

    IF p_items IS NOT NULL THEN
        SELECT COALESCE(jsonb_agg(normalized ORDER BY normalized::text), '[]'::jsonb)
        INTO v_existing_items
        FROM (
            SELECT jsonb_build_object(
                'product_type', COALESCE(product_type, ''),
                'teeth_numbers', COALESCE(teeth_numbers, '[]'::jsonb),
                'price', COALESCE(price, 0),
                'shade', COALESCE(shade, ''),
                'count', COALESCE(count, 1)
            ) AS normalized
            FROM order_items
            WHERE order_id = p_order_id
        ) current_items;

        SELECT COALESCE(jsonb_agg(normalized ORDER BY normalized::text), '[]'::jsonb)
        INTO v_requested_items
        FROM (
            SELECT jsonb_build_object(
                'product_type', COALESCE(item->>'product_type', ''),
                'teeth_numbers', COALESCE(item->'teeth_numbers', '[]'::jsonb),
                'price', COALESCE((item->>'price')::numeric, 0),
                'shade', COALESCE(item->>'shade', ''),
                'count', COALESCE((item->>'count')::int, 1)
            ) AS normalized
            FROM jsonb_array_elements(p_items) supplied(item)
        ) requested_items;

        v_items_changed := v_existing_items IS DISTINCT FROM v_requested_items;
    END IF;

    UPDATE orders
    SET
        case_id = CASE WHEN p_updates ? 'case_id' THEN (p_updates->>'case_id')::text ELSE case_id END,
        doctor_id = CASE WHEN p_updates ? 'doctor_id' THEN (p_updates->>'doctor_id')::uuid ELSE doctor_id END,
        branch_name = CASE WHEN p_updates ? 'branch_name' THEN (p_updates->>'branch_name')::text ELSE branch_name END,
        patient_name = CASE WHEN p_updates ? 'patient_name' THEN (p_updates->>'patient_name')::text ELSE patient_name END,
        status = CASE WHEN p_updates ? 'status' THEN (p_updates->>'status')::text ELSE status END,
        delivery_date = CASE WHEN p_updates ? 'delivery_date' THEN (p_updates->>'delivery_date')::date ELSE delivery_date END,
        cost = CASE WHEN p_updates ? 'cost' THEN (p_updates->>'cost')::numeric ELSE cost END,
        manual_cost = CASE WHEN p_updates ? 'manual_cost' THEN (p_updates->>'manual_cost')::numeric ELSE manual_cost END,
        lab_cost = CASE WHEN p_updates ? 'lab_cost' THEN (p_updates->>'lab_cost')::numeric ELSE lab_cost END,
        designer_cost = CASE WHEN p_updates ? 'designer_cost' THEN (p_updates->>'designer_cost')::numeric ELSE designer_cost END,
        discount = CASE WHEN p_updates ? 'discount' THEN (p_updates->>'discount')::numeric ELSE discount END,
        total_price = CASE WHEN p_updates ? 'total_price' THEN (p_updates->>'total_price')::numeric ELSE total_price END,
        shade = CASE WHEN p_updates ? 'shade' THEN (p_updates->>'shade')::text ELSE shade END,
        instructions = CASE WHEN p_updates ? 'instructions' THEN (p_updates->>'instructions')::text ELSE instructions END,
        priority = CASE WHEN p_updates ? 'priority' THEN (p_updates->>'priority')::text ELSE priority END,
        is_urgent = CASE WHEN p_updates ? 'is_urgent' THEN (p_updates->>'is_urgent')::boolean ELSE is_urgent END,
        is_redo = CASE WHEN p_updates ? 'is_redo' THEN (p_updates->>'is_redo')::boolean ELSE is_redo END,
        is_archived = CASE WHEN p_updates ? 'is_archived' THEN (p_updates->>'is_archived')::boolean ELSE is_archived END,
        is_deleted = CASE WHEN p_updates ? 'is_deleted' THEN (p_updates->>'is_deleted')::boolean ELSE is_deleted END,
        stl_url = CASE WHEN p_updates ? 'stl_url' THEN (p_updates->>'stl_url')::text ELSE stl_url END,
        images_url = CASE WHEN p_updates ? 'images_url' THEN (p_updates->>'images_url')::text ELSE images_url END,
        supplier_id = CASE WHEN p_updates ? 'supplier_id' THEN (p_updates->>'supplier_id')::uuid ELSE supplier_id END,
        delivery_type = CASE WHEN p_updates ? 'delivery_type' THEN (p_updates->>'delivery_type')::text ELSE delivery_type END,
        needs_design_review = CASE WHEN p_updates ? 'needs_design_review' THEN (p_updates->>'needs_design_review')::boolean ELSE needs_design_review END,
        technician_status = CASE WHEN p_updates ? 'technician_status' THEN (p_updates->>'technician_status')::text ELSE technician_status END,
        representative_id = CASE WHEN p_updates ? 'representative_id' THEN (p_updates->>'representative_id')::uuid ELSE representative_id END,
        is_registered = CASE
            WHEN v_items_changed AND is_registered = TRUE THEN FALSE
            WHEN p_updates ? 'is_registered' THEN (p_updates->>'is_registered')::boolean
            ELSE is_registered
        END,
        needs_accounting_reregistration = CASE
            WHEN v_items_changed AND is_registered = TRUE THEN TRUE
            WHEN p_updates ? 'is_registered' AND (p_updates->>'is_registered')::boolean = TRUE THEN FALSE
            ELSE needs_accounting_reregistration
        END,
        workflow_type = CASE WHEN p_updates ? 'workflow_type' THEN (p_updates->>'workflow_type')::text ELSE workflow_type END,
        designer_id = CASE WHEN p_updates ? 'designer_id' THEN (p_updates->>'designer_id')::uuid ELSE designer_id END,
        design_url = CASE WHEN p_updates ? 'design_url' THEN (p_updates->>'design_url')::text ELSE design_url END,
        design_status = CASE WHEN p_updates ? 'design_status' THEN (p_updates->>'design_status')::text ELSE design_status END,
        design_price = CASE WHEN p_updates ? 'design_price' THEN (p_updates->>'design_price')::numeric ELSE design_price END,
        manual_design_price = CASE WHEN p_updates ? 'manual_design_price' THEN (p_updates->>'manual_design_price')::numeric ELSE manual_design_price END,
        actual_delivery_date = CASE WHEN p_updates ? 'actual_delivery_date' THEN (p_updates->>'actual_delivery_date')::date ELSE actual_delivery_date END,
        feedback = CASE WHEN p_updates ? 'feedback' THEN (p_updates->'feedback') ELSE feedback END,
        original_order_id = CASE WHEN p_updates ? 'original_order_id' THEN (p_updates->>'original_order_id')::uuid ELSE original_order_id END,
        status_history = CASE WHEN p_updates ? 'status_history' THEN (p_updates->'status_history') ELSE status_history END,
        rejected_lab_cost = CASE WHEN p_updates ? 'rejected_lab_cost' THEN (p_updates->>'rejected_lab_cost')::numeric ELSE rejected_lab_cost END,
        rejected_designer_cost = CASE WHEN p_updates ? 'rejected_designer_cost' THEN (p_updates->>'rejected_designer_cost')::numeric ELSE rejected_designer_cost END,
        rejection_doctor_decision = CASE WHEN p_updates ? 'rejection_doctor_decision' THEN (p_updates->>'rejection_doctor_decision')::text ELSE rejection_doctor_decision END,
        rejected_doctor_amount = CASE WHEN p_updates ? 'rejected_doctor_amount' THEN (p_updates->>'rejected_doctor_amount')::numeric ELSE rejected_doctor_amount END,
        rejection_financial_review_status = CASE WHEN p_updates ? 'rejection_financial_review_status' THEN (p_updates->>'rejection_financial_review_status')::text ELSE rejection_financial_review_status END,
        rejected_lab_cost_status = CASE WHEN p_updates ? 'rejected_lab_cost_status' THEN (p_updates->>'rejected_lab_cost_status')::text ELSE rejected_lab_cost_status END,
        rejected_designer_cost_status = CASE WHEN p_updates ? 'rejected_designer_cost_status' THEN (p_updates->>'rejected_designer_cost_status')::text ELSE rejected_designer_cost_status END,
        production_status = CASE WHEN p_updates ? 'production_status' THEN (p_updates->>'production_status')::text ELSE production_status END,
        issue_state = CASE WHEN p_updates ? 'issue_state' THEN (p_updates->>'issue_state')::text ELSE issue_state END,
        updated_at = NOW()
    WHERE id = p_order_id;

    IF p_items IS NOT NULL AND v_items_changed THEN
        DELETE FROM order_items WHERE order_id = p_order_id;
        IF jsonb_array_length(p_items) > 0 THEN
            INSERT INTO order_items (order_id, product_type, teeth_numbers, price, shade, count)
            SELECT p_order_id, item->>'product_type', item->'teeth_numbers', (item->>'price')::numeric,
                   item->>'shade', COALESCE((item->>'count')::int, 1)
            FROM jsonb_array_elements(p_items) supplied(item);
        END IF;
    END IF;

    IF p_comments IS NOT NULL THEN
        DELETE FROM order_comments WHERE order_id = p_order_id;
        IF jsonb_array_length(p_comments) > 0 THEN
            INSERT INTO order_comments (order_id, content, user_id, user_name, created_at)
            SELECT p_order_id, item->>'text', (item->>'userId')::uuid, item->>'userName',
                   COALESCE((item->>'createdAt')::timestamptz, NOW())
            FROM jsonb_array_elements(p_comments) supplied(item);
        END IF;
    END IF;

    SELECT to_jsonb(o.*) INTO v_result FROM orders o WHERE o.id = p_order_id;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.orders_role_field_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_role TEXT := public.get_my_role();
    v_operation TEXT := current_setting('app.order_issue_operation', true);
    v_strict_rep TEXT;
    v_audit_flag TEXT := current_setting('app.rep_audit_in_progress', true);
BEGIN
    IF v_role IS NULL OR v_role = 'admin' THEN RETURN NEW; END IF;

    -- These bypasses are narrow and are revalidated by the V2 transition guard.
    IF v_role = ANY (ARRAY['representative', 'coordinator']) AND v_operation IN (
        'cancel_order', 'return_for_adjustment', 'doctor_reject_order',
        'create_redo', 'approve_designer_rejection'
    ) THEN RETURN NEW; END IF;
    IF v_role = 'designer' AND v_operation IN ('submit_design') THEN RETURN NEW; END IF;
    IF v_role = 'production_manager' AND v_operation IN ('record_final_delivery', 'submit_design') THEN RETURN NEW; END IF;

    IF v_role = 'production_manager' THEN
        IF NEW.issue_state IN ('doctor_rejected', 'lab_rejected', 'cancelled', 'redo')
           AND OLD.issue_state IS DISTINCT FROM NEW.issue_state THEN
            RAISE EXCEPTION 'production manager cannot apply issue transition %', NEW.issue_state;
        END IF;
        RETURN NEW;
    END IF;

    IF v_role = ANY (ARRAY['accountant', 'coordinator']) THEN
        IF NEW.production_status IS DISTINCT FROM OLD.production_status
           OR NEW.issue_state IS DISTINCT FROM OLD.issue_state
           OR NEW.actual_delivery_date IS DISTINCT FROM OLD.actual_delivery_date
           OR NEW.first_delivered_at IS DISTINCT FROM OLD.first_delivered_at
           OR NEW.design_submitted_at IS DISTINCT FROM OLD.design_submitted_at THEN
            RAISE EXCEPTION 'accountant cannot change workflow or delivery fields';
        END IF;
        RETURN NEW;
    END IF;

    IF v_role = 'designer' THEN
        IF NEW.total_price IS DISTINCT FROM OLD.total_price
           OR NEW.cost IS DISTINCT FROM OLD.cost
           OR NEW.lab_cost IS DISTINCT FROM OLD.lab_cost
           OR NEW.designer_cost IS DISTINCT FROM OLD.designer_cost
           OR NEW.manual_cost IS DISTINCT FROM OLD.manual_cost
           OR NEW.manual_design_price IS DISTINCT FROM OLD.manual_design_price
           OR NEW.discount IS DISTINCT FROM OLD.discount
           OR NEW.rejected_lab_cost IS DISTINCT FROM OLD.rejected_lab_cost
           OR NEW.rejected_designer_cost IS DISTINCT FROM OLD.rejected_designer_cost
           OR NEW.rejected_doctor_amount IS DISTINCT FROM OLD.rejected_doctor_amount
           OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
           OR NEW.representative_id IS DISTINCT FROM OLD.representative_id
           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
           OR NEW.designer_id IS DISTINCT FROM OLD.designer_id
           OR NEW.items IS DISTINCT FROM OLD.items
           OR NEW.delivery_type IS DISTINCT FROM OLD.delivery_type
           OR NEW.actual_delivery_date IS DISTINCT FROM OLD.actual_delivery_date
           OR NEW.first_delivered_at IS DISTINCT FROM OLD.first_delivered_at
           OR NEW.issue_state IS DISTINCT FROM OLD.issue_state THEN
            RAISE EXCEPTION 'designer cannot change protected order fields';
        END IF;
        RETURN NEW;
    END IF;

    IF v_role = 'representative' THEN
        SELECT value INTO v_strict_rep FROM public.app_settings WHERE key = 'workflow_strict_rep';
        IF v_strict_rep IS DISTINCT FROM 'on' THEN RETURN NEW; END IF;

        IF NEW.patient_name IS DISTINCT FROM OLD.patient_name
           OR NEW.stl_url IS DISTINCT FROM OLD.stl_url
           OR NEW.images_url IS DISTINCT FROM OLD.images_url
           OR NEW.delivery_date IS DISTINCT FROM OLD.delivery_date
           OR NEW.is_urgent IS DISTINCT FROM OLD.is_urgent
           OR NEW.priority IS DISTINCT FROM OLD.priority
           OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
           OR NEW.designer_id IS DISTINCT FROM OLD.designer_id
           OR NEW.instructions IS DISTINCT FROM OLD.instructions
           OR NEW.items IS DISTINCT FROM OLD.items
           OR NEW.total_price IS DISTINCT FROM OLD.total_price
           OR NEW.cost IS DISTINCT FROM OLD.cost
           OR NEW.lab_cost IS DISTINCT FROM OLD.lab_cost
           OR NEW.designer_cost IS DISTINCT FROM OLD.designer_cost
           OR NEW.design_price IS DISTINCT FROM OLD.design_price
           OR NEW.discount IS DISTINCT FROM OLD.discount
           OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
           OR NEW.representative_id IS DISTINCT FROM OLD.representative_id
           OR NEW.workflow_type IS DISTINCT FROM OLD.workflow_type
           OR NEW.is_archived IS DISTINCT FROM OLD.is_archived
           OR NEW.case_id IS DISTINCT FROM OLD.case_id
           OR NEW.is_registered IS DISTINCT FROM OLD.is_registered
           OR NEW.feedback IS DISTINCT FROM OLD.feedback THEN
            IF v_audit_flag IS DISTINCT FROM 'true' THEN
                RAISE EXCEPTION 'representative protected edits require the audited RPC';
            END IF;
        END IF;

        IF (NEW.total_price IS DISTINCT FROM OLD.total_price
                AND NEW.items IS NOT DISTINCT FROM OLD.items)
           OR (NEW.cost IS DISTINCT FROM OLD.cost
                AND NEW.items IS NOT DISTINCT FROM OLD.items
                AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id
                AND NEW.designer_id IS NOT DISTINCT FROM OLD.designer_id)
           OR ((NEW.lab_cost IS DISTINCT FROM OLD.lab_cost
                 OR NEW.designer_cost IS DISTINCT FROM OLD.designer_cost)
                AND NEW.items IS NOT DISTINCT FROM OLD.items
                AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id
                AND NEW.designer_id IS NOT DISTINCT FROM OLD.designer_id)
           OR (NEW.design_price IS DISTINCT FROM OLD.design_price
                AND NEW.items IS NOT DISTINCT FROM OLD.items
                AND NEW.designer_id IS NOT DISTINCT FROM OLD.designer_id)
           OR NEW.manual_cost IS DISTINCT FROM OLD.manual_cost
           OR NEW.manual_design_price IS DISTINCT FROM OLD.manual_design_price
           OR NEW.discount IS DISTINCT FROM OLD.discount
           OR NEW.rejected_lab_cost IS DISTINCT FROM OLD.rejected_lab_cost
           OR NEW.rejected_designer_cost IS DISTINCT FROM OLD.rejected_designer_cost
           OR NEW.rejected_doctor_amount IS DISTINCT FROM OLD.rejected_doctor_amount
           OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
           OR NEW.representative_id IS DISTINCT FROM OLD.representative_id
           OR NEW.workflow_type IS DISTINCT FROM OLD.workflow_type
           OR NEW.is_archived IS DISTINCT FROM OLD.is_archived
           OR NEW.case_id IS DISTINCT FROM OLD.case_id
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR NEW.is_registered IS DISTINCT FROM OLD.is_registered THEN
            RAISE EXCEPTION 'representative cannot change protected finance or identity fields';
        END IF;
        IF NEW.issue_state IN ('doctor_rejected', 'lab_rejected', 'cancelled', 'redo')
           AND OLD.issue_state IS DISTINCT FROM NEW.issue_state THEN
            RAISE EXCEPTION 'representative issue transitions require a V2 workflow RPC';
        END IF;
        RETURN NEW;
    END IF;

    IF v_role = 'doctor' THEN RAISE EXCEPTION 'doctor role cannot update orders directly'; END IF;
    RAISE EXCEPTION 'role % is not permitted to update orders', v_role;
END;
$function$;
-- ---------------------------------------------------------------------------
-- The reconciler.  Replaces the phase 1 one-way derivation.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_order_cost_components()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
    v_designer_cost      NUMERIC(10,2);
    v_components_written BOOLEAN;
    v_inputs_changed     BOOLEAN;
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- A legacy insert leaves the components at their column default of 0
        -- and puts everything in cost.  Anything else is a component-first
        -- insert and cost is computed from it.  The two agree when cost is 0.
        IF COALESCE(NEW.lab_cost, 0) = 0 AND COALESCE(NEW.designer_cost, 0) = 0 THEN
            v_designer_cost := CASE
                WHEN NEW.workflow_type = 'split'
                 AND NOT COALESCE(public.order_designer_is_salaried(NEW.designer_id), FALSE)
                THEN COALESCE(NEW.manual_design_price, NEW.design_price, 0)
                ELSE 0
            END;
            NEW.designer_cost := v_designer_cost;
            NEW.lab_cost      := COALESCE(NEW.cost, 0) - v_designer_cost;
        ELSE
            NEW.cost := COALESCE(NEW.lab_cost, 0) + COALESCE(NEW.designer_cost, 0);
        END IF;

        RETURN NEW;
    END IF;

    v_components_written :=
           NEW.lab_cost      IS DISTINCT FROM OLD.lab_cost
        OR NEW.designer_cost IS DISTINCT FROM OLD.designer_cost;

    v_inputs_changed :=
           NEW.cost                IS DISTINCT FROM OLD.cost
        OR NEW.design_price        IS DISTINCT FROM OLD.design_price
        OR NEW.manual_design_price IS DISTINCT FROM OLD.manual_design_price
        OR NEW.designer_id         IS DISTINCT FROM OLD.designer_id
        OR NEW.workflow_type       IS DISTINCT FROM OLD.workflow_type;

    IF v_components_written THEN
        -- A caller that sends cost alongside the components must agree with
        -- them.  Both of the app's order forms do, by construction; a caller
        -- that does not is confused about which number it owns, and guessing
        -- on its behalf is how the original bug was born.
        IF NEW.cost IS DISTINCT FROM OLD.cost
           AND NEW.cost <> COALESCE(NEW.lab_cost, 0) + COALESCE(NEW.designer_cost, 0) THEN
            RAISE EXCEPTION
                'cost (%) disagrees with lab_cost (%) + designer_cost (%); send the components or send cost, not both',
                NEW.cost, NEW.lab_cost, NEW.designer_cost;
        END IF;

        NEW.cost := COALESCE(NEW.lab_cost, 0) + COALESCE(NEW.designer_cost, 0);
        RETURN NEW;
    END IF;

    IF v_inputs_changed THEN
        -- Legacy writer: only cost (or something cost is built from) moved, so
        -- the split is re-derived exactly as it was in phase 1.
        v_designer_cost := CASE
            WHEN NEW.workflow_type = 'split'
             AND NOT COALESCE(public.order_designer_is_salaried(NEW.designer_id), FALSE)
            THEN COALESCE(NEW.manual_design_price, NEW.design_price, 0)
            ELSE 0
        END;

        NEW.designer_cost := v_designer_cost;
        NEW.lab_cost      := COALESCE(NEW.cost, 0) - v_designer_cost;
    END IF;

    RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.sync_order_cost_components() IS
    'Phase 3: reconciles orders.cost with lab_cost + designer_cost. A caller that writes the components sets cost; a caller that writes only cost still gets the components derived. A caller that writes both with disagreeing values is rejected.';

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

DO $do$
DECLARE
    v_broken INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_broken
      FROM public.orders
     WHERE COALESCE(cost, 0) <> lab_cost + designer_cost;

    IF v_broken > 0 THEN
        RAISE EXCEPTION
            'cost = lab_cost + designer_cost is violated on % row(s) before phase 3 takes effect',
            v_broken;
    END IF;

    RAISE NOTICE 'phase 3 active: the components now drive cost';
END;
$do$;
