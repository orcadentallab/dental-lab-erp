/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Material & Inventory Service (Phase 3)
 *
 * Provides typed operations for raw materials, warehouses, batches, movements,
 * purchases, stage bindings, and the 2-tap technician depletion workflow.
 */

import { supabase } from '../../lib/supabase';
import { ErrorHandler } from '../../lib/errorHandler';

export type MaterialCategory =
    | 'zirconia'
    | 'emax'
    | 'pmma'
    | 'resin'
    | 'powder'
    | 'stain_glaze'
    | 'packaging'
    | 'other';

export type MaterialUnit = 'disc' | 'block' | 'ml' | 'g' | 'piece' | 'bottle' | 'box';
export type TrackingMode = 'batch_depletion' | 'quantity';
export type BatchStatus = 'sealed' | 'open' | 'depleted' | 'scrapped';
export type MovementType = 'purchase_in' | 'issue_to_floor' | 'consume' | 'scrap' | 'return' | 'adjust';
export type SupplierType = 'external_lab' | 'material_vendor' | 'courier';

export interface Warehouse {
    id: string;
    code: string;
    nameAr: string;
    isDefault: boolean;
    isActive: boolean;
}

export interface Material {
    id: string;
    code: string;
    nameAr: string;
    category: MaterialCategory;
    unit: MaterialUnit;
    trackingMode: TrackingMode;
    attributes: Record<string, unknown>;
    expectedUnitsPerBatch: number | null;
    reorderPoint: number;
    isActive: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface MaterialBatch {
    id: string;
    materialId: string;
    warehouseId: string;
    batchCode: string;
    supplierId: string | null;
    purchaseId: string | null;
    qtyReceived: number;
    qtyRemaining: number;
    unitCost: number;
    expiryDate: string | null;
    attributes: Record<string, unknown>;
    status: BatchStatus;
    openedAt: string | null;
    openedBy: string | null;
    depletedAt: string | null;
    depletedBy: string | null;
    createdAt?: string;
    // Joined fields
    materialName?: string;
    materialCategory?: MaterialCategory;
    materialUnit?: MaterialUnit;
    warehouseName?: string;
    supplierName?: string;
}

export interface MaterialMovement {
    id: string;
    batchId: string;
    warehouseId: string;
    movementType: MovementType;
    qty: number;
    stageRunId: string | null;
    notes: string | null;
    createdBy: string | null;
    createdAt: string;
    // Joined fields
    batchCode?: string;
    materialName?: string;
}

export interface MaterialPurchase {
    id: string;
    supplierId: string;
    invoiceRef: string;
    purchaseDate: string;
    totalAmount: number;
    transactionId: string | null;
    status: 'received' | 'cancelled';
    notes: string | null;
    createdBy: string | null;
    createdAt: string;
    supplierName?: string;
}

export interface MaterialPurchaseItemPayload {
    material_id: string;
    warehouse_id?: string;
    batch_code: string;
    qty: number;
    unit_cost: number;
    expiry_date?: string | null;
    attributes?: Record<string, unknown>;
}

export interface StageMaterialBinding {
    id: string;
    stageId: string;
    materialId: string;
    routeId: string | null;
    consumptionMode: 'depletion' | 'per_unit_qty';
    qtyPerUnit: number | null;
    isRequired: boolean;
    materialName?: string;
    materialCode?: string;
    stageName?: string;
}

export interface InventorySummary {
    totalMaterials: number;
    totalActiveBatches: number;
    openBatchesCount: number;
    lowStockCount: number;
    expiringSoonCount: number;
}

export const materialService = {
    // ─── Warehouses ───────────────────────────────────────────────────────────
    async getWarehouses(): Promise<Warehouse[]> {
        const { data, error } = await supabase
            .from('warehouses')
            .select('id, code, name_ar, is_default, is_active')
            .order('is_default', { ascending: false });

        if (error) throw ErrorHandler.handle(error);
        return (data || []).map(w => ({
            id: w.id,
            code: w.code,
            nameAr: w.name_ar,
            isDefault: w.is_default,
            isActive: w.is_active,
        }));
    },

    // ─── Materials ────────────────────────────────────────────────────────────
    async getMaterials(activeOnly = true): Promise<Material[]> {
        let query = supabase
            .from('materials')
            .select('*')
            .order('name_ar');

        if (activeOnly) {
            query = query.eq('is_active', true);
        }

        const { data, error } = await query;
        if (error) throw ErrorHandler.handle(error);

        return (data || []).map(m => ({
            id: m.id,
            code: m.code,
            nameAr: m.name_ar,
            category: m.category,
            unit: m.unit,
            trackingMode: m.tracking_mode,
            attributes: m.attributes || {},
            expectedUnitsPerBatch: m.expected_units_per_batch ? Number(m.expected_units_per_batch) : null,
            reorderPoint: Number(m.reorder_point || 0),
            isActive: m.is_active,
            createdAt: m.created_at,
            updatedAt: m.updated_at,
        }));
    },

    async createMaterial(payload: Omit<Material, 'id' | 'createdAt' | 'updatedAt'>): Promise<Material> {
        const { data, error } = await supabase
            .from('materials')
            .insert({
                code: payload.code,
                name_ar: payload.nameAr,
                category: payload.category,
                unit: payload.unit,
                tracking_mode: payload.trackingMode,
                attributes: payload.attributes,
                expected_units_per_batch: payload.expectedUnitsPerBatch,
                reorder_point: payload.reorderPoint,
                is_active: payload.isActive,
            })
            .select()
            .single();

        if (error) throw ErrorHandler.handle(error);
        return {
            id: data.id,
            code: data.code,
            nameAr: data.name_ar,
            category: data.category,
            unit: data.unit,
            trackingMode: data.tracking_mode,
            attributes: data.attributes || {},
            expectedUnitsPerBatch: data.expected_units_per_batch ? Number(data.expected_units_per_batch) : null,
            reorderPoint: Number(data.reorder_point || 0),
            isActive: data.is_active,
        };
    },

    async updateMaterial(id: string, updates: Partial<Material>): Promise<void> {
        const dbUpdates: Record<string, unknown> = {};
        if (updates.nameAr !== undefined) dbUpdates.name_ar = updates.nameAr;
        if (updates.category !== undefined) dbUpdates.category = updates.category;
        if (updates.unit !== undefined) dbUpdates.unit = updates.unit;
        if (updates.trackingMode !== undefined) dbUpdates.tracking_mode = updates.trackingMode;
        if (updates.attributes !== undefined) dbUpdates.attributes = updates.attributes;
        if (updates.expectedUnitsPerBatch !== undefined) dbUpdates.expected_units_per_batch = updates.expectedUnitsPerBatch;
        if (updates.reorderPoint !== undefined) dbUpdates.reorder_point = updates.reorderPoint;
        if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;

        const { error } = await supabase
            .from('materials')
            .update(dbUpdates)
            .eq('id', id);

        if (error) throw ErrorHandler.handle(error);
    },

    // ─── Batches ──────────────────────────────────────────────────────────────
    async getBatches(statusFilter?: BatchStatus[]): Promise<MaterialBatch[]> {
        let query = supabase
            .from('material_batches')
            .select(`
                *,
                materials (name_ar, category, unit),
                warehouses (name_ar),
                suppliers (name)
            `)
            .order('created_at', { ascending: false });

        if (statusFilter && statusFilter.length > 0) {
            query = query.in('status', statusFilter);
        }

        const { data, error } = await query;
        if (error) throw ErrorHandler.handle(error);

        return (data || []).map((b: any) => ({
            id: b.id,
            materialId: b.material_id,
            warehouseId: b.warehouse_id,
            batchCode: b.batch_code,
            supplierId: b.supplier_id,
            purchaseId: b.purchase_id,
            qtyReceived: Number(b.qty_received),
            qtyRemaining: Number(b.qty_remaining),
            unitCost: Number(b.unit_cost),
            expiryDate: b.expiry_date,
            attributes: b.attributes || {},
            status: b.status,
            openedAt: b.opened_at,
            openedBy: b.opened_by,
            depletedAt: b.depleted_at,
            depletedBy: b.depleted_by,
            createdAt: b.created_at,
            materialName: b.materials?.name_ar,
            materialCategory: b.materials?.category,
            materialUnit: b.materials?.unit,
            warehouseName: b.warehouses?.name_ar,
            supplierName: b.suppliers?.name,
        }));
    },

    async getOpenBatchesForStage(stageId: string): Promise<MaterialBatch[]> {
        // Find bound materials for stage
        const { data: bindings, error: bindErr } = await supabase
            .from('stage_material_bindings')
            .select('material_id')
            .eq('stage_id', stageId);

        if (bindErr) throw ErrorHandler.handle(bindErr);
        if (!bindings || bindings.length === 0) return [];

        const materialIds = bindings.map(b => b.material_id);

        const { data: batches, error: batchErr } = await supabase
            .from('material_batches')
            .select(`
                *,
                materials (name_ar, category, unit),
                warehouses (name_ar)
            `)
            .in('material_id', materialIds)
            .in('status', ['open', 'sealed'])
            .order('status', { ascending: false }) // 'open' before 'sealed'
            .order('opened_at', { ascending: true });

        if (batchErr) throw ErrorHandler.handle(batchErr);

        return (batches || []).map((b: any) => ({
            id: b.id,
            materialId: b.material_id,
            warehouseId: b.warehouse_id,
            batchCode: b.batch_code,
            supplierId: b.supplier_id,
            purchaseId: b.purchase_id,
            qtyReceived: Number(b.qty_received),
            qtyRemaining: Number(b.qty_remaining),
            unitCost: Number(b.unit_cost),
            expiryDate: b.expiry_date,
            attributes: b.attributes || {},
            status: b.status,
            openedAt: b.opened_at,
            openedBy: b.opened_by,
            depletedAt: b.depleted_at,
            depletedBy: b.depleted_by,
            materialName: b.materials?.name_ar,
            materialCategory: b.materials?.category,
            materialUnit: b.materials?.unit,
            warehouseName: b.warehouses?.name_ar,
        }));
    },

    // ─── 2-Tap Technician RPCs ─────────────────────────────────────────────────
    async openBatch(batchId: string): Promise<void> {
        const { error } = await supabase.rpc('open_material_batch', {
            p_batch_id: batchId,
        });
        if (error) throw ErrorHandler.handle(error);
    },

    async depleteBatch(batchId: string): Promise<{ totalUnits: number; unitCost: number }> {
        const { data, error } = await supabase.rpc('deplete_material_batch', {
            p_batch_id: batchId,
        });
        if (error) throw ErrorHandler.handle(error);
        return {
            totalUnits: Number(data?.total_units_produced || 0),
            unitCost: Number(data?.effective_unit_cost || 0),
        };
    },

    async adjustBatch(batchId: string, newQty: number, reason: string): Promise<void> {
        const { error } = await supabase.rpc('adjust_material_batch', {
            p_batch_id: batchId,
            p_new_qty: newQty,
            p_reason: reason,
        });
        if (error) throw ErrorHandler.handle(error);
    },

    // ─── Purchases ────────────────────────────────────────────────────────────
    async getPurchases(): Promise<MaterialPurchase[]> {
        const { data, error } = await supabase
            .from('material_purchases')
            .select(`
                *,
                suppliers (name)
            `)
            .order('purchase_date', { ascending: false });

        if (error) throw ErrorHandler.handle(error);
        return (data || []).map((p: any) => ({
            id: p.id,
            supplierId: p.supplier_id,
            invoiceRef: p.invoice_ref,
            purchaseDate: p.purchase_date,
            totalAmount: Number(p.total_amount),
            transactionId: p.transaction_id,
            status: p.status,
            notes: p.notes,
            createdBy: p.created_by,
            createdAt: p.created_at,
            supplierName: p.suppliers?.name,
        }));
    },

    async recordPurchase(
        supplierId: string,
        invoiceRef: string,
        purchaseDate: string,
        items: MaterialPurchaseItemPayload[],
        notes?: string,
        cashboxId?: string
    ): Promise<string> {
        const { data, error } = await supabase.rpc('record_material_purchase', {
            p_supplier_id: supplierId,
            p_invoice_ref: invoiceRef,
            p_purchase_date: purchaseDate,
            p_items: items,
            p_notes: notes || null,
            p_cashbox_id: cashboxId || null,
        });

        if (error) throw ErrorHandler.handle(error);
        return data?.purchase?.id;
    },

    // ─── Movements Ledger ─────────────────────────────────────────────────────
    async getMovements(limit = 100): Promise<MaterialMovement[]> {
        const { data, error } = await supabase
            .from('material_movements')
            .select(`
                *,
                material_batches (
                    batch_code,
                    materials (name_ar)
                )
            `)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw ErrorHandler.handle(error);
        return (data || []).map((m: any) => ({
            id: m.id,
            batchId: m.batch_id,
            warehouseId: m.warehouse_id,
            movementType: m.movement_type,
            qty: Number(m.qty),
            stageRunId: m.stage_run_id,
            notes: m.notes,
            createdBy: m.created_by,
            createdAt: m.created_at,
            batchCode: m.material_batches?.batch_code,
            materialName: m.material_batches?.materials?.name_ar,
        }));
    },

    // ─── Stage Bindings ───────────────────────────────────────────────────────
    async getStageBindings(): Promise<StageMaterialBinding[]> {
        const { data, error } = await supabase
            .from('stage_material_bindings')
            .select(`
                *,
                materials (name_ar, code),
                production_stages (name_ar)
            `);

        if (error) throw ErrorHandler.handle(error);
        return (data || []).map((b: any) => ({
            id: b.id,
            stageId: b.stage_id,
            materialId: b.material_id,
            routeId: b.route_id,
            consumptionMode: b.consumption_mode,
            qtyPerUnit: b.qty_per_unit ? Number(b.qty_per_unit) : null,
            isRequired: b.is_required,
            materialName: b.materials?.name_ar,
            materialCode: b.materials?.code,
            stageName: b.production_stages?.name_ar,
        }));
    },

    async saveStageBinding(
        stageId: string,
        materialId: string,
        consumptionMode: 'depletion' | 'per_unit_qty',
        qtyPerUnit?: number,
        routeId?: string | null
    ): Promise<void> {
        const { error } = await supabase
            .from('stage_material_bindings')
            .upsert({
                stage_id: stageId,
                material_id: materialId,
                consumption_mode: consumptionMode,
                qty_per_unit: qtyPerUnit || null,
                route_id: routeId || null,
            }, {
                onConflict: 'stage_id, material_id, route_id',
            });

        if (error) throw ErrorHandler.handle(error);
    },

    async deleteStageBinding(bindingId: string): Promise<void> {
        const { error } = await supabase
            .from('stage_material_bindings')
            .delete()
            .eq('id', bindingId);

        if (error) throw ErrorHandler.handle(error);
    },

    // ─── Dashboard Summary ────────────────────────────────────────────────────
    async getInventorySummary(): Promise<InventorySummary> {
        const [materials, batches] = await Promise.all([
            this.getMaterials(true),
            this.getBatches(['sealed', 'open']),
        ]);

        const openBatchesCount = batches.filter(b => b.status === 'open').length;

        // Low stock: sum remaining per material < reorder_point
        let lowStockCount = 0;
        for (const m of materials) {
            if (m.reorderPoint > 0) {
                const totalRemaining = batches
                    .filter(b => b.materialId === m.id)
                    .reduce((sum, b) => sum + b.qtyRemaining, 0);
                if (totalRemaining <= m.reorderPoint) {
                    lowStockCount++;
                }
            }
        }

        // Expiring in next 30 days
        const now = Date.now();
        const in30Days = now + (30 * 24 * 60 * 60 * 1000);
        const expiringSoonCount = batches.filter(b => {
            if (!b.expiryDate) return false;
            const expTime = new Date(b.expiryDate).getTime();
            return expTime > now && expTime <= in30Days;
        }).length;

        return {
            totalMaterials: materials.length,
            totalActiveBatches: batches.length,
            openBatchesCount,
            lowStockCount,
            expiringSoonCount,
        };
    },
};
