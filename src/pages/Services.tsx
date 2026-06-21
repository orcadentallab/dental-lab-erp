import { useState, useEffect, useRef } from 'react';
import { db, type Service } from '../services/db';
import { FileSpreadsheet, Printer, Trash2, Edit2, Layers, GripVertical } from 'lucide-react';
import { exportToExcel } from '../lib/exportUtils';
import { generateGenericTablePDF } from '../services/pdfService';
import { DEFAULT_LAB_INFO } from '../utils/finance';
import { useToast } from '../context/ToastContext';

export default function ServicesPage() {
    const [services, setServices] = useState<Service[]>([]);
    const { success: toastSuccess, error: toastError } = useToast();
    const [editingService, setEditingService] = useState<Service | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const serviceFormRef = useRef<HTMLFormElement>(null);

    // Keep a ref to always have the latest services inside drag handlers (avoids stale closure)
    const servicesRef = useRef<Service[]>([]);
    useEffect(() => { servicesRef.current = services; }, [services]);

    // Drag state
    const dragIndex = useRef<number | null>(null);
    const dragOverIndex = useRef<number | null>(null);

    useEffect(() => {
        db.getServices().then(setServices).catch(console.error);
    }, []);

    const handleDragStart = (index: number) => {
        dragIndex.current = index;
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        dragOverIndex.current = index;
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        const from = dragIndex.current;
        const to = dragOverIndex.current;
        dragIndex.current = null;
        dragOverIndex.current = null;

        if (from === null || to === null || from === to) return;

        // Read latest services from ref to avoid stale closure
        const current = [...servicesRef.current];
        const [moved] = current.splice(from, 1);
        current.splice(to, 0, moved);

        // Optimistic UI update
        setServices(current);

        // Persist to database
        setIsSaving(true);
        try {
            await db.reorderServices(current.map(s => s.id));
        } catch (err) {
            console.error('[Services] Failed to save order:', err);
            // Revert on failure
            const fresh = await db.getServices();
            setServices(fresh);
        } finally {
            setIsSaving(false);
        }
    };


    return (
        <div className="max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-100 rounded-lg text-emerald-600">
                        <Layers size={24} />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-gray-800">الخدمات وأسعارها</h1>
                        <p className="text-sm text-gray-500">اسحب الصفوف لتغيير ترتيب العرض في كل مكان</p>
                    </div>
                </div>
                {isSaving && (
                    <span className="text-xs text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full font-medium animate-pulse">
                        جاري حفظ الترتيب...
                    </span>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Add / Edit Form */}
                <div className="lg:col-span-1">
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 sticky top-4">
                        <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
                            <span className="w-1 h-6 bg-emerald-500 rounded-full"></span>
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

                            try {
                                if (editingService) {
                                    await db.updateService(editingService.id, { name, sellingPrice, costPrice, millingPrice, designerPrice });
                                    toastSuccess('تم تعديل الخدمة بنجاح');
                                    setEditingService(null);
                                } else {
                                    await db.addService({ name, sellingPrice, costPrice, millingPrice, designerPrice });
                                    toastSuccess('تم إضافة الخدمة بنجاح');
                                }
                                const updatedServices = await db.getServices();
                                setServices(updatedServices);
                                form.reset();
                            } catch (error) {
                                console.error('Error saving service:', error);
                                toastError(error instanceof Error ? error.message : 'حدث خطأ أثناء حفظ الخدمة');
                            }
                        }} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">اسم الخدمة</label>
                                <input aria-label="اسم الخدمة" name="name" required defaultValue={editingService?.name} key={editingService?.id} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 transition-all" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">سعر البيع</label>
                                    <input aria-label="سعر البيع" name="sellingPrice" required type="number" defaultValue={editingService?.sellingPrice} key={`s-${editingService?.id}`} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 transition-all" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">التكلفة (المعمل)</label>
                                    <input aria-label="سعر التكلفة" name="costPrice" required type="number" defaultValue={editingService?.costPrice} key={`c-${editingService?.id}`} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 transition-all" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">سعر المصمم الافتراضي</label>
                                    <input
                                        aria-label="سعر المصمم"
                                        name="designerPrice"
                                        type="number"
                                        min="0"
                                        step="0.5"
                                        defaultValue={editingService?.designerPrice ?? ''}
                                        key={`d-${editingService?.id}`}
                                        placeholder="0 = مبتتحسبش"
                                        className="w-full p-2.5 bg-amber-50 border border-amber-200 rounded-xl focus:ring-2 focus:ring-amber-400 transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">سعر الخراطة (للمعامل)</label>
                                    <input aria-label="سعر الخراطة" name="millingPrice" type="number" defaultValue={editingService?.millingPrice} key={`m-${editingService?.id}`} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 transition-all" />
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="submit" className="flex-1 bg-emerald-600 text-white py-2.5 rounded-xl font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all active:scale-[0.98]">
                                    {editingService ? 'تحديث' : 'حفظ'}
                                </button>
                                {editingService && (
                                    <button type="button" onClick={() => { setEditingService(null); serviceFormRef.current?.reset(); }} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-all">إلغاء</button>
                                )}
                            </div>
                        </form>
                    </div>
                </div>

                {/* Services Table with Drag & Drop */}
                <div className="lg:col-span-2">
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                            <div>
                                <h3 className="font-bold text-gray-800">قائمة أسعار الخدمات</h3>
                                <p className="text-xs text-gray-400 mt-0.5">اسحب من <GripVertical size={11} className="inline" /> لتغيير الترتيب</p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => exportToExcel(services.map(s => ({ 'اسم الخدمة': s.name, 'سعر البيع': s.sellingPrice, 'التكلفة': s.costPrice, 'الخراطة': s.millingPrice || 0, 'الربح': s.sellingPrice - s.costPrice })), `services_${new Date().toISOString().split('T')[0]}`, 'الخدمات')}
                                    className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="تصدير Excel"
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
                                    className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="طباعة"
                                >
                                    <Printer size={18} />
                                </button>
                            </div>
                        </div>
                        <table className="w-full text-sm text-right">
                            <thead className="text-gray-500 bg-gray-50/50">
                                <tr>
                                    <th className="p-4 w-8"></th>
                                    <th className="p-4 font-medium">الخدمة</th>
                                    <th className="p-4 font-medium">سعر البيع</th>
                                    <th className="p-4 font-medium">التكلفة</th>
                                    <th className="p-4 font-medium">سعر المصمم</th>
                                    <th className="p-4 font-medium">الخراطة</th>
                                    <th className="p-4 font-medium text-center">إجراءات</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {services.map((s, index) => (
                                    <tr
                                        key={s.id}
                                        draggable
                                        onDragStart={() => handleDragStart(index)}
                                        onDragOver={(e) => handleDragOver(e, index)}
                                        onDrop={handleDrop}
                                        className="hover:bg-gray-50/80 transition-colors group cursor-grab active:cursor-grabbing active:bg-emerald-50/30"
                                    >
                                        <td className="p-4 w-8 text-gray-300 group-hover:text-gray-400 transition-colors">
                                            <GripVertical size={16} className="mx-auto" />
                                        </td>
                                        <td className="p-4 font-bold text-gray-800">{s.name}</td>
                                        <td className="p-4 text-emerald-600 font-bold">{s.sellingPrice}</td>
                                        <td className="p-4 text-rose-600">{s.costPrice}</td>
                                        <td className="p-4">
                                            {s.designerPrice === undefined ? (
                                                <span className="text-gray-300 text-xs">-</span>
                                            ) : s.designerPrice === 0 ? (
                                                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-bold">مجاني</span>
                                            ) : (
                                                <span className="text-amber-600 font-bold">{s.designerPrice}</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-gray-500">{s.millingPrice || '-'}</td>
                                        <td className="p-4 text-center">
                                            <div className="flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => setEditingService(s)} className="text-blue-500 hover:bg-blue-50 p-1.5 rounded-lg" title="تعديل"><Edit2 size={16} /></button>
                                                <button onClick={() => { if (confirm('حذف؟')) db.deleteService(s.id).then(() => db.getServices().then(setServices)); }} className="text-rose-500 hover:bg-rose-50 p-1.5 rounded-lg" title="حذف"><Trash2 size={16} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
