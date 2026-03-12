/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { db, type Order } from '../services/db';
import { useAuth } from '../context/AuthContext';
import {
    FolderKanban, Upload, Search, ChevronDown,
    AlertCircle, Clock, CheckCircle2
} from 'lucide-react';
import { format } from 'date-fns';

export default function DesignerDashboard() {
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

    const loadData = useCallback(async () => {
        if (!user) return;
        setIsLoading(true);
        try {
            const promises: Promise<any>[] = [
                db.getAllOrdersUnpaginated(),
                db.getDoctors(),
            ];

            // Only admins need users list for filtering
            if (user.role !== 'designer') {
                promises.push(db.getUsers());
            }

            const results = await Promise.all(promises);
            const allOrders: Order[] = results[0];
            const allDoctors = results[1];
            const allUsers = results[2] || []; // Undefined if not fetched

            // Filter for orders assigned to this designer OR if admin/accountant/rep (view all split)
            const isDesigner = user.role === 'designer';
            const relevantOrders = allOrders.filter(o =>
                o.workflowType === 'split' &&
                (!isDesigner || o.designerId === user.id)
            );

            // Sort by date desc
            setOrders(relevantOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
            setDoctors(allDoctors);
            setUsers(allUsers.filter((u: any) => u.role === 'designer'));
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    }, [user]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleStatusChange = async (order: Order, newStatus: string) => {
        if (newStatus === 'completed') {
            setSelectedOrder(order);
            setDesignUrl(order.designUrl || '');
            setShowDesignModal(true);
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
            await db.updateOrder(order.id, updates);
            loadData();
        }
    };

    const submitDesign = async () => {
        if (!selectedOrder) return;
        await db.updateOrder(selectedOrder.id, {
            designStatus: 'completed',
            designUrl: designUrl,
            status: 'Under Production', // Auto move to production
            technicianStatus: 'Pending' // Reset lab status if needed
        });
        setShowDesignModal(false);
        setSelectedOrder(null);
        loadData();
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

    return (
        <div className="space-y-6 animate-in fade-in pb-10">
            {/* Header Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3">
                    <div className="p-3 bg-gray-50 text-gray-600 rounded-lg">
                        <FolderKanban size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 font-bold">الكل</p>
                        <p className="text-xl font-bold text-gray-800">{orders.length}</p>
                    </div>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-3">
                    <div className="p-3 bg-yellow-50 text-yellow-600 rounded-lg">
                        <Clock size={24} />
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 font-bold">جاري العمل</p>
                        <p className="text-xl font-bold text-gray-800">
                            {orders.filter(o => o.designStatus === 'in_progress' || o.designStatus === 'accepted').length}
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
                            {orders.filter(o => o.designStatus === 'waiting_approval').length}
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
                            {orders.filter(o => o.designStatus === 'completed').length}
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

                    {user?.role !== 'designer' && (
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
                {isLoading ? (
                    <div className="p-8 text-center text-gray-500">جاري التحميل...</div>
                ) : filteredOrders.length === 0 ? (
                    <div className="p-12 text-center text-gray-400 flex flex-col items-center gap-4">
                        <FolderKanban size={48} className="opacity-20" />
                        <p>لا توجد حالات مطابقة للفلاتر</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-right">
                            <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 text-xs font-bold uppercase">
                                <tr>
                                    <th className="px-6 py-4">رقم الحالة</th>
                                    <th className="px-6 py-4">المريض / الطبيب</th>
                                    {user?.role !== 'designer' && <th className="px-6 py-4">المصمم</th>}
                                    <th className="px-6 py-4">تاريخ الاستلام</th>
                                    <th className="px-6 py-4">التفاصيل / المرفقات</th>
                                    <th className="px-6 py-4">الحالة</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {filteredOrders.map(order => {
                                    const currentStatus = order.designStatus || 'pending';
                                    return (
                                        <tr key={order.id} className="hover:bg-gray-50/50 transition-colors">
                                            <td className="px-6 py-4">
                                                <span className="font-bold text-gray-800">#{order.caseId}</span>
                                                {order.priority === 'Urgent' && (
                                                    <div className="mt-1">
                                                        <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-bold">مستعجل</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-gray-800">{order.patientName}</div>
                                                {user?.role !== 'designer' && (
                                                    <div className="text-xs text-gray-500 mt-1">
                                                        د. {doctors.find(d => d.id === order.doctorId)?.name}
                                                    </div>
                                                )}
                                            </td>
                                            {user?.role !== 'designer' && (
                                                <td className="px-6 py-4">
                                                    <span className="text-sm text-gray-700">
                                                        {users.find(u => u.id === order.designerId)?.name || '-'}
                                                    </span>
                                                </td>
                                            )}
                                            <td className="px-6 py-4 text-sm text-gray-600" dir="ltr">
                                                {format(new Date(order.createdAt), 'dd/MM/yyyy')}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-2">
                                                    <div className="flex gap-2">
                                                        {order.stlUrl && (
                                                            <a href={order.stlUrl} target="_blank" className="text-blue-600 hover:text-blue-800 text-xs flex items-center gap-1">
                                                                <Upload size={12} /> STL
                                                            </a>
                                                        )}
                                                        {order.imagesUrl && (
                                                            <a href={order.imagesUrl} target="_blank" className="text-teal-600 hover:text-teal-800 text-xs flex items-center gap-1">
                                                                <FolderKanban size={12} /> صور
                                                            </a>
                                                        )}
                                                    </div>
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

            {/* Design Completion Modal */}
            {showDesignModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95">
                        <h3 className="text-xl font-bold text-gray-900 mb-4">تسليم التصميم</h3>
                        <p className="text-sm text-gray-500 mb-6">
                            يرجى إرفاق رابط ملف التصميم النهائي
                            {selectedOrder?.status === 'Under Design' && ' (سيتم تحويل الحالة تلقائياً إلى "تحت التصنيع")'}
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
