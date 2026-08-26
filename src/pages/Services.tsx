import { useState, useEffect, useRef } from 'react';
import { db, type Service, type ServiceFamily } from '../services/db';
import type { FamilyPriceAdjustment } from '../services/supabase/serviceFamilyService';
import {
    FileSpreadsheet, Printer, Trash2, Edit2, Layers, GripVertical,
    Plus, Sparkles, SlidersHorizontal, Star, Check, AlertCircle, X
} from 'lucide-react';
import { exportToExcel } from '../lib/exportUtils';
import { generateGenericTablePDF } from '../services/pdfService';
import { DEFAULT_LAB_INFO } from '../utils/finance';
import { useToast } from '../context/ToastContext';
import clsx from 'clsx';

const COLOR_OPTIONS = [
    { id: 'emerald', label: 'أخضر زمردي', bg: 'bg-emerald-500', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    { id: 'blue', label: 'أزرق سماوي', bg: 'bg-blue-500', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-800 border-blue-200' },
    { id: 'indigo', label: 'بنفسجي نيلي', bg: 'bg-indigo-500', text: 'text-indigo-700', badge: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
    { id: 'amber', label: 'برتقالي عنبري', bg: 'bg-amber-500', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-800 border-amber-200' },
    { id: 'purple', label: 'أرجواني', bg: 'bg-purple-500', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-800 border-purple-200' },
    { id: 'rose', label: 'وردي ياقوتي', bg: 'bg-rose-500', text: 'text-rose-700', badge: 'bg-rose-100 text-rose-800 border-rose-200' },
    { id: 'slate', label: 'رمادي صلب', bg: 'bg-slate-500', text: 'text-slate-700', badge: 'bg-slate-100 text-slate-800 border-slate-200' },
];

export default function ServicesPage() {
    const [services, setServices] = useState<Service[]>([]);
    const [families, setFamilies] = useState<ServiceFamily[]>([]);
    const { success: toastSuccess, error: toastError } = useToast();
    const [editingService, setEditingService] = useState<Service | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const serviceFormRef = useRef<HTMLFormElement>(null);

    // Family Modal state
    const [showFamilyModal, setShowFamilyModal] = useState(false);
    const [editingFamily, setEditingFamily] = useState<ServiceFamily | null>(null);
    const [familyForm, setFamilyForm] = useState({ nameAr: '', nameEn: '', description: '', color: 'emerald', defaultServiceId: '' });

    // Bulk Price Adjustment Modal
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [bulkFamilyId, setBulkFamilyId] = useState('');
    const [bulkType, setBulkType] = useState<'percentage' | 'fixed'>('percentage');
    const [bulkTarget, setBulkTarget] = useState<'sellingPrice' | 'costPrice' | 'both'>('sellingPrice');
    const [bulkValue, setBulkValue] = useState<number>(10);
    // Preview of what the adjustment would do, fetched with dryRun before any
    // write. Repricing a whole family should never be the first thing the
    // admin learns about from the resulting prices.
    const [bulkPreview, setBulkPreview] = useState<FamilyPriceAdjustment | null>(null);
    const [bulkBusy, setBulkBusy] = useState(false);

    // Load status. An empty catalogue and a failed fetch used to render the
    // same empty table, which reads as "there is nothing here".
    const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
    const [loadError, setLoadError] = useState<string | null>(null);

    // Any change to the inputs invalidates the preview. Without this the admin
    // could preview +10%, change the field to +50%, and confirm — the button
    // would still say "10%" while applying 50, because the confirm step reads
    // live state rather than the previewed values.
    useEffect(() => {
        setBulkPreview(null);
    }, [bulkFamilyId, bulkType, bulkValue, bulkTarget]);

    // Drag state
    const servicesRef = useRef<Service[]>([]);
    useEffect(() => { servicesRef.current = services; }, [services]);
    const dragIndex = useRef<number | null>(null);
    const dragOverIndex = useRef<number | null>(null);

    const refreshData = async () => {
        setLoadState('loading');
        setLoadError(null);
        try {
            // Together: a page showing the catalogue without the families it is
            // grouped by would present every service as unassigned.
            const [fetchedServices, fetchedFamilies] = await Promise.all([
                db.getServices(),
                db.getServiceFamilies(),
            ]);
            setServices(fetchedServices || []);
            setFamilies(fetchedFamilies || []);
            setLoadState('ready');
        } catch (err) {
            console.error('Failed to load services/families:', err);
            setLoadError(err instanceof Error ? err.message : 'تعذر تحميل البيانات');
            setLoadState('error');
        }
    };

    useEffect(() => {
        refreshData();
    }, []);

    const handleOpenFamilyModal = (family?: ServiceFamily) => {
        if (family) {
            setEditingFamily(family);
            setFamilyForm({
                nameAr: family.nameAr,
                nameEn: family.nameEn || '',
                description: family.description || '',
                color: family.color || 'emerald',
                defaultServiceId: family.defaultServiceId || '',
            });
        } else {
            setEditingFamily(null);
            setFamilyForm({ nameAr: '', nameEn: '', description: '', color: 'emerald', defaultServiceId: '' });
        }
        setShowFamilyModal(true);
    };

    const handleSaveFamily = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!familyForm.nameAr.trim()) {
            toastError('اسم العائلة بالعربية مطلوب');
            return;
        }
        try {
            if (editingFamily) {
                await db.updateServiceFamily(editingFamily.id, {
                    nameAr: familyForm.nameAr,
                    nameEn: familyForm.nameEn || null,
                    description: familyForm.description || null,
                    color: familyForm.color,
                    defaultServiceId: familyForm.defaultServiceId || null,
                });
                toastSuccess('تم تحديث العائلة بنجاح');
            } else {
                await db.createServiceFamily({
                    nameAr: familyForm.nameAr,
                    nameEn: familyForm.nameEn,
                    description: familyForm.description,
                    color: familyForm.color,
                    defaultServiceId: familyForm.defaultServiceId || null,
                });
                toastSuccess('تم إضافة العائلة بنجاح');
            }
            setShowFamilyModal(false);
            refreshData();
        } catch (err) {
            console.error('Failed to save family:', err);
            toastError(err instanceof Error ? err.message : 'تعذر حفظ العائلة');
        }
    };

    const handleDeleteFamily = async (familyId: string) => {
        if (!confirm('هل أنت تأكد من حذف العائلة؟ الخدمات التابعة ستصبح بدون عائلة.')) return;
        try {
            await db.deleteServiceFamily(familyId);
            toastSuccess('تم حذف العائلة بنجاح');
            refreshData();
        } catch (err) {
            toastError(err instanceof Error ? err.message : 'تعذر حذف العائلة');
        }
    };

    const handleAssignFamily = async (serviceId: string, familyId: string | null) => {
        try {
            await db.assignServiceToFamily(serviceId, familyId);
            toastSuccess('تم تغيير عائلة الخدمة');
            refreshData();
        } catch {
            toastError('تعذر تغيير العائلة');
        }
    };

    /** Step 1: ask the server what would change, without changing it. */
    const handlePreviewBulkAdjustment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!bulkFamilyId) {
            toastError('يرجى اختيار العائلة المستهدفة');
            return;
        }
        setBulkBusy(true);
        try {
            const preview = await db.bulkAdjustFamilyPrices(bulkFamilyId, bulkType, bulkValue, bulkTarget, true);
            if (preview.affected === 0) {
                toastError('مفيش أي خدمة في العائلة دي هيتغير سعرها');
                return;
            }
            setBulkPreview(preview);
        } catch (err) {
            toastError(err instanceof Error ? err.message : 'تعذر حساب المعاينة');
        } finally {
            setBulkBusy(false);
        }
    };

    /** Step 2: apply exactly what the preview showed. */
    const handleConfirmBulkAdjustment = async () => {
        setBulkBusy(true);
        try {
            const applied = await db.bulkAdjustFamilyPrices(bulkFamilyId, bulkType, bulkValue, bulkTarget, false);
            toastSuccess(`تم تحديث أسعار ${applied.applied} خدمة`);
            setShowBulkModal(false);
            setBulkPreview(null);
            refreshData();
        } catch (err) {
            toastError(err instanceof Error ? err.message : 'تعذر التحديث الجماعي للأسعار');
        } finally {
            setBulkBusy(false);
        }
    };

    const handleDragStart = (index: number) => { dragIndex.current = index; };
    const handleDragOver = (e: React.DragEvent, index: number) => { e.preventDefault(); dragOverIndex.current = index; };
    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        const from = dragIndex.current;
        const to = dragOverIndex.current;
        dragIndex.current = null;
        dragOverIndex.current = null;
        if (from === null || to === null || from === to) return;

        const current = [...servicesRef.current];
        const [moved] = current.splice(from, 1);
        current.splice(to, 0, moved);
        setServices(current);

        setIsSaving(true);
        try {
            await db.reorderServices(current.map(s => s.id));
        } catch (err) {
            console.error('[Services] Failed to save order:', err);
            const fresh = await db.getServices();
            setServices(fresh);
        } finally {
            setIsSaving(false);
        }
    };

    const getColorBadge = (colorName?: string) => {
        const option = COLOR_OPTIONS.find(c => c.id === colorName) || COLOR_OPTIONS[0];
        return option.badge;
    };

    if (loadState === 'loading') {
        return (
            <div className="max-w-7xl mx-auto space-y-4" dir="rtl">
                <div className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" />
                <div className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white" />
                <div className="h-96 animate-pulse rounded-2xl border border-slate-200 bg-white" />
            </div>
        );
    }

    // Distinct from an empty catalogue on purpose: an empty table would say
    // the lab has no services, which is a much worse thing to be wrong about
    // than saying the fetch failed.
    if (loadState === 'error') {
        return (
            <div className="max-w-7xl mx-auto" dir="rtl">
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
                    <AlertCircle size={32} className="mx-auto mb-3 text-rose-500" />
                    <p className="font-bold text-rose-800">تعذر تحميل الخدمات والعوائل</p>
                    <p className="mt-1 text-xs text-rose-600">{loadError}</p>
                    <button
                        onClick={refreshData}
                        className="mt-4 cursor-pointer rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-rose-700"
                    >
                        إعادة المحاولة
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6" dir="rtl">
            {/* Page Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-emerald-100 rounded-xl text-emerald-600">
                        <Layers size={26} />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-slate-800">عوائل الخدمات والكتالوج</h1>
                        <p className="text-xs text-slate-500 mt-0.5">
                            إدارة عوائل الخدمات، أسعار الكتالوج، البلوكات الافتراضية والتحديث الجماعي للأسعار
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    {isSaving && (
                        <span className="text-xs text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full font-medium animate-pulse">
                            جاري حفظ الترتيب...
                        </span>
                    )}

                    <button
                        onClick={() => handleOpenFamilyModal()}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-all shadow-sm active:scale-95 cursor-pointer"
                    >
                        <Plus size={16} />
                        عائلة جديدة
                    </button>

                    <button
                        onClick={() => setShowBulkModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-bold hover:bg-amber-600 transition-all shadow-sm active:scale-95 cursor-pointer"
                    >
                        <SlidersHorizontal size={16} />
                        تحديث جماعي للأسعار
                    </button>
                </div>
            </div>

            {/* Families Bar */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <Sparkles size={16} className="text-amber-500" />
                        العوائل المعرفة للنظام ({families.length})
                    </h3>
                    <span className="text-xs text-slate-400">انقر على العائلة لتعديل بياناتها والنوع الافتراضي</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {families.map(family => {
                        const familyServices = services.filter(s => s.familyId === family.id);
                        const defaultSvc = familyServices.find(s => s.id === family.defaultServiceId);
                        return (
                            <div
                                key={family.id}
                                className="group relative bg-slate-50 hover:bg-slate-100/80 p-4 rounded-xl border border-slate-200 transition-all cursor-pointer"
                                onClick={() => handleOpenFamilyModal(family)}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <span className={clsx(
                                            'inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border mb-1',
                                            getColorBadge(family.color)
                                        )}>
                                            {family.nameAr}
                                        </span>
                                        {family.nameEn && <span className="text-[10px] text-slate-400 block">{family.nameEn}</span>}
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteFamily(family.id); }}
                                        className="opacity-0 group-hover:opacity-100 text-rose-500 hover:bg-rose-50 p-1 rounded-lg transition-all"
                                        title="حذف العائلة"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>

                                <div className="mt-3 pt-2 border-t border-slate-200/60 flex justify-between items-center text-[11px] text-slate-600">
                                    <span>{familyServices.length} خدمات</span>
                                    {defaultSvc ? (
                                        <span className="inline-flex items-center gap-1 text-amber-600 font-bold truncate max-w-[120px]">
                                            <Star size={11} className="fill-amber-400" />
                                            {defaultSvc.name}
                                        </span>
                                    ) : (
                                        <span className="text-slate-400 text-[10px]">لم يحدد نوع افتراضي</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {families.length === 0 && (
                        <div className="col-span-full text-center py-6 bg-slate-50 rounded-xl border border-dashed border-slate-300 text-slate-500 text-xs">
                            لا توجد عوائل معرفة حالياً. انقر على «عائلة جديدة» لتنظيم خدماتك تحت عوائل (مثل: زيركون، إيماكس...).
                        </div>
                    )}
                </div>
            </div>

            {/* Main Form & Services Table Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Add / Edit Service Form */}
                <div className="lg:col-span-1">
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 sticky top-4 space-y-4">
                        <h3 className="font-bold text-lg flex items-center gap-2 text-slate-800">
                            <span className="w-1.5 h-6 bg-emerald-500 rounded-full"></span>
                            {editingService ? 'تعديل خدمة' : 'إضافة خدمة جديدة'}
                        </h3>
                        <form ref={serviceFormRef} onSubmit={async (e) => {
                            e.preventDefault();
                            const form = e.currentTarget;
                            const formData = new FormData(form);
                            const name = formData.get('name')?.toString() || '';
                            const sellingPrice = Number(formData.get('sellingPrice'));
                            const costPrice = Number(formData.get('costPrice'));
                            const millingPrice = Number(formData.get('millingPrice')) || 0;
                            const designerPrice = formData.get('designerPrice') !== '' ? Number(formData.get('designerPrice')) : undefined;
                            const familyId = formData.get('familyId')?.toString() || null;

                            try {
                                if (editingService) {
                                    await db.updateService(editingService.id, { name, sellingPrice, costPrice, millingPrice, designerPrice, familyId });
                                    toastSuccess('تم تعديل الخدمة بنجاح');
                                    setEditingService(null);
                                } else {
                                    await db.addService({ name, sellingPrice, costPrice, millingPrice, designerPrice, familyId });
                                    toastSuccess('تم إضافة الخدمة بنجاح');
                                }
                                refreshData();
                                form.reset();
                            } catch (error) {
                                console.error('Error saving service:', error);
                                toastError(error instanceof Error ? error.message : 'حدث خطأ أثناء حفظ الخدمة');
                            }
                        }} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1.5">اسم الخدمة / البلوكة التفصيلية</label>
                                <input
                                    aria-label="اسم الخدمة"
                                    name="name"
                                    required
                                    defaultValue={editingService?.name}
                                    key={editingService?.id}
                                    placeholder="مثال: Zircon High Translucent"
                                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 transition-all font-semibold"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1.5">العائلة التابعة لها</label>
                                <select
                                    name="familyId"
                                    defaultValue={editingService?.familyId || ''}
                                    key={`fam-${editingService?.id}`}
                                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 transition-all font-semibold"
                                >
                                    <option value="">بدون عائلة (خدمة منفردة)</option>
                                    {families.map(f => (
                                        <option key={f.id} value={f.id}>{f.nameAr}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">سعر البيع (ج.م)</label>
                                    <input aria-label="سعر البيع" name="sellingPrice" required type="number" defaultValue={editingService?.sellingPrice} key={`s-${editingService?.id}`} className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 transition-all font-mono font-bold text-emerald-600" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">التكلفة (المعمل)</label>
                                    <input aria-label="سعر التكلفة" name="costPrice" required type="number" defaultValue={editingService?.costPrice} key={`c-${editingService?.id}`} className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 transition-all font-mono font-bold text-rose-600" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">سعر المصمم الافتراضي</label>
                                    <input
                                        aria-label="سعر المصمم"
                                        name="designerPrice"
                                        type="number"
                                        min="0"
                                        step="0.5"
                                        defaultValue={editingService?.designerPrice ?? ''}
                                        key={`d-${editingService?.id}`}
                                        placeholder="0 = مبتتحسبش"
                                        className="w-full p-2.5 text-xs bg-amber-50/60 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 transition-all font-mono text-amber-700 font-bold"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1.5">سعر الخراطة (للمعامل)</label>
                                    <input aria-label="سعر الخراطة" name="millingPrice" type="number" defaultValue={editingService?.millingPrice} key={`m-${editingService?.id}`} className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 transition-all font-mono" />
                                </div>
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button type="submit" className="flex-1 bg-emerald-600 text-white py-2.5 rounded-xl text-xs font-bold hover:bg-emerald-700 shadow-md shadow-emerald-200 transition-all active:scale-[0.98] cursor-pointer">
                                    {editingService ? 'تحديث الخدمة' : 'حفظ الخدمة'}
                                </button>
                                {editingService && (
                                    <button type="button" onClick={() => { setEditingService(null); serviceFormRef.current?.reset(); }} className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200 transition-all cursor-pointer">إلغاء</button>
                                )}
                            </div>
                        </form>
                    </div>
                </div>

                {/* Services Table Grouped by Family */}
                <div className="lg:col-span-2">
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
                            <div>
                                <h3 className="font-bold text-slate-800 text-sm">قائمة أسعار الخدمات حسب العائلة</h3>
                                <p className="text-xs text-slate-400 mt-0.5">اسحب من <GripVertical size={11} className="inline" /> لتغيير الترتيب | ⭐ يمثل البلوكة الافتراضية للعائلة</p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => exportToExcel(services.map(s => ({
                                        'العائلة': families.find(f => f.id === s.familyId)?.nameAr || 'بدون عائلة',
                                        'اسم الخدمة': s.name,
                                        'سعر البيع': s.sellingPrice,
                                        'التكلفة': s.costPrice,
                                        'الخراطة': s.millingPrice || 0,
                                        'الربح': s.sellingPrice - s.costPrice
                                    })), `services_${new Date().toISOString().split('T')[0]}`, 'الخدمات')}
                                    className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer" title="تصدير Excel"
                                >
                                    <FileSpreadsheet size={18} />
                                </button>
                                <button
                                    onClick={() => generateGenericTablePDF('قائمة الخدمات', [
                                        { header: 'اسم الخدمة', key: 'name' },
                                        { header: 'سعر البيع', key: 'sellingPrice' },
                                        { header: 'التكلفة', key: 'costPrice' },
                                        { header: 'الخراطة', key: 'millingPrice' }
                                    ], services.map(s => ({
                                        name: s.name,
                                        sellingPrice: s.sellingPrice,
                                        costPrice: s.costPrice,
                                        millingPrice: s.millingPrice
                                    })), DEFAULT_LAB_INFO)}
                                    className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer" title="طباعة"
                                >
                                    <Printer size={18} />
                                </button>
                            </div>
                        </div>

                        <table className="w-full text-xs text-right">
                            <thead className="text-slate-500 bg-slate-50/80 border-b border-slate-200">
                                <tr>
                                    <th className="p-3 w-8"></th>
                                    <th className="p-3 font-bold">الخدمة / البلوكة</th>
                                    <th className="p-3 font-bold">العائلة</th>
                                    <th className="p-3 font-bold">سعر البيع</th>
                                    <th className="p-3 font-bold">التكلفة</th>
                                    <th className="p-3 font-bold">سعر المصمم</th>
                                    <th className="p-3 font-bold">الخراطة</th>
                                    <th className="p-3 font-bold text-center">إجراءات</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {services.map((s, index) => {
                                    const family = families.find(f => f.id === s.familyId);
                                    const isDefault = family?.defaultServiceId === s.id;
                                    return (
                                        <tr
                                            key={s.id}
                                            draggable
                                            onDragStart={() => handleDragStart(index)}
                                            onDragOver={(e) => handleDragOver(e, index)}
                                            onDrop={handleDrop}
                                            className="hover:bg-slate-50/80 transition-colors group cursor-grab active:cursor-grabbing active:bg-emerald-50/30"
                                        >
                                            <td className="p-3 w-8 text-slate-300 group-hover:text-slate-400 transition-colors">
                                                <GripVertical size={16} className="mx-auto" />
                                            </td>
                                            <td className="p-3 font-bold text-slate-800">
                                                <div className="flex items-center gap-1.5">
                                                    <span>{s.name}</span>
                                                    {isDefault && (
                                                        <span className="inline-flex items-center gap-0.5 text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full font-bold" title="البلوكة الافتراضية للعائلة">
                                                            <Star size={10} className="fill-amber-400 text-amber-500" />
                                                            افتراضي
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-3">
                                                <select
                                                    value={s.familyId || ''}
                                                    onChange={(e) => handleAssignFamily(s.id, e.target.value || null)}
                                                    className={clsx(
                                                        'text-[11px] font-bold px-2 py-1 rounded-lg border focus:outline-none transition-all cursor-pointer',
                                                        family ? getColorBadge(family.color) : 'bg-slate-100 text-slate-600 border-slate-200'
                                                    )}
                                                >
                                                    <option value="">بدون عائلة</option>
                                                    {families.map(f => (
                                                        <option key={f.id} value={f.id}>{f.nameAr}</option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td className="p-3 text-emerald-600 font-extrabold font-mono">{s.sellingPrice}</td>
                                            <td className="p-3 text-rose-600 font-mono font-semibold">{s.costPrice}</td>
                                            <td className="p-3">
                                                {s.designerPrice === undefined ? (
                                                    <span className="text-slate-300 text-xs">-</span>
                                                ) : s.designerPrice === 0 ? (
                                                    <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-bold">مجاني</span>
                                                ) : (
                                                    <span className="text-amber-600 font-bold font-mono">{s.designerPrice}</span>
                                                )}
                                            </td>
                                            <td className="p-3 text-slate-500 font-mono">{s.millingPrice || '-'}</td>
                                            <td className="p-3 text-center">
                                                <div className="flex justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button onClick={() => setEditingService(s)} className="text-blue-500 hover:bg-blue-50 p-1.5 rounded-lg transition-colors cursor-pointer" title="تعديل"><Edit2 size={15} /></button>
                                                    <button onClick={() => { if (confirm('حذف الخدمة؟')) db.deleteService(s.id).then(refreshData); }} className="text-rose-500 hover:bg-rose-50 p-1.5 rounded-lg transition-colors cursor-pointer" title="حذف"><Trash2 size={15} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Family Modal */}
            {showFamilyModal && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                            <h3 className="font-bold text-slate-800 text-base">
                                {editingFamily ? 'تعديل عائلة خدمات' : 'إضافة عائلة خدمات جديدة'}
                            </h3>
                            <button onClick={() => setShowFamilyModal(false)} className="text-slate-400 hover:text-slate-600">
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveFamily} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">اسم العائلة (بالعربية)</label>
                                <input
                                    type="text"
                                    required
                                    placeholder="مثال: زيركون"
                                    value={familyForm.nameAr}
                                    onChange={(e) => setFamilyForm(f => ({ ...f, nameAr: e.target.value }))}
                                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 font-bold"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">اسم العائلة (بالإنجليزية - اختياري)</label>
                                <input
                                    type="text"
                                    placeholder="مثال: Zirconia"
                                    value={familyForm.nameEn}
                                    onChange={(e) => setFamilyForm(f => ({ ...f, nameEn: e.target.value }))}
                                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1.5">اللون المميز (Color Badge)</label>
                                <div className="grid grid-cols-4 gap-2">
                                    {COLOR_OPTIONS.map(c => (
                                        <button
                                            type="button"
                                            key={c.id}
                                            onClick={() => setFamilyForm(f => ({ ...f, color: c.id }))}
                                            className={clsx(
                                                'px-2.5 py-1.5 rounded-xl text-xs font-bold border flex items-center justify-between transition-all cursor-pointer',
                                                c.badge,
                                                familyForm.color === c.id ? 'ring-2 ring-offset-1 ring-slate-800 shadow-xs' : 'opacity-70 hover:opacity-100'
                                            )}
                                        >
                                            <span>{c.label.split(' ')[0]}</span>
                                            {familyForm.color === c.id && <Check size={12} />}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {editingFamily && (
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">النوع / البلوكة الافتراضية للعائلة</label>
                                    <select
                                        value={familyForm.defaultServiceId}
                                        onChange={(e) => setFamilyForm(f => ({ ...f, defaultServiceId: e.target.value }))}
                                        className="w-full p-2.5 text-xs bg-amber-50/60 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-500 font-bold"
                                    >
                                        <option value="">لم يحدد (اختياري)</option>
                                        {services.filter(s => s.familyId === editingFamily.id).map(s => (
                                            <option key={s.id} value={s.id}>{s.name} ({s.sellingPrice} ج.م)</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div className="flex gap-3 pt-3 border-t border-slate-100">
                                <button
                                    type="submit"
                                    className="flex-1 bg-emerald-600 text-white py-2.5 rounded-xl text-xs font-bold hover:bg-emerald-700 shadow-md shadow-emerald-200 transition-all cursor-pointer"
                                >
                                    حفظ العائلة
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowFamilyModal(false)}
                                    className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200 transition-all cursor-pointer"
                                >
                                    إلغاء
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Bulk Price Adjustment Modal */}
            {showBulkModal && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                            <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                                <SlidersHorizontal size={18} className="text-amber-500" />
                                التحديث الجماعي لأسعار العائلة
                            </h3>
                            <button onClick={() => setShowBulkModal(false)} className="text-slate-400 hover:text-slate-600">
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handlePreviewBulkAdjustment} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">اختر العائلة المستهدفة</label>
                                <select
                                    required
                                    value={bulkFamilyId}
                                    onChange={(e) => setBulkFamilyId(e.target.value)}
                                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 font-bold"
                                >
                                    <option value="">-- اختر العائلة --</option>
                                    {families.map(f => (
                                        <option key={f.id} value={f.id}>{f.nameAr} ({services.filter(s => s.familyId === f.id).length} خدمات)</option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">نوع التعديل</label>
                                    <select
                                        value={bulkType}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            if (v === 'percentage' || v === 'fixed') setBulkType(v);
                                        }}
                                        className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500"
                                    >
                                        <option value="percentage">نسبة مئوية (%)</option>
                                        <option value="fixed">مبلغ ثابت (ج.م)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">السعر المستهدف</label>
                                    <select
                                        value={bulkTarget}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            if (v === 'sellingPrice' || v === 'costPrice' || v === 'both') setBulkTarget(v);
                                        }}
                                        className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500"
                                    >
                                        <option value="sellingPrice">سعر البيع فقط</option>
                                        <option value="costPrice">سعر التكلفة فقط</option>
                                        <option value="both">سعر البيع والتكلفة معاً</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">قيمة التعديل (+ للزيادة، - للنقصان)</label>
                                <input
                                    type="number"
                                    required
                                    value={bulkValue}
                                    onChange={(e) => setBulkValue(Number(e.target.value))}
                                    className="w-full p-2.5 text-xs bg-amber-50/60 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-500 font-mono font-bold"
                                />
                                <span className="text-[10px] text-slate-400 mt-1 block">
                                    مثال: 10 تعني زيادة 10%، و -5 تعني تخفيض 5%
                                </span>
                            </div>

                            <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl flex items-start gap-2 text-[11px] text-amber-800">
                                <AlertCircle size={15} className="shrink-0 mt-0.5 text-amber-600" />
                                <span>سيتم تطبيق هذا التغيير على أسعار الكتالوج لجميع الخدمات التابعة لهذه العائلة أوتوماتيكياً.</span>
                            </div>

                            {/* The exact rows the server would write, read back from
                                a dry run of the same statement — not a client-side
                                guess at what it will do. */}
                            {bulkPreview && (
                                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                                    <p className="mb-2 text-xs font-bold text-amber-800">
                                        هيتغير سعر {bulkPreview.affected} خدمة — راجعها قبل التأكيد:
                                    </p>
                                    <div className="max-h-44 space-y-1 overflow-y-auto">
                                        {bulkPreview.services.map(row => (
                                            <div key={row.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5 text-[11px]">
                                                <span className="truncate font-semibold text-slate-700">{row.name}</span>
                                                <span className="shrink-0 font-mono text-slate-500">
                                                    {row.sellingBefore !== row.sellingAfter && (
                                                        <span className="text-emerald-700">
                                                            بيع {row.sellingBefore} ← {row.sellingAfter}
                                                        </span>
                                                    )}
                                                    {row.sellingBefore !== row.sellingAfter && row.costBefore !== row.costAfter && ' • '}
                                                    {row.costBefore !== row.costAfter && (
                                                        <span className="text-rose-700">
                                                            تكلفة {row.costBefore} ← {row.costAfter}
                                                        </span>
                                                    )}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-3 pt-2">
                                {bulkPreview ? (
                                    <button
                                        type="button"
                                        onClick={handleConfirmBulkAdjustment}
                                        disabled={bulkBusy}
                                        className="flex-1 bg-amber-600 text-white py-2.5 rounded-xl text-xs font-bold hover:bg-amber-700 shadow-md shadow-amber-200 transition-all cursor-pointer disabled:opacity-50"
                                    >
                                        {bulkBusy ? 'جارٍ التطبيق…' : `أكّد وطبّق على ${bulkPreview.affected} خدمة`}
                                    </button>
                                ) : (
                                    <button
                                        type="submit"
                                        disabled={bulkBusy}
                                        className="flex-1 bg-slate-800 text-white py-2.5 rounded-xl text-xs font-bold hover:bg-slate-900 shadow-md transition-all cursor-pointer disabled:opacity-50"
                                    >
                                        {bulkBusy ? 'جارٍ الحساب…' : 'اعرض المعاينة'}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => { setShowBulkModal(false); setBulkPreview(null); }}
                                    className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200 transition-all cursor-pointer"
                                >
                                    إلغاء
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
