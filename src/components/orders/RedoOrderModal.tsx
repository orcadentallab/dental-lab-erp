import { useId, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { db, type Order } from '../../services/db';
import { Input } from '../ui/Input';
import { useDialogBehavior } from '../../hooks/useDialogBehavior';

interface Props {
    order: Order;
    userRole?: string;
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

type DoctorLiabilityOption = 'later' | 'full' | 'half' | 'zero' | 'custom';

function isDoctorLiabilityOption(value: string): value is DoctorLiabilityOption {
    return value === 'later' || value === 'full' || value === 'half' || value === 'zero' || value === 'custom';
}

export default function RedoOrderModal({ order, isOpen, onClose, onSuccess }: Props) {
    const titleId = useId();
    const dialogRef = useDialogBehavior(isOpen, onClose);
    const [reason, setReason] = useState('lab_error');
    const [notes, setNotes] = useState('');
    const [doctorLiabilityOption, setDoctorLiabilityOption] = useState<DoctorLiabilityOption>('full');
    const [customDoctorAmount, setCustomDoctorAmount] = useState<number | ''>('');
    const [errorMessage, setErrorMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    if (!isOpen) return null;

    const doctorAmount = doctorLiabilityOption === 'later'
        ? (order.totalPrice || 0)
        : doctorLiabilityOption === 'full'
        ? (order.totalPrice || 0)
        : doctorLiabilityOption === 'half'
            ? (order.totalPrice || 0) / 2
            : doctorLiabilityOption === 'zero'
                ? 0
                : (customDoctorAmount === '' ? null : Number(customDoctorAmount));
    const isDoctorAmountValid = doctorLiabilityOption === 'later'
        || (doctorAmount !== null && doctorAmount >= 0 && doctorAmount <= (order.totalPrice || 0));

    const handleSubmit = async () => {
        if (!notes.trim() || !isDoctorAmountValid) return;
        setErrorMessage('');
        setIsLoading(true);
        try {
            const result = await db.createRedoOrderAtomic({
                originalOrderId: order.id,
                reasonCode: reason,
                notes: notes.trim(),
                doctorDecision: doctorLiabilityOption === 'later'
                    ? 'decide_later'
                    : doctorLiabilityOption === 'full'
                        ? 'full_price'
                        : doctorLiabilityOption === 'zero'
                            ? 'zero'
                            : 'custom_amount',
                customDoctorAmount: doctorLiabilityOption === 'half'
                    ? (order.totalPrice || 0) / 2
                    : doctorLiabilityOption === 'custom' ? doctorAmount : null,
            });
            void result;
            onSuccess();
            onClose();
        } catch (err) {
            console.error('Redo order error:', err);
            setErrorMessage(err instanceof Error ? err.message : 'تعذر حفظ المراجعة المالية للإعادة.');
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
                    <strong>ملاحظة:</strong> سيتم إغلاق الأوردر الحالي كإعادة إنتاج وإنشاء أوردر جديد مرتبط به بنفس البيانات.
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
                    <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                        <label className="block text-sm font-bold text-violet-900 mb-1">
                            المبلغ الذي يتحمله الطبيب <span className="text-red-500">*</span>
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                { value: 'later', label: 'تحديد لاحقًا (كامل مؤقتًا)', amount: order.totalPrice || 0 },
                                { value: 'full', label: 'كامل', amount: order.totalPrice || 0 },
                                { value: 'half', label: '50%', amount: (order.totalPrice || 0) / 2 },
                                { value: 'zero', label: 'صفر', amount: 0 },
                                { value: 'custom', label: 'مخصص', amount: null },
                            ].map(option => (
                                <label key={option.value} className={`cursor-pointer rounded-lg border p-2 text-center text-sm font-bold transition-colors ${doctorLiabilityOption === option.value ? 'border-violet-600 bg-violet-600 text-white' : 'border-violet-200 bg-white text-violet-800'}`}>
                                    <input type="radio" className="sr-only" name="redo-doctor-liability" value={option.value} checked={doctorLiabilityOption === option.value} onChange={() => {
                                        if (isDoctorLiabilityOption(option.value)) setDoctorLiabilityOption(option.value);
                                    }} />
                                    <span>{option.label}</span>
                                    {option.amount !== null && <span className="mt-0.5 block text-xs opacity-80">{option.amount.toLocaleString('en-EG')} ج.م</span>}
                                </label>
                            ))}
                        </div>
                        {doctorLiabilityOption === 'later' && (
                            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                                كامل قيمة الطلب مسؤولية مؤقتة على الطبيب لحماية رصيد المعمل، وتُعدّل عند حسم القرار.
                            </p>
                        )}
                        {doctorLiabilityOption === 'custom' && (
                            <div className="mt-3">
                                <label className="mb-1 block text-xs font-bold text-violet-900">اكتب المبلغ المخصص</label>
                                <Input type="number" min="0" max={order.totalPrice || 0} value={customDoctorAmount} onChange={(e) => setCustomDoctorAmount(e.target.value === '' ? '' : Number(e.target.value))} placeholder="0" />
                            </div>
                        )}
                        <p className="mt-2 text-xs text-violet-700">الحد الأقصى: {(order.totalPrice || 0).toLocaleString('en-EG')} ج.م</p>
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
                    {errorMessage && <p className="rounded-lg bg-red-50 p-3 text-sm font-medium text-red-700">{errorMessage}</p>}
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
                        disabled={isLoading || !notes.trim() || !isDoctorAmountValid}
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
