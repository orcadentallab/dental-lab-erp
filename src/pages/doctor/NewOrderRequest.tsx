import { useState, useEffect } from 'react';
import { db, type Order, type Service, type OrderItem } from '../../services/db';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Box, Plus, Trash2, Link as LinkIcon, Image, Send } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface FormOrderItem extends Omit<OrderItem, 'teethNumbers'> {
    teethNumbers: string;
}

export default function NewOrderRequest() {
    const { user } = useAuth();
    const { error: toastError, success: toastSuccess } = useToast();
    const navigate = useNavigate();

    const [services, setServices] = useState<Service[]>([]);
    const [loading, setLoading] = useState(false);

    // Form State
    const [patientName, setPatientName] = useState('');
    const [shade, setShade] = useState('');
    const [stlUrl, setStlUrl] = useState('');
    const [imagesUrl, setImagesUrl] = useState('');
    const [instructions, setInstructions] = useState('');

    // Items
    const [items, setItems] = useState<FormOrderItem[]>([{ serviceType: '', teethNumbers: '', price: 0 }]);

    useEffect(() => {
        const loadServices = async () => {
            const data = await db.getServices();
            setServices(data.sort((a, b) => a.name.localeCompare(b.name)));
            // Do not set default service automatically - force user to select
            // if (data.length > 0) {
            //     setItems([{ serviceType: data[0].name, teethNumbers: '', price: 0 }]);
            // }
        };
        loadServices();
    }, []);

    const handleAddItem = () => {
        if (services.length > 0) {
            setItems([...items, { serviceType: services[0].name, teethNumbers: '', price: 0 }]);
        }
    };

    const handleRemoveItem = (index: number) => {
        if (items.length > 1) {
            const newItems = [...items];
            newItems.splice(index, 1);
            setItems(newItems);
        }
    };

    const updateItem = (index: number, field: keyof FormOrderItem, value: string | number) => {
        const newItems = [...items];
        newItems[index] = { ...newItems[index], [field]: value };
        setItems(newItems);
    };

    // Calculate Total Automatically (No Discount)
    const calculateTotal = () => {
        return items.reduce((sum, item) => {
            const count = item.teethNumbers ? item.teethNumbers.split(',').length : 0;
            const svc = services.find(s => s.name === item.serviceType);
            return sum + (count * (svc ? svc.sellingPrice : 0));
        }, 0);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (loading) return;

        if (!user?.entityId) {
            toastError('خطأ: حسابك غير مرتبط ببيانات طبيب. يرجى مراجعة الإدارة.');
            return;
        }

        if (!patientName.trim()) {
            toastError('يرجى إدخال اسم المريض');
            return;
        }

        const invalidItems = items.filter(i => i.teethNumbers.split(/[\s,]+/).filter(t => t.trim().length > 0).length === 0);
        if (invalidItems.length > 0) {
            toastError('يرجى تحديد أرقام الأسنان لجميع الخدمات');
            return;
        }

        setLoading(true);
        try {
            const doctor = await db.getDoctor(user.entityId);
            if (!doctor) throw new Error('بيانات الطبيب غير موجودة');

            // Generate temporary Case ID (will be finalized by Admin)
            // Or use a "REQ-" prefix
            const caseId = `REQ-${Date.now().toString().slice(-6)}`;

            const orderTotal = calculateTotal();

            const orderData: Omit<Order, 'id'> = {
                caseId,
                doctorId: user.entityId,
                patientName,
                items: items.map(i => ({
                    ...i,
                    teethNumbers: i.teethNumbers.split(',').map(s => s.trim()).filter(Boolean),
                    price: services.find(s => s.name === i.serviceType)?.sellingPrice || 0
                })),
                shade,
                instructions,
                stlUrl: stlUrl || undefined,
                imagesUrl: imagesUrl || undefined,
                status: 'Pending Review',
                technicianStatus: 'Pending',
                deliveryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Default 3 days
                createdAt: new Date().toISOString(),
                totalPrice: orderTotal,
                cost: 0, // Costs calculated by lab
                discount: 0,
                priority: 'Normal',
                comments: [],
                workflowType: 'full', // Default
            };

            await db.addOrder(orderData);
            toastSuccess('تم إرسال الطلب بنجاح. سيتم مراجعته من قبل المعمل.');
            navigate('/doctor/my-orders');
        } catch (error) {
            console.error(error);
            toastError('حدث خطأ أثناء إرسال الطلب');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto p-4 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">طلب أوردر جديد</h1>
                    <p className="text-gray-500">قم بتعبئة البيانات وسيقوم المعمل بمراجعة الطلب وتأكيده.</p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
                <Card className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <Input
                            label="اسم المريض"
                            required
                            value={patientName}
                            onChange={e => setPatientName(e.target.value)}
                            placeholder="اسم الحالة..."
                        />
                        <Input
                            label="اللون (Shade)"
                            value={shade}
                            onChange={e => setShade(e.target.value)}
                            placeholder="e.g. A1, B2"
                        />
                    </div>

                    <div className="space-y-4 mb-6">
                        <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg border border-gray-100">
                            <h3 className="font-bold text-gray-700 flex items-center gap-2">
                                <Box size={18} className="text-blue-600" />
                                الخدمات المطلوبة
                            </h3>
                            <Button type="button" size="sm" onClick={handleAddItem} className="gap-1">
                                <Plus size={16} /> إضافة خدمة
                            </Button>
                        </div>

                        {items.map((item, index) => (
                            <div key={index} className="flex gap-3 items-end bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center font-bold text-gray-500 shrink-0">
                                    {index + 1}
                                </div>
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-gray-500 mb-1">نوع الخدمة</label>
                                    <select
                                        title="Service Type"
                                        aria-label="Service Type"
                                        className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold outline-none focus:border-blue-500 transition-colors"
                                        value={item.serviceType}
                                        onChange={(e) => updateItem(index, 'serviceType', e.target.value)}
                                    >
                                        <option value="" disabled>-- اختر نوع الخدمة --</option>
                                        {services.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                    </select>
                                </div>
                                <div className="flex-[2]">
                                    <Input
                                        label="أرقام الأسنان (مفصولة بفاصلة)"
                                        value={item.teethNumbers}
                                        onChange={e => updateItem(index, 'teethNumbers', e.target.value)}
                                        placeholder="11, 21, 22..."
                                        className="font-mono text-left ltr"
                                    />
                                </div>
                                {items.length > 1 && (
                                    <button
                                        type="button"
                                        aria-label="Remove Item"
                                        onClick={() => handleRemoveItem(index)}
                                        className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                                    <LinkIcon size={16} className="text-blue-600" /> رابط ملف المسح (Scan Link)
                                </label>
                                <Input
                                    className="font-mono text-left ltr text-blue-600"
                                    placeholder="https://..."
                                    value={stlUrl}
                                    onChange={e => setStlUrl(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                                    <Image size={16} className="text-purple-600" /> رابط الصور (Images Link)
                                </label>
                                <Input
                                    className="font-mono text-left ltr text-blue-600"
                                    placeholder="https://..."
                                    value={imagesUrl}
                                    onChange={e => setImagesUrl(e.target.value)}
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">ملاحظات إضافية</label>
                            <textarea
                                className="w-full h-32 p-3 border border-gray-200 rounded-lg resize-none outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm"
                                placeholder="أي تفاصيل إضافية للمعمل..."
                                value={instructions}
                                onChange={e => setInstructions(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="mt-6 pt-4 border-t border-gray-100 flex justify-between items-center">
                        <div>
                            <span className="text-gray-500 text-sm">التكلفة التقديرية</span>
                            <div className="text-2xl font-black text-gray-800">{calculateTotal().toLocaleString()} ج.م</div>
                        </div>
                        <Button type="submit" size="lg" disabled={loading} className="px-8 bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20">
                            {loading ? 'جاري الإرسال...' : (
                                <>
                                    <Send size={18} className="ml-2" /> إرسال الطلب
                                </>
                            )}
                        </Button>
                    </div>

                </Card>
            </form>
        </div >
    );
}
