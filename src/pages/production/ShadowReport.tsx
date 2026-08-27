/**
 * The cutover decision instrument.
 *
 * Two systems currently describe the same case: the old status buttons, which
 * finance reads, and the stage chain, which computes silently. This page is
 * the comparison. The flag is only worth flipping once they have agreed on
 * every live order for two solid weeks.
 *
 * Deliberate: with nothing to compare, the agreement figure shows as unknown
 * rather than 100%. An empty sample reporting perfect agreement is exactly how
 * a bad cutover gets approved.
 */
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../../context/ToastContext';
import {
    getShadowReport, getShadowSummary,
    type ShadowRow, type ShadowSummary,
} from '../../services/supabase/production';
import { supabase } from '../../lib/supabase';
import { RefreshCw, ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react';

interface SystemWarning {
    source: string;
    ref_id: string | null;
    message: string;
    occurred_at: string;
}

/**
 * The reconciler and the material attribution both swallow their exceptions so
 * a bug in either cannot stop somebody saving an order or finishing a case.
 * That is correct -- but it leaves the failure with no trace a person will ever
 * look at. Every swallowed failure now lands in system_warnings, and this is
 * where they surface: a case that failed to sync shows up here instead of only
 * as an unexplained gap in the comparison below.
 */
function parseWarnings(value: unknown): SystemWarning[] {
    if (typeof value !== 'object' || value === null) return [];
    const envelope: Record<string, unknown> = { ...value };
    const list = envelope.warnings;
    if (!Array.isArray(list)) return [];
    return list.flatMap((raw: unknown) => {
        if (typeof raw !== 'object' || raw === null) return [];
        const r: Record<string, unknown> = { ...raw };
        if (typeof r.source !== 'string' || typeof r.message !== 'string') return [];
        return [{
            source: r.source,
            ref_id: typeof r.ref_id === 'string' ? r.ref_id : null,
            message: r.message,
            occurred_at: typeof r.occurred_at === 'string' ? r.occurred_at : '',
        }];
    });
}

const STATUS_LABELS: Record<string, string> = {
    not_started: 'لم يبدأ',
    designing: 'تصميم',
    in_production: 'إنتاج',
    try_in_ready: 'تراي إن جاهز',
    waiting_doctor: 'عند الطبيب',
    finalization: 'تشطيب نهائي',
    final_ready: 'جاهز',
    final_delivered: 'تم التسليم',
};

const label = (s: string | null) => (s ? STATUS_LABELS[s] ?? s : '—');

export default function ShadowReport() {
    const { error: toastError } = useToast();
    const [rows, setRows] = useState<ShadowRow[]>([]);
    const [summary, setSummary] = useState<ShadowSummary | null>(null);
    const [warnings, setWarnings] = useState<SystemWarning[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const [r, s, w] = await Promise.all([
                getShadowReport(),
                getShadowSummary(),
                supabase.rpc('get_open_system_warnings', { p_limit: 50 }),
            ]);
            setRows(r);
            setSummary(s);
            setWarnings(w.error ? [] : parseWarnings(w.data));
        } catch (e) {
            console.error('[ShadowReport] load failed', e);
            toastError('تعذّر تحميل تقرير الظل');
        } finally {
            setLoading(false);
        }
    }, [toastError]);

    useEffect(() => { void load(); }, [load]);

    if (loading) return <div className="p-8 text-center text-slate-500">جارِ التحميل…</div>;

    const disagreements = rows.filter((r) => !r.agrees);

    return (
        <div className="max-w-5xl mx-auto space-y-5" dir="rtl">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">تقرير الظل</h1>
                    <p className="text-sm text-slate-500">
                        مقارنة بين حالة الأوردر الفعلية واللي سلسلة المراحل بتحسبها
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

            {/* Swallowed background failures. A row here means a measurement did
                not happen -- not that anything a user did failed. Rendered above
                the agreement figure on purpose: the comparison below is only
                trustworthy if nothing failed to be measured in the first place. */}
            {warnings.length > 0 && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                        <h2 className="font-bold text-amber-900 text-sm">
                            {warnings.length} عملية قياس فشلت في الخلفية
                        </h2>
                    </div>
                    <p className="text-xs text-amber-800">
                        دي حاجات اتبلعت عمداً عشان متوقّفش حفظ الأوردرات — بس معناها إن الأرقام
                        اللي تحت ناقصة الحالات دي.
                    </p>
                    <ul className="space-y-1 max-h-56 overflow-y-auto">
                        {warnings.map((w, i) => (
                            <li key={i} className="text-xs bg-white/70 rounded-lg px-3 py-2">
                                <span className="font-mono font-semibold text-amber-900">{w.source}</span>
                                <span className="text-slate-500"> · {w.occurred_at.slice(0, 16).replace('T', ' ')}</span>
                                <div className="text-slate-700 mt-0.5">{w.message}</div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* The switch state, stated plainly. */}
            <div className={`rounded-2xl border p-4 flex items-center gap-3 ${
                summary?.flagEnabled
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-slate-50 border-slate-200'
            }`}>
                {summary?.flagEnabled
                    ? <ShieldCheck className="w-5 h-5 text-emerald-700 flex-shrink-0" />
                    : <ShieldAlert className="w-5 h-5 text-slate-500 flex-shrink-0" />}
                <div className="text-sm">
                    <div className="font-bold text-slate-800">
                        {summary?.flagEnabled
                            ? 'القطع مفعّل — المراحل هي اللي بتحرّك حالة الأوردر'
                            : 'وضع الظل — المراحل بتحسب ومبتكتبش'}
                    </div>
                    <div className="text-slate-500">
                        {summary?.flagEnabled
                            ? 'لإيقافه: production_v1 = off في app_settings، وكل حاجة ترجع لسلوكها السابق فورًا.'
                            : 'حالة الأوردر لسه بتتحرك بالزراير القديمة، والمالية بتقرا منها.'}
                    </div>
                </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
                <Stat label="حالات تحت المقارنة" value={summary ? String(summary.total) : '—'} />
                <Stat
                    label="نسبة الاتفاق"
                    value={summary?.agreementPct != null ? `${summary.agreementPct}%` : 'لسه مفيش'}
                    tone={summary?.agreementPct === 100 ? 'good'
                        : summary?.agreementPct != null ? 'bad' : 'muted'}
                />
                <Stat
                    label="اختلافات"
                    value={summary ? String(summary.disagreeing) : '—'}
                    tone={summary && summary.disagreeing > 0 ? 'bad' : 'good'}
                />
            </div>

            {summary?.total === 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
                    <p className="text-slate-600">مفيش حالات في السيستم الجديد لسه</p>
                    <p className="text-sm text-slate-400 mt-2">
                        ادخل حالة للإنتاج من صفحة الأوردرات عشان المقارنة تبدأ.
                        عدّاد الأيام مبيبدأش غير مع أول حالة حقيقية.
                    </p>
                </div>
            )}

            {disagreements.length > 0 && (
                <div className="bg-white rounded-2xl border border-red-200 p-4">
                    <h2 className="font-bold text-red-800 mb-1">
                        اختلافات لازم تتفهم قبل القطع
                    </h2>
                    <p className="text-xs text-slate-500 mb-3">
                        كل صف هنا معناه إن الحساب الجديد كان هيحط حالة غير اللي موجودة فعلاً.
                        ممنوع القطع وفيه أي صف هنا.
                    </p>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-slate-500 text-xs border-b border-slate-100">
                                <th className="text-right py-2">الحالة</th>
                                <th className="text-right py-2">الفعلي</th>
                                <th className="text-right py-2">المحسوب</th>
                            </tr>
                        </thead>
                        <tbody>
                            {disagreements.map((r) => (
                                <tr key={r.orderId} className="border-b border-slate-50">
                                    <td className="py-2 font-medium text-slate-800">{r.caseId}</td>
                                    <td className="py-2 text-slate-600">{label(r.actualStatus)}</td>
                                    <td className="py-2 text-red-700 font-medium">
                                        {label(r.computedStatus)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {summary && summary.total > 0 && disagreements.length === 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-sm text-emerald-900">
                    كل الحالات متفقة النهارده. القطع محتاج <b>14 يوم متصلة</b> بالشكل ده —
                    يوم واحد باتفاق كامل مش دليل كافي على نظام هتتبني عليه الفواتير.
                </div>
            )}
        </div>
    );
}

function Stat({ label: text, value, tone = 'muted' }: {
    label: string; value: string; tone?: 'good' | 'bad' | 'muted';
}) {
    const color = tone === 'good' ? 'text-emerald-700'
        : tone === 'bad' ? 'text-red-700'
        : 'text-slate-800';

    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="text-xs text-slate-500">{text}</div>
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
        </div>
    );
}
