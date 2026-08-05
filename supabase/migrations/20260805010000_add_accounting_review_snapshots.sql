-- Phase 1 accounting review: keep the existing is_registered workflow while
-- storing the last accepted values and the values before a later amendment.

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS accounting_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS accounting_previous_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS accounting_registered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS accounting_reviewed_by UUID,
    ADD COLUMN IF NOT EXISTS accounting_last_review_type TEXT;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'orders_accounting_last_review_type_check'
          AND conrelid = 'public.orders'::regclass
    ) THEN
        ALTER TABLE public.orders
        ADD CONSTRAINT orders_accounting_last_review_type_check
        CHECK (accounting_last_review_type IS NULL OR accounting_last_review_type IN ('new', 'change', 'cancellation'));
    END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.build_order_accounting_snapshot(p_order public.orders)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'status', p_order.status,
        'saleAmount', CASE
            WHEN p_order.status IN ('Cancelled', 'Lab Rejected') THEN 0
            WHEN p_order.status IN ('Doctor Rejected', 'Rejected')
                THEN COALESCE(p_order.rejected_doctor_amount, p_order.total_price, 0)
            ELSE COALESCE(p_order.total_price, 0)
        END,
        'labCost', CASE
            WHEN p_order.status IN ('Cancelled', 'Lab Rejected') THEN 0
            WHEN p_order.status IN ('Doctor Rejected', 'Rejected') THEN COALESCE(p_order.rejected_lab_cost, 0)
            ELSE COALESCE(p_order.manual_cost, p_order.cost, 0)
        END,
        'designCost', CASE
            WHEN p_order.status IN ('Cancelled', 'Lab Rejected') THEN 0
            WHEN p_order.status IN ('Doctor Rejected', 'Rejected') THEN COALESCE(p_order.rejected_designer_cost, 0)
            ELSE COALESCE(p_order.manual_design_price, p_order.design_price, 0)
        END,
        'discount', CASE WHEN p_order.status IN ('Cancelled', 'Lab Rejected') THEN 0 ELSE COALESCE(p_order.discount, 0) END,
        'doctorId', p_order.doctor_id,
        'supplierId', p_order.supplier_id,
        'designerId', p_order.designer_id
    );
$$;
CREATE OR REPLACE FUNCTION public.reopen_registered_order_for_accounting()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_business_changed BOOLEAN;
    v_old_snapshot JSONB;
BEGIN
    v_business_changed :=
           NEW.case_id                           IS DISTINCT FROM OLD.case_id
        OR NEW.doctor_id                         IS DISTINCT FROM OLD.doctor_id
        OR NEW.branch_name                       IS DISTINCT FROM OLD.branch_name
        OR NEW.patient_name                      IS DISTINCT FROM OLD.patient_name
        OR NEW.items                             IS DISTINCT FROM OLD.items
        OR NEW.discount                          IS DISTINCT FROM OLD.discount
        OR NEW.total_price                       IS DISTINCT FROM OLD.total_price
        OR NEW.shade                             IS DISTINCT FROM OLD.shade
        OR NEW.status                            IS DISTINCT FROM OLD.status
        OR NEW.production_status                 IS DISTINCT FROM OLD.production_status
        OR NEW.issue_state                       IS DISTINCT FROM OLD.issue_state
        OR NEW.delivery_date                     IS DISTINCT FROM OLD.delivery_date
        OR NEW.actual_delivery_date              IS DISTINCT FROM OLD.actual_delivery_date
        OR NEW.cost                              IS DISTINCT FROM OLD.cost
        OR NEW.manual_cost                       IS DISTINCT FROM OLD.manual_cost
        OR NEW.supplier_id                       IS DISTINCT FROM OLD.supplier_id
        OR NEW.representative_id                 IS DISTINCT FROM OLD.representative_id
        OR NEW.designer_id                       IS DISTINCT FROM OLD.designer_id
        OR NEW.design_price                      IS DISTINCT FROM OLD.design_price
        OR NEW.manual_design_price               IS DISTINCT FROM OLD.manual_design_price
        OR NEW.design_status                     IS DISTINCT FROM OLD.design_status
        OR NEW.workflow_type                     IS DISTINCT FROM OLD.workflow_type
        OR NEW.delivery_type                     IS DISTINCT FROM OLD.delivery_type
        OR NEW.priority                          IS DISTINCT FROM OLD.priority
        OR NEW.is_urgent                         IS DISTINCT FROM OLD.is_urgent
        OR NEW.instructions                      IS DISTINCT FROM OLD.instructions
        OR NEW.stl_url                           IS DISTINCT FROM OLD.stl_url
        OR NEW.images_url                        IS DISTINCT FROM OLD.images_url
        OR NEW.design_url                        IS DISTINCT FROM OLD.design_url
        OR NEW.needs_design_review               IS DISTINCT FROM OLD.needs_design_review
        OR NEW.technician_status                 IS DISTINCT FROM OLD.technician_status
        OR NEW.feedback                          IS DISTINCT FROM OLD.feedback
        OR NEW.is_redo                           IS DISTINCT FROM OLD.is_redo
        OR NEW.original_order_id                 IS DISTINCT FROM OLD.original_order_id
        OR NEW.is_deleted                        IS DISTINCT FROM OLD.is_deleted
        OR NEW.rejected_lab_cost                 IS DISTINCT FROM OLD.rejected_lab_cost
        OR NEW.rejected_designer_cost            IS DISTINCT FROM OLD.rejected_designer_cost
        OR NEW.rejection_doctor_decision         IS DISTINCT FROM OLD.rejection_doctor_decision
        OR NEW.rejected_doctor_amount            IS DISTINCT FROM OLD.rejected_doctor_amount
        OR NEW.rejection_financial_review_status IS DISTINCT FROM OLD.rejection_financial_review_status
        OR NEW.rejected_lab_cost_status          IS DISTINCT FROM OLD.rejected_lab_cost_status
        OR NEW.rejected_designer_cost_status     IS DISTINCT FROM OLD.rejected_designer_cost_status;

    -- The explicit flag transition covers item-only updates performed by the
    -- atomic RPC and the direct order_items trigger.
    IF OLD.is_registered = TRUE AND (
        v_business_changed
        OR (NEW.is_registered = FALSE AND NEW.needs_accounting_reregistration = TRUE)
    ) THEN
        v_old_snapshot := COALESCE(OLD.accounting_snapshot, public.build_order_accounting_snapshot(OLD));
        NEW.accounting_snapshot := v_old_snapshot;
        NEW.accounting_previous_snapshot := v_old_snapshot;
        NEW.is_registered := FALSE;
        NEW.needs_accounting_reregistration := TRUE;
    ELSIF NEW.is_registered = TRUE AND OLD.is_registered = FALSE THEN
        NEW.accounting_last_review_type := CASE
            WHEN OLD.needs_accounting_reregistration = TRUE AND NEW.status = 'Cancelled' THEN 'cancellation'
            WHEN OLD.needs_accounting_reregistration = TRUE THEN 'change'
            ELSE 'new'
        END;
        NEW.accounting_snapshot := public.build_order_accounting_snapshot(NEW);
        NEW.accounting_registered_at := timezone('utc'::text, now());
        NEW.accounting_reviewed_by := public.get_my_user_id();
        NEW.needs_accounting_reregistration := FALSE;
    END IF;

    RETURN NEW;
END;
$$;
-- Establish a baseline for orders already acknowledged by accounting. This
-- does not alter any financial or workflow value.
UPDATE public.orders AS o
SET accounting_snapshot = public.build_order_accounting_snapshot(o),
    accounting_registered_at = COALESCE(o.accounting_registered_at, o.updated_at, o.created_at),
    accounting_last_review_type = COALESCE(
        o.accounting_last_review_type,
        CASE WHEN o.status = 'Cancelled' THEN 'cancellation' ELSE 'new' END
    )
WHERE o.is_registered = TRUE
  AND o.accounting_snapshot IS NULL;
-- Tasneem is currently pending a one-time removal. Preserve the mistakenly
-- recorded 12,000 / 3,950 entry as the old snapshot so the UI can show the
-- exact negative correction instead of pretending it was a new zero row.
UPDATE public.orders AS o
SET accounting_snapshot = jsonb_build_object(
        'status', 'Delivered',
        'saleAmount', COALESCE(o.total_price, 0),
        'labCost', COALESCE(o.manual_cost, o.cost, 0),
        'designCost', COALESCE(o.manual_design_price, o.design_price, 0),
        'discount', COALESCE(o.discount, 0),
        'doctorId', o.doctor_id,
        'supplierId', o.supplier_id,
        'designerId', o.designer_id
    ),
    accounting_previous_snapshot = jsonb_build_object(
        'status', 'Delivered',
        'saleAmount', COALESCE(o.total_price, 0),
        'labCost', COALESCE(o.manual_cost, o.cost, 0),
        'designCost', COALESCE(o.manual_design_price, o.design_price, 0),
        'discount', COALESCE(o.discount, 0),
        'doctorId', o.doctor_id,
        'supplierId', o.supplier_id,
        'designerId', o.designer_id
    )
WHERE o.id = '4f0f9156-ac82-4c3b-a785-2e501dd2f71d'::uuid
  AND o.case_id = '1503-260507-511'
  AND o.status = 'Cancelled'
  AND o.needs_accounting_reregistration = TRUE;
