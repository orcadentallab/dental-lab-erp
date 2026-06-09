import { useMemo, useState, type FormEvent } from 'react';
import clsx from 'clsx';
import { db, type AllocationPreviewResult, type Doctor, type Supplier } from '../../services/db';

type EntityType = 'doctor' | 'external_lab';

interface AllocationPreviewPanelProps {
    doctors: Doctor[];
    suppliers: Supplier[];
}

const formatMoney = (value: number) => `${value.toLocaleString()} ج.م`;

const formatDate = (date?: string | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-GB');
};

const triggerTypeLabels: Record<string, string> = {
    doctor_delivered: 'تسليم نهائي للطبيب',
    external_lab_ready: 'جاهزية نهائية من المعمل',
};

export default function AllocationPreviewPanel({ doctors, suppliers }: AllocationPreviewPanelProps) {
    const today = new Date().toISOString().split('T')[0];
    const [entityType, setEntityType] = useState<EntityType>('doctor');
    const [entityId, setEntityId] = useState('');
    const [amount, setAmount] = useState('');
    const [includeNotDue, setIncludeNotDue] = useState(true);
    const [paymentDate, setPaymentDate] = useState(today);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<AllocationPreviewResult | null>(null);

    const entities = useMemo(() => (
        entityType === 'doctor'
            ? doctors.map(doctor => ({ id: doctor.id, name: doctor.name }))
            : suppliers.map(supplier => ({ id: supplier.id, name: supplier.name }))
    ), [doctors, entityType, suppliers]);

    const direction = entityType === 'doctor' ? 'receivable' : 'payable';

    const handleEntityTypeChange = (value: EntityType) => {
        setEntityType(value);
        setEntityId('');
        setResult(null);
        setError(null);
    };

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        const numericAmount = Number(amount);

        if (!entityId) {
            setError('اختر الطرف أولا');
            setResult(null);
            return;
        }

        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            setError('أدخل مبلغ صحيح أكبر من صفر');
            setResult(null);
            return;
        }

        setIsLoading(true);
        setError(null);
        try {
            const preview = await db.previewPaymentAllocation({
                entityType,
                entityId,
                direction,
                amount: numericAmount,
                includeNotDue,
                paymentDate: includeNotDue ? undefined : paymentDate,
                mode: 'fifo',
            });
            setResult(preview);
        } catch (err) {
            console.error('Failed to preview payment allocation', err);
            setResult(null);
            setError('تعذر تنفيذ معاينة التوزيع');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-5">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <div className="mb-5">
                    <h2 className="text-lg font-black text-gray-900">معاينة توزيع الدفعات</h2>
                    <p className="text-sm text-gray-500 mt-1">
                        معاينة داخلية فقط لطريقة توزيع دفعة على الالتزامات المفتوحة بنظام FIFO. لا يتم حفظ أو إنشاء أي توزيع من هذه الشاشة.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3 items-end">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">نوع الطرف</label>
                        <select
                            aria-label="نوع الطرف"
                            value={entityType}
                            onChange={event => {
                                const val = event.target.value;
                                if (val === 'doctor' || val === 'external_lab') {
                                    handleEntityTypeChange(val);
                                }
                            }}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
                        >
                            <option value="doctor">طبيب</option>
                            <option value="external_lab">معمل خارجي</option>
                        </select>
                    </div>

                    <div className="xl:col-span-2">
                        <label className="block text-sm font-bold text-gray-700 mb-2">
                            {entityType === 'doctor' ? 'الطبيب' : 'المعمل الخارجي'}
                        </label>
                        <select
                            aria-label="اختيار الطرف"
                            value={entityId}
                            onChange={event => {
                                setEntityId(event.target.value);
                                setResult(null);
                                setError(null);
                            }}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
                        >
                            <option value="">-- اختر من القائمة --</option>
                            {entities.map(entity => (
                                <option key={entity.id} value={entity.id}>{entity.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">الاتجاه</label>
                        <div className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold text-gray-700">
                            {direction === 'receivable' ? 'مستحق لنا' : 'مستحق علينا'}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">مبلغ الدفعة</label>
                        <input
                            aria-label="مبلغ الدفعة"
                            value={amount}
                            onChange={event => setAmount(event.target.value)}
                            type="number"
                            min="0"
                            step="0.01"
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
                            placeholder="0"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">تاريخ الدفعة</label>
                        <input
                            aria-label="تاريخ الدفعة"
                            type="date"
                            value={paymentDate}
                            disabled={includeNotDue}
                            onChange={event => setPaymentDate(event.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm disabled:opacity-50"
                        />
                    </div>

                    <label className="md:col-span-2 xl:col-span-2 flex items-center gap-2 text-sm font-bold text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
                        <input
                            type="checkbox"
                            checked={includeNotDue}
                            onChange={event => setIncludeNotDue(event.target.checked)}
                            className="rounded border-gray-300"
                        />
                        تضمين غير المستحق حتى الآن
                    </label>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className={clsx(
                            "xl:col-span-2 bg-blue-600 text-white px-4 py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors",
                            isLoading && "opacity-60 cursor-not-allowed"
                        )}
                    >
                        {isLoading ? 'جاري المعاينة...' : 'معاينة التوزيع'}
                    </button>
                </form>

                {error && (
                    <div className="mt-4 rounded-xl bg-red-50 text-red-700 px-4 py-3 text-sm font-bold">
                        {error}
                    </div>
                )}
            </div>

            {result && (
                <div className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                            <p className="text-xs text-gray-500 mb-1">مبلغ الدفعة</p>
                            <p className="text-xl font-black text-gray-900">{formatMoney(result.amount)}</p>
                        </div>
                        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                            <p className="text-xs text-gray-500 mb-1">إجمالي الموزع</p>
                            <p className="text-xl font-black text-blue-700">{formatMoney(result.totalAllocated)}</p>
                        </div>
                        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                            <p className="text-xs text-gray-500 mb-1">غير موزع</p>
                            <p className="text-xl font-black text-amber-700">{formatMoney(result.unallocatedAmount)}</p>
                        </div>
                        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                            <p className="text-xs text-gray-500 mb-1">رصيد دائن متوقع للطبيب</p>
                            <p className="text-xl font-black text-emerald-700">{formatMoney(result.creditPreviewAmount)}</p>
                        </div>
                    </div>

                    {result.warnings.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800 font-bold space-y-1">
                            {result.warnings.map(warning => <div key={warning}>{warning}</div>)}
                        </div>
                    )}

                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        {result.allocationPlan.length === 0 ? (
                            <div className="p-12 text-center text-gray-400">لا توجد التزامات مفتوحة لهذا الطرف</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-right">
                                    <thead className="bg-gray-50 text-gray-500">
                                        <tr>
                                            <th className="p-3 font-bold">Case ID</th>
                                            <th className="p-3 font-bold">اسم المريض</th>
                                            <th className="p-3 font-bold">المحفز</th>
                                            <th className="p-3 font-bold">تاريخ الاستحقاق</th>
                                            <th className="p-3 font-bold">تاريخ المحفز</th>
                                            <th className="p-3 font-bold">الصافي</th>
                                            <th className="p-3 font-bold">الموزع سابقا</th>
                                            <th className="p-3 font-bold">المتبقي الحالي</th>
                                            <th className="p-3 font-bold">الموزع في المعاينة</th>
                                            <th className="p-3 font-bold">المتبقي بعد المعاينة</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {result.allocationPlan.map(item => (
                                            <tr key={item.obligationId} className="hover:bg-gray-50/80">
                                                <td className="p-3 font-bold text-gray-800">{item.caseId || '-'}</td>
                                                <td className="p-3 text-gray-700">{item.patientName || '-'}</td>
                                                <td className="p-3 text-gray-700">{triggerTypeLabels[item.triggerType] || item.triggerType}</td>
                                                <td className="p-3 font-mono">{formatDate(item.dueDate)}</td>
                                                <td className="p-3 font-mono">{formatDate(item.triggerDate)}</td>
                                                <td className="p-3 font-mono">{formatMoney(item.netAmount)}</td>
                                                <td className="p-3 font-mono">{formatMoney(item.alreadyAllocatedAmount)}</td>
                                                <td className="p-3 font-mono">{formatMoney(item.currentRemainingAmount)}</td>
                                                <td className="p-3 font-mono font-black text-blue-700">{formatMoney(item.previewAllocatedAmount)}</td>
                                                <td className="p-3 font-mono font-bold">{formatMoney(item.previewRemainingAmountAfter)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
