-- Phase 3: Raw Materials, Inventory, Material Suppliers & Depletion Tracking
--
-- WHAT THIS IMPLEMENTS
--   1. suppliers.supplier_type distinction ('external_lab' | 'material_vendor' | 'courier').
--   2. Materials catalog (materials), warehouses, physical batches (material_batches),
--      and the immutable ledger of movements (material_movements).
--   3. Material purchases & invoices (material_purchases, material_purchase_items)
--      which link directly to transactions (expenses) with category 'خامات ومستهلكات'
--      WITHOUT touching financial_obligations (preserving order-level debt integrity).
--   4. Stage material bindings (stage_material_bindings) defining what materials
--      each production stage uses.
--   5. Material batch usage & auto-attribution (material_batch_usage) powering the
--      2-tap technician workflow: open batch -> auto attribute on run completion -> deplete.
--   6. Security, RLS policies, and atomic RPCs.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Suppliers type distinction
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.suppliers
    ADD COLUMN IF NOT EXISTS supplier_type TEXT NOT NULL DEFAULT 'external_lab'
        CHECK (supplier_type IN ('external_lab', 'material_vendor', 'courier'));

COMMENT ON COLUMN public.suppliers.supplier_type IS
'Distinguishes outsourced processing labs from material vendors and delivery couriers.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Warehouses
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default warehouses if not present
INSERT INTO public.warehouses (code, name_ar, is_default, is_active)
VALUES
    ('main', 'المخزن الرئيسي', TRUE, TRUE),
    ('floor', 'أرضية المعمل (التشغيل)', FALSE, TRUE)
ON CONFLICT (code) DO UPDATE
    SET name_ar = EXCLUDED.name_ar,
        is_active = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Materials Catalog
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL,
    category TEXT NOT NULL, -- 'zirconia', 'emax', 'pmma', 'resin', 'powder', 'stain_glaze', 'packaging', 'other'
    unit TEXT NOT NULL,     -- 'disc', 'block', 'ml', 'g', 'piece', 'bottle', 'box'
    tracking_mode TEXT NOT NULL DEFAULT 'batch_depletion'
        CHECK (tracking_mode IN ('batch_depletion', 'quantity')),
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb, -- e.g. {"shade": "A2", "thickness_mm": 14}
    expected_units_per_batch NUMERIC(10, 2) NULL,  -- expected yield (e.g. 20 crowns per disc)
    reorder_point NUMERIC(10, 2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_materials_category ON public.materials(category);
CREATE INDEX IF NOT EXISTS idx_materials_is_active ON public.materials(is_active);

-- DELIBERATELY NOT SEEDED.
-- An earlier draft shipped eight materials with invented yields ("20 crowns per
-- 14mm disc"). Those numbers become the denominator of every estimated material
-- cost the moment a batch is opened against them, and plan 4.7 is explicit that
-- an invented number is worse than none: it produces a confident cost nobody
-- measured. The catalogue is entered from the inventory screen on the day the
-- lab actually buys something, with the real yield off the real invoice.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Material Batches (The physical unit: Disc, Bottle, Box, Lot)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.material_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
    batch_code TEXT NOT NULL, -- Lot number / barcode
    supplier_id UUID NULL REFERENCES public.suppliers(id) ON DELETE SET NULL,
    purchase_id UUID NULL,   -- Set when created from a purchase
    qty_received NUMERIC(10, 2) NOT NULL CHECK (qty_received > 0),
    qty_remaining NUMERIC(10, 2) NOT NULL CHECK (qty_remaining >= 0),
    unit_cost NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    expiry_date DATE NULL,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'sealed'
        CHECK (status IN ('sealed', 'open', 'depleted', 'scrapped')),
    opened_at TIMESTAMPTZ NULL,
    opened_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    depleted_at TIMESTAMPTZ NULL,
    depleted_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_material_batches_material ON public.material_batches(material_id);
CREATE INDEX IF NOT EXISTS idx_material_batches_status ON public.material_batches(status);
CREATE INDEX IF NOT EXISTS idx_material_batches_warehouse ON public.material_batches(warehouse_id);

-- The lot code is what the technician scans (plan 4.7). Two live batches of the
-- same material sharing a code makes the scan ambiguous, and the depletion
-- engine would attribute crowns to whichever row it happened to find first.
CREATE UNIQUE INDEX IF NOT EXISTS uq_material_batches_material_code
    ON public.material_batches (material_id, batch_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Material Movements (Ledger - single source of truth for stock quantities)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.material_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.material_batches(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
    movement_type TEXT NOT NULL
        CHECK (movement_type IN ('purchase_in', 'issue_to_floor', 'consume', 'scrap', 'return', 'adjust')),
    qty NUMERIC(10, 2) NOT NULL CHECK (qty != 0),
    stage_run_id UUID NULL REFERENCES public.production_stage_runs(id) ON DELETE SET NULL,
    notes TEXT NULL,
    created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_material_movements_batch ON public.material_movements(batch_id);
CREATE INDEX IF NOT EXISTS idx_material_movements_type ON public.material_movements(movement_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5b. The ledger is the balance -- plan 4.7
-- ─────────────────────────────────────────────────────────────────────────────
-- "الرصيد بيتحسب من دفتر الحركات، مش عدّاد بيتعدّل."
--
-- material_batches.qty_remaining stays as a column because every screen and
-- index reads it, but nothing is allowed to SET it any more. This trigger
-- recomputes it from the sum of the batch's movements after every ledger write,
-- so the column is a cache that cannot drift rather than a second source of
-- truth that silently disagrees with the ledger.
-- Every batch opens its own ledger. Without this, a batch created any way other
-- than through record_material_purchase would have qty_received but no receipt
-- movement, and the balance below -- which is the SUM of movements -- would
-- start from zero instead of from what actually arrived.
CREATE OR REPLACE FUNCTION public.trg_material_batch_opening_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.material_movements (
        batch_id, warehouse_id, movement_type, qty, notes, created_by
    ) VALUES (
        NEW.id, NEW.warehouse_id, 'purchase_in', NEW.qty_received,
        'رصيد افتتاحي للوت ' || NEW.batch_code, auth.uid()
    );
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_material_batches_opening_movement ON public.material_batches;
CREATE TRIGGER trg_material_batches_opening_movement
    AFTER INSERT ON public.material_batches
    FOR EACH ROW EXECUTE FUNCTION public.trg_material_batch_opening_movement();

CREATE OR REPLACE FUNCTION public.trg_material_batch_balance_from_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_id UUID := COALESCE(NEW.batch_id, OLD.batch_id);
BEGIN
    UPDATE public.material_batches b
       SET qty_remaining = GREATEST(0, COALESCE((
               SELECT SUM(m.qty) FROM public.material_movements m
                WHERE m.batch_id = v_batch_id), 0)),
           updated_at = NOW()
     WHERE b.id = v_batch_id;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_material_movements_rebalance ON public.material_movements;
CREATE TRIGGER trg_material_movements_rebalance
    AFTER INSERT OR UPDATE OR DELETE ON public.material_movements
    FOR EACH ROW EXECUTE FUNCTION public.trg_material_batch_balance_from_ledger();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Purchases & Invoices
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.material_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
    invoice_ref TEXT NOT NULL,
    purchase_date DATE NOT NULL,
    total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    -- RESTRICT, not SET NULL. This column is the only thread tying the stock
    -- that arrived to the money that left. Letting a delete quietly cut it
    -- leaves an invoice with no expense behind it and nobody able to tell the
    -- expense ever existed. Cancelling a purchase goes through
    -- cancel_material_purchase, which reverses both sides together.
    transaction_id UUID NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'cancelled')),
    notes TEXT NULL,
    created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.material_purchase_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id UUID NOT NULL REFERENCES public.material_purchases(id) ON DELETE CASCADE,
    material_id UUID NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
    batch_code TEXT NOT NULL,
    qty NUMERIC(10, 2) NOT NULL CHECK (qty > 0),
    unit_cost NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    expiry_date DATE NULL,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    batch_id UUID NULL REFERENCES public.material_batches(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_material_purchases_supplier ON public.material_purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_material_purchase_items_purchase ON public.material_purchase_items(purchase_id);

-- material_batches.purchase_id was declared as a bare UUID because
-- material_purchases is defined further down this file. Declared late, but
-- declared: without it a batch can point at a purchase that does not exist and
-- the unit cost behind it becomes untraceable.
ALTER TABLE public.material_batches
    DROP CONSTRAINT IF EXISTS material_batches_purchase_id_fkey;
ALTER TABLE public.material_batches
    ADD CONSTRAINT material_batches_purchase_id_fkey
    FOREIGN KEY (purchase_id) REFERENCES public.material_purchases(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_material_batches_purchase ON public.material_batches(purchase_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Stage Material Bindings (Which stage consumes what)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.stage_material_bindings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stage_id UUID NOT NULL REFERENCES public.production_stages(id) ON DELETE CASCADE,
    material_id UUID NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
    route_id UUID NULL REFERENCES public.production_routes(id) ON DELETE CASCADE,
    consumption_mode TEXT NOT NULL DEFAULT 'depletion'
        CHECK (consumption_mode IN ('depletion', 'per_unit_qty')),
    qty_per_unit NUMERIC(10, 4) NULL,
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stage_material_bindings_unique
    ON public.stage_material_bindings (stage_id, material_id, COALESCE(route_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Material Batch Usage (Attribution of crown units to open batches)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.material_batch_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.material_batches(id) ON DELETE RESTRICT,
    stage_run_id UUID NOT NULL REFERENCES public.production_stage_runs(id) ON DELETE CASCADE,
    units_attributed NUMERIC(10, 2) NOT NULL CHECK (units_attributed >= 0),
    attributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_batch_stage_run UNIQUE (batch_id, stage_run_id)
);

CREATE INDEX IF NOT EXISTS idx_material_batch_usage_batch ON public.material_batch_usage(batch_id);
CREATE INDEX IF NOT EXISTS idx_material_batch_usage_run ON public.material_batch_usage(stage_run_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Atomic RPCs
-- ─────────────────────────────────────────────────────────────────────────────

-- 9.1 Open a material batch (Technician tap 1)
CREATE OR REPLACE FUNCTION public.open_material_batch(
    p_batch_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch public.material_batches%ROWTYPE;
    v_user_id UUID := auth.uid();
    v_role TEXT := public.get_my_role();
BEGIN
    IF v_role NOT IN ('admin', 'lab', 'technician') THEN
        RAISE EXCEPTION 'ليس لديك صلاحية فتح خامة';
    END IF;

    SELECT * INTO v_batch FROM public.material_batches WHERE id = p_batch_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'اللوت غير موجود';
    END IF;

    IF v_batch.status = 'open' THEN
        RETURN to_jsonb(v_batch);
    END IF;

    IF v_batch.status IN ('depleted', 'scrapped') THEN
        RAISE EXCEPTION 'لا يمكن فتح لوت منتهي أو تالف';
    END IF;

    UPDATE public.material_batches
       SET status = 'open',
           opened_at = COALESCE(opened_at, NOW()),
           opened_by = COALESCE(opened_by, v_user_id),
           updated_at = NOW()
     WHERE id = p_batch_id
     RETURNING * INTO v_batch;

    RETURN to_jsonb(v_batch);
END;
$$;

-- 9.2 Deplete a material batch (Technician tap 2)
CREATE OR REPLACE FUNCTION public.deplete_material_batch(
    p_batch_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch public.material_batches%ROWTYPE;
    v_user_id UUID := auth.uid();
    v_role TEXT := public.get_my_role();
    v_total_units NUMERIC;
BEGIN
    IF v_role NOT IN ('admin', 'lab', 'technician') THEN
        RAISE EXCEPTION 'ليس لديك صلاحية إغلاق خامة';
    END IF;

    SELECT * INTO v_batch FROM public.material_batches WHERE id = p_batch_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'اللوت غير موجود';
    END IF;

    IF v_batch.status = 'depleted' THEN
        RETURN to_jsonb(v_batch);
    END IF;

    -- Record consumption movement for remaining qty
    IF v_batch.qty_remaining > 0 THEN
        INSERT INTO public.material_movements (
            batch_id, warehouse_id, movement_type, qty, notes, created_by
        ) VALUES (
            p_batch_id, v_batch.warehouse_id, 'consume', -v_batch.qty_remaining,
            'استنفاد الديسك بالكامل', v_user_id
        );
    END IF;

    -- qty_remaining is not set here. The 'consume' movement above already
    -- drives it to zero through trg_material_movements_rebalance; writing it
    -- again would be the second source of truth this design exists to avoid.
    UPDATE public.material_batches
       SET status = 'depleted',
           depleted_at = NOW(),
           depleted_by = v_user_id,
           updated_at = NOW()
     WHERE id = p_batch_id
     RETURNING * INTO v_batch;

    -- Calculate total units attributed
    SELECT COALESCE(SUM(units_attributed), 0) INTO v_total_units
      FROM public.material_batch_usage
     WHERE batch_id = p_batch_id;

    RETURN jsonb_build_object(
        'batch', to_jsonb(v_batch),
        'total_units_produced', v_total_units,
        'effective_unit_cost', CASE WHEN v_total_units > 0 THEN ROUND(v_batch.unit_cost / v_total_units, 2) ELSE v_batch.unit_cost END
    );
END;
$$;

-- 9.3 Record a Material Purchase Atomically
CREATE OR REPLACE FUNCTION public.record_material_purchase(
    p_supplier_id UUID,
    p_invoice_ref TEXT,
    p_purchase_date DATE,
    p_items JSONB, -- array of {material_id, warehouse_id, batch_code, qty, unit_cost, expiry_date, attributes}
    p_notes TEXT DEFAULT NULL,
    p_cashbox_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_purchase public.material_purchases%ROWTYPE;
    v_supplier public.suppliers%ROWTYPE;
    v_user_id UUID := auth.uid();
    v_role TEXT := public.get_my_role();
    v_item JSONB;
    v_material_id UUID;
    v_warehouse_id UUID;
    v_batch_code TEXT;
    v_qty NUMERIC;
    v_unit_cost NUMERIC;
    v_expiry_date DATE;
    v_attrs JSONB;
    v_total NUMERIC := 0;
    v_batch_id UUID;
    v_tx_id UUID := NULL;
    v_default_warehouse_id UUID;
BEGIN
    IF v_role NOT IN ('admin', 'accountant') THEN
        RAISE EXCEPTION 'صلاحية تسجيل المشتريات للأدمن والمحاسب فقط';
    END IF;

    SELECT * INTO v_supplier FROM public.suppliers WHERE id = p_supplier_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'المورد غير موجود';
    END IF;

    IF NULLIF(btrim(p_invoice_ref), '') IS NULL THEN
        RAISE EXCEPTION 'رقم الفاتورة مطلوب';
    END IF;

    IF jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'الفاتورة يجب أن تحتوي على صنف واحد على الأقل';
    END IF;

    SELECT id INTO v_default_warehouse_id FROM public.warehouses WHERE is_default = TRUE LIMIT 1;

    -- Compute total
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_qty := (v_item->>'qty')::numeric;
        v_unit_cost := (v_item->>'unit_cost')::numeric;
        IF v_qty <= 0 THEN RAISE EXCEPTION 'الكمية يجب أن تكون أكبر من صفر'; END IF;
        IF v_unit_cost < 0 THEN RAISE EXCEPTION 'سعر الوحدة لا يمكن أن يكون سالباً'; END IF;
        v_total := v_total + (v_qty * v_unit_cost);
    END LOOP;

    -- Create Finance Expense Transaction in transactions table
    IF v_total > 0 THEN
        INSERT INTO public.transactions (
            type, amount, category, description, date, effective_date,
            entity_type, entity_id, cashbox_id, status, is_approved, is_registered
        ) VALUES (
            'expense', v_total, 'خامات ومستهلكات',
            'فاتورة مشتريات خامات: ' || btrim(p_invoice_ref) || ' (' || v_supplier.name || ')',
            p_purchase_date, p_purchase_date,
            'supplier', p_supplier_id, p_cashbox_id, 'approved', TRUE, FALSE
        ) RETURNING id INTO v_tx_id;
    END IF;

    -- Create Purchase header
    INSERT INTO public.material_purchases (
        supplier_id, invoice_ref, purchase_date, total_amount,
        transaction_id, status, notes, created_by
    ) VALUES (
        p_supplier_id, btrim(p_invoice_ref), p_purchase_date, v_total,
        v_tx_id, 'received', p_notes, v_user_id
    ) RETURNING * INTO v_purchase;

    -- Insert Items, Batches & Ledger Movements
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_material_id := (v_item->>'material_id')::uuid;
        v_warehouse_id := COALESCE((v_item->>'warehouse_id')::uuid, v_default_warehouse_id);
        v_batch_code := COALESCE(NULLIF(btrim(v_item->>'batch_code'), ''), 'LOT-' || to_char(NOW(), 'YYYYMMDD-HH24MISS'));
        v_qty := (v_item->>'qty')::numeric;
        v_unit_cost := (v_item->>'unit_cost')::numeric;
        v_expiry_date := (v_item->>'expiry_date')::date;
        v_attrs := COALESCE(v_item->'attributes', '{}'::jsonb);

        -- Create Batch
        INSERT INTO public.material_batches (
            material_id, warehouse_id, batch_code, supplier_id, purchase_id,
            qty_received, qty_remaining, unit_cost, expiry_date, attributes, status
        ) VALUES (
            v_material_id, v_warehouse_id, v_batch_code, p_supplier_id, v_purchase.id,
            v_qty, v_qty, v_unit_cost, v_expiry_date, v_attrs, 'sealed'
        ) RETURNING id INTO v_batch_id;

        -- Create Purchase Item
        INSERT INTO public.material_purchase_items (
            purchase_id, material_id, warehouse_id, batch_code, qty, unit_cost,
            expiry_date, attributes, batch_id
        ) VALUES (
            v_purchase.id, v_material_id, v_warehouse_id, v_batch_code, v_qty, v_unit_cost,
            v_expiry_date, v_attrs, v_batch_id
        );

        -- The receipt movement is written by trg_material_batches_opening_movement
        -- when the batch row is inserted above. Adding it again here would
        -- double the stock. Only the invoice reference is stamped on it.
        UPDATE public.material_movements
           SET notes = 'وارد مشتريات فاتورة ' || btrim(p_invoice_ref),
               created_by = v_user_id
         WHERE batch_id = v_batch_id
           AND movement_type = 'purchase_in';
    END LOOP;

    RETURN jsonb_build_object(
        'purchase', to_jsonb(v_purchase),
        'transaction_id', v_tx_id
    );
END;
$$;

-- 9.3b Cancel a material purchase -- reverses stock and money together
--
-- material_purchases.status has always had a 'cancelled' value with nothing
-- able to set it, so a wrong invoice could only be fixed by deleting the
-- expense straight out of the finance screen, which left the purchase pointing
-- at nothing. This reverses both sides in one transaction, and refuses when the
-- stock has already been touched -- consumed material cannot be un-bought.
CREATE OR REPLACE FUNCTION public.cancel_material_purchase(
    p_purchase_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT := public.get_my_role();
    v_user_id UUID := auth.uid();
    v_purchase public.material_purchases%ROWTYPE;
    v_touched INT;
    v_batches INT := 0;
BEGIN
    IF v_role NOT IN ('admin', 'accountant') THEN
        RAISE EXCEPTION 'صلاحية إلغاء فواتير المشتريات للأدمن والمحاسب فقط';
    END IF;

    IF NULLIF(btrim(p_reason), '') IS NULL THEN
        RAISE EXCEPTION 'سبب الإلغاء مطلوب';
    END IF;

    SELECT * INTO v_purchase FROM public.material_purchases WHERE id = p_purchase_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الفاتورة غير موجودة';
    END IF;

    IF v_purchase.status = 'cancelled' THEN
        RETURN jsonb_build_object('success', TRUE, 'message', 'الفاتورة ملغاة بالفعل');
    END IF;

    -- Any movement other than the original purchase_in means the stock has been
    -- issued, consumed, scrapped or counted. Reversing then would rewrite
    -- history that production already depends on.
    SELECT COUNT(*) INTO v_touched
      FROM public.material_movements m
      JOIN public.material_batches b ON b.id = m.batch_id
     WHERE b.purchase_id = p_purchase_id
       AND m.movement_type <> 'purchase_in';

    IF v_touched > 0 THEN
        RAISE EXCEPTION 'لا يمكن إلغاء الفاتورة: الخامات اتحركت في المخزن بالفعل (% حركة). اعمل تسوية جردية بدل الإلغاء', v_touched;
    END IF;

    -- Reverse the stock: a contra movement, never a delete. The ledger stays
    -- auditable and trg_material_movements_rebalance drives the balance to zero.
    INSERT INTO public.material_movements (batch_id, warehouse_id, movement_type, qty, notes, created_by)
    SELECT b.id, b.warehouse_id, 'return', -b.qty_received,
           'إلغاء فاتورة ' || v_purchase.invoice_ref || ': ' || btrim(p_reason), v_user_id
      FROM public.material_batches b
     WHERE b.purchase_id = p_purchase_id;

    GET DIAGNOSTICS v_batches = ROW_COUNT;

    UPDATE public.material_batches
       SET status = 'scrapped', updated_at = NOW()
     WHERE purchase_id = p_purchase_id;

    -- Reverse the money through the same table the purchase used. The original
    -- expense row is kept and a contra row is added, because a deleted
    -- transaction is a hole in the supplier account nobody can explain.
    IF v_purchase.transaction_id IS NOT NULL THEN
        INSERT INTO public.transactions (
            type, amount, category, description, date, effective_date,
            entity_type, entity_id, status, is_approved, is_registered
        )
        SELECT 'income', t.amount, t.category,
               'إلغاء فاتورة خامات: ' || v_purchase.invoice_ref || ' — ' || btrim(p_reason),
               CURRENT_DATE, CURRENT_DATE,
               t.entity_type, t.entity_id, 'approved', TRUE, FALSE
          FROM public.transactions t
         WHERE t.id = v_purchase.transaction_id;
    END IF;

    UPDATE public.material_purchases
       SET status = 'cancelled',
           notes = COALESCE(notes || E'\n', '') || '[إلغاء]: ' || btrim(p_reason),
           updated_at = NOW()
     WHERE id = p_purchase_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'purchase_id', p_purchase_id,
        'batches_reversed', v_batches,
        'transaction_reversed', (v_purchase.transaction_id IS NOT NULL)
    );
END;
$$;

-- 9.4 Stock Adjustment RPC (For inventory counts/discrepancies)
CREATE OR REPLACE FUNCTION public.adjust_material_batch(
    p_batch_id UUID,
    p_new_qty NUMERIC,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch public.material_batches%ROWTYPE;
    v_diff NUMERIC;
    v_user_id UUID := auth.uid();
    v_role TEXT := public.get_my_role();
BEGIN
    IF v_role NOT IN ('admin', 'accountant', 'lab') THEN
        RAISE EXCEPTION 'ليس لديك صلاحية تسوية المخزون';
    END IF;

    IF p_new_qty < 0 THEN
        RAISE EXCEPTION 'الكمية لا يمكن أن تكون سالبة';
    END IF;

    SELECT * INTO v_batch FROM public.material_batches WHERE id = p_batch_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'اللوت غير موجود';
    END IF;

    v_diff := p_new_qty - v_batch.qty_remaining;
    IF v_diff = 0 THEN
        RETURN to_jsonb(v_batch);
    END IF;

    -- Record Adjustment Movement
    INSERT INTO public.material_movements (
        batch_id, warehouse_id, movement_type, qty, notes, created_by
    ) VALUES (
        p_batch_id, v_batch.warehouse_id, 'adjust', v_diff,
        COALESCE(p_reason, 'تسوية جردية'), v_user_id
    );

    -- The 'adjust' movement above is what changes the balance; the rebalance
    -- trigger has already applied it. Only the status is decided here.
    UPDATE public.material_batches
       SET status = CASE WHEN p_new_qty = 0 THEN 'depleted' ELSE v_batch.status END,
           depleted_at = CASE WHEN p_new_qty = 0 THEN COALESCE(depleted_at, NOW()) ELSE depleted_at END,
           depleted_by = CASE WHEN p_new_qty = 0 THEN COALESCE(depleted_by, v_user_id) ELSE depleted_by END,
           updated_at = NOW()
     WHERE id = p_batch_id
     RETURNING * INTO v_batch;

    RETURN to_jsonb(v_batch);
END;
$$;

-- 9.5 Auto-attribute units to open batches when a stage run completes
--
-- Wrapped in the same deliberate swallow as trg_sync_production_from_order
-- (20260827000000). This is material bookkeeping hanging off the side of a
-- stage transition: an exception here would abort the enclosing statement,
-- which is a technician finishing a case. A missing attribution is a gap in a
-- cost report; a failed transition stops the bench. The warning goes to the
-- Postgres log and the gap shows up as an uncosted batch.
CREATE OR REPLACE FUNCTION public.trg_attribute_material_usage_on_stage_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_stage_id UUID := NEW.stage_id;
    v_passed_units NUMERIC := COALESCE(NEW.units_passed, NEW.units_in, 1);
    v_binding RECORD;
    v_open_batch RECORD;
BEGIN
    -- Nothing to attribute until the lab is actually consuming its own stock.
    -- Before then this fires on every reconciler-driven stage update for no
    -- reason. Cheap guard, and it keeps the pre-opening period completely inert.
    IF NOT EXISTS (SELECT 1 FROM public.stage_material_bindings WHERE stage_id = v_stage_id) THEN
        RETURN NEW;
    END IF;

    -- Only trigger when stage run transitions to done or has completed_at newly stamped
    IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done' OR OLD.completed_at IS NULL) THEN
        -- Find all materials bound to this stage
        FOR v_binding IN
            SELECT b.material_id, b.consumption_mode, b.qty_per_unit
              FROM public.stage_material_bindings b
             WHERE b.stage_id = v_stage_id
        LOOP
            -- Look for an open batch for this material
            SELECT mb.id, mb.qty_remaining
              INTO v_open_batch
              FROM public.material_batches mb
             WHERE mb.material_id = v_binding.material_id
               AND mb.status = 'open'
             ORDER BY mb.opened_at ASC
             LIMIT 1;

            IF FOUND THEN
                -- Record attribution
                INSERT INTO public.material_batch_usage (
                    batch_id, stage_run_id, units_attributed, attributed_at
                ) VALUES (
                    v_open_batch.id, NEW.id, v_passed_units, NOW()
                )
                ON CONFLICT (batch_id, stage_run_id) DO UPDATE
                    SET units_attributed = EXCLUDED.units_attributed,
                        attributed_at = NOW();

                -- If per_unit_qty mode, deduct quantity immediately in ledger.
                -- The movement is the only write: trg_material_movements_rebalance
                -- recomputes qty_remaining from it, so the balance can never
                -- disagree with the ledger.
                IF v_binding.consumption_mode = 'per_unit_qty' AND COALESCE(v_binding.qty_per_unit, 0) > 0 THEN
                    DECLARE
                        v_deduct_qty NUMERIC := v_passed_units * v_binding.qty_per_unit;
                    BEGIN
                        INSERT INTO public.material_movements (
                            batch_id, warehouse_id, movement_type, qty, stage_run_id, notes, created_by
                        ) VALUES (
                            v_open_batch.id, (SELECT warehouse_id FROM public.material_batches WHERE id = v_open_batch.id),
                            'consume', -v_deduct_qty, NEW.id, 'استهلاك تلقائي لأمر التشغيل', auth.uid()
                        );

                        UPDATE public.material_batches
                           SET status      = CASE WHEN qty_remaining <= 0 THEN 'depleted' ELSE status END,
                               depleted_at = CASE WHEN qty_remaining <= 0 THEN COALESCE(depleted_at, NOW()) ELSE depleted_at END,
                               depleted_by = CASE WHEN qty_remaining <= 0 THEN COALESCE(depleted_by, auth.uid()) ELSE depleted_by END,
                               updated_at  = NOW()
                         WHERE id = v_open_batch.id;
                    END;
                END IF;
            END IF;
        END LOOP;
    END IF;

    RETURN NEW;

EXCEPTION WHEN OTHERS THEN
    -- DELIBERATE SWALLOW -- see the header above. Material bookkeeping must
    -- never be able to block a technician finishing a case.
    RAISE WARNING 'material attribution for stage_run % failed: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_production_stage_run_material_attribution ON public.production_stage_runs;
CREATE TRIGGER trg_production_stage_run_material_attribution
    AFTER UPDATE ON public.production_stage_runs
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_attribute_material_usage_on_stage_complete();

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. RLS Policies
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stage_material_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_batch_usage ENABLE ROW LEVEL SECURITY;

-- Read policies: staff (admin, lab, technician, accountant, designer) can view inventory
DROP POLICY IF EXISTS "Staff can read warehouses" ON public.warehouses;
CREATE POLICY "Staff can read warehouses" ON public.warehouses
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'lab', 'technician', 'accountant', 'designer', 'representative'));

DROP POLICY IF EXISTS "Staff can read materials" ON public.materials;
CREATE POLICY "Staff can read materials" ON public.materials
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'lab', 'technician', 'accountant', 'designer', 'representative'));

DROP POLICY IF EXISTS "Staff can read material batches" ON public.material_batches;
CREATE POLICY "Staff can read material batches" ON public.material_batches
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'lab', 'technician', 'accountant', 'designer', 'representative'));

DROP POLICY IF EXISTS "Staff can read material movements" ON public.material_movements;
CREATE POLICY "Staff can read material movements" ON public.material_movements
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'lab', 'technician', 'accountant'));

DROP POLICY IF EXISTS "Staff can read material purchases" ON public.material_purchases;
CREATE POLICY "Staff can read material purchases" ON public.material_purchases
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'accountant', 'lab'));

DROP POLICY IF EXISTS "Staff can read material purchase items" ON public.material_purchase_items;
CREATE POLICY "Staff can read material purchase items" ON public.material_purchase_items
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'accountant', 'lab'));

DROP POLICY IF EXISTS "Staff can read stage bindings" ON public.stage_material_bindings;
CREATE POLICY "Staff can read stage bindings" ON public.stage_material_bindings
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'lab', 'technician', 'accountant'));

DROP POLICY IF EXISTS "Staff can read batch usage" ON public.material_batch_usage;
CREATE POLICY "Staff can read batch usage" ON public.material_batch_usage
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('admin', 'lab', 'technician', 'accountant'));

-- Write policies: Admin & Accountant manage catalog, purchases and bindings
DROP POLICY IF EXISTS "Admins manage warehouses" ON public.warehouses;
CREATE POLICY "Admins manage warehouses" ON public.warehouses
    FOR ALL TO authenticated
    USING (public.get_my_role() = 'admin')
    WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "Admins manage materials" ON public.materials;
CREATE POLICY "Admins manage materials" ON public.materials
    FOR ALL TO authenticated
    USING (public.get_my_role() = 'admin')
    WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "Admins manage material batches" ON public.material_batches;
CREATE POLICY "Admins manage material batches" ON public.material_batches
    FOR ALL TO authenticated
    USING (public.get_my_role() = 'admin')
    WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "Admins manage material movements" ON public.material_movements;
CREATE POLICY "Admins manage material movements" ON public.material_movements
    FOR ALL TO authenticated
    USING (public.get_my_role() = 'admin')
    WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "Admins manage stage bindings" ON public.stage_material_bindings;
CREATE POLICY "Admins manage stage bindings" ON public.stage_material_bindings
    FOR ALL TO authenticated
    USING (public.get_my_role() = 'admin')
    WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "Admins and accountants manage purchases" ON public.material_purchases;
CREATE POLICY "Admins and accountants manage purchases" ON public.material_purchases
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('admin', 'accountant'))
    WITH CHECK (public.get_my_role() IN ('admin', 'accountant'));

-- Revoke execute from PUBLIC and anon, and grant to authenticated
REVOKE ALL ON FUNCTION public.open_material_batch(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deplete_material_batch(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_material_purchase(UUID, TEXT, DATE, JSONB, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.adjust_material_batch(UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_material_purchase(UUID, TEXT) FROM PUBLIC, anon;
-- Trigger bodies are never called directly.
REVOKE ALL ON FUNCTION public.trg_material_batch_balance_from_ledger() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_material_batch_opening_movement() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_attribute_material_usage_on_stage_complete() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.open_material_batch(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deplete_material_batch(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_material_purchase(UUID, TEXT, DATE, JSONB, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_material_batch(UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_material_purchase(UUID, TEXT) TO authenticated;

COMMIT;
