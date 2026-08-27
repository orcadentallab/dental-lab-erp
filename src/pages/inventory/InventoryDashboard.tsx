/* eslint-disable @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any */
/**
 * Inventory & Raw Materials Dashboard (Phase 3)
 *
 * Provides full control over:
 * 1. Material Catalog & Stock Levels
 * 2. Physical Batches (Sealed, Open, Depleted) & Expirations
 * 3. Purchases & Invoices linked to Expense Transactions
 * 4. Movement Ledger (Audit Log)
 * 5. Stage Material Bindings
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '../../context/ToastContext';
import {
    materialService,
    type Material,
    type MaterialBatch,
    type MaterialMovement,
    type MaterialPurchase,
    type StageMaterialBinding,
    type Warehouse,
    type MaterialCategory,
    type MaterialUnit,
    type TrackingMode,
    type InventorySummary,
} from '../../services/supabase/materialService';
import { db, type Supplier } from '../../services/db';
import { getStages, type ProductionStage } from '../../services/supabase/production';
import {
    Package,
    Layers,
    ShoppingCart,
    FileText,
    Settings,
    Plus,
    AlertTriangle,
    CheckCircle2,
    RefreshCw,
    X,
    TrendingDown,
    SlidersHorizontal,
} from 'lucide-react';

const CATEGORY_LABELS: Record<MaterialCategory, string> = {
    zirconia: 'زيركونيا (Zirconia)',
    emax: 'إيماكس (E.max)',
    pmma: 'بي إم إم إيه (PMMA)',
    resin: 'ريزن طباعة 3D',
    powder: 'بودرة بورسلين',
    stain_glaze: 'ستين وجليز',
    packaging: 'تغليف وشحن',
    other: 'أخرى',
};

const UNIT_LABELS: Record<MaterialUnit, string> = {
    disc: 'قرص / ديسك',
    block: 'بلوك',
    ml: 'ملليلتر (ml)',
    g: 'جرام (g)',
    piece: 'قطعة',
    bottle: 'زجاجة / عبوة',
    box: 'علبة / صندوق',
};

type TabType = 'batches' | 'catalog' | 'purchases' | 'movements' | 'bindings';

export default function InventoryDashboard() {
    const { success: toastSuccess, error: toastError } = useToast();
    const [activeTab, setActiveTab] = useState<TabType>('batches');
    const [loading, setLoading] = useState(true);

    // Data states
    const [summary, setSummary] = useState<InventorySummary>({
        totalMaterials: 0,
        totalActiveBatches: 0,
        openBatchesCount: 0,
        lowStockCount: 0,
        expiringSoonCount: 0,
    });
    const [materials, setMaterials] = useState<Material[]>([]);
    const [batches, setBatches] = useState<MaterialBatch[]>([]);
    const [movements, setMovements] = useState<MaterialMovement[]>([]);
    const [purchases, setPurchases] = useState<MaterialPurchase[]>([]);
    const [bindings, setBindings] = useState<StageMaterialBinding[]>([]);
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [stages, setStages] = useState<ProductionStage[]>([]);

    // Modals
    const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false);
    const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
    const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
    const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
    const [adjustingBatch, setAdjustingBatch] = useState<MaterialBatch | null>(null);
    const [adjustNewQty, setAdjustNewQty] = useState('');
    const [adjustReason, setAdjustReason] = useState('');
    const [isBindingModalOpen, setIsBindingModalOpen] = useState(false);

    // Filters
    const [batchStatusFilter, setBatchStatusFilter] = useState<'all' | 'open' | 'sealed' | 'depleted'>('open');
    const [materialCategoryFilter, setMaterialCategoryFilter] = useState<string>('all');

    // Forms
    const [materialForm, setMaterialForm] = useState({
        code: '',
        nameAr: '',
        category: 'zirconia' as MaterialCategory,
        unit: 'disc' as MaterialUnit,
        trackingMode: 'batch_depletion' as TrackingMode,
        expectedUnitsPerBatch: 20,
        reorderPoint: 2,
    });

    const [purchaseForm, setPurchaseForm] = useState({
        supplierId: '',
        invoiceRef: '',
        purchaseDate: new Date().toISOString().split('T')[0],
        notes: '',
        items: [
            {
                material_id: '',
                warehouse_id: '',
                batch_code: '',
                qty: 1,
                unit_cost: 0,
                expiry_date: '',
            },
        ],
    });

    const [bindingForm, setBindingForm] = useState({
        stageId: '',
        materialId: '',
        consumptionMode: 'depletion' as 'depletion' | 'per_unit_qty',
        qtyPerUnit: 1,
    });

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [
                summaryRes,
                materialsRes,
                batchesRes,
                movementsRes,
                purchasesRes,
                bindingsRes,
                warehousesRes,
                suppliersRes,
                stagesRes,
            ] = await Promise.all([
                materialService.getInventorySummary(),
                materialService.getMaterials(false),
                materialService.getBatches(),
                materialService.getMovements(100),
                materialService.getPurchases(),
                materialService.getStageBindings(),
                materialService.getWarehouses(),
                db.getSuppliers(),
                getStages(),
            ]);

            setSummary(summaryRes);
            setMaterials(materialsRes);
            setBatches(batchesRes);
            setMovements(movementsRes);
            setPurchases(purchasesRes);
            setBindings(bindingsRes);
            setWarehouses(warehousesRes);
            setSuppliers(suppliersRes);
            setStages(stagesRes);
        } catch (e) {
            console.error('[Inventory] load failed', e);
            toastError('تعذّر تحميل بيانات المخزن');
        } finally {
            setLoading(false);
        }
    }, [toastError]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    // Handle Open/Deplete Batch
    const handleOpenBatch = async (batchId: string) => {
        try {
            await materialService.openBatch(batchId);
            toastSuccess('تم فتح اللوت للتشغيل بنجاح');
            await loadData();
        } catch (e) {
            console.error(e);
            toastError(e instanceof Error ? e.message : 'تعذّر فتح اللوت');
        }
    };

    const handleDepleteBatch = async (batchId: string) => {
        try {
            const res = await materialService.depleteBatch(batchId);
            toastSuccess(`تم استنفاد الديسك بنجاح. أنتج ${res.totalUnits} وحدة بتكلفة ${res.unitCost} ج.م للوحدة.`);
            await loadData();
        } catch (e) {
            console.error(e);
            toastError(e instanceof Error ? e.message : 'تعذّر استنفاد اللوت');
        }
    };

    const handleSaveAdjustment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!adjustingBatch) return;
        const newQtyNum = Number(adjustNewQty);
        if (isNaN(newQtyNum) || newQtyNum < 0) {
            toastError('الكمية يجب أن تكون رقماً موجباً أو صفراً');
            return;
        }

        try {
            await materialService.adjustBatch(adjustingBatch.id, newQtyNum, adjustReason || 'تسوية جردية');
            toastSuccess('تم تسجيل التسوية بنجاح');
            setIsAdjustModalOpen(false);
            setAdjustingBatch(null);
            await loadData();
        } catch (err) {
            console.error(err);
            toastError(err instanceof Error ? err.message : 'تعذّر تسجيل التسوية');
        }
    };

    const handleSaveMaterial = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingMaterial) {
                await materialService.updateMaterial(editingMaterial.id, {
                    nameAr: materialForm.nameAr,
                    category: materialForm.category,
                    unit: materialForm.unit,
                    trackingMode: materialForm.trackingMode,
                    expectedUnitsPerBatch: Number(materialForm.expectedUnitsPerBatch) || null,
                    reorderPoint: Number(materialForm.reorderPoint) || 0,
                });
                toastSuccess('تم تعديل الخامة بنجاح');
            } else {
                await materialService.createMaterial({
                    code: materialForm.code.trim().toUpperCase(),
                    nameAr: materialForm.nameAr.trim(),
                    category: materialForm.category,
                    unit: materialForm.unit,
                    trackingMode: materialForm.trackingMode,
                    attributes: {},
                    expectedUnitsPerBatch: Number(materialForm.expectedUnitsPerBatch) || null,
                    reorderPoint: Number(materialForm.reorderPoint) || 0,
                    isActive: true,
                });
                toastSuccess('تمت إضافة الخامة بنجاح');
            }
            setIsMaterialModalOpen(false);
            setEditingMaterial(null);
            await loadData();
        } catch (err) {
            console.error(err);
            toastError(err instanceof Error ? err.message : 'تعذّر حفظ الخامة');
        }
    };

    const handleSavePurchase = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!purchaseForm.supplierId) {
            toastError('يرجى اختيار المورد');
            return;
        }
        if (!purchaseForm.invoiceRef.trim()) {
            toastError('يرجى إدخال رقم الفاتورة');
            return;
        }

        const validItems = purchaseForm.items.filter(it => it.material_id && it.qty > 0);
        if (validItems.length === 0) {
            toastError('يرجى إضافة صنف واحد على الأقل بكمية صالحة');
            return;
        }

        try {
            await materialService.recordPurchase(
                purchaseForm.supplierId,
                purchaseForm.invoiceRef,
                purchaseForm.purchaseDate,
                validItems.map(it => ({
                    material_id: it.material_id,
                    warehouse_id: it.warehouse_id || warehouses.find(w => w.isDefault)?.id,
                    batch_code: it.batch_code || `LOT-${Date.now().toString().slice(-6)}`,
                    qty: Number(it.qty),
                    unit_cost: Number(it.unit_cost),
                    expiry_date: it.expiry_date || null,
                })),
                purchaseForm.notes
            );
            toastSuccess('تم تسجيل فاتورة الشراء وتوريد اللوتات بنجاح');
            setIsPurchaseModalOpen(false);
            setPurchaseForm({
                supplierId: '',
                invoiceRef: '',
                purchaseDate: new Date().toISOString().split('T')[0],
                notes: '',
                items: [{ material_id: '', warehouse_id: '', batch_code: '', qty: 1, unit_cost: 0, expiry_date: '' }],
            });
            await loadData();
        } catch (err) {
            console.error(err);
            toastError(err instanceof Error ? err.message : 'تعذّر تسجيل الفاتورة');
        }
    };

    const handleSaveBinding = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!bindingForm.stageId || !bindingForm.materialId) {
            toastError('يرجى اختيار المرحلة والخامة');
            return;
        }

        try {
            await materialService.saveStageBinding(
                bindingForm.stageId,
                bindingForm.materialId,
                bindingForm.consumptionMode,
                bindingForm.consumptionMode === 'per_unit_qty' ? Number(bindingForm.qtyPerUnit) : undefined
            );
            toastSuccess('تم ربط المرحلة بالخامة بنجاح');
            setIsBindingModalOpen(false);
            await loadData();
        } catch (err) {
            console.error(err);
            toastError(err instanceof Error ? err.message : 'تعذّر ربط المرحلة');
        }
    };

    const handleDeleteBinding = async (id: string) => {
        try {
            await materialService.deleteStageBinding(id);
            toastSuccess('تم حذف الربط');
            await loadData();
        } catch (err) {
            console.error(err);
            toastError('تعذّر حذف الربط');
        }
    };

    const filteredBatches = useMemo(() => {
        return batches.filter(b => {
            if (batchStatusFilter !== 'all' && b.status !== batchStatusFilter) return false;
            if (materialCategoryFilter !== 'all' && b.materialCategory !== materialCategoryFilter) return false;
            return true;
        });
    }, [batches, batchStatusFilter, materialCategoryFilter]);

    if (loading) {
        return <div className="p-8 text-center text-slate-500">جارِ تحميل بيانات المخزن والخامات…</div>;
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6 pb-28" dir="rtl">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <Package className="w-7 h-7 text-emerald-600" />
                        المخزن والخامات
                    </h1>
                    <p className="text-sm text-slate-500">
                        متابعة ديسكات الزيركون وبلوكات الإيماكس والريزن، الشحنات، اللوتات المفتوحة، والمشتريات
                    </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        onClick={() => void loadData()}
                        className="p-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                        title="تحديث"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => {
                            setEditingMaterial(null);
                            setMaterialForm({
                                code: '',
                                nameAr: '',
                                category: 'zirconia',
                                unit: 'disc',
                                trackingMode: 'batch_depletion',
                                expectedUnitsPerBatch: 20,
                                reorderPoint: 2,
                            });
                            setIsMaterialModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-medium"
                    >
                        <Plus className="w-4 h-4 text-emerald-600" />
                        خامة جديدة
                    </button>
                    <button
                        onClick={() => setIsPurchaseModalOpen(true)}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 text-sm font-medium shadow-sm"
                    >
                        <ShoppingCart className="w-4 h-4" />
                        فاتورة شراء واردة
                    </button>
                </div>
            </div>

            {/* KPI Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                        <Layers className="w-4 h-4 text-slate-400" />
                        إجمالي الخامات
                    </div>
                    <div className="text-2xl font-bold text-slate-800">{summary.totalMaterials}</div>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                        <Package className="w-4 h-4 text-emerald-500" />
                        الشحنات / اللوتات المتاحة
                    </div>
                    <div className="text-2xl font-bold text-slate-800">{summary.totalActiveBatches}</div>
                </div>

                <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl shadow-sm">
                    <div className="text-xs text-emerald-700 mb-1 flex items-center gap-1 font-medium">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        مفتوح على البنش حالياً
                    </div>
                    <div className="text-2xl font-bold text-emerald-800">{summary.openBatchesCount}</div>
                </div>

                <div className={`p-4 rounded-2xl border shadow-sm ${summary.lowStockCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
                    <div className="text-xs text-amber-700 mb-1 flex items-center gap-1 font-medium">
                        <TrendingDown className="w-4 h-4 text-amber-600" />
                        أوشكت على النفاد
                    </div>
                    <div className="text-2xl font-bold text-amber-800">{summary.lowStockCount}</div>
                </div>

                <div className={`p-4 rounded-2xl border shadow-sm ${summary.expiringSoonCount > 0 ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200'}`}>
                    <div className="text-xs text-rose-700 mb-1 flex items-center gap-1 font-medium">
                        <AlertTriangle className="w-4 h-4 text-rose-600" />
                        صلاحيات قريبة (&lt; 30 يوم)
                    </div>
                    <div className="text-2xl font-bold text-rose-800">{summary.expiringSoonCount}</div>
                </div>
            </div>

            {/* Tabs Navigation */}
            <div className="flex border-b border-slate-200 gap-2 overflow-x-auto">
                <button
                    onClick={() => setActiveTab('batches')}
                    className={`pb-3 px-4 text-sm font-bold border-b-2 flex items-center gap-2 whitespace-nowrap ${
                        activeTab === 'batches'
                            ? 'border-emerald-600 text-emerald-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                >
                    <Package className="w-4 h-4" />
                    اللوتات والشحنات ({batches.length})
                </button>
                <button
                    onClick={() => setActiveTab('catalog')}
                    className={`pb-3 px-4 text-sm font-bold border-b-2 flex items-center gap-2 whitespace-nowrap ${
                        activeTab === 'catalog'
                            ? 'border-emerald-600 text-emerald-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                >
                    <Layers className="w-4 h-4" />
                    قاموس الخامات ({materials.length})
                </button>
                <button
                    onClick={() => setActiveTab('purchases')}
                    className={`pb-3 px-4 text-sm font-bold border-b-2 flex items-center gap-2 whitespace-nowrap ${
                        activeTab === 'purchases'
                            ? 'border-emerald-600 text-emerald-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                >
                    <ShoppingCart className="w-4 h-4" />
                    فواتير المشتريات ({purchases.length})
                </button>
                <button
                    onClick={() => setActiveTab('movements')}
                    className={`pb-3 px-4 text-sm font-bold border-b-2 flex items-center gap-2 whitespace-nowrap ${
                        activeTab === 'movements'
                            ? 'border-emerald-600 text-emerald-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                >
                    <FileText className="w-4 h-4" />
                    دفتر الحركات ({movements.length})
                </button>
                <button
                    onClick={() => setActiveTab('bindings')}
                    className={`pb-3 px-4 text-sm font-bold border-b-2 flex items-center gap-2 whitespace-nowrap ${
                        activeTab === 'bindings'
                            ? 'border-emerald-600 text-emerald-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                >
                    <Settings className="w-4 h-4" />
                    ربط المراحل بالخامات ({bindings.length})
                </button>
            </div>

            {/* TAB 1: BATCHES & LOTS */}
            {activeTab === 'batches' && (
                <div className="space-y-4">
                    {/* Filters */}
                    <div className="bg-white p-3.5 rounded-2xl border border-slate-200 flex items-center justify-between gap-3 flex-wrap text-xs">
                        <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-600">الحالة:</span>
                            {(['all', 'open', 'sealed', 'depleted'] as const).map(st => (
                                <button
                                    key={st}
                                    onClick={() => setBatchStatusFilter(st)}
                                    className={`px-3 py-1.5 rounded-xl ${
                                        batchStatusFilter === st
                                            ? 'bg-emerald-600 text-white font-bold'
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                >
                                    {st === 'all' ? 'الكل' : st === 'open' ? '🟢 مفتوح للتشغيل' : st === 'sealed' ? '📦 مغلق بالمخزن' : '⚪ منتهي/مستنفد'}
                                </button>
                            ))}
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-600">الفئة:</span>
                            <select
                                value={materialCategoryFilter}
                                onChange={e => setMaterialCategoryFilter(e.target.value)}
                                className="p-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                            >
                                <option value="all">كل الفئات</option>
                                {Object.entries(CATEGORY_LABELS).map(([cat, lbl]) => (
                                    <option key={cat} value={cat}>{lbl}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Batches Table */}
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="w-full text-right text-xs">
                                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                                    <tr>
                                        <th className="p-3.5">رقم اللوت / الباركود</th>
                                        <th className="p-3.5">الخامة والفئة</th>
                                        <th className="p-3.5">المخزن</th>
                                        <th className="p-3.5">المتبقي / المستلم</th>
                                        <th className="p-3.5">تكلفة الوحدة</th>
                                        <th className="p-3.5">الحالة</th>
                                        <th className="p-3.5">الصلاحية</th>
                                        <th className="p-3.5 text-center">الإجراءات</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredBatches.length === 0 ? (
                                        <tr>
                                            <td colSpan={8} className="p-8 text-center text-slate-400">
                                                لا توجد لوتات مطابقة للفلتر
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredBatches.map(b => (
                                            <tr key={b.id} className="hover:bg-slate-50/70 transition-colors">
                                                <td className="p-3.5 font-mono font-bold text-slate-800">
                                                    {b.batchCode}
                                                </td>
                                                <td className="p-3.5">
                                                    <div className="font-bold text-slate-800">{b.materialName}</div>
                                                    <div className="text-[10px] text-slate-500">
                                                        {CATEGORY_LABELS[b.materialCategory as MaterialCategory] || b.materialCategory}
                                                    </div>
                                                </td>
                                                <td className="p-3.5 text-slate-600">
                                                    {b.warehouseName || 'المخزن الرئيسي'}
                                                </td>
                                                <td className="p-3.5 font-bold">
                                                    <span className={b.qtyRemaining === 0 ? 'text-slate-400' : 'text-emerald-700'}>
                                                        {b.qtyRemaining}
                                                    </span>
                                                    <span className="text-slate-400 font-normal"> / {b.qtyReceived} {UNIT_LABELS[b.materialUnit as MaterialUnit] || b.materialUnit}</span>
                                                </td>
                                                <td className="p-3.5 font-mono text-slate-700">
                                                    {b.unitCost} ج.م
                                                </td>
                                                <td className="p-3.5">
                                                    {b.status === 'open' && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                                                            🟢 مفتوح على البنش
                                                        </span>
                                                    )}
                                                    {b.status === 'sealed' && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 text-[10px] font-bold">
                                                            📦 مغلق بالمخزن
                                                        </span>
                                                    )}
                                                    {b.status === 'depleted' && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px]">
                                                            ⚪ منتهي
                                                        </span>
                                                    )}
                                                    {b.status === 'scrapped' && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px]">
                                                            ❌ تالف
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="p-3.5 text-slate-600">
                                                    {b.expiryDate ? (
                                                        <span className={new Date(b.expiryDate).getTime() < Date.now() ? 'text-rose-600 font-bold' : ''}>
                                                            {b.expiryDate}
                                                        </span>
                                                    ) : '—'}
                                                </td>
                                                <td className="p-3.5 text-center">
                                                    <div className="flex items-center justify-center gap-1.5">
                                                        {b.status === 'sealed' && (
                                                            <button
                                                                onClick={() => void handleOpenBatch(b.id)}
                                                                className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-bold"
                                                                title="افتح اللوت للتشغيل"
                                                            >
                                                                افتح للتشغيل
                                                            </button>
                                                        )}
                                                        {b.status === 'open' && (
                                                            <button
                                                                onClick={() => void handleDepleteBatch(b.id)}
                                                                className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 font-bold"
                                                                title="إغلاق واستنفاد الديسك"
                                                            >
                                                                الديسك خلص
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => {
                                                                setAdjustingBatch(b);
                                                                setAdjustNewQty(String(b.qtyRemaining));
                                                                setAdjustReason('');
                                                                setIsAdjustModalOpen(true);
                                                            }}
                                                            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                                                            title="تسوية جردية"
                                                        >
                                                            <SlidersHorizontal className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 2: MATERIALS CATALOG */}
            {activeTab === 'catalog' && (
                <div className="space-y-4">
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <table className="w-full text-right text-xs">
                            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                                <tr>
                                    <th className="p-3.5">الكود</th>
                                    <th className="p-3.5">اسم الخامة</th>
                                    <th className="p-3.5">الفئة</th>
                                    <th className="p-3.5">الوحدة</th>
                                    <th className="p-3.5">الإنتاجية المتوقعة للديسك</th>
                                    <th className="p-3.5">حد إعادة الطلب</th>
                                    <th className="p-3.5">الحالة</th>
                                    <th className="p-3.5 text-center">تعديل</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {materials.map(m => (
                                    <tr key={m.id} className="hover:bg-slate-50/70">
                                        <td className="p-3.5 font-mono font-bold text-slate-800">{m.code}</td>
                                        <td className="p-3.5 font-bold text-slate-800">{m.nameAr}</td>
                                        <td className="p-3.5 text-slate-600">
                                            {CATEGORY_LABELS[m.category] || m.category}
                                        </td>
                                        <td className="p-3.5 text-slate-600">
                                            {UNIT_LABELS[m.unit] || m.unit}
                                        </td>
                                        <td className="p-3.5 text-slate-600">
                                            {m.expectedUnitsPerBatch ? `${m.expectedUnitsPerBatch} وحدة / ${UNIT_LABELS[m.unit] || m.unit}` : '—'}
                                        </td>
                                        <td className="p-3.5 font-mono font-bold text-amber-700">{m.reorderPoint}</td>
                                        <td className="p-3.5">
                                            {m.isActive ? (
                                                <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-[10px] font-bold">نشط</span>
                                            ) : (
                                                <span className="text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full text-[10px]">معطل</span>
                                            )}
                                        </td>
                                        <td className="p-3.5 text-center">
                                            <button
                                                onClick={() => {
                                                    setEditingMaterial(m);
                                                    setMaterialForm({
                                                        code: m.code,
                                                        nameAr: m.nameAr,
                                                        category: m.category,
                                                        unit: m.unit,
                                                        trackingMode: m.trackingMode,
                                                        expectedUnitsPerBatch: m.expectedUnitsPerBatch || 20,
                                                        reorderPoint: m.reorderPoint || 2,
                                                    });
                                                    setIsMaterialModalOpen(true);
                                                }}
                                                className="px-2.5 py-1 text-slate-600 hover:text-emerald-700 hover:bg-slate-100 rounded-lg text-xs"
                                            >
                                                تعديل
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 3: PURCHASES */}
            {activeTab === 'purchases' && (
                <div className="space-y-4">
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <table className="w-full text-right text-xs">
                            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                                <tr>
                                    <th className="p-3.5">رقم الفاتورة</th>
                                    <th className="p-3.5">المورد</th>
                                    <th className="p-3.5">تاريخ الشراء</th>
                                    <th className="p-3.5">إجمالي المبلغ</th>
                                    <th className="p-3.5">الحالة</th>
                                    <th className="p-3.5">ملاحظات</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {purchases.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="p-8 text-center text-slate-400">
                                            لا توجد فواتير مشتريات مسجلة بعد
                                        </td>
                                    </tr>
                                ) : (
                                    purchases.map(p => (
                                        <tr key={p.id} className="hover:bg-slate-50/70">
                                            <td className="p-3.5 font-mono font-bold text-slate-800">{p.invoiceRef}</td>
                                            <td className="p-3.5 font-bold text-slate-800">{p.supplierName || '—'}</td>
                                            <td className="p-3.5 text-slate-600">{p.purchaseDate}</td>
                                            <td className="p-3.5 font-mono font-bold text-emerald-700">{p.totalAmount.toLocaleString()} ج.م</td>
                                            <td className="p-3.5">
                                                <span className="text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full text-[10px] font-bold">
                                                    تم الاستلام والتوريد
                                                </span>
                                            </td>
                                            <td className="p-3.5 text-slate-500">{p.notes || '—'}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 4: MOVEMENTS LEDGER */}
            {activeTab === 'movements' && (
                <div className="space-y-4">
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <table className="w-full text-right text-xs">
                            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                                <tr>
                                    <th className="p-3.5">التاريخ والوقت</th>
                                    <th className="p-3.5">نوع الحركة</th>
                                    <th className="p-3.5">الخامة واللوت</th>
                                    <th className="p-3.5">الكمية</th>
                                    <th className="p-3.5">البيان والملاحظات</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {movements.map(m => (
                                    <tr key={m.id} className="hover:bg-slate-50/70">
                                        <td className="p-3.5 text-slate-500 font-mono text-[11px]">
                                            {new Date(m.createdAt).toLocaleString('ar-EG')}
                                        </td>
                                        <td className="p-3.5 font-bold">
                                            {m.movementType === 'purchase_in' && <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg">وارد مشتريات</span>}
                                            {m.movementType === 'consume' && <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg">صرف وتشغيل</span>}
                                            {m.movementType === 'adjust' && <span className="text-blue-700 bg-blue-50 px-2 py-0.5 rounded-lg">تسوية جردية</span>}
                                            {m.movementType === 'scrap' && <span className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded-lg">هالك وتالف</span>}
                                        </td>
                                        <td className="p-3.5">
                                            <span className="font-bold text-slate-800">{m.materialName}</span>
                                            <span className="text-slate-400 text-[10px] font-mono mr-1">({m.batchCode})</span>
                                        </td>
                                        <td className={`p-3.5 font-mono font-bold ${m.qty > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                            {m.qty > 0 ? `+${m.qty}` : m.qty}
                                        </td>
                                        <td className="p-3.5 text-slate-600">{m.notes || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 5: STAGE BINDINGS */}
            {activeTab === 'bindings' && (
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <p className="text-xs text-slate-500">
                            تحديد الخامات التي تستهلكها كل مرحلة تشغيلية (لتفعيل السحب والإسناد التلقائي في شاشة الفني)
                        </p>
                        <button
                            onClick={() => {
                                setBindingForm({ stageId: stages[0]?.id || '', materialId: materials[0]?.id || '', consumptionMode: 'depletion', qtyPerUnit: 1 });
                                setIsBindingModalOpen(true);
                            }}
                            className="px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 inline-flex items-center gap-1"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            ربط جديد
                        </button>
                    </div>

                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <table className="w-full text-right text-xs">
                            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                                <tr>
                                    <th className="p-3.5">المرحلة الإنتاجية</th>
                                    <th className="p-3.5">الخامة المرتبطة</th>
                                    <th className="p-3.5">طريقة الاستهلاك</th>
                                    <th className="p-3.5">الكمية لكل وحدة (إن وجدت)</th>
                                    <th className="p-3.5 text-center">حذف</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {bindings.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="p-8 text-center text-slate-400">
                                            لم يتم ربط أي مراحل بخامات بعد
                                        </td>
                                    </tr>
                                ) : (
                                    bindings.map(b => (
                                        <tr key={b.id} className="hover:bg-slate-50/70">
                                            <td className="p-3.5 font-bold text-slate-800">{b.stageName}</td>
                                            <td className="p-3.5 text-slate-800">
                                                {b.materialName} <span className="text-slate-400 font-mono text-[10px]">({b.materialCode})</span>
                                            </td>
                                            <td className="p-3.5">
                                                {b.consumptionMode === 'depletion' ? (
                                                    <span className="text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-lg text-[10px] font-bold">
                                                        إسناد بالاستنفاد (Depletion)
                                                    </span>
                                                ) : (
                                                    <span className="text-blue-800 bg-blue-50 px-2 py-0.5 rounded-lg text-[10px] font-bold">
                                                        خصم مباشر لكل وحدة
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-3.5 font-mono">{b.qtyPerUnit || '—'}</td>
                                            <td className="p-3.5 text-center">
                                                <button
                                                    onClick={() => void handleDeleteBinding(b.id)}
                                                    className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* MODAL 1: ADD/EDIT MATERIAL */}
            {isMaterialModalOpen && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4" dir="rtl">
                        <div className="flex items-center justify-between border-b pb-3">
                            <h3 className="font-bold text-slate-800">
                                {editingMaterial ? 'تعديل بيانات خامة' : 'إضافة خامة جديدة للقاموس'}
                            </h3>
                            <button onClick={() => setIsMaterialModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSaveMaterial} className="space-y-3 text-xs">
                            <div>
                                <label className="block font-bold text-slate-700 mb-1">كود الخامة (Code)</label>
                                <input
                                    type="text"
                                    required
                                    disabled={!!editingMaterial}
                                    placeholder="مثال: ZIR-HT-A2-14"
                                    value={materialForm.code}
                                    onChange={e => setMaterialForm(f => ({ ...f, code: e.target.value }))}
                                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:ring-2 focus:ring-emerald-500"
                                />
                            </div>

                            <div>
                                <label className="block font-bold text-slate-700 mb-1">اسم الخامة بالعربي</label>
                                <input
                                    type="text"
                                    required
                                    placeholder="مثال: ديسك زيركونيا HT A2 - 14mm"
                                    value={materialForm.nameAr}
                                    onChange={e => setMaterialForm(f => ({ ...f, nameAr: e.target.value }))}
                                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block font-bold text-slate-700 mb-1">الفئة</label>
                                    <select
                                        value={materialForm.category}
                                        onChange={e => setMaterialForm(f => ({ ...f, category: e.target.value as MaterialCategory }))}
                                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                                    >
                                        {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                                            <option key={k} value={k}>{v}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block font-bold text-slate-700 mb-1">الوحدة</label>
                                    <select
                                        value={materialForm.unit}
                                        onChange={e => setMaterialForm(f => ({ ...f, unit: e.target.value as MaterialUnit }))}
                                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                                    >
                                        {Object.entries(UNIT_LABELS).map(([k, v]) => (
                                            <option key={k} value={k}>{v}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block font-bold text-slate-700 mb-1">الإنتاجية المتوقعة للديسك</label>
                                    <input
                                        type="number"
                                        placeholder="مثال: 20 وحدة"
                                        value={materialForm.expectedUnitsPerBatch}
                                        onChange={e => setMaterialForm(f => ({ ...f, expectedUnitsPerBatch: Number(e.target.value) }))}
                                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold text-slate-700 mb-1">حد إعادة الطلب</label>
                                    <input
                                        type="number"
                                        placeholder="مثال: 2"
                                        value={materialForm.reorderPoint}
                                        onChange={e => setMaterialForm(f => ({ ...f, reorderPoint: Number(e.target.value) }))}
                                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                                    />
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-3 border-t">
                                <button
                                    type="button"
                                    onClick={() => setIsMaterialModalOpen(false)}
                                    className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-medium"
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700"
                                >
                                    حفظ الخامة
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL 2: RECORD PURCHASE INVOICE */}
            {isPurchaseModalOpen && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto" dir="rtl">
                        <div className="flex items-center justify-between border-b pb-3">
                            <h3 className="font-bold text-slate-800">تسجيل فاتورة شراء خامات واردة للمخزن</h3>
                            <button onClick={() => setIsPurchaseModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSavePurchase} className="space-y-4 text-xs">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label className="block font-bold text-slate-700 mb-1">المورد</label>
                                    <select
                                        required
                                        value={purchaseForm.supplierId}
                                        onChange={e => setPurchaseForm(f => ({ ...f, supplierId: e.target.value }))}
                                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                                    >
                                        <option value="">اختر المورد...</option>
                                        {suppliers.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block font-bold text-slate-700 mb-1">رقم الفاتورة</label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="مثال: INV-2026-08"
                                        value={purchaseForm.invoiceRef}
                                        onChange={e => setPurchaseForm(f => ({ ...f, invoiceRef: e.target.value }))}
                                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold text-slate-700 mb-1">تاريخ الشراء</label>
                                    <input
                                        type="date"
                                        required
                                        value={purchaseForm.purchaseDate}
                                        onChange={e => setPurchaseForm(f => ({ ...f, purchaseDate: e.target.value }))}
                                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                                    />
                                </div>
                            </div>

                            {/* Items */}
                            <div className="space-y-2">
                                <label className="block font-bold text-slate-700">الأصناف واللوتات المستلمة</label>
                                {purchaseForm.items.map((item, idx) => (
                                    <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
                                        <div className="sm:col-span-2">
                                            <label className="text-[10px] text-slate-500 mb-0.5 block">الخامة</label>
                                            <select
                                                required
                                                value={item.material_id}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    setPurchaseForm(f => {
                                                        const updated = [...f.items];
                                                        updated[idx].material_id = val;
                                                        return { ...f, items: updated };
                                                    });
                                                }}
                                                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs"
                                            >
                                                <option value="">اختر الخامة...</option>
                                                {materials.map(m => (
                                                    <option key={m.id} value={m.id}>{m.nameAr}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <label className="text-[10px] text-slate-500 mb-0.5 block">رقم اللوت (Lot)</label>
                                            <input
                                                type="text"
                                                placeholder="LOT-XXX"
                                                value={item.batch_code}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    setPurchaseForm(f => {
                                                        const updated = [...f.items];
                                                        updated[idx].batch_code = val;
                                                        return { ...f, items: updated };
                                                    });
                                                }}
                                                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-mono"
                                            />
                                        </div>

                                        <div>
                                            <label className="text-[10px] text-slate-500 mb-0.5 block">الكمية</label>
                                            <input
                                                type="number"
                                                required
                                                min="1"
                                                value={item.qty}
                                                onChange={e => {
                                                    const val = Number(e.target.value);
                                                    setPurchaseForm(f => {
                                                        const updated = [...f.items];
                                                        updated[idx].qty = val;
                                                        return { ...f, items: updated };
                                                    });
                                                }}
                                                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs"
                                            />
                                        </div>

                                        <div>
                                            <label className="text-[10px] text-slate-500 mb-0.5 block">سعر الوحدة (ج.م)</label>
                                            <input
                                                type="number"
                                                required
                                                min="0"
                                                value={item.unit_cost}
                                                onChange={e => {
                                                    const val = Number(e.target.value);
                                                    setPurchaseForm(f => {
                                                        const updated = [...f.items];
                                                        updated[idx].unit_cost = val;
                                                        return { ...f, items: updated };
                                                    });
                                                }}
                                                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs"
                                            />
                                        </div>
                                    </div>
                                ))}

                                <button
                                    type="button"
                                    onClick={() => {
                                        setPurchaseForm(f => ({
                                            ...f,
                                            items: [...f.items, { material_id: '', warehouse_id: '', batch_code: '', qty: 1, unit_cost: 0, expiry_date: '' }],
                                        }));
                                    }}
                                    className="text-xs text-emerald-700 font-bold hover:underline inline-flex items-center gap-1"
                                >
                                    <Plus className="w-3.5 h-3.5" /> إضافة صنف آخر بالفاتورة
                                </button>
                            </div>

                            <div>
                                <label className="block font-bold text-slate-700 mb-1">ملاحظات الفاتورة</label>
                                <textarea
                                    rows={2}
                                    value={purchaseForm.notes}
                                    onChange={e => setPurchaseForm(f => ({ ...f, notes: e.target.value }))}
                                    placeholder="أي تفاصيل خاصة بالشحن أو السداد..."
                                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-3 border-t">
                                <button
                                    type="button"
                                    onClick={() => setIsPurchaseModalOpen(false)}
                                    className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-medium"
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="submit"
                                    className="px-5 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 shadow-sm"
                                >
                                    حفظ وتوريد الفاتورة
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL 3: STOCK ADJUSTMENT */}
            {isAdjustModalOpen && adjustingBatch && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-3" dir="rtl">
                        <div className="flex items-center justify-between border-b pb-2">
                            <h3 className="font-bold text-slate-800">تسوية جردية للوت {adjustingBatch.batchCode}</h3>
                            <button onClick={() => setIsAdjustModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <form onSubmit={handleSaveAdjustment} className="space-y-3 text-xs">
                            <p className="text-slate-500">
                                الخامة: <b>{adjustingBatch.materialName}</b> — الرصيد الحالي المسجل: <b>{adjustingBatch.qtyRemaining}</b>
                            </p>

                            <div>
                                <label className="block font-bold text-slate-700 mb-1">الكمية الفعلية بعد الجرد</label>
                                <input
                                    type="number"
                                    required
                                    min="0"
                                    step="0.01"
                                    value={adjustNewQty}
                                    onChange={e => setAdjustNewQty(e.target.value)}
                                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"
                                />
                            </div>

                            <div>
                                <label className="block font-bold text-slate-700 mb-1">سبب التسوية</label>
                                <input
                                    type="text"
                                    required
                                    placeholder="مثال: تلف أثناء النقل / جرد دوري"
                                    value={adjustReason}
                                    onChange={e => setAdjustReason(e.target.value)}
                                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-2 border-t">
                                <button
                                    type="button"
                                    onClick={() => setIsAdjustModalOpen(false)}
                                    className="px-3 py-1.5 rounded-xl text-slate-600 hover:bg-slate-100"
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-1.5 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700"
                                >
                                    تأكيد التسوية
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL 4: STAGE BINDING */}
            {isBindingModalOpen && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-3" dir="rtl">
                        <div className="flex items-center justify-between border-b pb-2">
                            <h3 className="font-bold text-slate-800">ربط مرحلة تشغيلية بخامة</h3>
                            <button onClick={() => setIsBindingModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <form onSubmit={handleSaveBinding} className="space-y-3 text-xs">
                            <div>
                                <label className="block font-bold text-slate-700 mb-1">المرحلة الإنتاجية</label>
                                <select
                                    value={bindingForm.stageId}
                                    onChange={e => setBindingForm(f => ({ ...f, stageId: e.target.value }))}
                                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                                >
                                    {stages.map(st => (
                                        <option key={st.id} value={st.id}>{st.nameAr}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block font-bold text-slate-700 mb-1">الخامة</label>
                                <select
                                    value={bindingForm.materialId}
                                    onChange={e => setBindingForm(f => ({ ...f, materialId: e.target.value }))}
                                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                                >
                                    {materials.map(m => (
                                        <option key={m.id} value={m.id}>{m.nameAr}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block font-bold text-slate-700 mb-1">طريقة الاستهلاك</label>
                                <select
                                    value={bindingForm.consumptionMode}
                                    onChange={e => setBindingForm(f => ({ ...f, consumptionMode: e.target.value as any }))}
                                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                                >
                                    <option value="depletion">إسناد بالاستنفاد (للديسكات والبلوكات والريزن)</option>
                                    <option value="per_unit_qty">خصم كمية محددة لكل وحدة (للعلب والتغليف)</option>
                                </select>
                            </div>

                            {bindingForm.consumptionMode === 'per_unit_qty' && (
                                <div>
                                    <label className="block font-bold text-slate-700 mb-1">الكمية لكل كراون</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={bindingForm.qtyPerUnit}
                                        onChange={e => setBindingForm(f => ({ ...f, qtyPerUnit: Number(e.target.value) }))}
                                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                                    />
                                </div>
                            )}

                            <div className="flex justify-end gap-2 pt-2 border-t">
                                <button
                                    type="button"
                                    onClick={() => setIsBindingModalOpen(false)}
                                    className="px-3 py-1.5 rounded-xl text-slate-600 hover:bg-slate-100"
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-1.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700"
                                >
                                    حفظ الربط
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
