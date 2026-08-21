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
    getOpenStageRuns, type ExternalWorkOrderRow, type StageRunCard,
} from '../../services/supabase/production';
import { Send, PackageCheck, RefreshCw } from 'lucide-react';

function daysOut(sentAt: string | null): number | null {
    if (!sentAt) return null;
    return Math.floor((Date.now() - new Date(sentAt).getTime()) / 86_400_000);
}

export default function ExternalWorkOrders() {
    const { success, error: toastError } = useToast();
    const [open, setOpen] = useState<ExternalWorkOrderRow[]>([]);
    const [pending, setPending] = useState<StageRunCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const [wos, runs] = await Promise.all([
                getExternalWorkOrders(true),
                getOpenStageRuns(),
            ]);
            setOpen(wos);
            // External stages sitting ready: they have not been handed over yet.
            setPending(runs.filter((r) => r.execution === 'external' && r.status === 'ready'));
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
                    {pending.map((r) => (
                        <div key={r.id}
                             className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-3 flex-wrap">
                            <div className="text-sm">
                                <span className="font-bold text-slate-800">{r.caseId}</span>
                                <span className="text-slate-500"> · {r.stageNameAr} · د. {r.doctorName}</span>
                                <span className="text-slate-400"> · {r.unitsIn} وحدة</span>
                                {r.supplierName && (
                                    <span className="text-sky-700"> · {r.supplierName}</span>
                                )}
                            </div>
                            <button
                                disabled={busy === r.id || !r.supplierId}
                                onClick={() => void act(r.id, () => sendExternalWorkOrder(r.id), 'اتبعتت')}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-blue text-white disabled:opacity-50"
                            >
                                <Send className="w-4 h-4" /> ابعت
                            </button>
                        </div>
                    ))}
                    {pending.some((r) => !r.supplierId) && (
                        <p className="text-xs text-amber-700">
                            حالات من غير مورد محدد مش هينفع تتبعت — حدد المورد في خريطة الإنتاج.
                        </p>
                    )}
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
        </div>
    );
}
