import { useState, useEffect, useMemo } from 'react';
import { db, type OrderIssue, type Doctor, type Supplier, type User, type OrderItem } from '../services/db';
import { AlertTriangle, BarChart2, RefreshCw, XCircle, RotateCcw, Ban, UserX } from 'lucide-react';
import { ResponsiveTable } from '../components/ui/ResponsiveTable';
import { ISSUE_CAUSE, responsibleStageLabel } from '../constants/issueCauses';
import { analyticsService, type SupplierIssuePerformance } from '../services/supabase/analyticsService';
import { useReportDateRange } from '../hooks/useReportDateRange';
import ReportDateRangeFilter from '../components/reports/ReportDateRangeFilter';

// Issue type display config, ordered by business severity (owner,
// 2026-08-17) rather than registration order — severe first, so the cards
// and the type filter read worst-to-least-bad:
//   severe   (doctor_rejected, redo)   — a produced piece is genuinely lost.
//   returned                           — some doctor trust cost, no product lost.
//   minor    (cancelled, lab_rejected) — we chose not to continue; nothing lost.
const ISSUE_TYPE_LABELS: Record<string, string> = {
    doctor_rejected: 'مرتجع طبيب',      // Doctor rejected — rejectedLabCost applies
    redo:            'إعادة إنتاج',      // Redo — new case linked to original
    returned:        'مرتجع للتعديل',   // Returned for rework — linked to original order
    cancelled:       'ملغي',             // Cancelled — zero financial impact
    lab_rejected:    'رفض معمل',         // Lab/designer internal rejection — zero financial impact
};

// Replaced by the shared 14-code taxonomy (migration 20260816000000).
// The old 6 buckets (lab/doctor/scan/design/communication/other) no longer
// exist in the database — the CHECK constraint rejects them.
const CAUSE_LABELS: Record<string, string> = ISSUE_CAUSE;

const ISSUE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    returned:        RotateCcw,
    doctor_rejected: UserX,
    lab_rejected:    XCircle,
    cancelled:       Ban,
    redo:            RefreshCw,
};

// Colors follow business severity, not registration order (owner,
// 2026-08-17): doctor_rejected + redo are real product loss — the piece is
// gone whether or not the doctor continues — so both get alarming colors.
// lab_rejected and cancelled never became a lost, delivered product (we
// simply chose not to continue), so both read calm; returned sits between
// the two and gets its own distinct, non-alarming color.
const ISSUE_TYPE_STYLES: Record<string, { bg: string; text: string; border: string; iconBg: string }> = {
    doctor_rejected: { bg: 'bg-rose-50/50',   text: 'text-rose-700',   border: 'border-rose-100',   iconBg: 'bg-rose-100/50' },
    redo:            { bg: 'bg-orange-50/50', text: 'text-orange-700', border: 'border-orange-100', iconBg: 'bg-orange-100/50' },
    returned:        { bg: 'bg-blue-50/50',   text: 'text-blue-600',   border: 'border-blue-100',   iconBg: 'bg-blue-100/50' },
    cancelled:       { bg: 'bg-blue-50/50',   text: 'text-blue-600',   border: 'border-blue-100',   iconBg: 'bg-blue-100/50' },
    lab_rejected:    { bg: 'bg-emerald-50/50', text: 'text-emerald-600', border: 'border-emerald-100', iconBg: 'bg-emerald-100/50' },
};

// Explanation for each issue type
const ISSUE_TYPE_DESCRIPTIONS: Record<string, string> = {
    returned:        'الحالة مرتجعة للتعديل وترتبط بالطلب الأصلي. لها تأثير مالي.',
    doctor_rejected: 'رفض الطبيب الحالة. يُطبَّق فيها تكلفة رفض المعمل (rejectedLabCost).',
    lab_rejected:    'رفض المعمل/المصمم الحالة داخلياً. بدون تأثير مالي (مثل الملغية).',
    cancelled:       'تم إلغاء الحالة. بدون تأثير مالي.',
    redo:            'تم طلب إعادة إنتاج. يُنشأ طلب جديد مرتبط بالأصلي.',
};

export default function IssuesReport() {
    const [issues, setIssues] = useState<OrderIssue[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [lookupError, setLookupError] = useState<string | null>(null);
    const [reportError, setReportError] = useState<string | null>(null);
    const [typeFilter, setTypeFilter] = useState('all');
    const [designerFilter, setDesignerFilter] = useState('all');
    const [supplierFilter, setSupplierFilter] = useState('all');
    const dateRangeState = useReportDateRange('current_month');
    const { startDate: rangeStart, endDate: rangeEnd } = dateRangeState;
    const [hoveredType, setHoveredType] = useState<string | null>(null);

    const [labPerf, setLabPerf] = useState<SupplierIssuePerformance | null>(null);
    const [labPerfLoading, setLabPerfLoading] = useState(true);
    const [labPerfError, setLabPerfError] = useState<string | null>(null);

    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [users, setUsers] = useState<User[]>([]);

    const designers = useMemo(() => users.filter(u => u.role === 'designer'), [users]);

    useEffect(() => {
        (async () => {
            setLookupError(null);
            try {
                const [docs, sups, usrs] = await Promise.all([
                    db.getDoctors(),
                    db.getSuppliers(),
                    db.getUsers()
                ]);
                setDoctors(docs);
                setSuppliers(sups);
                setUsers(usrs);
            } catch (err) {
                console.error("Failed to load lookups:", err);
                setLookupError('تعذر تحميل بيانات الفلاتر. تحقق من الاتصال وحاول مرة أخرى.');
            }
        })();
    }, []);

    useEffect(() => {
        let ignore = false;

        (async () => {
            setIsLoading(true);
            setReportError(null);
            try {
                const data = await db.getOrderIssues({
                    issueType: typeFilter !== 'all' ? typeFilter : undefined,
                    startDate: rangeStart || undefined,
                    // order_issues.created_at is a timestamp; a date-only
                    // upper bound would silently exclude issues logged later
                    // in that final day, so it's pushed to the day's end.
                    endDate: rangeEnd ? `${rangeEnd}T23:59:59` : undefined,
                });
                if (ignore) return;
                setIssues(data);
            } catch (err) {
                if (ignore) return;
                console.error('Failed to load order issues:', err);
                setIssues([]);
                setReportError('تعذر تحميل تقرير المشكلات. تحقق من الاتصال وحاول مرة أخرى.');
            } finally {
                if (!ignore) setIsLoading(false);
            }
        })();

        return () => {
            ignore = true;
        };
    }, [typeFilter, rangeStart, rangeEnd]);

    // Lab performance is loaded separately from the issues list because it is
    // measured on a different date axis (the order's statement date, for both
    // sides of its ratio) and needs a denominator the issues list does not
    // carry: every case the lab handled, not only the ones that went wrong.
    useEffect(() => {
        let ignore = false;

        (async () => {
            setLabPerfLoading(true);
            setLabPerfError(null);
            try {
                const data = await analyticsService.getSupplierIssuePerformance(
                    rangeStart || undefined,
                    rangeEnd || undefined,
                );
                if (ignore) return;
                setLabPerf(data);
            } catch (err) {
                if (ignore) return;
                console.error('Failed to load lab performance:', err);
                setLabPerf(null);
                setLabPerfError('تعذر تحميل أداء المعامل.');
            } finally {
                if (!ignore) setLabPerfLoading(false);
            }
        })();

        return () => { ignore = true; };
    }, [rangeStart, rangeEnd]);

    const filteredIssues = useMemo(() => {
        return issues.filter(issue => {
            const order = issue.order;
            if (designerFilter !== 'all' && order?.designerId !== designerFilter) return false;
            if (supplierFilter !== 'all' && order?.supplierId !== supplierFilter) return false;
            return true;
        });
    }, [issues, designerFilter, supplierFilter]);

    const stats = useMemo(() => {
        const byType = filteredIssues.reduce<Record<string, number>>((acc, i) => {
            acc[i.issueType] = (acc[i.issueType] || 0) + 1;
            return acc;
        }, {});
        const byCause = filteredIssues.reduce<Record<string, number>>((acc, i) => {
            acc[i.causeCategory] = (acc[i.causeCategory] || 0) + 1;
            return acc;
        }, {});
        return { byType, byCause, total: filteredIssues.length };
    }, [filteredIssues]);

    const formatCaseDetails = (items: OrderItem[]) => {
        if (!items || items.length === 0) return '—';
        return items.map(item => {
            const count = item.teethNumbers?.length || 1;
            return `${item.serviceType} (${count} أسنان)`;
        }).join('، ');
    };

    const formatCurrency = (val?: number | null) => {
        if (val === undefined || val === null || val === 0) return '—';
        return `${val.toLocaleString('ar-EG')} ج.م`;
    };

    return (
        <div className="space-y-6 p-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div className="flex items-center gap-3">
                    <BarChart2 size={24} className="text-surface-500" />
                    <h1 className="text-xl font-bold text-surface-900">تقرير المشكلات والجودة</h1>
                </div>
                <ReportDateRangeFilter state={dateRangeState} />
            </div>

            {[lookupError, reportError].filter((message): message is string => Boolean(message)).map(message => (
                <div key={message} className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 flex items-start gap-2" role="alert">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                    <span className="text-sm font-medium">{message}</span>
                </div>
            ))}

            {/* Filters */}
            <div className="flex flex-wrap gap-3 bg-white p-4 rounded-xl border border-surface-200">
                <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="px-3 py-2 border border-surface-200 rounded-lg text-sm bg-white"
                >
                    <option value="all">كل الأنواع</option>
                    {Object.entries(ISSUE_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                    ))}
                </select>

                <select
                    value={designerFilter}
                    onChange={(e) => setDesignerFilter(e.target.value)}
                    className="px-3 py-2 border border-surface-200 rounded-lg text-sm bg-white"
                >
                    <option value="all">كل المصممين</option>
                    {designers.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                </select>

                <select
                    value={supplierFilter}
                    onChange={(e) => setSupplierFilter(e.target.value)}
                    className="px-3 py-2 border border-surface-200 rounded-lg text-sm bg-white"
                >
                    <option value="all">كل المعامل الخارجية</option>
                    {suppliers.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>
            </div>

            {/* Stats Cards — 5 types now */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {Object.entries(ISSUE_TYPE_LABELS).map(([type, label]) => {
                    const Icon = ISSUE_ICONS[type];
                    const count = stats.byType[type] || 0;
                    const style = ISSUE_TYPE_STYLES[type] || { bg: 'bg-white', text: 'text-surface-900', border: 'border-surface-200', iconBg: 'bg-surface-100' };
                    const isActive = typeFilter === type;
                    return (
                        <button
                            key={type}
                            onClick={() => setTypeFilter(typeFilter === type ? 'all' : type)}
                            onMouseEnter={() => setHoveredType(type)}
                            onMouseLeave={() => setHoveredType(null)}
                            className={`${style.bg} rounded-xl border ${isActive ? 'ring-2 ring-offset-1 ' + style.text : style.border} p-4 flex items-center gap-3 transition-all hover:shadow-sm text-right w-full`}
                        >
                            <div className={`p-2.5 ${style.iconBg} rounded-xl flex-shrink-0`}>
                                {Icon && <Icon size={20} className={style.text} />}
                            </div>
                            <div>
                                <p className="text-xs font-bold text-surface-500">{label}</p>
                                <p className={`text-2xl font-bold ${count > 0 ? style.text : 'text-surface-300'}`}>{count}</p>
                                {hoveredType === type && (
                                    <p className="text-[9px] text-surface-400 mt-0.5 leading-tight max-w-[100px]">
                                        {ISSUE_TYPE_DESCRIPTIONS[type]?.slice(0, 40)}...
                                    </p>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Cause Breakdown */}
            <div className="bg-white rounded-xl border border-surface-200 p-4">
                <h3 className="text-sm font-bold text-surface-700 mb-3">توزيع الأسباب</h3>
                <div className="flex flex-wrap gap-2">
                    {Object.entries(CAUSE_LABELS).map(([cause, label]) => {
                        const count = stats.byCause[cause] || 0;
                        const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
                        return (
                            <div key={cause} className="flex items-center gap-2 bg-surface-50 rounded-lg px-3 py-2 border border-surface-100">
                                <span className="text-xs font-bold text-surface-700">{label}</span>
                                <span className="text-xs text-surface-500">{count} ({pct}%)</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Lab performance — moved here from the retired Quality page and
                rebuilt on order_issues, which the old version did not use.
                Split by severity tier (owner, 2026-08-17): the rate column
                is driven ONLY by doctor_rejected + redo (a produced piece
                genuinely lost) — cancelled/lab_rejected never feed a rate,
                since we simply chose not to continue on those and nothing
                was ever produced and lost. returned gets its own column,
                counted on its own since it costs trust but not a finished
                product. */}
            <div className="bg-white rounded-xl border border-surface-200 overflow-hidden shadow-sm">
                <div className="px-4 py-3 bg-surface-50 border-b border-surface-200">
                    <h3 className="text-sm font-bold text-surface-800">أداء المعامل</h3>
                    <p className="text-[11px] text-surface-500 mt-0.5">
                        «نسبة مرتجع+إعادة» محسوبة من <strong className="text-rose-600">مرتجع طبيب</strong> و<strong className="text-orange-600">إعادة إنتاج</strong> بس
                        (منتج اتعمل وضاع فعلاً). <strong className="text-blue-600">مرتجع للتعديل</strong> له عمود لوحده.
                        <strong className="text-emerald-600"> ملغى ومرفوض المعمل</strong> بيتعرضوا كعدد بس <strong>مش بيأثروا على النسبة</strong> —
                        دول قرار إننا منكملش، مش منتج ضاع. المؤرشف داخل، الملغي تسجيله (`is_voided`) مستبعد.
                    </p>
                </div>

                {/* This is the single most common source of "الجدول ده غلط"
                    reports on this page — flagged directly, not buried in a
                    muted footnote, because the two counts can legitimately
                    differ by a lot (an order delivered months ago can get its
                    rejection logged this week). */}
                <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                    <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-900 leading-relaxed">
                        <strong>الجدول ده على محور تاريخ مختلف عن الكروت والجدول تحت.</strong> الكروت فوق بتعدّ المشاكل
                        حسب <strong>امتى اتسجّلت</strong>؛ الجدول ده بيعدّها حسب <strong>امتى الطلب الأصلي اتسلّم</strong> —
                        عشان النسبة تتحسب على نفس مجموعة الطلبات اللي المعمل شغلها فعلاً في الفترة دي، مش على مشاكل
                        لطلبات قديمة. لو طبيب رفض حالة في أغسطس لطلب اتسلّم في يونيو، هتلاقيها في الكروت فوق كـ«مرتجع طبيب»
                        لكن مش هنا — لأنها مش بتاعة معمل «أغسطس». الفرق ده <strong>طبيعي ومتوقع</strong>، مش خطأ.
                    </p>
                </div>

                {labPerfLoading ? (
                    <div className="p-8 text-center text-surface-400 text-xs">جاري التحميل...</div>
                ) : labPerfError ? (
                    <div className="p-6 text-center">
                        <p className="text-rose-700 text-xs font-bold">{labPerfError}</p>
                        <p className="text-surface-400 text-[11px] mt-1">الجدول ده مش معروض — مفيش أرقام جزئية.</p>
                    </div>
                ) : !labPerf?.rows.length ? (
                    <div className="p-8 text-center">
                        <p className="text-surface-800 font-bold mb-1 text-sm">مفيش حالات في الفترة دي</p>
                        <p className="text-surface-500 text-xs">وسّع الفترة من فلتر التاريخ فوق.</p>
                    </div>
                ) : (
                    <ResponsiveTable label="جدول أداء المعامل">
                        <table className="w-full text-xs">
                            <thead className="bg-surface-800 text-white">
                                <tr>
                                    <th className="text-right px-4 py-2.5 font-bold">المعمل</th>
                                    <th className="px-3 py-2.5 text-center font-bold">إجمالي الحالات</th>
                                    <th className="px-3 py-2.5 text-center font-bold">مرتجع + إعادة</th>
                                    <th className="px-3 py-2.5 text-center font-bold">نسبة مرتجع+إعادة</th>
                                    <th className="px-3 py-2.5 text-center font-bold">نسبته من كل مرتجع+إعادة</th>
                                    <th className="px-3 py-2.5 text-center font-bold">مرتجع للتعديل</th>
                                    <th className="px-3 py-2.5 text-center font-bold">ملغى + مرفوض</th>
                                    <th className="px-3 py-2.5 text-center font-bold">توزيع الأنواع</th>
                                    <th className="px-3 py-2.5 text-center font-bold">تكلفة الرفض</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-100">
                                {labPerf.rows.map(row => (
                                    <tr key={row.supplier_id ?? 'internal'} className="hover:bg-surface-50">
                                        <td className="px-4 py-2.5 text-right font-bold text-surface-800">
                                            {row.supplier_name}
                                            {row.supplier_id === null && (
                                                <span className="block text-[10px] text-surface-400 font-normal mt-0.5">
                                                    طلبات من غير معمل خارجي محدد
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2.5 text-center font-mono text-surface-600">{row.total_orders}</td>
                                        <td className="px-3 py-2.5 text-center font-mono text-rose-700 font-bold">{row.severe_issue_orders}</td>
                                        <td className={`px-3 py-2.5 text-center font-mono font-bold ${
                                            row.severe_issue_rate_pct === null ? 'text-surface-300'
                                                : row.severe_issue_rate_pct > 12 ? 'text-rose-600'
                                                    : row.severe_issue_rate_pct > 7 ? 'text-amber-600' : 'text-emerald-600'
                                        }`}>
                                            {row.severe_issue_rate_pct === null ? '—' : `${row.severe_issue_rate_pct}%`}
                                        </td>
                                        <td className="px-3 py-2.5 text-center font-mono text-surface-600">
                                            {row.share_of_all_severe_issues_pct === null ? '—' : `${row.share_of_all_severe_issues_pct}%`}
                                        </td>
                                        <td className="px-3 py-2.5 text-center font-mono text-blue-600">
                                            {row.returned_orders > 0 ? (
                                                <>
                                                    {row.returned_orders}
                                                    <span className="text-surface-400"> ({row.returned_rate_pct}%)</span>
                                                </>
                                            ) : <span className="text-surface-300">—</span>}
                                        </td>
                                        <td className="px-3 py-2.5 text-center font-mono text-surface-400">
                                            {row.minor_issue_orders > 0 ? row.minor_issue_orders : <span className="text-surface-300">—</span>}
                                        </td>
                                        <td className="px-3 py-2.5 text-center">
                                            <div className="flex flex-wrap gap-1 justify-center">
                                                {Object.entries(row.by_type).length === 0 ? (
                                                    <span className="text-surface-300">—</span>
                                                ) : Object.entries(row.by_type).map(([type, count]) => (
                                                    <span key={type} className="text-[9px] bg-surface-100 text-surface-700 px-1.5 py-0.5 rounded font-semibold">
                                                        {ISSUE_TYPE_LABELS[type] || type}: {count}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5 text-center font-mono text-amber-700">
                                            {row.rejection_cost > 0 ? row.rejection_cost.toLocaleString('en-US') : <span className="text-surface-300">—</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </ResponsiveTable>
                )}
            </div>

            {/* Issues Table */}
            <div className="bg-white rounded-xl border border-surface-200 overflow-hidden shadow-sm">
                {isLoading ? (
                    <div className="p-8 text-center text-surface-400">جاري التحميل...</div>
                ) : filteredIssues.length === 0 ? (
                    <div className="p-8 text-center">
                        <AlertTriangle size={32} className="mx-auto mb-2 text-surface-300" />
                        <p className="text-sm text-surface-400">لا توجد مشكلات مسجلة</p>
                    </div>
                ) : (
                    <ResponsiveTable label="جدول المشكلات المسجلة">
                        <table className="w-full text-right text-sm min-w-[1000px]">
                            <thead className="bg-surface-50 border-b border-surface-200 text-surface-600 text-xs font-bold">
                                <tr>
                                    <th className="px-4 py-3">نوع المشكلة</th>
                                    <th className="px-4 py-3">المريض / كود الحالة</th>
                                    <th className="px-4 py-3">معرف الحالة الأصلية</th>
                                    <th className="px-4 py-3">الطبيب</th>
                                    <th className="px-4 py-3">فريق العمل</th>
                                    <th className="px-4 py-3">التفاصيل</th>
                                    <th className="px-4 py-3">سعر البيع</th>
                                    <th className="px-4 py-3">تكلفة المعمل</th>
                                    <th className="px-4 py-3">تكلفة الرفض</th>
                                    <th className="px-4 py-3">السبب</th>
                                    <th className="px-4 py-3">المرحلة المسؤولة</th>
                                    <th className="px-4 py-3">ملاحظات المشكلة</th>
                                    <th className="px-4 py-3">التاريخ</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-100">
                                {filteredIssues.map(issue => {
                                    const style = ISSUE_TYPE_STYLES[issue.issueType] || { bg: 'bg-white', text: 'text-surface-900', border: 'border-surface-200', iconBg: 'bg-surface-100' };
                                    const order = issue.order;
                                    const doctorName = order?.doctorId ? (doctors.find(d => d.id === order.doctorId)?.name || 'غير معروف') : '—';
                                    const designerName = order?.designerId ? (users.find(u => u.id === order.designerId)?.name || 'غير معروف') : '—';
                                    const supplierName = order?.supplierId ? (suppliers.find(s => s.id === order.supplierId)?.name || 'غير معروف') : '—';
                                    const labCost = order ? (order.manualCost ?? order.cost ?? 0) : 0;
                                    // Show rejection cost only for doctor_rejected (has financial impact)
                                    const showRejCost = issue.issueType === 'doctor_rejected';

                                    return (
                                        <tr key={issue.id} className="hover:bg-surface-50/30 transition-colors">
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold border ${style.border} ${style.text} ${style.bg}`}>
                                                    {(() => {
                                                        const Icon = ISSUE_ICONS[issue.issueType];
                                                        return Icon ? <Icon size={10} /> : null;
                                                    })()}
                                                    {ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="font-bold text-surface-900">{order?.patientName || '—'}</div>
                                                <div className="text-[10px] text-surface-400 font-mono">#{order?.caseId || '—'}</div>
                                            </td>
                                            <td className="px-4 py-3 text-surface-400 text-xs">
                                                {order?.originalOrderId && issue.issueType === 'redo' ? (
                                                    <span className="text-emerald-600 font-mono">{order.originalOrderId.slice(0, 8)}...</span>
                                                ) : '—'}
                                            </td>
                                            <td className="px-4 py-3 font-medium text-surface-800">{doctorName}</td>
                                            <td className="px-4 py-3 text-xs">
                                                <div className="text-surface-500">المصمم: <span className="font-bold text-surface-700">{designerName}</span></div>
                                                <div className="text-surface-500">المعمل: <span className="font-bold text-surface-700">{supplierName}</span></div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="text-xs font-semibold text-surface-700 max-w-[180px] truncate" title={formatCaseDetails(order?.items || [])}>
                                                    {formatCaseDetails(order?.items || [])}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 font-semibold text-surface-700">{formatCurrency(order?.totalPrice)}</td>
                                            <td className="px-4 py-3 font-semibold text-surface-700">{formatCurrency(labCost)}</td>
                                            <td className="px-4 py-3 font-semibold text-red-600">
                                                {showRejCost ? formatCurrency(order?.rejectedLabCost) : (
                                                    <span className="text-xs text-surface-300">لا ينطبق</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="text-xs font-medium bg-surface-100 text-surface-700 px-2 py-1 rounded">
                                                    {CAUSE_LABELS[issue.causeCategory] || issue.causeCategory}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="text-xs text-surface-600">
                                                    {responsibleStageLabel(issue.responsibleStage)}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-surface-500 max-w-[200px] truncate" title={issue.notes || ''}>
                                                {issue.notes || '—'}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="text-xs font-bold text-surface-800" dir="ltr">
                                                    {new Date(issue.createdAt).toLocaleDateString('ar-EG')}
                                                </div>
                                                <div className="text-[10px] text-surface-400">تاريخ المشكلة</div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </ResponsiveTable>
                )}
            </div>
        </div>
    );
}
