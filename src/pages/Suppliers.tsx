/* eslint-disable @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any */
import { useState, useEffect, useMemo } from 'react';
import { db, type Supplier, type Service } from '../services/db';
import { useAuth } from '../context/AuthContext';
import { Plus, Edit2, X, Building2, Package, Truck, Filter } from 'lucide-react';
import BillingSettingsPanel from '../components/finance/BillingSettingsPanel';
import { useToast } from '../context/ToastContext';

const SUPPLIER_TYPE_LABELS: Record<'external_lab' | 'material_vendor' | 'courier', { label: string; icon: typeof Building2; color: string }> = {
    external_lab: { label: 'معمل خارجي', icon: Building2, color: 'bg-blue-50 text-blue-700 border-blue-200' },
    material_vendor: { label: 'مورد خامات ومستلزمات', icon: Package, color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    courier: { label: 'شركة شحن', icon: Truck, color: 'bg-amber-50 text-amber-700 border-amber-200' },
};

export default function Suppliers() {
    const { user } = useAuth();
    const { success: toastSuccess, error: toastError } = useToast();
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [typeFilter, setTypeFilter] = useState<'all' | 'external_lab' | 'material_vendor' | 'courier'>('all');

    // Form State
    const [formData, setFormData] = useState<{
        name: string;
        supplierCode: string;
        username: string;
        phone: string;
        isActive: boolean;
        supplierType: 'external_lab' | 'material_vendor' | 'courier';
        redoCostPercentage: number;
        customPrices: Record<string, number>;
        millingPrices: Record<string, number>;
    }>({
        name: '',
        supplierCode: '',
        username: '',
        phone: '',
        isActive: true,
        supplierType: 'external_lab',
        redoCostPercentage: 0,
        customPrices: {},
        millingPrices: {}
    });

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [sups, srvs] = await Promise.all([
                db.getSuppliers(),
                db.getServices()
            ]);
            setSuppliers(sups);
            setServices(srvs);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleOpenModal = (supplier?: Supplier) => {
        if (supplier) {
            setEditingSupplier(supplier);
            setFormData({
                name: supplier.name,
                supplierCode: supplier.supplierCode || '',
                username: supplier.username,
                phone: supplier.phone,
                isActive: supplier.isActive !== false,
                supplierType: supplier.supplierType || 'external_lab',
                redoCostPercentage: supplier.redoCostPercentage || 0,
                customPrices: supplier.customPrices || {},
                millingPrices: supplier.millingPrices || {}
            });
        } else {
            setEditingSupplier(null);
            setFormData({
                name: '',
                supplierCode: '',
                username: '',
                phone: '',
                isActive: true,
                supplierType: 'external_lab',
                redoCostPercentage: 0,
                customPrices: {},
                millingPrices: {}
            });
        }
        setIsModalOpen(true);
    };

    const handlePriceChange = (serviceName: string, rawValue: string, type: 'cost' | 'milling') => {
        setFormData(prev => {
            const priceKey = type === 'cost' ? 'customPrices' : 'millingPrices';
            const currentPrices = { ...prev[priceKey] };

            if (rawValue.trim() === '') {
                delete currentPrices[serviceName];
            } else {
                const price = Number(rawValue);
                if (!isNaN(price)) {
                    currentPrices[serviceName] = price;
                }
            }

            return {
                ...prev,
                [priceKey]: currentPrices
            };
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            if (editingSupplier) {
                await db.updateSupplier(editingSupplier.id, formData);
                toastSuccess('تم تعديل بيانات المورد بنجاح');
            } else {
                await db.addSupplier(formData);
                toastSuccess('تم إضافة المورد بنجاح');
            }
            await loadData();
            setIsModalOpen(false);
        } catch (error) {
            console.error('Error saving supplier:', error);
            toastError(error instanceof Error ? error.message : 'حدث خطأ أثناء حفظ المورد');
        }
    };

    const filteredSuppliers = useMemo(() => {
        return suppliers.filter(s => {
            if (typeFilter === 'all') return true;
            const currentType = s.supplierType || 'external_lab';
            return currentType === typeFilter;
        });
    }, [suppliers, typeFilter]);

    return (
        <div className="p-6 space-y-6" dir="rtl">
            <div className="flex justify-between items-center flex-wrap gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">إدارة الموردين والمعامل</h1>
                    <p className="text-sm text-gray-500">
                        حسابات المعامل الخارجية وموردي الخامات والمستلزمات وشركات الشحن
                    </p>
                    {isLoading && <span className="text-sm text-blue-600 animate-pulse">جاري التحميل...</span>}
                </div>
                {user?.role !== 'accountant' && (
                    <button
                        onClick={() => handleOpenModal()}
                        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl hover:bg-blue-700 shadow-sm text-sm font-medium"
                    >
                        <Plus size={18} />
                        <span>إضافة مورد جديد</span>
                    </button>
                )}
            </div>

            {/* Type Filters */}
            <div className="flex items-center gap-2 flex-wrap text-xs bg-white p-2.5 rounded-xl border border-gray-200">
                <span className="font-bold text-gray-600 mr-2 flex items-center gap-1">
                    <Filter className="w-3.5 h-3.5" />
                    التصنيف:
                </span>
                <button
                    onClick={() => setTypeFilter('all')}
                    className={`px-3 py-1.5 rounded-lg font-medium ${
                        typeFilter === 'all'
                            ? 'bg-gray-800 text-white font-bold'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                >
                    الكل ({suppliers.length})
                </button>
                <button
                    onClick={() => setTypeFilter('external_lab')}
                    className={`px-3 py-1.5 rounded-lg font-medium flex items-center gap-1 ${
                        typeFilter === 'external_lab'
                            ? 'bg-blue-600 text-white font-bold'
                            : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                    }`}
                >
                    <Building2 className="w-3.5 h-3.5" />
                    معامل خارجية ({suppliers.filter(s => (s.supplierType || 'external_lab') === 'external_lab').length})
                </button>
                <button
                    onClick={() => setTypeFilter('material_vendor')}
                    className={`px-3 py-1.5 rounded-lg font-medium flex items-center gap-1 ${
                        typeFilter === 'material_vendor'
                            ? 'bg-emerald-600 text-white font-bold'
                            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    }`}
                >
                    <Package className="w-3.5 h-3.5" />
                    موردي خامات ({suppliers.filter(s => s.supplierType === 'material_vendor').length})
                </button>
                <button
                    onClick={() => setTypeFilter('courier')}
                    className={`px-3 py-1.5 rounded-lg font-medium flex items-center gap-1 ${
                        typeFilter === 'courier'
                            ? 'bg-amber-600 text-white font-bold'
                            : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                    }`}
                >
                    <Truck className="w-3.5 h-3.5" />
                    شركات شحن ({suppliers.filter(s => s.supplierType === 'courier').length})
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredSuppliers.map(supplier => {
                    const typeConfig = SUPPLIER_TYPE_LABELS[supplier.supplierType || 'external_lab'];
                    const TypeIcon = typeConfig.icon;

                    return (
                        <div key={supplier.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
                            <div className="flex justify-between items-start">
                                <div>
                                    <div className="flex items-center gap-2 flex-wrap mb-1">
                                        <h3 className="text-lg font-bold text-gray-900">{supplier.name}</h3>
                                        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md border ${typeConfig.color}`}>
                                            <TypeIcon className="w-3 h-3" />
                                            {typeConfig.label}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {supplier.supplierCode && <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs">{supplier.supplierCode}</span>}
                                        {supplier.isActive === false && <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded text-xs font-bold">غير فعال</span>}
                                        <p className="text-xs text-gray-500 font-mono">@{supplier.username}</p>
                                    </div>
                                </div>
                                {user?.role !== 'accountant' && (
                                    <button onClick={() => handleOpenModal(supplier)} className="p-2 text-gray-400 hover:text-blue-600 bg-gray-50 rounded-lg" aria-label="تعديل">
                                        <Edit2 size={16} />
                                    </button>
                                )}
                            </div>

                            <div className="space-y-2 text-sm text-gray-600">
                                <div className="flex justify-between">
                                    <span>الهاتف:</span>
                                    <span className="font-medium font-mono" dir="ltr">{supplier.phone}</span>
                                </div>
                                {(!supplier.supplierType || supplier.supplierType === 'external_lab') && (
                                    <div className="flex justify-between items-center bg-blue-50/70 px-2.5 py-1.5 rounded-lg text-xs">
                                        <span className="text-blue-900 font-medium">نسبة تحملنا في الإعادة:</span>
                                        <span className="font-bold text-blue-700">{supplier.redoCostPercentage || 0}%</span>
                                    </div>
                                )}
                            </div>

                            {(!supplier.supplierType || supplier.supplierType === 'external_lab') && (
                                <div className="border-t border-gray-100 pt-3">
                                    <h4 className="font-bold text-xs text-gray-500 mb-2">أسعار خاصة (شراء / خراطة)</h4>
                                    <div className="space-y-1 max-h-32 overflow-y-auto">
                                        {[...new Set([...Object.keys(supplier.customPrices || {}), ...Object.keys(supplier.millingPrices || {})])].map((srv) => (
                                            <div key={srv} className="flex justify-between text-xs items-center">
                                                <span>{srv}</span>
                                                <div className="flex gap-2">
                                                    {supplier.customPrices?.[srv] !== undefined && <span className="font-medium text-red-600 px-1 bg-red-50 rounded" title="سعر كامل">{supplier.customPrices[srv]}</span>}
                                                    {supplier.millingPrices?.[srv] !== undefined && <span className="font-medium text-blue-600 px-1 bg-blue-50 rounded" title="خراطة فقط">{supplier.millingPrices[srv]}</span>}
                                                </div>
                                            </div>
                                        ))}
                                        {(!supplier.customPrices || Object.keys(supplier.customPrices).length === 0) && (!supplier.millingPrices || Object.keys(supplier.millingPrices).length === 0) && (
                                            <p className="text-xs text-gray-400 italic">نفس الأسعار الافتراضية</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white z-10">
                            <h2 className="text-xl font-bold">
                                {editingSupplier ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
                            </h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600" aria-label="إغلاق">
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-bold text-gray-700 mb-1">نوع المورد</label>
                                    <select
                                        value={formData.supplierType}
                                        onChange={e => setFormData({ ...formData, supplierType: e.target.value as any })}
                                        className="w-full p-2.5 border border-gray-200 bg-gray-50 rounded-xl text-sm"
                                    >
                                        <option value="external_lab">معمل خارجي (تنفيذ حالات وأوامر شغل)</option>
                                        <option value="material_vendor">مورد خامات ومستلزمات مخزن</option>
                                        <option value="courier">شركة شحن وتوصيل</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">اسم المعمل / المورد</label>
                                    <input
                                        required
                                        type="text"
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full p-2.5 border border-gray-200 rounded-xl text-sm"
                                        aria-label="اسم المعمل / المورد"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">كود المورد (مطابقة الاستيراد)</label>
                                    <input
                                        type="text"
                                        value={formData.supplierCode}
                                        onChange={e => setFormData({ ...formData, supplierCode: e.target.value })}
                                        className="w-full p-2.5 border border-gray-200 rounded-xl text-sm font-mono"
                                        placeholder="مثلاً: SUP001"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">اسم المستخدم (للدخول)</label>
                                    <input
                                        required
                                        type="text"
                                        value={formData.username}
                                        onChange={e => setFormData({ ...formData, username: e.target.value })}
                                        className="w-full p-2.5 border border-gray-200 rounded-xl text-sm font-mono"
                                        aria-label="اسم المستخدم (للدخول)"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">الهاتف</label>
                                    <input
                                        required
                                        type="text"
                                        value={formData.phone}
                                        onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                        className="w-full p-2.5 border border-gray-200 rounded-xl text-sm font-mono"
                                        aria-label="الهاتف"
                                    />
                                </div>

                                {formData.supplierType === 'external_lab' && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">نسبة تحملنا للتكلفة عند الإعادة (%)</label>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                min="0"
                                                max="100"
                                                value={formData.redoCostPercentage}
                                                onChange={e => setFormData({ ...formData, redoCostPercentage: Number(e.target.value) })}
                                                className="w-full p-2.5 border border-gray-200 rounded-xl pr-8 text-sm"
                                                placeholder="مثلاً 25"
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">%</span>
                                        </div>
                                    </div>
                                )}

                                <label className="flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                                    <input
                                        type="checkbox"
                                        className="mt-1"
                                        checked={formData.isActive}
                                        onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                                    />
                                    <div>
                                        <span className="block text-sm font-bold text-gray-800">فعال في السيستم</span>
                                        <span className="block text-xs text-gray-500 mt-1">عند إيقافه سيظل موجوداً في الحسابات والفواتير السابقة، ولن يظهر كاختيار جديد.</span>
                                    </div>
                                </label>
                            </div>

                            {formData.supplierType === 'external_lab' && (
                                <div className="border-t border-gray-100 pt-6">
                                    <h3 className="font-bold text-gray-800 mb-2">تخصيص أسعار الشراء (التكلفة)</h3>
                                    <p className="text-xs text-gray-500 mb-4">اترك الحقل فارغاً لاستخدام سعر التكلفة الافتراضي.</p>

                                    <div className="grid grid-cols-1 gap-3 max-h-60 overflow-y-auto">
                                        {services.map(service => (
                                            <div key={service.id} className="flex items-center gap-3 bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                                                <label className="flex-1 text-xs font-medium">{service.name}</label>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="number"
                                                        placeholder="كامل"
                                                        className="w-20 p-1 text-xs border rounded-lg"
                                                        value={formData.customPrices[service.name] !== undefined ? formData.customPrices[service.name] : ''}
                                                        onChange={e => handlePriceChange(service.name, e.target.value, 'cost')}
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="خراطة"
                                                        className="w-20 p-1 text-xs border rounded-lg bg-blue-50/50"
                                                        value={formData.millingPrices[service.name] !== undefined ? formData.millingPrices[service.name] : ''}
                                                        onChange={e => handlePriceChange(service.name, e.target.value, 'milling')}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {editingSupplier && formData.supplierType === 'external_lab' && (
                                <div className="border-t border-gray-100 pt-6">
                                    <BillingSettingsPanel
                                        entityType="external_lab"
                                        entityId={editingSupplier.id}
                                        title="نظام الدفع للمعمل"
                                        canEdit={user?.role === 'admin'}
                                    />
                                </div>
                            )}

                            <div className="pt-4 flex gap-3 justify-end border-t">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-5 py-2 border rounded-xl hover:bg-gray-50 text-sm font-medium"
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="submit"
                                    className="px-6 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-bold shadow-sm"
                                >
                                    حفظ المورد
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
