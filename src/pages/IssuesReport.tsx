import { useState, useEffect, useMemo } from 'react';
import { db, type OrderIssue } from '../services/db';
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

export default function IssuesReport() {
    const [issues, setIssues] = useState<OrderIssue[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [typeFilter, setTypeFilter] = useState('all');
    const [dateRange, setDateRange] = useState({ start: '', end: '' });

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

    const stats = useMemo(() => {
        const byType = issues.reduce<Record<string, number>>((acc, i) => {
            acc[i.issueType] = (acc[i.issueType] || 0) + 1;
            return acc;
        }, {});
        const byCause = issues.reduce<Record<string, number>>((acc, i) => {
            acc[i.causeCategory] = (acc[i.causeCategory] || 0) + 1;
            return acc;
        }, {});
        return { byType, byCause, total: issues.length };
    }, [issues]);

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center gap-3">
                <BarChart2 size={24} className="text-surface-500" />
                <h1 className="text-xl font-bold text-surface-900">تقرير المشكلات والجودة</h1>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 bg-white p-4 rounded-xl border border-surface-200">
                <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="px-3 py-2 border border-surface-200 rounded-lg text-sm"
                >
                    <option value="all">كل الأنواع</option>
                    {Object.entries(ISSUE_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                    ))}
                </select>
                <input
                    type="date"
                    value={dateRange.start}
                    onChange={(e) => setDateRange(p => ({ ...p, start: e.target.value }))}
                    className="px-3 py-2 border border-surface-200 rounded-lg text-sm"
                />
                <input
                    type="date"
                    value={dateRange.end}
                    onChange={(e) => setDateRange(p => ({ ...p, end: e.target.value }))}
                    className="px-3 py-2 border border-surface-200 rounded-lg text-sm"
                />
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(ISSUE_TYPE_LABELS).map(([type, label]) => {
                    const Icon = ISSUE_ICONS[type];
                    const count = stats.byType[type] || 0;
                    return (
                        <div key={type} className="bg-white rounded-xl border border-surface-200 p-4 flex items-center gap-3">
                            <div className="p-2 bg-red-50 rounded-lg">
                                <Icon size={20} className="text-red-500" />
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
            <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
                {isLoading ? (
                    <div className="p-8 text-center text-surface-400">جاري التحميل...</div>
                ) : issues.length === 0 ? (
                    <div className="p-8 text-center">
                        <AlertTriangle size={32} className="mx-auto mb-2 text-surface-300" />
                        <p className="text-sm text-surface-400">لا توجد مشكلات مسجلة</p>
                    </div>
                ) : (
                    <table className="w-full text-right text-sm">
                        <thead className="bg-surface-50 border-b border-surface-100 text-surface-500 text-xs font-bold">
                            <tr>
                                <th className="px-4 py-3">النوع</th>
                                <th className="px-4 py-3">السبب</th>
                                <th className="px-4 py-3">ملاحظات</th>
                                <th className="px-4 py-3">التاريخ</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-50">
                            {issues.map(issue => (
                                <tr key={issue.id} className="hover:bg-surface-50/50">
                                    <td className="px-4 py-3 font-bold">{ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType}</td>
                                    <td className="px-4 py-3">{CAUSE_LABELS[issue.causeCategory] || issue.causeCategory}</td>
                                    <td className="px-4 py-3 text-surface-500 max-w-[200px] truncate">{issue.notes || '—'}</td>
                                    <td className="px-4 py-3 text-surface-500" dir="ltr">
                                        {new Date(issue.createdAt).toLocaleDateString('ar-EG')}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
