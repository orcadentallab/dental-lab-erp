import { useId, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { db, type Order } from '../../services/db';
import { generateNextCaseIdForDoctor } from '../../services/caseIdService';
import { Input } from '../ui/Input';
import { useAuth } from '../../context/AuthContext';
import { useDialogBehavior } from '../../hooks/useDialogBehavior';

interface Props {
    order: Order;
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

const REDO_REASONS = [
    { value: 'lab_error', label: 'خطأ في المعمل' },
    { value: 'design_error', label: 'خطأ في التصميم' },
    { value: 'doctor_change', label: 'تغيير طلب الدكتور' },
    { value: 'scan_issue', label: 'مشكلة في السكان' },
    { value: 'other', label: 'أخرى' },
];

export default function RedoOrderModal({ order, isOpen, onClose, onSuccess }: Props) {
    const titleId = useId();
    const dialogRef = useDialogBehavior(isOpen, onClose);
    const { user } = useAuth();
    const [reason, setReason] = useState('lab_error');
    const [notes, setNotes] = useState('');
    const [rejectedLabCost, setRejectedLabCost] = useState<number | ''>('');
    const [isLoading, setIsLoading] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async () => {
        if (!notes.trim()) return;
        setIsLoading(true);
        try {
            // 1. Mark old order as redo
            await db.updateOrderStatus(order.id, 'Doctor Rejected', {
                userId: user?.id,
                userName: user?.name || user?.role || 'User',
                actorRole: user?.role,
                issueState: 'redo',
                comment: `إعادة إنتاج من #${order.caseId} — السبب: ${REDO_REASONS.find(r => r.value === reason)?.label} — ${notes}`,
                ...(rejectedLabCost !== '' ? { rejectedLabCost: Number(rejectedLabCost) } : {}),
            });

            // 2. Create new linked order (copy all data)
            const doctors = await db.getDoctors();
            const doctor = doctors.find(d => d.id === order.doctorId);
            const caseId = doctor
                ? await generateNextCaseIdForDoctor(doctor, doctors)
                : `${order.caseId}-REDO`;

            const newOrderData: Omit<Order, 'id' | 'createdAt'> = {
                caseId,
                doctorId: order.doctorId,
                patientName: order.patientName,
                items: order.items || [],
                discount: order.discount || 0,
                totalPrice: order.totalPrice || 0,
                shade: order.shade || '',
                deliveryDate: order.deliveryDate,
                cost: order.cost || 0,
                manualCost: order.manualCost ?? null,
                deliveryType: order.deliveryType,
                workflowType: order.workflowType,
                designerId: order.designerId,
                designPrice: order.designPrice || 0,
                designStatus: order.workflowType === 'split' ? 'pending' : undefined,
                designUrl: order.designUrl,
                supplierId: order.supplierId,
                representativeId: order.representativeId,
                instructions: order.instructions,
                stlUrl: order.stlUrl,
                imagesUrl: order.imagesUrl,
                priority: order.priority || 'Normal',
                isUrgent: order.isUrgent || false,
                needsDesignReview: order.needsDesignReview || false,
                technicianStatus: 'Pending',
                isRedo: true,
                originalOrderId: order.id,
                status: 'New Case',
                isRegistered: false,
                comments: [{
                    id: crypto.randomUUID(),
                    text: `إعادة إنتاج من #${order.caseId} — السبب: ${REDO_REASONS.find(r => r.value === reason)?.label} — ${notes}`,
                    userId: 'system',
                    userName: 'النظام',
                    createdAt: new Date().toISOString(),
                }],
            };

            await db.addOrder(newOrderData);
            onSuccess();
            onClose();
        } catch (err) {
            console.error('Redo order error:', err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="h-[100dvh] w-full max-w-lg overflow-y-auto bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl animate-in zoom-in-95 sm:h-auto sm:max-h-[90vh] sm:rounded-2xl sm:p-6">
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                        <RefreshCw size={18} className="text-amber-500" />
                        <h3 id={titleId} className="text-lg font-bold text-gray-900">إعادة إنتاج — #{order.caseId}</h3>
                    </div>
                    <button onClick={onClose} aria-label="إغلاق نافذة إعادة الإنتاج" className="grid h-11 w-11 shrink-0 place-items-center hover:bg-surface-100 rounded-lg transition-colors">
                        <X size={16} />
                    </button>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-xs text-amber-800">
                    <strong>ملاحظة:</strong> سيتم إغلاق الأوردر الحالي كـ &quot;مرفوض&quot; وإنشاء أوردر جديد مرتبط به بنفس البيانات.
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">سبب الإعادة</label>
                        <select
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="w-full px-3 py-2 border border-surface-200 rounded-lg text-base sm:text-sm"
                        >
                            {REDO_REASONS.map(r => (
                                <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">تفاصيل المشكلة <span className="text-red-500">*</span></label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={3}
                            placeholder="اشرح المشكلة بالتفاصيل..."
                            className="w-full px-3 py-2 border border-surface-200 rounded-lg text-base sm:text-sm resize-none"
                        />
                    </div>
                    {(order.supplierId || order.designerId) && (
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">
                                تكلفة الاستحقاق للمعمل/المصمم (اختياري)
                            </label>
                            <Input
                                type="number"
                                min="0"
                                placeholder="0"
                                value={rejectedLabCost}
                                onChange={(e) => setRejectedLabCost(e.target.value ? Number(e.target.value) : '')}
                            />
                        </div>
                    )}
                </div>

                <div className="sticky bottom-0 -mx-4 mt-6 flex gap-3 justify-end border-t border-gray-100 bg-white/95 px-4 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 text-sm font-bold text-gray-500 hover:bg-gray-50 rounded-xl transition-colors"
                    >
                        إلغاء
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isLoading || !notes.trim()}
                        className="px-5 py-2.5 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        <RefreshCw size={15} />
                        {isLoading ? 'جاري الإنشاء...' : 'تأكيد الإعادة'}
                    </button>
                </div>
            </div>
        </div>
    );
}
