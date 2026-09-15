/**
 * External work orders: the milling and sintering that still leave the
 * building, tracked per STAGE rather than per case.
 *
 * The turnaround measured here is raw wall-clock (plan 6.2): a vendor's
 * opening hours are not ours, and their weekend belongs inside the average we
 * quote against. Receiving a case closes the stage run, which stamps that
 * turnaround and opens the next stage on its own.
 */
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../../context/ToastContext';
import {
    getExternalWorkOrders, sendExternalWorkOrder, receiveExternalWorkOrder,
    recordExternalWorkOrderSettlement,
    getOpenStageRuns, type ExternalWorkOrderRow, type StageRunCard,
} from '../../services/supabase/production';
import { db, type Supplier } from '../../services/db';
import { Send, PackageCheck, RefreshCw, AlertTriangle, X } from 'lucide-react';

function daysOut(sentAt: string | null): number | null {
    if (!sentAt) return null;
    return Math.floor((Date.now() - new Date(sentAt).getTime()) / 86_400_000);
}

export default function ExternalWorkOrders() {
    const { success, error: toastError } = useToast();
    const [open, setOpen] = useState<ExternalWorkOrderRow[]>([]);
    const [returned, setReturned] = useState<ExternalWorkOrderRow[]>([]);
    const [pending, setPending] = useState<StageRunCard[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [pendingAssignments, setPendingAssignments] = useState<Record<string, { supplierId?: string; agreedCost?: number }>>({});
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);

    // Rejection & Defect settlement modal state
    const [settlementTarget, setSettlementTarget] = useState<ExternalWorkOrderRow | null>(null);
    const [settlementReason, setSettlementReason] = useState('');
    const [settlementAmount, setSettlementAmount] = useState<number | ''>('');
    const [isSubmittingSettlement, setIsSubmittingSettlement] = useState(false);

    const load = useCallback(async () => {
        try {
            const [allWos, runs, sups] = await Promise.all([
                getExternalWorkOrders(false),
                getOpenStageRuns(),
                db.getSuppliers(),
            ]);
            setOpen(allWos.filter((w) => w.status === 'sent'));
            setReturned(allWos.filter((w) => w.status === 'returned'));
            setSuppliers(sups);
            // External stages sitting ready: they have not been handed over yet.
            //
            // A step whose driver is the ORDER STATUS never appears here, even
            // though it is external. Today's whole-case outsourcing is recorded
            // by the rep moving the order, and offering a second Send/Receive
            // for the same run would be two places advancing one stage -- the
            // one thing the driver field exists to prevent.
            setPending(runs.filter((r) => r.execution === 'external'
                && r.status === 'ready'
                && r.drivenBy !== 'order_status'));
        } catch (e) {
            console.error('[ExternalWorkOrders] load failed', e);
            toastError('تعذّر التحميل');
        } finally {
            setLoading(false);
        }
    }, [toastError]);

    useEffect(() => { void load(); }, [load]);

    const act = async (key: string, fn: () => Promise<unknown>, msg: string) => {
        setBusy(key);
        try {
            await fn();
            success(msg);
            await load();
        } catch (e) {
            console.error('[ExternalWorkOrders] action failed', e);
            toastError(e instanceof Error ? e.message : 'تعذّر تنفيذ العملية');
        } finally {
            setBusy(null);
        }
    };

    const receive = async (wo: ExternalWorkOrderRow) => {
        const costStr = window.prompt(
            `تكلفة ${wo.supplierName} للحالة ${wo.caseId} (سيبها فاضية لو متغيرتش)`,
            wo.agreedCost != null ? String(wo.agreedCost) : '',
        );
        if (costStr === null) return;
        const cost = costStr.trim() === '' ? undefined : Number(costStr);
        if (cost !== undefined && !Number.isFinite(cost)) {
            toastError('التكلفة لازم تبقى رقم');
            return;
        }
        await act(wo.id, () => receiveExternalWorkOrder(wo.id, { agreedCost: cost }),
            'اتستلمت والمرحلة اللي بعدها فتحت');
    };

    const openSettlement = (wo: ExternalWorkOrderRow) => {
        setSettlementTarget(wo);
        setSettlementReason('');
        setSettlementAmount(wo.agreedCost ?? '');
    };

    const handleConfirmSettlement = async () => {
        if (!settlementTarget) return;
        if (!settlementReason.trim()) {
            toastError('يرجى كتابة سبب العيب أو الرفض');
            return;
        }
        const amount = Number(settlementAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            toastError('يرجى إدخال مبلغ تسوية صحيح أكبر من الصفر');
            return;
        }

        setIsSubmittingSettlement(true);
        try {
            await recordExternalWorkOrderSettlement({
                workOrderId: settlementTarget.id,
                stageRunId: settlementTarget.stageRunId,
                orderId: settlementTarget.orderId,
                supplierId: settlementTarget.supplierId,
                deductionAmount: amount,
                reason: settlementReason.trim(),
                caseId: settlementTarget.caseId,
                stageNameAr: settlementTarget.stageNameAr,
            });
            success(`تم تسجيل التسوية وخصم ${amount} ج.م من حساب المعمل ${settlementTarget.supplierName}`);
            setSettlementTarget(null);
            await load();
        } catch (e) {
            console.error('[ExternalWorkOrders] settlement failed', e);
            toastError(e instanceof Error ? e.message : 'تعذّر تسجيل التسوية');
        } finally {
            setIsSubmittingSettlement(false);
        }
    };

    if (loading) return <div className="p-8 text-center text-slate-500">جارِ التحميل…</div>;

    return (
        <div className="max-w-5xl mx-auto space-y-6" dir="rtl">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">الشغل الخارجي</h1>
                    <p className="text-sm text-slate-500">
                        {open.length} حالة برّه · {pending.length} مستنية الإرسال
                    </p>
                </div>
                <button
                    onClick={() => void load()}
                    className="p-3 rounded-xl bg-white border border-slate-200 text-slate-600"
                    aria-label="تحديث"
                >
                    <RefreshCw className="w-5 h-5" />
                </button>
            </div>

            {pending.length > 0 && (
                <section className="space-y-2">
                    <h2 className="font-bold text-slate-700">جاهزة للإرسال</h2>
                    {pending.map((r) => {
                        const assignedSupplierId = pendingAssignments[r.id]?.supplierId !== undefined
                            ? pendingAssignments[r.id].supplierId
                            : (r.supplierId || '');
                        const agreedCost = pendingAssignments[r.id]?.agreedCost;

                        return (
                            <div key={r.id}
                                 className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-3 flex-wrap">
                                <div className="text-sm">
                                    <span className="font-bold text-slate-800">{r.caseId}</span>
                                    <span className="text-slate-500"> · {r.stageNameAr} · د. {r.doctorName}</span>
                                    <span className="text-slate-400"> · {r.unitsIn} وحدة</span>
                                </div>

                                <div className="flex items-center gap-2 flex-wrap">
                                    <select
                                        value={assignedSupplierId}
                                        onChange={(e) => setPendingAssignments(prev => ({
                                            ...prev,
                                            [r.id]: { ...prev[r.id], supplierId: e.target.value }
                                        }))}
                                        className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white min-w-[140px]"
                                        title="اختر المعمل الخارجي"
                                    >
                                        <option value="">— اختر المعمل —</option>
                                        {suppliers.filter(s => s.isActive !== false).map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>

                                    <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        placeholder="السعر المتفق عليه"
                                        value={agreedCost ?? ''}
                                        onChange={(e) => setPendingAssignments(prev => ({
                                            ...prev,
                                            [r.id]: {
                                                ...prev[r.id],
                                                agreedCost: e.target.value === '' ? undefined : Number(e.target.value)
                                            }
                                        }))}
                                        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 w-28 bg-white"
                                    />

                                    <button
                                        disabled={busy === r.id || !assignedSupplierId}
                                        onClick={() => void act(
                                            r.id,
                                            () => sendExternalWorkOrder(r.id, {
                                                supplierId: assignedSupplierId,
                                                agreedCost: agreedCost,
                                            }),
                                            'تم إرسال الشغل للمعمل بنجاح'
                                        )}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-blue text-white text-xs font-medium disabled:opacity-50"
                                    >
                                        <Send className="w-3.5 h-3.5" /> ابعت
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </section>
            )}

            <section className="space-y-2">
                <h2 className="font-bold text-slate-700">برّه دلوقتي</h2>

                {open.length === 0 && (
                    <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500">
                        مفيش حالات عند معامل خارجية دلوقتي
                    </div>
                )}

                {open.map((wo) => {
                    const days = daysOut(wo.sentAt);
                    const late = wo.expectedReturnAt
                        ? new Date(wo.expectedReturnAt).getTime() < Date.now()
                        : false;

                    return (
                        <div key={wo.id}
                             className={`bg-white rounded-xl border p-4 flex items-center justify-between gap-3 flex-wrap ${
                                 late ? 'border-red-300' : 'border-slate-200'
                             }`}>
                            <div className="text-sm space-y-1">
                                <div>
                                    <span className="font-bold text-slate-800">{wo.caseId}</span>
                                    <span className="text-slate-500"> · {wo.stageNameAr} · {wo.supplierName}</span>
                                </div>
                                <div className="text-xs text-slate-400">
                                    د. {wo.doctorName} · {wo.units} وحدة
                                    {days !== null && (
                                        <span className={late ? 'text-red-600 font-bold' : ''}>
                                            {' '}· برّه من {days} يوم
                                        </span>
                                    )}
                                </div>
                            </div>
                            <button
                                disabled={busy === wo.id}
                                onClick={() => void receive(wo)}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white disabled:opacity-50"
                            >
                                <PackageCheck className="w-4 h-4" /> استلمت
                            </button>
                        </div>
                    );
                })}
            </section>

            {returned.length > 0 && (
                <section className="space-y-2">
                    <h2 className="font-bold text-slate-700">المستلمة مؤخراً (متابعة الجودة والتسويات)</h2>
                    <div className="space-y-2">
                        {returned.slice(0, 20).map((wo) => (
                            <div
                                key={wo.id}
                                className="bg-slate-50 rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-3 flex-wrap"
                            >
                                <div className="text-sm space-y-1">
                                    <div>
                                        <span className="font-bold text-slate-800">{wo.caseId}</span>
                                        <span className="text-slate-500"> · {wo.stageNameAr} · {wo.supplierName}</span>
                                    </div>
                                    <div className="text-xs text-slate-400">
                                        د. {wo.doctorName} · {wo.units} وحدة
                                        {wo.agreedCost != null && ` · ${wo.agreedCost} ج.م`}
                                        {wo.returnedAt && ` · استلمت في ${new Date(wo.returnedAt).toLocaleDateString('ar-EG')}`}
                                    </div>
                                </div>
                                <button
                                    onClick={() => openSettlement(wo)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 text-xs font-semibold transition-colors"
                                >
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> تسجيل عيب / تسوية
                                </button>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* Rejection / Defect Settlement Modal */}
            {settlementTarget && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" dir="rtl">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
                        <div className="flex items-center justify-between border-b pb-3">
                            <div className="flex items-center gap-2 text-amber-800 font-bold">
                                <AlertTriangle className="w-5 h-5 text-amber-600" />
                                <h3>تسجيل عيب وتخصيم تسوية لمعمل خارجي</h3>
                            </div>
                            <button
                                onClick={() => setSettlementTarget(null)}
                                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
                                aria-label="إغلاق"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="bg-slate-50 p-3 rounded-xl text-xs space-y-1 text-slate-700">
                            <div><span className="font-bold">رقم الحالة:</span> #{settlementTarget.caseId}</div>
                            <div><span className="font-bold">المرحلة الخارجية:</span> {settlementTarget.stageNameAr}</div>
                            <div><span className="font-bold">المعمل الخارجي:</span> {settlementTarget.supplierName}</div>
                            <div><span className="font-bold">التكلفة المتفق عليها:</span> {settlementTarget.agreedCost ?? 0} ج.م</div>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    سبب العيب أو الرفض <span className="text-red-500">*</span>
                                </label>
                                <textarea
                                    value={settlementReason}
                                    onChange={(e) => setSettlementReason(e.target.value)}
                                    placeholder="اكتب تفاصيل عيب التصنيع (مثل: عدم تطابق الحواف، كسر أثناء الخرط...)"
                                    rows={3}
                                    className="w-full text-xs border border-slate-200 rounded-xl p-2.5 focus:outline-none focus:ring-2 focus:ring-amber-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    مبلغ الخصم / التسوية من حساب المعمل (ج.م) <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    step="any"
                                    value={settlementAmount}
                                    onChange={(e) => setSettlementAmount(e.target.value === '' ? '' : Number(e.target.value))}
                                    placeholder="مبلغ الخصم"
                                    className="w-full text-xs border border-slate-200 rounded-xl p-2.5 font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
                                />
                                <p className="text-[10px] text-slate-400 mt-1">
                                    سيتم خصم هذا المبلغ تلقائياً من رصيد المعمل وكشف حسابه (حركة تسوية سالبة).
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2 border-t">
                            <button
                                type="button"
                                onClick={() => setSettlementTarget(null)}
                                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                            >
                                إلغاء
                            </button>
                            <button
                                type="button"
                                disabled={isSubmittingSettlement || !settlementReason.trim() || !settlementAmount}
                                onClick={() => void handleConfirmSettlement()}
                                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold disabled:opacity-50 transition-colors"
                            >
                                {isSubmittingSettlement ? 'جارِ التسجيل...' : 'تأكيد الخصم والتسوية'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
