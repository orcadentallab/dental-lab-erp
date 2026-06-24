import { useEffect, useState, useMemo } from 'react';
import { db, type Order, type User, type Doctor } from '../services/db';
import { Search, BarChart3, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatDesignerDuration, getDesignSubmittedAt, getDesignerWorkDurationMs, isDesignSubmitted } from '../lib/designerOrderUtils';
import { useToast } from '../context/ToastContext';
import { ensureAbsoluteUrl } from '../lib/urlUtils';
import { ErrorHandler } from '../lib/errorHandler';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

export default function DesignerStats() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const toast = useToast();

    const [isLoading, setIsLoading] = useState(true);
    const [orders, setOrders] = useState<Order[]>([]);
    const [designerOrders, setDesignerOrders] = useState<Order[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [refreshKey, setRefreshKey] = useState(0);

    const [designerStatsSearch, setDesignerStatsSearch] = useState('');
    const [designerStatsTimeFilter, setDesignerStatsTimeFilter] = useState<'all' | 'week' | 'month'>('all');
    const [designerStatsStatusFilter, setDesignerStatsStatusFilter] = useState<'all' | 'pending' | 'submitted' | 'tryin' | 'delivered'>('all');

    const handleOpenExternalUrl = (rawUrl: string | undefined | null, errorMsg: string) => {
        if (!rawUrl) return;
        const absoluteUrl = ensureAbsoluteUrl(rawUrl);
        if (!absoluteUrl) {
            toast.error(errorMsg);
            return;
        }
        const link = document.createElement('a');
        link.href = absoluteUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    useEffect(() => {
        if (!user) return;

        const loadData = async () => {
            setIsLoading(true);
            try {
                const [ordersData, designerOrdersData, usersData, doctorsData] = await Promise.all([
                    db.getDashboardActiveOrders().catch((): Order[] => []),
                    db.getDesignerDashboardOrders().catch((): Order[] => []),
                    db.getUsers().catch((): User[] => []),
                    db.getDoctors().catch((): Doctor[] => []),
                ]);

                setOrders(ordersData);
                setDesignerOrders(designerOrdersData);
                setUsers(usersData);
                setDoctors(doctorsData);
            } catch (error) {
                console.error('Error loading designer statistics data:', error);
                toast.error('حدث خطأ أثناء تحميل البيانات');
            } finally {
                setIsLoading(false);
            }
        };

        loadData();
    }, [user, refreshKey, toast]);

    const today = new Date().toISOString().split('T')[0];
    const nowMs = Date.now();

    const getOrderUnitsCount = (order: Order) => {
        return order.items.reduce((total, item) => total + Math.max(item.teethNumbers.length, 1), 0);
    };

    const getRowsUnitsCount = (rows: { order: Order }[]) => {
        return rows.reduce((total, row) => total + getOrderUnitsCount(row.order), 0);
    };

    const designerSubmittedOrders = useMemo(
        () => designerOrders.filter(order => isDesignSubmitted(order)),
        [designerOrders]
    );

    const designerPerformanceRows = useMemo(() => {
        return designerSubmittedOrders
            .map(order => {
                const submittedAt = getDesignSubmittedAt(order);
                const durationMs = getDesignerWorkDurationMs(order, nowMs);

                return {
                    order,
                    submittedAt,
                    durationMs,
                };
            })
            .sort((a, b) => new Date(b.submittedAt || b.order.createdAt).getTime() - new Date(a.submittedAt || a.order.createdAt).getTime());
    }, [designerSubmittedOrders, nowMs]);

    const designerTimelineRows = useMemo(() => {
        return designerOrders
            .map(order => {
                const submittedAt = getDesignSubmittedAt(order);
                const durationMs = getDesignerWorkDurationMs(order, nowMs);

                return {
                    order,
                    submittedAt,
                    durationMs,
                    isFinished: isDesignSubmitted(order),
                };
            })
            .sort((a, b) => new Date((b.submittedAt || b.order.createdAt)).getTime() - new Date((a.submittedAt || a.order.createdAt)).getTime());
    }, [designerOrders, nowMs]);

    const pendingDesignerTimelineRows = useMemo(
        () => designerTimelineRows.filter(row => !row.isFinished),
        [designerTimelineRows]
    );

    const submittedDesignerTimelineRows = useMemo(
        () => designerTimelineRows.filter(row => row.isFinished),
        [designerTimelineRows]
    );

    const pendingDesignerUnitsCount = getRowsUnitsCount(pendingDesignerTimelineRows);
    const submittedDesignerUnitsCount = getRowsUnitsCount(submittedDesignerTimelineRows);

    const filteredDesignerStatsRows = useMemo(() => {
        let rows: typeof designerTimelineRows;
        if (designerStatsStatusFilter === 'pending') {
            rows = pendingDesignerTimelineRows;
        } else if (designerStatsStatusFilter === 'submitted') {
            rows = submittedDesignerTimelineRows;
        } else if (designerStatsStatusFilter === 'tryin' || designerStatsStatusFilter === 'delivered') {
            const targetStatus = designerStatsStatusFilter === 'tryin' ? 'Try In' : 'Delivered';
            rows = orders
                .filter(o => o.designerId && o.status === targetStatus)
                .map(order => ({
                    order,
                    submittedAt: getDesignSubmittedAt(order),
                    durationMs: getDesignerWorkDurationMs(order, nowMs),
                    isFinished: isDesignSubmitted(order),
                }))
                .sort((a, b) => new Date(b.submittedAt || b.order.createdAt).getTime() - new Date(a.submittedAt || a.order.createdAt).getTime());
        } else {
            const designerRowIds = new Set(designerTimelineRows.map(r => r.order.id));
            const extraRows = orders
                .filter(o => o.designerId && !designerRowIds.has(o.id))
                .map(order => ({
                    order,
                    submittedAt: getDesignSubmittedAt(order),
                    durationMs: getDesignerWorkDurationMs(order, nowMs),
                    isFinished: isDesignSubmitted(order),
                }));
            rows = [...designerTimelineRows, ...extraRows]
                .sort((a, b) => new Date(b.submittedAt || b.order.createdAt).getTime() - new Date(a.submittedAt || a.order.createdAt).getTime());
        }
        if (designerStatsTimeFilter !== 'all') {
            const cutoff = new Date();
            if (designerStatsTimeFilter === 'week') cutoff.setDate(cutoff.getDate() - 7);
            else cutoff.setDate(cutoff.getDate() - 30);
            const cutoffMs = cutoff.getTime();
            rows = rows.filter(row => new Date(row.order.createdAt).getTime() >= cutoffMs);
        }
        if (designerStatsSearch.trim()) {
            const q = designerStatsSearch.trim().toLowerCase();
            rows = rows.filter(row => {
                const o = row.order;
                const doctorName = o.doctorId ? (doctors.find(d => d.id === o.doctorId)?.name || '').toLowerCase() : '';
                return (
                    (o.patientName || '').toLowerCase().includes(q) ||
                    (o.caseId || '').toLowerCase().includes(q) ||
                    doctorName.includes(q)
                );
            });
        }
        return rows;
    }, [designerTimelineRows, pendingDesignerTimelineRows, submittedDesignerTimelineRows, orders, designerStatsStatusFilter, designerStatsTimeFilter, designerStatsSearch, nowMs, doctors]);

    const filteredDesignerStatsGroups = useMemo(() => {
        const groups = new Map<string, { designerId: string; designerName: string; rows: typeof designerTimelineRows; }>();
        filteredDesignerStatsRows.forEach(row => {
            const designerId = row.order.designerId || 'unassigned';
            const designerName = users.find(u => u.id === row.order.designerId)?.name || 'غير محدد';
            if (!groups.has(designerId)) {
                groups.set(designerId, { designerId, designerName, rows: [] });
            }
            groups.get(designerId)?.rows.push(row);
        });
        return Array.from(groups.values());
    }, [filteredDesignerStatsRows, users]);

    const dailyDesignerCount = useMemo(() => {
        return designerPerformanceRows.filter(({ submittedAt }) =>
            submittedAt && submittedAt.startsWith(today)
        ).length;
    }, [designerPerformanceRows, today]);

    const weeklyDesignerCount = useMemo(() => {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const weekAgoMs = weekAgo.getTime();
        return designerPerformanceRows.filter(({ submittedAt }) => {
            if (!submittedAt) return false;
            return new Date(submittedAt).getTime() >= weekAgoMs;
        }).length;
    }, [designerPerformanceRows]);

    const monthlyDesignerCount = useMemo(() => {
        const monthAgo = new Date();
        monthAgo.setDate(monthAgo.getDate() - 30);
        const monthAgoMs = monthAgo.getTime();
        return designerPerformanceRows.filter(({ submittedAt }) => {
            if (!submittedAt) return false;
            return new Date(submittedAt).getTime() >= monthAgoMs;
        }).length;
    }, [designerPerformanceRows]);

    const averageDesignerDuration = useMemo(() => {
        const finishedRows = designerPerformanceRows.filter(row => row.durationMs !== null);
        if (finishedRows.length === 0) return null;

        const totalDuration = finishedRows.reduce((sum, row) => sum + (row.durationMs || 0), 0);
        return Math.round(totalDuration / finishedRows.length);
    }, [designerPerformanceRows]);

    const getDoctorDisplayName = (doctorId?: string) => {
        if (!doctorId) return '-';

        const doctor = doctors.find(doc => doc.id === doctorId);
        if (!doctor) return '-';

        if (doctor.parentId) {
            const center = doctors.find(doc => doc.id === doctor.parentId);
            if (center?.name) {
                return `${doctor.name} (${center.name})`;
            }
        }

        return doctor.name;
    };

    const requestDesignRevision = async (order: Order) => {
        if (!user) return;
        if (!confirm('هل تريد إرجاع الحالة تحت التصميم مع الاحتفاظ برابط التصميم الحالي؟')) return;

        try {
            const updatedOrder = await db.updateOrderStatus(order.id, 'Under Design', {
                comment: '↩️ تم طلب تعديل على التصميم، ورجعت الحالة تحت التصميم مع الاحتفاظ بالرابط السابق لحين رفع نسخة جديدة.',
                userId: user.id,
                userName: user.name || user.role || 'مستخدم',
                actorRole: user.role,
            });

            if (updatedOrder) {
                setDesignerOrders(prev => prev.map(existingOrder => existingOrder.id === updatedOrder.id ? updatedOrder : existingOrder));
                setOrders(prev => prev.map(existingOrder => existingOrder.id === updatedOrder.id ? updatedOrder : existingOrder));
                toast.success('تم إرجاع الحالة تحت التصميم بنجاح');
                setRefreshKey(prev => prev + 1);
            }
        } catch (error) {
            toast.error(ErrorHandler.getUserMessage(error) || 'فشل إرجاع الحالة تحت التصميم');
        }
    };

    if (isLoading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-500 border-t-transparent" />
            </div>
        );
    }

    return (
        <div className="space-y-6 p-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <button 
                        onClick={() => navigate('/dashboard')}
                        className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                        title="العودة للرئيسية"
                    >
                        <ArrowRight size={18} className="rtl:rotate-0 ltr:rotate-180" />
                    </button>
                    <div>
                        <div className="flex items-center gap-2">
                            <BarChart3 size={22} className="text-teal-600 dark:text-teal-400" />
                            <h1 className="text-xl font-bold text-gray-900 dark:text-white">إحصائيات المصممين</h1>
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">متابعة زمن تنفيذ التصميم وروابط المراجعة الأخيرة</p>
                    </div>
                </div>
            </div>

            {/* Metrics cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-xl shadow-sm border border-amber-200 dark:border-amber-800">
                    <p className="text-sm font-bold text-amber-700 dark:text-amber-300 mb-1">لسه تحت التصميم</p>
                    <p className="text-2xl font-bold text-amber-900 dark:text-amber-100">{pendingDesignerTimelineRows.length}</p>
                    <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-300/80">{pendingDesignerUnitsCount} يونت تحت التصميم</p>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-xl shadow-sm border border-emerald-200 dark:border-emerald-800">
                    <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300 mb-1">اترفع لها تصميم</p>
                    <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">{submittedDesignerTimelineRows.length}</p>
                    <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-300/80">{submittedDesignerUnitsCount} يونت تم رفعها</p>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">مرفوع آخر 7 أيام</p>
                    <p className="text-2xl font-bold text-gray-800 dark:text-white">{weeklyDesignerCount}</p>
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">اليوم: {dailyDesignerCount}</p>
                </div>
                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">متوسط زمن التصميم</p>
                    <p className="text-2xl font-bold text-gray-800 dark:text-white">{averageDesignerDuration !== null ? formatDesignerDuration(averageDesignerDuration) : '-'}</p>
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">آخر 30 يوم: {monthlyDesignerCount}</p>
                </div>
            </div>

            {/* Toolbar & Search */}
            <div className="space-y-4">
                <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800 space-y-3">
                    <div className="relative">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
                        <input
                            type="text"
                            placeholder="ابحث بالمريض أو كود الحالة أو الطبيب..."
                            value={designerStatsSearch}
                            onChange={e => setDesignerStatsSearch(e.target.value)}
                            className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pr-9 pl-3 text-sm text-right dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400 dark:placeholder-gray-400"
                        />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-900">
                            {(['all', 'week', 'month'] as const).map(f => (
                                <button key={f} type="button" onClick={() => setDesignerStatsTimeFilter(f)}
                                    className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${designerStatsTimeFilter === f ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-800 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-white/60 dark:hover:bg-gray-700/50'}`}>
                                    {f === 'all' ? 'الكل' : f === 'week' ? 'الأسبوع' : 'الشهر'}
                                </button>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-900">
                            {([
                                { key: 'all', label: 'كل الحالات' },
                                { key: 'pending', label: 'تحت التصميم' },
                                { key: 'submitted', label: 'تم رفع التصميم' },
                                { key: 'tryin', label: 'تراى ان' },
                                { key: 'delivered', label: 'اتسلمت' },
                            ] as const).map(({ key, label }) => (
                                <button key={key} type="button" onClick={() => setDesignerStatsStatusFilter(key)}
                                    className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${designerStatsStatusFilter === key ? 'bg-amber-600 text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:bg-white/60 dark:hover:bg-gray-700/50'}`}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Groups and Tables */}
                {filteredDesignerStatsGroups.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center text-sm text-gray-400 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500">
                        لا توجد حالات تطابق البحث أو الفلاتر المحددة
                    </div>
                ) : filteredDesignerStatsGroups.map(group => (
                    <div key={group.designerId} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-gray-800 dark:text-white">{group.designerName}</h3>
                                <p className="text-xs text-gray-400 dark:text-gray-500">
                                    {group.rows.length} حالة / {getRowsUnitsCount(group.rows)} يونت
                                </p>
                            </div>
                        </div>
                        <div className="overflow-auto max-h-[420px]">
                            <table className="w-full text-right text-sm">
                                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900/95 text-gray-500 dark:text-gray-400">
                                    <tr>
                                        <th className="px-4 py-3">الحالة</th>
                                        <th className="px-4 py-3">المريض</th>
                                        <th className="px-4 py-3">الطبيب</th>
                                        <th className="px-4 py-3">الخدمات</th>
                                        <th className="px-4 py-3">الوضع</th>
                                        <th className="px-4 py-3">تم الرفع</th>
                                        <th className="px-4 py-3">المدة</th>
                                        <th className="px-4 py-3">الرابط</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {group.rows.map(({ order, submittedAt, durationMs, isFinished }) => {
                                        const rowStatus = order.status === 'Delivered' ? 'delivered' : order.status === 'Try In' ? 'tryin' : isFinished ? 'submitted' : 'pending';
                                        const rowBg = rowStatus === 'delivered'
                                            ? 'border-gray-100 bg-gray-50/30 dark:border-gray-700/40 dark:bg-gray-700/10'
                                            : rowStatus === 'tryin'
                                                ? 'border-blue-100 bg-blue-50/35 dark:border-blue-900/40 dark:bg-blue-900/10'
                                                : rowStatus === 'submitted'
                                                    ? 'border-emerald-100 bg-emerald-50/35 dark:border-emerald-900/40 dark:bg-emerald-900/10'
                                                    : 'border-amber-100 bg-amber-50/35 dark:border-amber-900/40 dark:bg-amber-900/10';
                                        const badgeCls = rowStatus === 'delivered' ? 'bg-gray-500 text-white'
                                            : rowStatus === 'tryin' ? 'bg-blue-500 text-white'
                                                : rowStatus === 'submitted' ? 'bg-emerald-600 text-white dark:bg-emerald-500'
                                                    : 'bg-amber-500 text-white';
                                        const badgeLabel = rowStatus === 'delivered' ? 'اتسلمت'
                                            : rowStatus === 'tryin' ? 'تراى ان'
                                                : rowStatus === 'submitted' ? 'تم رفع التصميم'
                                                    : 'تحت التصميم';
                                        return (
                                            <tr key={order.id} className={`border-t align-top ${rowBg}`}>
                                                <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-gray-300">#{order.caseId}</td>
                                                <td className="px-4 py-3 text-gray-800 dark:text-gray-200">{order.patientName}</td>
                                                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{order.doctorId ? `د. ${getDoctorDisplayName(order.doctorId)}` : '-'}</td>
                                                <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">
                                                    <div className="max-w-[280px] space-y-1">
                                                        <div className="mb-1 inline-flex rounded-md bg-white px-2 py-0.5 text-[11px] font-bold text-gray-700 ring-1 ring-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700">
                                                            إجمالي {getOrderUnitsCount(order)} يونت
                                                        </div>
                                                        {order.items.map((item, index) => (
                                                            <div key={`${order.id}-item-${index}`} className="rounded-lg bg-gray-50 dark:bg-gray-700/50 px-2 py-1">
                                                                {item.serviceType} x{Math.max(item.teethNumbers.length, 1)}
                                                                {item.teethNumbers.length > 0 && (
                                                                    <span className="text-gray-400 dark:text-gray-500"> ({item.teethNumbers.join(', ')})</span>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={`inline-flex min-w-[96px] justify-center rounded-full px-2 py-1 text-[11px] font-bold ${badgeCls}`}>
                                                        {badgeLabel}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{submittedAt ? format(new Date(submittedAt), 'dd/MM/yyyy HH:mm') : '-'}</td>
                                                <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{durationMs !== null ? formatDesignerDuration(durationMs) : '-'}</td>
                                                <td className="px-4 py-3">
                                                    <div className="flex min-w-[130px] flex-col gap-1.5">
                                                        {order.designUrl ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleOpenExternalUrl(order.designUrl, 'رابط التحميل غير صالح أو معطوب')}
                                                                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-xs font-bold text-right cursor-pointer"
                                                            >
                                                                مراجعة التصميم
                                                            </button>
                                                        ) : (
                                                            <span className="text-xs text-gray-300">-</span>
                                                        )}
                                                        {isFinished && rowStatus !== 'delivered' && (
                                                            <button
                                                                type="button"
                                                                onClick={() => requestDesignRevision(order)}
                                                                className="rounded-md border border-red-100 bg-red-50 px-2 py-1 text-xs font-bold text-red-700 transition hover:bg-red-100 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300 cursor-pointer"
                                                            >
                                                                طلب تعديل تصميم
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
