import React, { useState, useEffect, useId, useMemo } from 'react';
import { type Order, type User, type Doctor, type Supplier } from '../../services/db';
import { generateNextCaseIdForDoctor } from '../../services/caseIdService';
import { X, Check, Building2, User as UserIcon, ArrowRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useDialogBehavior } from '../../hooks/useDialogBehavior';

interface AcceptOrderModalProps {
    order: Order;
    doctors: Doctor[];
    suppliers: Supplier[];
    designers: User[];
    existingOrders: Order[];
    isOpen: boolean;
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
    isOpen,
    onClose,
    onConfirm
}: AcceptOrderModalProps) {
    const titleId = useId();
    const dialogRef = useDialogBehavior(isOpen, onClose);
    const [supplierId, setSupplierId] = useState('');
    const [designerId, setDesignerId] = useState('');
    const [workflowType, setWorkflowType] = useState<'full' | 'split'>('full');
    const visibleSuppliers = useMemo(
        () => suppliers.filter(supplier => supplier.isActive !== false),
        [suppliers]
    );

    // Calculate recommended case ID
    const doctor = doctors.find(d => d.id === order.doctorId);
    const [caseId, setCaseId] = useState('');

    // Update caseId when recommended changes (e.g. initial load or doctor change)
    useEffect(() => {
        let isMounted = true;

        const loadRecommendedCaseId = async () => {
            if (!doctor || !isOpen) {
                if (isMounted) {
                    setCaseId('');
                }
                return;
            }

            const nextCaseId = await generateNextCaseIdForDoctor(doctor, doctors);
            if (isMounted) {
                setCaseId(nextCaseId);
            }
        };

        loadRecommendedCaseId();

        return () => {
            isMounted = false;
        };
    }, [doctor, doctors, isOpen]);

    const [receivedDate, setReceivedDate] = useState(() => {
        const d = new Date();
        return d.toISOString().split('T')[0];
    });
    const [deliveryDate, setDeliveryDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() + 7);
        return d.toISOString().split('T')[0];
    });

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!supplierId) return;
        if (workflowType === 'split' && !designerId) return;
        if (!caseId) return;

        onConfirm({
            caseId,
            workflowType,
            supplierId,
            designerId: workflowType === 'split' ? designerId : undefined,
            receivedDate,
            deliveryDate
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/50 p-0 backdrop-blur-sm animate-in fade-in sm:items-center sm:p-4">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="flex h-[100dvh] w-full max-w-lg flex-col overflow-hidden bg-white shadow-2xl dark:bg-gray-800 sm:h-auto sm:max-h-[92vh] sm:rounded-xl">
                <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-gray-50 p-4 pt-[max(1rem,env(safe-area-inset-top))] dark:border-gray-700 dark:bg-gray-700/50">
                    <h3 id={titleId} className="font-bold text-lg flex items-center gap-2">
                        <Check className="text-green-600" size={20} />
                        قبول الأوردر وتحديد المسار
                    </h3>
                    <button onClick={onClose} aria-label="إغلاق نافذة قبول الأوردر" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 space-y-6 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
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
                        <p className="text-[10px] text-gray-400 mt-1">تم توليد الرقم تلقائياً بناءً على كود الجهة والتاريخ وتسلسل السنة.</p>
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
                                    ? 'border-teal-600 bg-teal-50 text-teal-700'
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
                                    ? 'border-teal-600 bg-teal-50 text-teal-700'
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
                                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-base sm:text-sm outline-none focus:border-blue-500"
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
                                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-base sm:text-sm outline-none focus:border-blue-500"
                                value={supplierId}
                                onChange={e => setSupplierId(e.target.value)}
                            >
                                <option value="">-- اختر المعمل --</option>
                                {visibleSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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
                                className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-base sm:text-xs font-bold"
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
                                className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-base sm:text-xs font-bold"
                            />
                        </div>
                    </div>

                    <div className="sticky bottom-0 -mx-4 flex gap-3 border-t border-gray-100 bg-white/95 px-4 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur dark:border-gray-700 dark:bg-gray-800/95 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:pt-4">
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
