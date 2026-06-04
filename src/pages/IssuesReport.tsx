import { useState, useEffect, useMemo } from 'react';
import { db, type OrderIssue, type Doctor, type Supplier, type User, type OrderItem } from '../services/db';
import { AlertTriangle, BarChart2, RefreshCw, XCircle, RotateCcw, Ban } from 'lucide-react';

const ISSUE_TYPE_LABELS: Record<string, string> = {
    returned: 'مرتجع',
    rejected: 'مرفوض',
    cancelled: 'ملغي',
    redo: 'إعادة إنتاج',
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
    returned: RotateCcw,
    rejected: XCircle,
    cancelled: Ban,
    redo: RefreshCw,
};

const ISSUE_TYPE_STYLES: Record<string, { bg: string; text: string; border: string; iconBg: string }> = {
    returned: { bg: 'bg-blue-50/50', text: 'text-blue-600', border: 'border-blue-100', iconBg: 'bg-blue-100/50' },
    rejected: { bg: 'bg-rose-50/50', text: 'text-rose-600', border: 'border-rose-100', iconBg: 'bg-rose-100/50' },
    cancelled: { bg: 'bg-slate-50/50', text: 'text-slate-600', border: 'border-slate-100', iconBg: 'bg-slate-100/50' },
    redo: { bg: 'bg-amber-50/50', text: 'text-amber-600', border: 'border-amber-100', iconBg: 'bg-amber-100/50' },
};

export default function IssuesReport() {
    const [issues, setIssues] = useState<OrderIssue[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [typeFilter, setTypeFilter] = useState('all');
    const [designerFilter, setDesignerFilter] = useState('all');
    const [supplierFilter, setSupplierFilter] = useState('all');
    const [dateRange, setDateRange] = useState({ start: '', end: '' });

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
            {/* Explanatory note */}
            <div className="bg-emerald-100 border-l-4 border-emerald-200 p-4 rounded-md mb-4 text-emerald-800">
              <p className="text-sm">
                <strong>الفرق بين المرتجع والمرفوض:</strong> <br />
                • <span className="text-blue-600">مرتجع (Returned)</span> يعني أن الحالة تحتاج إلى إعادة إنتاج أو تعديل وتُربط بالطلب الأصلي. <br />
                • <span className="text-rose-600">مرفوض (Rejected)</span> يعني أن الحالة غير صالحة ولا يمكن إصلاحها، يتم إنشاء طلب جديد بدلاً منها.
              </p>
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

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(ISSUE_TYPE_LABELS).map(([type, label]) => {
                    const Icon = ISSUE_ICONS[type];
                    const count = stats.byType[type] || 0;
                    const style = ISSUE_TYPE_STYLES[type] || { bg: 'bg-white', text: 'text-surface-900', border: 'border-surface-200', iconBg: 'bg-surface-100' };
                    return (
                        <div key={type} className={`${style.bg} rounded-xl border ${style.border} p-4 flex items-center gap-3 transition-shadow hover:shadow-sm`}>
                            <div className={`p-2.5 ${style.iconBg} rounded-xl`}>
                                <Icon size={20} className={style.text} />
                            </div>
                            <div>
                                <p className="text-xs font-bold text-surface-500">{label}</p>
                                <p className="text-2xl font-bold text-surface-900">{count}</p>
                            </div>
                        </div>
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
                ) : issues.length === 0 ? (
                    <div className="p-8 text-center">
                        <AlertTriangle size={32} className="mx-auto mb-2 text-surface-300" />
                        <p className="text-sm text-surface-400">لا توجد مشكلات مسجلة</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-right text-sm min-w-[1000px]">
                            <thead className="bg-surface-50 border-b border-surface-200 text-surface-600 text-xs font-bold">
                                <tr>
            
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
                                {issues.map(issue => {
                                    const style = ISSUE_TYPE_STYLES[issue.issueType] || { bg: 'bg-white', text: 'text-surface-900', border: 'border-surface-200', iconBg: 'bg-surface-100' };
                                    const order = issue.order;
                                    const doctorName = order?.doctorId ? (doctors.find(d => d.id === order.doctorId)?.name || 'غير معروف') : '—';
                                    const designerName = order?.designerId ? (users.find(u => u.id === order.designerId)?.name || 'غير معروف') : '—';
                                    const supplierName = order?.supplierId ? (suppliers.find(s => s.id === order.supplierId)?.name || 'غير معروف') : '—';
                                    const labCost = order ? (order.manualCost ?? order.cost ?? 0) : 0;

                                    return (
                                        <tr key={issue.id} className="hover:bg-surface-50/30 transition-colors transform hover:scale-105">
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold border ${style.border} ${style.text} ${style.bg}`}>
                                                    {ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
    <div className="font-bold text-surface-900">{order?.patientName || '—'}</div>
    <div className="text-[10px] text-surface-400 font-mono">#{order?.caseId || '—'}</div>
</td>
{order?.originalOrderId && issue.issueType === 'redo' ? (
    <td className="px-4 py-3">
        <a href={`#/issues/${order?.originalOrderId}`} className="text-emerald-600 underline">{order?.originalOrderId}</a>
    </td>
) : null}
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
                                            <td className="px-4 py-3 font-semibold text-red-600">{formatCurrency(order?.rejectedLabCost)}</td>
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
                    </div>
                )}
            </div>
        </div>
    );
}

