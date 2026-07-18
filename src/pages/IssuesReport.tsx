import { useState, useEffect, useMemo } from 'react';
import { db, type OrderIssue, type Doctor, type Supplier, type User, type OrderItem } from '../services/db';
import { AlertTriangle, BarChart2, RefreshCw, XCircle, RotateCcw, Ban, UserX } from 'lucide-react';
import { ResponsiveTable } from '../components/ui/ResponsiveTable';

// Issue type display config
const ISSUE_TYPE_LABELS: Record<string, string> = {
    returned:        'مرتجع للتعديل',   // Returned for rework — linked to original order
    doctor_rejected: 'مرتجع طبيب',      // Doctor rejected — rejectedLabCost applies
    lab_rejected:    'رفض معمل',         // Lab/designer internal rejection — zero financial impact
    cancelled:       'ملغي',             // Cancelled — zero financial impact
    redo:            'إعادة إنتاج',      // Redo — new case linked to original
};

const CAUSE_LABELS: Record<string, string> = {
    lab: 'خطأ معمل',
    doctor: 'طلب دكتور',
    scan: 'سكان',
    design: 'تصميم',
    communication: 'تواصل',
    other: 'أخرى',
};

const ISSUE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    returned:        RotateCcw,
    doctor_rejected: UserX,
    lab_rejected:    XCircle,
    cancelled:       Ban,
    redo:            RefreshCw,
};

const ISSUE_TYPE_STYLES: Record<string, { bg: string; text: string; border: string; iconBg: string }> = {
    returned:        { bg: 'bg-blue-50/50',   text: 'text-blue-600',   border: 'border-blue-100',   iconBg: 'bg-blue-100/50' },
    // Doctor rejected: amber (financial impact with rejectedLabCost)
    doctor_rejected: { bg: 'bg-amber-50/50',  text: 'text-amber-700',  border: 'border-amber-100',  iconBg: 'bg-amber-100/50' },
    // Lab rejected: rose (internal rejection, no financial impact)
    lab_rejected:    { bg: 'bg-rose-50/50',   text: 'text-rose-600',   border: 'border-rose-100',   iconBg: 'bg-rose-100/50' },
    cancelled:       { bg: 'bg-slate-50/50',  text: 'text-slate-600',  border: 'border-slate-100',  iconBg: 'bg-slate-100/50' },
    redo:            { bg: 'bg-amber-50/50',  text: 'text-amber-600',  border: 'border-amber-100',  iconBg: 'bg-amber-100/50' },
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
    const [typeFilter, setTypeFilter] = useState('all');
    const [designerFilter, setDesignerFilter] = useState('all');
    const [supplierFilter, setSupplierFilter] = useState('all');
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [hoveredType, setHoveredType] = useState<string | null>(null);

    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [users, setUsers] = useState<User[]>([]);

    const designers = useMemo(() => users.filter(u => u.role === 'designer'), [users]);

    useEffect(() => {
        (async () => {
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
            }
        })();
    }, []);

    useEffect(() => {
        (async () => {
            setIsLoading(true);
            try {
                const data = await db.getOrderIssues({
                    issueType: typeFilter !== 'all' ? typeFilter : undefined,
                    startDate: dateRange.start || undefined,
                    endDate: dateRange.end ? `${dateRange.end}T23:59:59` : undefined,
                });
                setIssues(data);
            } finally {
                setIsLoading(false);
            }
        })();
    }, [typeFilter, dateRange]);

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
            <div className="flex items-center gap-3">
                <BarChart2 size={24} className="text-surface-500" />
                <h1 className="text-xl font-bold text-surface-900">تقرير المشكلات والجودة</h1>
            </div>

            {/* Issue Type Guide */}
            <div className="bg-white border border-surface-200 rounded-xl p-4 shadow-sm">
                <p className="text-xs font-bold text-surface-500 mb-3">دليل حالات المشكلات</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {Object.entries(ISSUE_TYPE_LABELS).map(([type, label]) => {
                        const style = ISSUE_TYPE_STYLES[type] || { bg: 'bg-white', text: 'text-surface-900', border: 'border-surface-200', iconBg: 'bg-surface-100' };
                        const Icon = ISSUE_ICONS[type];
                        const description = ISSUE_TYPE_DESCRIPTIONS[type] || '';
                        return (
                            <div key={type} className={`flex items-start gap-2.5 p-3 rounded-lg border ${style.border} ${style.bg}`}>
                                <div className={`p-1.5 rounded-lg ${style.iconBg} mt-0.5 flex-shrink-0`}>
                                    {Icon && <Icon size={14} className={style.text} />}
                                </div>
                                <div>
                                    <span className={`text-xs font-bold ${style.text}`}>{label}</span>
                                    <p className="text-[10px] text-surface-500 mt-0.5 leading-relaxed">{description}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

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

                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-surface-500">من</span>
                    <input
                        type="date"
                        value={dateRange.start}
                        onChange={(e) => setDateRange(p => ({ ...p, start: e.target.value }))}
                        className="px-3 py-2 border border-surface-200 rounded-lg text-sm bg-white"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-surface-500">إلى</span>
                    <input
                        type="date"
                        value={dateRange.end}
                        onChange={(e) => setDateRange(p => ({ ...p, end: e.target.value }))}
                        className="px-3 py-2 border border-surface-200 rounded-lg text-sm bg-white"
                    />
                </div>
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
