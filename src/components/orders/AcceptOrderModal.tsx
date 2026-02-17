import { useState, useEffect } from 'react';
import { type Order, type Supplier, type User, type Doctor } from '../../services/db';
import { generateCaseId } from '../../utils/caseId';
import { X, Check, Building2, User as UserIcon, ArrowRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface AcceptOrderModalProps {
    order: Order;
    doctors: Doctor[];
    suppliers: Supplier[];
    designers: User[];
    existingOrders: Order[];
    onClose: () => void;
    onConfirm: (data: {
        caseId: string;
        workflowType: 'full' | 'split';
        supplierId: string;
        designerId?: string;
        receivedDate: string;
        deliveryDate: string;
    }) => void;
}

export default function AcceptOrderModal({
    order,
    doctors,
    suppliers,
    designers,
    existingOrders,
    onClose,
    onConfirm
}: AcceptOrderModalProps) {
    const [workflowType, setWorkflowType] = useState<'full' | 'split'>('full');
    const [supplierId, setSupplierId] = useState('');
    const [designerId, setDesignerId] = useState('');
    const [caseId, setCaseId] = useState('');
    const [receivedDate, setReceivedDate] = useState(new Date().toISOString().split('T')[0]);
    const [deliveryDate, setDeliveryDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() + 3);
        return d.toISOString().split('T')[0];
    });

    const doctor = doctors.find(d => d.id === order.doctorId);

    useEffect(() => {
        if (doctor) {
            const nextId = generateCaseId(doctor.doctorCode || 'UNK');
            setCaseId(nextId);
        }
    }, [doctor, existingOrders]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!supplierId) return;
        if (workflowType === 'split' && !designerId) return;

        onConfirm({
            caseId,
            workflowType,
            supplierId,
            designerId: workflowType === 'split' ? designerId : undefined,
            receivedDate,
            deliveryDate
        });
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white dark:bg-gray-800 rounded-xl max-w-lg w-full shadow-2xl overflow-hidden">
                <div className="bg-gray-50 dark:bg-gray-700/50 p-4 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
                    <h3 className="font-bold text-lg flex items-center gap-2">
                        <Check className="text-green-600" size={20} />
                        قبول الأوردر وتحديد المسار
                    </h3>
                    <button onClick={onClose} aria-label="Close Modal" className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Order Summary */}
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-100 dark:border-blue-900/30 text-sm">
                        <div className="flex justify-between mb-1">
                            <span className="text-gray-500">الطبيب:</span>
                            <span className="font-bold">{doctor?.name}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">المريض:</span>
                            <span className="font-bold">{order.patientName}</span>
                        </div>
                    </div>

                    {/* Case ID Generation */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">رقم الحالة (Case ID)</label>
                        <div className="flex items-center gap-2">
                            <Input
                                title="Generated Case ID"
                                value={caseId}
                                onChange={e => setCaseId(e.target.value)}
                                className="font-mono text-center font-bold text-lg tracking-wider"
                            />
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1">تم توليد الرقم تلقائياً بناءً على كود الطبيب والتاريخ.</p>
                    </div>

                    {/* Workflow Type */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-2">نوع مسار العمل</label>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                type="button"
                                title="Select Full Lab Workflow"
                                onClick={() => setWorkflowType('full')}
                                className={`p-3 rounded-lg border-2 text-sm font-bold transition-all ${workflowType === 'full'
                                    ? 'border-purple-600 bg-purple-50 text-purple-700'
                                    : 'border-gray-200 hover:border-gray-300 text-gray-600'
                                    }`}
                            >
                                <Building2 size={24} className="mb-2 mx-auto opacity-80" />
                                معمل كامل
                                <span className="block text-[10px] font-normal opacity-70 mt-1">إرسال للمعمل مباشرة</span>
                            </button>
                            <button
                                type="button"
                                title="Select Split Workflow"
                                onClick={() => setWorkflowType('split')}
                                className={`p-3 rounded-lg border-2 text-sm font-bold transition-all ${workflowType === 'split'
                                    ? 'border-purple-600 bg-purple-50 text-purple-700'
                                    : 'border-gray-200 hover:border-gray-300 text-gray-600'
                                    }`}
                            >
                                <div className="flex justify-center gap-1 mb-2 opacity-80">
                                    <UserIcon size={24} />
                                    <ArrowRight size={16} className="mt-1" />
                                    <Building2 size={24} />
                                </div>
                                تقسيم (Split)
                                <span className="block text-[10px] font-normal opacity-70 mt-1">تصميم ثم معمل</span>
                            </button>
                        </div>
                    </div>

                    {/* Supplier & Designer Select */}
                    <div className="space-y-3">
                        {workflowType === 'split' && (
                            <div className="animate-in slide-in-from-top-2">
                                <label className="block text-xs font-bold text-gray-500 mb-1">المصمم (Designer)</label>
                                <select
                                    required
                                    title="Select Designer"
                                    aria-label="Select Designer"
                                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-500"
                                    value={designerId}
                                    onChange={e => setDesignerId(e.target.value)}
                                >
                                    <option value="">-- اختر المصمم --</option>
                                    {designers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                </select>
                            </div>
                        )}

                        <div className="animate-in slide-in-from-top-2">
                            <label className="block text-xs font-bold text-gray-500 mb-1">المعمل المنفذ (Lab)</label>
                            <select
                                required
                                title="Select Lab"
                                aria-label="Select Lab"
                                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-blue-500"
                                value={supplierId}
                                onChange={e => setSupplierId(e.target.value)}
                            >
                                <option value="">-- اختر المعمل --</option>
                                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Dates */}
                    <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                        <div>
                            <label className="block text-[10px] font-bold text-gray-500 mb-1">تاريخ الاستلام</label>
                            <input
                                title="Received Date"
                                type="date"
                                required
                                value={receivedDate}
                                onChange={e => setReceivedDate(e.target.value)}
                                className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-gray-500 mb-1">تاريخ التسليم المتوقع</label>
                            <input
                                title="Delivery Date"
                                type="date"
                                required
                                value={deliveryDate}
                                onChange={e => setDeliveryDate(e.target.value)}
                                className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold"
                            />
                        </div>
                    </div>

                    <div className="flex gap-3 pt-4">
                        <Button type="button" variant="ghost" onClick={onClose} className="flex-1">إلغاء</Button>
                        <Button type="submit" variant="primary" disabled={!supplierId || (workflowType === 'split' && !designerId)} className="flex-[2]">
                            تأكيد وبدء العمل
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
