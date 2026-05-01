/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { db, type Order } from '../services/db';
import { useAuth } from '../context/AuthContext';
import {
    FolderKanban, Upload, Search, ChevronDown,
    AlertCircle, Clock, CheckCircle2, Link as LinkIcon, StickyNote, MessageCircle
} from 'lucide-react';
import { format } from 'date-fns';
import { isDesignerUser } from '../lib/userRoles';
import { formatDesignerDuration, getDesignSubmittedAt, getDesignerWorkDurationMs, isDesignSubmitted } from '../lib/designerOrderUtils';

interface DesignerDashboardProps {
    embedded?: boolean;
}

interface ExpandedTextPreview {
    title: string;
    content: string;
    accentClass: string;
}

type DesignSubmitTarget = 'Waiting Dr Approval' | 'Under Production';

const DESIGNER_DASHBOARD_CACHE_KEY = 'designer-dashboard-cache-v1';
const DESIGNER_DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;

interface DesignerDashboardCache {
    userId: string;
    userRole: string;
    savedAt: number;
    orders: Order[];
    doctors: any[];
    users: any[];
}

export default function DesignerDashboard({ embedded = false }: DesignerDashboardProps) {
    const { user } = useAuth();
    const [orders, setOrders] = useState<Order[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [doctors, setDoctors] = useState<any[]>([]);
    const [users, setUsers] = useState<any[]>([]);

    // Filters
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [designerFilter, setDesignerFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });

    // Modal State
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [showDesignModal, setShowDesignModal] = useState(false);
    const [designUrl, setDesignUrl] = useState('');
    const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
    const [expandedTextPreview, setExpandedTextPreview] = useState<ExpandedTextPreview | null>(null);
    const [designSubmitTarget, setDesignSubmitTarget] = useState<DesignSubmitTarget>('Waiting Dr Approval');
    const [designQueueView, setDesignQueueView] = useState<'pending' | 'submitted'>('pending');
    const [nowMs, setNowMs] = useState(() => Date.now());

    const isRestrictedDesigner = useMemo(
        () => !!user && isDesignerUser(user) && user.role !== 'admin' && user.role !== 'accountant',
        [user]
    );

    const doctorsById = useMemo(
        () => new Map(doctors.map((doctor: any) => [doctor.id, doctor])),
        [doctors]
    );

    const usersById = useMemo(
        () => new Map(users.map((appUser: any) => [appUser.id, appUser])),
        [users]
    );

    const loadData = useCallback(async () => {
        if (!user) return;
        let restoredFromCache = false;

        try {
            const rawCache = sessionStorage.getItem(DESIGNER_DASHBOARD_CACHE_KEY);
            if (rawCache) {
                const cache = JSON.parse(rawCache) as DesignerDashboardCache;
                const isSameUser = cache.userId === user.id && cache.userRole === user.role;
                const isFresh = Date.now() - cache.savedAt < DESIGNER_DASHBOARD_CACHE_TTL_MS;

                if (isSameUser && isFresh) {
                    setOrders(cache.orders);
                    setDoctors(cache.doctors);
                    setUsers(cache.users);
                    setIsLoading(false);
                    restoredFromCache = true;
                }
            }
        } catch (error) {
            console.warn('Could not restore designer dashboard cache:', error);
        }

        if (!restoredFromCache) {
            setIsLoading(true);
        }

        try {
            const promises: Promise<any>[] = [
                db.getDesignerDashboardOrders(isRestrictedDesigner ? user.id : undefined),
                db.getDoctors(),
            ];

            // Only non-designer-only users need users list for filtering
            if (user.role !== 'designer') {
                promises.push(db.getUsers());
            }

            const results = await Promise.all(promises);
            const dashboardOrders: Order[] = results[0];
            const allDoctors = results[1];
            const allUsers = results[2] || []; // Undefined if not fetched

            setOrders(dashboardOrders);
            setDoctors(allDoctors);
            const designerUsers = allUsers.filter((u: any) => isDesignerUser(u));
            setUsers(designerUsers);

            try {
                const cachePayload: DesignerDashboardCache = {
                    userId: user.id,
                    userRole: user.role,
                    savedAt: Date.now(),
                    orders: dashboardOrders,
                    doctors: allDoctors,
                    users: designerUsers,
                };
                sessionStorage.setItem(DESIGNER_DASHBOARD_CACHE_KEY, JSON.stringify(cachePayload));
            } catch (error) {
                console.warn('Could not save designer dashboard cache:', error);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    }, [isRestrictedDesigner, user]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setNowMs(Date.now());
        }, 60 * 1000);

        return () => window.clearInterval(timer);
    }, []);

    const updateOrderInState = useCallback((updatedOrder: Order | null) => {
        if (!updatedOrder) return;
        setOrders(prev => prev.map(order => order.id === updatedOrder.id ? updatedOrder : order));
    }, []);

    useEffect(() => {
        if (!user) return;

        try {
            const cachePayload: DesignerDashboardCache = {
                userId: user.id,
                userRole: user.role,
                savedAt: Date.now(),
                orders,
                doctors,
                users,
            };
            sessionStorage.setItem(DESIGNER_DASHBOARD_CACHE_KEY, JSON.stringify(cachePayload));
        } catch (error) {
            console.warn('Could not update designer dashboard cache:', error);
        }
    }, [doctors, orders, user, users]);

    const handleStatusChange = async (order: Order, newStatus: string) => {
        if (newStatus === 'completed') {
            setSelectedOrder(order);
            setDesignUrl(order.designUrl || '');
            setShowDesignModal(true);
            setDesignSubmitTarget(order.status === 'Under Production' ? 'Under Production' : 'Waiting Dr Approval');
            return;
        }

        // Direct status updates
        const updates: Partial<Order> = { designStatus: newStatus as Order['designStatus'] };

        // Auto-update main status based on design status
        if (newStatus === 'in_progress') updates.status = 'Under Design';
        if (newStatus === 'waiting_approval') updates.status = 'Waiting Dr Approval';
        if (newStatus === 'returned') updates.status = 'Returned for Adjustments';
        if (newStatus === 'accepted') updates.status = 'Under Design'; // Accepted starts design

        if (confirm(`هل أنت متأكد من تغيير الحالة إلى ${getStatusLabel(newStatus)}؟`)) {
            const updatedOrder = await db.updateOrder(order.id, updates);
            updateOrderInState(updatedOrder);
        }
    };

    const submitDesign = async () => {
        if (!selectedOrder || !user) return;

        const isUnderProduction = designSubmitTarget === 'Under Production';
        const comment = isUnderProduction
            ? `🔗 تم تسليم التصميم وإرساله للمعمل:\n${designUrl}`
            : `🔗 تم رفع التصميم وبانتظار موافقة الطبيب:\n${designUrl}`;

        const updatedOrder = await db.updateOrderStatus(selectedOrder.id, designSubmitTarget, {
            designUrl,
            comment,
            userId: user.id,
            userName: user.name || user.role || 'مصمم',
        });

        if (isUnderProduction) {
            await db.updateOrder(selectedOrder.id, { technicianStatus: 'Pending' });
        }

        const refreshedOrder = await db.getOrder(selectedOrder.id);
        updateOrderInState(refreshedOrder || updatedOrder);
        setShowDesignModal(false);
        setSelectedOrder(null);
        setDesignUrl('');
        setDesignQueueView('submitted');
    };

    const handleAddComment = async (order: Order) => {
        if (!user) return;
        const text = (commentDrafts[order.id] || '').trim();
        if (!text) return;

        const nextComment = {
            id: Math.random().toString(36).substr(2, 9),
            text,
            userId: user.id,
            userName: user.name || user.role || 'مصمم',
            createdAt: new Date().toISOString(),
        };

        const updatedOrder = await db.updateOrder(order.id, {
            comments: [...(order.comments || []), nextComment],
        });

        setCommentDrafts(prev => ({ ...prev, [order.id]: '' }));
        updateOrderInState(updatedOrder);
    };

    const requestDesignRevision = async (order: Order) => {
        if (!user) return;
        if (!confirm('هل تريد إرجاع الحالة تحت التصميم مع الاحتفاظ برابط التصميم الحالي؟')) return;

        const updatedOrder = await db.updateOrderStatus(order.id, 'Under Design', {
            comment: '↩️ تم طلب تعديل على التصميم، ورجعت الحالة تحت التصميم مع الاحتفاظ بالرابط السابق لحين رفع نسخة جديدة.',
            userId: user.id,
            userName: user.name || user.role || 'مستخدم',
        });

        updateOrderInState(updatedOrder);
        setDesignQueueView('pending');
    };

    const filteredOrders = useMemo(() => {
        return orders.filter(order => {
            const s = (order.designStatus || 'pending');
            const matchesStatus = statusFilter === 'all' || s === statusFilter;
            const matchesDesigner = designerFilter === 'all' || order.designerId === designerFilter;
            const matchesSearch =
                order.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                order.caseId.toString().includes(searchQuery);

            let matchesDate = true;
            if (dateRange.start) {
                matchesDate = matchesDate && new Date(order.createdAt) >= new Date(dateRange.start);
            }
            if (dateRange.end) {
                matchesDate = matchesDate && new Date(order.createdAt) <= new Date(dateRange.end);
            }

            return matchesStatus && matchesDesigner && matchesSearch && matchesDate;
        });
    }, [orders, statusFilter, designerFilter, searchQuery, dateRange]);

    const stats = useMemo(() => ({
        total: orders.length,
        inProgress: orders.filter(o => o.designStatus === 'in_progress' || o.designStatus === 'accepted').length,
        waitingApproval: orders.filter(o => o.designStatus === 'waiting_approval').length,
        completed: orders.filter(o => o.designStatus === 'completed').length,
    }), [orders]);

    const pendingOrders = useMemo(
        () => filteredOrders.filter(order => !isDesignSubmitted(order)),
        [filteredOrders]
    );

    const submittedOrders = useMemo(
        () => filteredOrders.filter(order => isDesignSubmitted(order)),
        [filteredOrders]
    );

    const visibleOrders = designQueueView === 'submitted' ? submittedOrders : pendingOrders;

    const showDoctorName = Boolean(user && user.role !== 'designer');

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'pending': return 'جديد';
            case 'accepted': return 'تم القبول';
            case 'in_progress': return 'جاري العمل';
            case 'waiting_approval': return 'انتظار الموافقة';
            case 'completed': return 'مكتمل';
            case 'returned': return 'مرتجع';
            default: return status;
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'pending': return 'bg-gray-100 text-gray-700';
            case 'accepted': return 'bg-blue-100 text-blue-700';
            case 'in_progress': return 'bg-yellow-100 text-yellow-700';
            case 'waiting_approval': return 'bg-teal-100 text-teal-700';
            case 'completed': return 'bg-green-100 text-green-700';
            case 'returned': return 'bg-red-100 text-red-700';
            default: return 'bg-gray-100 text-gray-700';
        }
    };

    const openTextPreview = (title: string, content: string, accentClass: string) => {
        setExpandedTextPreview({ title, content, accentClass });
    };

    const getDoctorDisplayName = (doctorId?: string) => {
        if (!doctorId) return '-';

        const doctor = doctorsById.get(doctorId);
        if (!doctor) return '-';

        if (doctor.parentId) {
            const center = doctorsById.get(doctor.parentId);
            if (center?.name) {
                return `${doctor.name} (${center.name})`;
            }
        }

        return doctor.name;
    };

    const openDesignUploadModal = (order: Order) => {
        setSelectedOrder(order);
        setDesignUrl(order.designUrl || '');
        setDesignSubmitTarget(order.status === 'Under Production' ? 'Under Production' : 'Waiting Dr Approval');
        setShowDesignModal(true);
    };

    return (
        <div className={`space-y-6 animate-in fade-in ${embedded ? '' : 'pb-10'}`}>
            {/* Header Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3">
                    <div className="p-3 bg-gray-50 text-gray-600 rounded-lg">
                        <FolderKanban size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 font-bold">الكل</p>
                        <p className="text-xl font-bold text-gray-800">{stats.total}</p>
                    </div>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3">
                    <div className="p-3 bg-yellow-50 text-yellow-600 rounded-lg">
                        <Clock size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 font-bold">جاري العمل</p>
                        <p className="text-xl font-bold text-gray-800">
                            {stats.inProgress}
                        </p>
                    </div>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3">
                    <div className="p-3 bg-teal-50 text-teal-600 rounded-lg">
                        <AlertCircle size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 font-bold">انتظار الموافقة</p>
                        <p className="text-xl font-bold text-gray-800">
                            {stats.waitingApproval}
                        </p>
                    </div>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3">
                    <div className="p-3 bg-green-50 text-green-600 rounded-lg">
                        <CheckCircle2 size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 font-bold">مكتمل</p>
                        <p className="text-xl font-bold text-gray-800">
                            {stats.completed}
                        </p>
                    </div>
                </div>
            </div>

            {/* Filters Bar */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-wrap gap-4 items-center justify-between">
                <div className="flex flex-wrap gap-4 items-center flex-1">
                    <div className="relative">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="بحث برقم الحالة أو اسم المريض..."
                            value={searchQuery}
                            aria-label="بحث عن حالة"
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pr-10 pl-4 py-2 border border-gray-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        aria-label="فلترة بالحالة"
                        className="px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                        <option value="all">كل الحالات</option>
                        <option value="pending">جديد</option>
                        <option value="accepted">تم القبول</option>
                        <option value="in_progress">جاري العمل</option>
                        <option value="waiting_approval">انتظار الموافقة</option>
                        <option value="completed">مكتمل</option>
                        <option value="returned">مرتجع</option>
                    </select>

                    {user && !isDesignerUser(user) && (
                        <select
                            value={designerFilter}
                            onChange={(e) => setDesignerFilter(e.target.value)}
                            aria-label="فلترة بالمصمم"
                            className="px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        >
                            <option value="all">كل المصممين</option>
                            {users.map(u => (
                                <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                        </select>
                    )}

                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <input
                                type="date"
                                value={dateRange.start}
                                aria-label="تاريخ البداية"
                                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                                className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                            />
                        </div>
                        <span className="text-gray-400">-</span>
                        <div className="relative">
                            <input
                                type="date"
                                value={dateRange.end}
                                aria-label="تاريخ النهاية"
                                onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                                className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Orders List */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                    <div>
                        <h3 className="text-sm font-bold text-gray-800">حالات التصميم</h3>
                        <p className="text-xs text-gray-400">افصل بين الحالات قبل رفع التصميم وبعد الرفع لتقليل اللخبطة</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setDesignQueueView('pending')}
                            className={`rounded-lg px-3 py-2 text-xs font-bold transition ${designQueueView === 'pending' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
                        >
                            قبل رفع التصميم ({pendingOrders.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setDesignQueueView('submitted')}
                            className={`rounded-lg px-3 py-2 text-xs font-bold transition ${designQueueView === 'submitted' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                        >
                            بعد رفع التصميم ({submittedOrders.length})
                        </button>
                    </div>
                </div>
                {isLoading ? (
                    <div className="p-8 text-center text-gray-500">جاري التحميل...</div>
                ) : visibleOrders.length === 0 ? (
                    <div className="p-12 text-center text-gray-400 flex flex-col items-center gap-4">
                        <FolderKanban size={48} className="opacity-20" />
                        <p>{designQueueView === 'pending' ? 'لا توجد حالات تصميم قبل الرفع' : 'لا توجد حالات تم رفع تصميمها'}</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-right">
                            <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 text-xs font-bold uppercase">
                                <tr>
                                    <th className="px-4 py-4">رقم الحالة</th>
                                    <th className="px-6 py-4">المريض / الطبيب</th>
                                    {user && !isDesignerUser(user) && <th className="px-6 py-4">المصمم</th>}
                                    <th className="px-6 py-4">تعليمات / تعليقات</th>
                                    <th className="px-6 py-4">الاستلام / التسليم / المدة</th>
                                    <th className="px-6 py-4">المرفقات / التسليم</th>
                                    <th className="px-6 py-4">الحالة</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {visibleOrders.map(order => {
                                    const currentStatus = order.designStatus || 'pending';
                                    const latestComment = order.comments && order.comments.length > 0
                                        ? order.comments[order.comments.length - 1]
                                        : null;
                                    const submittedAt = getDesignSubmittedAt(order);
                                    const durationMs = getDesignerWorkDurationMs(order, nowMs);
                                    const durationLabel = durationMs !== null ? formatDesignerDuration(durationMs) : '-';
                                    return (
                                        <tr key={order.id} className="hover:bg-gray-50/50 transition-colors">
                                            <td className="px-4 py-4 w-[150px]">
                                                <span
                                                    className="block max-w-[140px] truncate text-sm font-semibold text-gray-700"
                                                    title={`#${order.caseId}`}
                                                    dir="ltr"
                                                >
                                                    #{order.caseId}
                                                </span>
                                                {order.priority === 'Urgent' && (
                                                    <div className="mt-1">
                                                        <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-bold">مستعجل</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-gray-800">{order.patientName}</div>
                                                {showDoctorName && (
                                                    <div className="text-xs text-gray-500 mt-1">
                                                        د. {getDoctorDisplayName(order.doctorId)}
                                                    </div>
                                                )}
                                            </td>
                                            {user && !isDesignerUser(user) && (
                                                <td className="px-6 py-4">
                                                    <span className="text-sm text-gray-700">
                                                        {usersById.get(order.designerId)?.name || '-'}
                                                    </span>
                                                </td>
                                            )}
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-1.5 min-w-[220px] max-w-[280px]">
                                                    {order.instructions ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => openTextPreview('تعليمات الحالة', order.instructions || '', 'bg-amber-50 border-amber-100 text-amber-800')}
                                                            className="flex w-full items-start gap-1.5 rounded-lg border border-amber-100 bg-amber-50 px-2 py-1.5 text-right text-xs text-amber-800 transition hover:bg-amber-100/70"
                                                        >
                                                            <StickyNote size={13} className="mt-0.5 shrink-0 text-amber-600" />
                                                            <span className="line-clamp-2 font-semibold">{order.instructions}</span>
                                                        </button>
                                                    ) : null}
                                                    {latestComment ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => openTextPreview(`تعليق ${latestComment.userName}`, latestComment.text, 'bg-blue-50 border-blue-100 text-blue-800')}
                                                            className="flex w-full items-start gap-1.5 rounded-lg border border-blue-100 bg-blue-50 px-2 py-1.5 text-right text-xs text-blue-800 transition hover:bg-blue-100/70"
                                                        >
                                                            <MessageCircle size={13} className="mt-0.5 shrink-0 text-blue-600" />
                                                            <span className="line-clamp-2">
                                                                <span className="font-bold">{latestComment.userName}: </span>
                                                                {latestComment.text}
                                                            </span>
                                                        </button>
                                                    ) : null}
                                                    {!order.instructions && !latestComment && (
                                                        <span className="text-xs text-gray-300">-</span>
                                                    )}
                                                    <div className="mt-1 flex items-center gap-1.5">
                                                        <input
                                                            type="text"
                                                            value={commentDrafts[order.id] || ''}
                                                            onChange={(e) => setCommentDrafts(prev => ({ ...prev, [order.id]: e.target.value }))}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    e.preventDefault();
                                                                    handleAddComment(order);
                                                                }
                                                            }}
                                                            placeholder="اكتب تعليق..."
                                                            aria-label="إضافة تعليق للحالة"
                                                            className="h-8 min-w-0 flex-1 rounded-lg border border-gray-200 px-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => handleAddComment(order)}
                                                            disabled={!commentDrafts[order.id]?.trim()}
                                                            className="h-8 rounded-lg bg-blue-600 px-2.5 text-xs font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                                                        >
                                                            إضافة
                                                        </button>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-600" dir="ltr">
                                                <div className="min-w-[170px] space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[11px] font-bold text-gray-400">استلام</span>
                                                        <span>{format(new Date(order.createdAt), 'dd/MM/yyyy')}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[11px] font-bold text-gray-400">تسليم</span>
                                                        <span>{format(new Date(order.deliveryDate), 'dd/MM/yyyy')}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[11px] font-bold text-gray-400">مدة التصميم</span>
                                                        <span className={submittedAt ? 'text-emerald-700' : 'text-amber-700'}>
                                                            {durationLabel}
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-2 min-w-[220px]">
                                                    <div className="flex gap-2 flex-wrap">
                                                        <button
                                                            type="button"
                                                            onClick={() => openDesignUploadModal(order)}
                                                            className={`text-xs flex items-center gap-1 px-2 py-1 rounded-md border transition ${order.designUrl ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100' : 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100'}`}
                                                        >
                                                            <LinkIcon size={12} />
                                                            {order.designUrl ? 'تحديث التصميم' : 'رفع التصميم'}
                                                        </button>
                                                    </div>
                                                    <div className="flex gap-2 flex-wrap">
                                                        {order.stlUrl && (
                                                            <a href={order.stlUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800 text-xs flex items-center gap-1 bg-blue-50 px-2 py-1 rounded-md border border-blue-100">
                                                                <Upload size={12} /> STL
                                                            </a>
                                                        )}
                                                        {order.imagesUrl && (
                                                            <a href={order.imagesUrl} target="_blank" rel="noreferrer" className="text-teal-600 hover:text-teal-800 text-xs flex items-center gap-1 bg-teal-50 px-2 py-1 rounded-md border border-teal-100">
                                                                <FolderKanban size={12} /> صور
                                                            </a>
                                                        )}
                                                        {order.designUrl && (
                                                            <a href={order.designUrl} target="_blank" rel="noreferrer" className="text-amber-700 hover:text-amber-800 text-xs flex items-center gap-1 bg-amber-50 px-2 py-1 rounded-md border border-amber-100">
                                                                <LinkIcon size={12} /> التصميم الحالي
                                                            </a>
                                                        )}
                                                        {isDesignSubmitted(order) && (
                                                            <button
                                                                type="button"
                                                                onClick={() => requestDesignRevision(order)}
                                                                className="text-red-700 hover:text-red-800 text-xs flex items-center gap-1 bg-red-50 px-2 py-1 rounded-md border border-red-100 transition hover:bg-red-100"
                                                            >
                                                                <AlertCircle size={12} /> طلب تعديل تصميم
                                                            </button>
                                                        )}
                                                    </div>
                                                    {submittedAt && (
                                                        <div className="text-[11px] text-emerald-700">
                                                            تم الرفع: {format(new Date(submittedAt), 'dd/MM/yyyy HH:mm')}
                                                        </div>
                                                    )}
                                                    <div className="text-xs text-gray-500 max-w-[200px] truncate">
                                                        {order.items.map(i => `${i.serviceType} x${i.teethNumbers.length}`).join(', ')}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="relative group">
                                                    <select
                                                        value={currentStatus}
                                                        onChange={(e) => handleStatusChange(order, e.target.value)}
                                                        aria-label="تغيير حالة التصميم"
                                                        className={`appearance-none w-full pl-8 pr-4 py-2 rounded-lg text-xs font-bold border-0 cursor-pointer focus:ring-2 focus:ring-blue-500 transition-all ${getStatusColor(currentStatus)}`}
                                                    >
                                                        <option value="pending" disabled={currentStatus !== 'pending'}>جديد</option>
                                                        {currentStatus === 'pending' && <option value="accepted">قبول الحالة</option>}
                                                        {/* Allow going back to pending only if accepted/in_progress? Or admin force? */}

                                                        {(currentStatus === 'pending' || currentStatus === 'accepted' || currentStatus === 'waiting_approval' || currentStatus === 'returned' || currentStatus === 'completed') && (
                                                            <option value="in_progress">جاري العمل</option>
                                                        )}

                                                        {(currentStatus === 'in_progress') && (
                                                            <option value="waiting_approval">انتظار موافقة الطبيب</option>
                                                        )}

                                                        {(currentStatus === 'in_progress' || currentStatus === 'waiting_approval') && (
                                                            <option value="completed">مكتمل (تسليم)</option>
                                                        )}

                                                        {(currentStatus === 'completed' || currentStatus === 'in_progress') && (
                                                            <option value="returned">إرجاع (للتعديل)</option>
                                                        )}
                                                    </select>
                                                    <ChevronDown size={14} className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-50" />
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {expandedTextPreview && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
                        <div className="mb-4 flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900">{expandedTextPreview.title}</h3>
                                <p className="mt-1 text-xs text-gray-400">عرض كامل للنص</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setExpandedTextPreview(null)}
                                className="rounded-lg px-3 py-1.5 text-sm font-bold text-gray-500 transition hover:bg-gray-100"
                            >
                                إغلاق
                            </button>
                        </div>
                        <div className={`max-h-[60vh] overflow-y-auto rounded-xl border p-4 text-sm leading-7 ${expandedTextPreview.accentClass}`}>
                            <p className="whitespace-pre-wrap break-words">{expandedTextPreview.content}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Design Completion Modal */}
            {showDesignModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95">
                        <h3 className="text-xl font-bold text-gray-900 mb-4">تسليم التصميم</h3>
                        <p className="text-sm text-gray-500 mb-6">
                            ارفع رابط التصميم ثم اختر هل يبقى في انتظار موافقة الطبيب أو ينتقل مباشرة إلى المعمل.
                        </p>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">رابط التصميم (WeTransfer, Dropbox, Google Drive)</label>
                                <input
                                    type="url"
                                    value={designUrl}
                                    onChange={(e) => setDesignUrl(e.target.value)}
                                    placeholder="https://..."
                                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-left ltr"
                                    autoFocus
                                />
                            </div>
                            <div className="space-y-2">
                                <p className="text-sm font-bold text-gray-700">بعد الحفظ، تروح الحالة على أي مرحلة؟</p>
                                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 px-4 py-3 transition hover:border-blue-300">
                                    <input
                                        type="radio"
                                        name="design-submit-target"
                                        checked={designSubmitTarget === 'Waiting Dr Approval'}
                                        onChange={() => setDesignSubmitTarget('Waiting Dr Approval')}
                                        className="mt-1"
                                    />
                                    <div>
                                        <p className="text-sm font-bold text-gray-800">فى انتظار موافقة الطبيب</p>
                                        <p className="text-xs text-gray-500">تفضل الحالة معروضة ضمن الحالات المرفوعة بانتظار الاعتماد.</p>
                                    </div>
                                </label>
                                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 px-4 py-3 transition hover:border-emerald-300">
                                    <input
                                        type="radio"
                                        name="design-submit-target"
                                        checked={designSubmitTarget === 'Under Production'}
                                        onChange={() => setDesignSubmitTarget('Under Production')}
                                        className="mt-1"
                                    />
                                    <div>
                                        <p className="text-sm font-bold text-gray-800">تم الارسال للمعمل للتنفيذ</p>
                                        <p className="text-xs text-gray-500">تتحول الحالة إلى تحت التصنيع ويبدأ المعمل تنفيذها مباشرة.</p>
                                    </div>
                                </label>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-8">
                            <button
                                onClick={() => { setShowDesignModal(false); setSelectedOrder(null); }}
                                className="px-6 py-2.5 text-gray-500 font-bold hover:bg-gray-50 rounded-xl transition-colors"
                            >
                                إلغاء
                            </button>
                            <button
                                onClick={submitDesign}
                                disabled={!designUrl}
                                className="px-6 py-2.5 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                <CheckCircle2 size={18} />
                                تأكيد التسليم
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
