import { useMemo } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import clsx from 'clsx';
import type { DoctorServiceProfitabilityRow, DoctorSegmentationInput, DoctorReceivable } from '../../services/supabase/analyticsService';
import {
    gradeDoctor,
    SEGMENT_WEIGHTS,
    GROSS_PROFIT_BANDS,
    COLLECTION_BANDS,
    MARGIN_BANDS,
    REMAKE_BANDS,
    GRADE_LABEL,
    GRADE_STYLE,
    MIN_ORDERS_FOR_GRADE,
    MIN_DAYS_FOR_GRADE,
    OVERRIDE_OVER90_SHARE,
    type Grade,
    type ScoreBand,
    type SegmentResult,
} from '../../constants/doctorSegmentation';

const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

interface Props {
    profitabilityRows: DoctorServiceProfitabilityRow[];
    segmentationInputs: DoctorSegmentationInput[];
    receivables: DoctorReceivable[];
    search: string;
    loading: boolean;
}

interface GradedDoctor extends SegmentResult {
    doctorId: string;
    doctorName: string;
    revenue: number;
    grossProfit: number;
    marginPct: number | null;
    orderCount: number;
    ordersWithIssues: number;
    receivableTotal: number;
}

const GRADE_ORDER: Grade[] = ['A', 'B', 'C', 'D', 'new', 'small_sample'];

function BandTable({ title, weight, bands }: { title: string; weight: number; bands: ScoreBand[] }) {
    return (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-slate-100 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">{title}</span>
                <span className="text-[10px] font-mono font-bold text-slate-500">{weight} نقطة</span>
            </div>
            <ul className="divide-y divide-slate-100">
                {bands.map(band => (
                    <li key={band.label} className="px-3 py-1.5 flex items-center justify-between text-[11px]">
                        <span className="text-slate-600">{band.label}</span>
                        <span className="font-mono font-bold text-slate-700">{band.points}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default function DoctorSegmentationTab({
    profitabilityRows, segmentationInputs, receivables, search, loading,
}: Props) {
    const graded = useMemo<GradedDoctor[]>(() => {
        if (!segmentationInputs.length) return [];

        // Profit rolls up from the doctor x service rows already on screen, so
        // the grade can never disagree with the table the owner just read.
        const profitByDoctor = new Map<string, { revenue: number; cost: number }>();
        for (const row of profitabilityRows) {
            const existing = profitByDoctor.get(row.doctor_id) ?? { revenue: 0, cost: 0 };
            existing.revenue += row.revenue;
            existing.cost += row.cost;
            profitByDoctor.set(row.doctor_id, existing);
        }

        const receivableByDoctor = new Map(receivables.map(r => [r.doctorId, r]));

        const profitOf = (doctorId: string): { revenue: number; cost: number } =>
            profitByDoctor.get(doctorId) ?? { revenue: 0, cost: 0 };

        // Percentile is computed over the doctors in this result set. Ranking
        // against people who did no work in the window would flatter everyone
        // who did.
        const profits = segmentationInputs
            .map(i => { const p = profitOf(i.doctor_id); return p.revenue - p.cost; })
            .sort((a, b) => a - b);

        const percentileOf = (value: number): number => {
            if (profits.length <= 1) return 1;
            const below = profits.filter(p => p < value).length;
            return below / (profits.length - 1);
        };

        return segmentationInputs.map(input => {
            const { revenue, cost } = profitOf(input.doctor_id);
            const grossProfit = revenue - cost;
            const marginPct = revenue > 0 ? ((revenue - cost) / revenue) * 100 : null;
            const ar = receivableByDoctor.get(input.doctor_id);

            const result = gradeDoctor({
                grossProfit,
                revenue,
                grossProfitPercentile: percentileOf(grossProfit),
                marginPct,
                orderCount: input.order_count,
                ordersWithIssues: input.orders_with_issues,
                daysSinceFirstRegistered: input.days_since_first_registered,
                receivableTotal: ar?.balance ?? 0,
                aging0to30: ar?.aging_0_30 ?? 0,
                aging31to60: ar?.aging_31_60 ?? 0,
                aging61to90: ar?.aging_61_90 ?? 0,
                aging90Plus: ar?.aging_90_plus ?? 0,
            });

            return {
                ...result,
                doctorId: input.doctor_id,
                doctorName: input.doctor_name,
                revenue,
                grossProfit,
                marginPct,
                orderCount: input.order_count,
                ordersWithIssues: input.orders_with_issues,
                receivableTotal: ar?.balance ?? 0,
            };
        });
    }, [profitabilityRows, segmentationInputs, receivables]);

    const visible = useMemo(() => {
        const filtered = search.trim()
            ? graded.filter(d => d.doctorName.includes(search.trim()))
            : graded;
        return [...filtered].sort((a, b) => {
            const rank = GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade);
            if (rank !== 0) return rank;
            return (b.score ?? -1) - (a.score ?? -1);
        });
    }, [graded, search]);

    const counts = useMemo(() => {
        const map = new Map<Grade, number>();
        for (const g of graded) map.set(g.grade, (map.get(g.grade) ?? 0) + 1);
        return map;
    }, [graded]);

    if (loading) {
        return <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-slate-400 text-xs">جاري التحميل...</div>;
    }

    if (!graded.length) {
        return (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
                <p className="text-slate-800 font-bold mb-2">مفيش أطباء يتصنّفوا في الفترة دي</p>
                <p className="text-slate-600 text-sm mb-1">التصنيف محتاج طلبات مسلّمة أو متسوّاة بين التاريخين المختارين.</p>
                <p className="text-slate-400 text-xs">وسّع الفترة من التاريخين فوق الصفحة.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Grade distribution */}
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
                {GRADE_ORDER.map(grade => (
                    <div key={grade} className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 text-center">
                        <span className={clsx('inline-block px-2 py-0.5 rounded text-[10px] font-bold', GRADE_STYLE[grade])}>
                            {GRADE_LABEL[grade]}
                        </span>
                        <h3 className="text-xl font-extrabold text-slate-800 font-mono mt-2">{counts.get(grade) ?? 0}</h3>
                    </div>
                ))}
            </div>

            {/* The weights table, shown not hidden — this is owner policy */}
            <details className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden" open>
                <summary className="px-4 py-3 bg-slate-50 border-b border-slate-200 cursor-pointer flex items-center gap-2">
                    <Info size={14} className="text-slate-500" />
                    <span className="text-xs font-bold text-slate-700">الأوزان والحدود المستخدمة في التصنيف</span>
                </summary>
                <div className="p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                        <BandTable title="مجمل الربح (ترتيب نسبي)" weight={SEGMENT_WEIGHTS.grossProfit} bands={GROSS_PROFIT_BANDS} />
                        <BandTable title="جودة التحصيل" weight={SEGMENT_WEIGHTS.collectionQuality} bands={COLLECTION_BANDS} />
                        <BandTable title="هامش الربح" weight={SEGMENT_WEIGHTS.grossMargin} bands={MARGIN_BANDS} />
                        <BandTable title="نسبة المشاكل" weight={SEGMENT_WEIGHTS.remakeRate} bands={REMAKE_BANDS} />
                    </div>

                    <div className="text-[11px] text-slate-600 leading-relaxed space-y-1.5">
                        <p>
                            <strong className="text-slate-700">الشرائح:</strong> A من 80 لـ 100 · B من 60 لـ 79 · C من 40 لـ 59 · D أقل من 40.
                        </p>
                        <p>
                            <strong className="text-slate-700">قواعد تجاوز تكسر النقاط:</strong> مجمل ربح سالب ← D مهما كانت النقاط ·
                            رصيد +90 يوم أكتر من {OVERRIDE_OVER90_SHARE * 100}% من رصيده ← D ·
                            طبيب مسجّل من أقل من {MIN_DAYS_FOR_GRADE} يوم ← «جديد» مش A/B/C/D ·
                            أقل من {MIN_ORDERS_FOR_GRADE} طلبات ← «عينة صغيرة». آخر اتنين مقصودين: تصنيف طبيب على طلبين ضوضاء مش إشارة.
                        </p>
                        <p>
                            <strong className="text-slate-700">الإيراد وزنه صفر عمداً</strong> — هو داخل ضمنياً في مجمل الربح، وحسابه تاني ازدواج
                            بيرفع طبيب حجمه كبير وهامشه ضعيف فوق طبيب مربح. معروض للسياق بس.
                        </p>
                        <p>
                            <strong className="text-slate-700">كثافة اللوجستيات اتشالت</strong> (قرار المالك 2026-08-12): الشحن عبر شركة خارجية
                            بفاتورة شهرية إجمالية، فمفيش تكلفة توصيل حقيقية لكل طبيب تتقاس. الـ 10 نقاط اتوزعت على الأربعة الباقيين.
                        </p>
                    </div>
                </div>
            </details>

            {/* Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500">
                    {visible.length} طبيب
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-slate-800 text-white z-10">
                            <tr>
                                <th className="text-right px-4 py-3 font-bold">الطبيب</th>
                                <th className="px-3 py-3 text-center font-bold">التصنيف</th>
                                <th className="px-3 py-3 text-center font-bold">النقاط</th>
                                <th className="px-3 py-3 text-center font-bold">مجمل الربح</th>
                                <th className="px-3 py-3 text-center font-bold">الهامش</th>
                                <th className="px-3 py-3 text-center font-bold">الرصيد</th>
                                <th className="px-3 py-3 text-center font-bold">+90 يوم</th>
                                <th className="px-3 py-3 text-center font-bold">الطلبات</th>
                                <th className="px-3 py-3 text-center font-bold">نسبة المشاكل</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {visible.map(doctor => (
                                <tr key={doctor.doctorId} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-4 py-2.5 text-right">
                                        <span className="font-bold text-slate-800">{doctor.doctorName}</span>
                                        {doctor.overrideReason && (
                                            <p className="text-[10px] text-rose-600 mt-0.5 flex items-center gap-1">
                                                <AlertTriangle size={9} />
                                                {doctor.overrideReason}
                                            </p>
                                        )}
                                    </td>
                                    <td className="px-3 py-2.5 text-center">
                                        <span className={clsx('inline-block px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap', GRADE_STYLE[doctor.grade])}>
                                            {GRADE_LABEL[doctor.grade]}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2.5 text-center font-mono font-bold text-slate-700">
                                        {doctor.score === null ? (
                                            <span className="text-slate-300" title="غير مصنّف — عينة صغيرة أو طبيب جديد">—</span>
                                        ) : (
                                            <span title={`ربح ${doctor.breakdown.grossProfit} · تحصيل ${doctor.breakdown.collectionQuality} · هامش ${doctor.breakdown.grossMargin} · مشاكل ${doctor.breakdown.remakeRate}`}>
                                                {doctor.score}
                                            </span>
                                        )}
                                    </td>
                                    <td className={clsx(
                                        'px-3 py-2.5 text-center font-mono font-bold',
                                        doctor.grossProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'
                                    )}>
                                        {fmt(doctor.grossProfit)}
                                    </td>
                                    <td className="px-3 py-2.5 text-center font-mono text-slate-600">
                                        {doctor.marginPct === null ? <span className="text-slate-300">—</span> : `${doctor.marginPct.toFixed(1)}%`}
                                    </td>
                                    <td className="px-3 py-2.5 text-center font-mono text-slate-600">{fmt(doctor.receivableTotal)}</td>
                                    <td className={clsx(
                                        'px-3 py-2.5 text-center font-mono',
                                        doctor.over90Share > 0.3 ? 'text-rose-600 font-bold' : 'text-slate-500'
                                    )}>
                                        {doctor.receivableTotal > 0 ? `${(doctor.over90Share * 100).toFixed(0)}%` : <span className="text-slate-300">—</span>}
                                    </td>
                                    <td className="px-3 py-2.5 text-center font-mono text-slate-600">{doctor.orderCount}</td>
                                    <td className={clsx(
                                        'px-3 py-2.5 text-center font-mono',
                                        doctor.remakeRate > 12 ? 'text-rose-600 font-bold' : doctor.remakeRate > 7 ? 'text-amber-600' : 'text-slate-500'
                                    )}>
                                        {doctor.remakeRate.toFixed(1)}%
                                        <span className="text-slate-400"> ({doctor.ordersWithIssues})</span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] text-slate-600 leading-relaxed">
                <strong className="text-slate-700">أساس الأرقام:</strong>{' '}
                الربح والهامش مجمّعان من نفس صفوف «طبيب × خدمة» في التبويب الأول، فالتصنيف ما يقدرش يخالف الجدول اللي قريته.
                الرصيد وشرائح التقادم من تقرير الذمم (رصيد <span className="font-mono">اليوم</span>، مش محدود بالفترة المختارة).
                نسبة المشاكل من سجل <span className="font-mono">order_issues</span> — بتعدّ <strong>طلبات</strong> مش أسطر مشاكل،
                والمشاكل الملغاة مستبعدة. التصنيف ده <strong>ربحي</strong>، غير الشرائح السلوكية في صفحة{' '}
                <span className="font-mono">/doctors/retention</span> اللي بتجاوب على «مين وقف يطلب؟».
            </div>
        </div>
    );
}
