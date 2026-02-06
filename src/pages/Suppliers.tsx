import { useState, useEffect } from 'react';
import { db, type Supplier, type Service } from '../services/db';
import { useAuth } from '../context/AuthContext';
import { Plus, Edit2, X } from 'lucide-react';


export default function Suppliers() {
    const { user } = useAuth();
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Form State
    const [formData, setFormData] = useState<{
        name: string;
        supplierCode: string;
        username: string;
        phone: string;
        redoCostPercentage: number;
        customPrices: Record<string, number>;
        millingPrices: Record<string, number>;
    }>({
        name: '',
        supplierCode: '',
        username: '',
        phone: '',
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
                redoCostPercentage: supplier.redoCostPercentage || 0,
                customPrices: supplier.customPrices || {},
                millingPrices: supplier.millingPrices || {}
            });
        } else {
            setEditingSupplier(null);
            setFormData({ name: '', supplierCode: '', username: '', phone: '', redoCostPercentage: 0, customPrices: {}, millingPrices: {} });
        }
        setIsModalOpen(true);
    };

    const handlePriceChange = (serviceName: string, price: number, type: 'cost' | 'milling') => {
        setFormData(prev => ({
            ...prev,
            [type === 'cost' ? 'customPrices' : 'millingPrices']: {
                ...prev[type === 'cost' ? 'customPrices' : 'millingPrices'],
                [serviceName]: price
            }
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            if (editingSupplier) {
                await db.updateSupplier(editingSupplier.id, formData);
            } else {
                await db.addSupplier(formData);
            }
            await loadData();
            setIsModalOpen(false);
        } catch (error) {
            console.error('Error saving supplier:', error);
        }
    };

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">إدارة الموردين (المعامل الخارجية)</h1>
                    {isLoading && <span className="text-sm text-blue-600 animate-pulse">جاري التحميل...</span>}
                </div>
                {user?.role !== 'accountant' && (
                    <button
                        onClick={() => handleOpenModal()}
                        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                    >
                        <Plus size={20} />
                        <span>إضافة مورد</span>
                    </button>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {suppliers.map(supplier => (
                    <div key={supplier.id} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900">{supplier.name}</h3>
                                {supplier.supplierCode && <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs ml-2">{supplier.supplierCode}</span>}
                                <p className="text-sm text-gray-500">@{supplier.username}</p>
                            </div>
                            {user?.role !== 'accountant' && (
                                <button onClick={() => handleOpenModal(supplier)} className="p-2 text-gray-400 hover:text-blue-600 bg-gray-50 rounded-lg" aria-label="تعديل">
                                    <Edit2 size={16} />
                                </button>
                            )}
                        </div>

                        <div className="space-y-2 text-sm text-gray-600 mb-4">
                            <div className="flex justify-between">
                                <span>الهاتف:</span>
                                <span className="font-medium" dir="ltr">{supplier.phone}</span>
                            </div>
                            <div className="flex justify-between items-center bg-blue-50 px-2 py-1 rounded">
                                <span>نسبة تحملنا في الإعادة:</span>
                                <span className="font-bold text-blue-700">{supplier.redoCostPercentage || 0}%</span>
                            </div>
                        </div>

                        <div className="border-t border-gray-100 pt-4">
                            <h4 className="font-bold text-xs text-gray-500 mb-2">أسعار الشراء الخاصة (جنيه)</h4>
                            <h4 className="font-bold text-xs text-gray-500 mb-2">أسعار خاصة (شراء / خراطة فقط)</h4>
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                                {[...new Set([...Object.keys(supplier.customPrices || {}), ...Object.keys(supplier.millingPrices || {})])].map((srv) => (
                                    <div key={srv} className="flex justify-between text-xs items-center">
                                        <span>{srv}</span>
                                        <div className="flex gap-2">
                                            {supplier.customPrices?.[srv] && <span className="font-medium text-red-600 px-1 bg-red-50 rounded" title="سعر كامل">{supplier.customPrices[srv]}</span>}
                                            {supplier.millingPrices?.[srv] && <span className="font-medium text-blue-600 px-1 bg-blue-50 rounded" title="خراطة فقط">{supplier.millingPrices[srv]}</span>}
                                        </div>
                                    </div>
                                ))}
                                {(!supplier.customPrices && !supplier.millingPrices) && (
                                    <p className="text-xs text-gray-400 italic">نفس الأسعار الافتراضية</p>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white">
                            <h2 className="text-xl font-bold">
                                {editingSupplier ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
                            </h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600" aria-label="إغلاق">
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">اسم المعمل / المورد</label>
                                    <input
                                        required
                                        type="text"
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full p-2 border rounded-lg"
                                        aria-label="اسم المعمل / المورد"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">كود المورد (مطابقة الاستيراد)</label>
                                    <input
                                        type="text"
                                        value={formData.supplierCode}
                                        onChange={e => setFormData({ ...formData, supplierCode: e.target.value })}
                                        className="w-full p-2 border rounded-lg"
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
                                        className="w-full p-2 border rounded-lg"
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
                                        className="w-full p-2 border rounded-lg"
                                        aria-label="الهاتف"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">نسبة تحملنا للتكلفة عند الإعادة (%)</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={formData.redoCostPercentage}
                                            onChange={e => setFormData({ ...formData, redoCostPercentage: Number(e.target.value) })}
                                            className="w-full p-2 border rounded-lg pr-8"
                                            placeholder="مثلاً 25"
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">%</span>
                                    </div>
                                    <p className="text-[10px] text-gray-400 mt-1">
                                        0 = المعمل يتحملها بالكامل (Free)
                                        <br />
                                        100 = نتحملها نحن بالكامل (Full Cost)
                                    </p>
                                </div>
                            </div>

                            <div className="border-t border-gray-100 pt-6">
                                <h3 className="font-bold text-gray-800 mb-4">تخصيص أسعار الشراء (التكلفة)</h3>
                                <p className="text-sm text-gray-500 mb-4">اترك الحقل فارغاً لاستخدام سعر التكلفة الافتراضي.</p>


                                <div className="grid grid-cols-1 gap-4">
                                    <div className="flex justify-end gap-8 px-2 text-xs font-bold text-gray-500 mb-1">
                                        <span className="w-24 text-center">سعر الشراء (كامل)</span>
                                        <span className="w-24 text-center">سعر الخراطة فقط</span>
                                    </div>
                                    {services.map(service => (
                                        <div key={service.id} className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg border border-gray-100">
                                            <label className="flex-1 text-sm font-medium">{service.name}</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    placeholder="كامل"
                                                    className="w-24 p-1 text-sm border rounded hover:border-red-300 focus:border-red-500"
                                                    value={formData.customPrices[service.name] || ''}
                                                    onChange={e => handlePriceChange(service.name, Number(e.target.value), 'cost')}
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="خراطة"
                                                    className="w-24 p-1 text-sm border rounded hover:border-blue-300 focus:border-blue-500 bg-blue-50/50"
                                                    value={formData.millingPrices[service.name] || ''}
                                                    onChange={e => handlePriceChange(service.name, Number(e.target.value), 'milling')}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="pt-6 flex gap-3 justify-end">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-6 py-2 border rounded-lg hover:bg-gray-50"
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="submit"
                                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                >
                                    حفظ
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
