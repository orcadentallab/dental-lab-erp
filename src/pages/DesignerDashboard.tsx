import { useState, useEffect } from 'react';
import { db, type Order } from '../services/db';
import { useAuth } from '../context/AuthContext';
import { FolderKanban, CheckCircle2, Clock, DollarSign, Upload, PlayCircle } from 'lucide-react';

export default function DesignerDashboard() {
    const { user } = useAuth();
    const [orders, setOrders] = useState<Order[]>([]);
    const [filter, setFilter] = useState<'pending' | 'in_progress' | 'completed'>('pending');

    const [isLoading, setIsLoading] = useState(false);
    const [doctors, setDoctors] = useState<any[]>([]);

    useEffect(() => {
        loadOrders();
    }, [user]);

    const loadOrders = async () => {
        if (!user) return;
        setIsLoading(true);
        try {
            const [allOrders, allDoctors] = await Promise.all([
                db.getOrders(),
                db.getDoctors()
            ]);

            // Filter for orders assigned to this designer
            const myOrders = allOrders.filter(o =>
                o.workflowType === 'split' &&
                o.designerId === user.id
            );
            // Sort by date desc
            setOrders(myOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
            setDoctors(allDoctors);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleStatusUpdate = async (orderId: string, newStatus: 'pending' | 'in_progress' | 'completed') => {
        await db.updateOrder(orderId, { designStatus: newStatus });
        await loadOrders();
    };

    const filteredOrders = orders.filter(o => (o.designStatus || 'pending') === filter);

    // Stats
    const totalEarnings = orders
        .filter(o => o.designStatus === 'completed')
        .reduce((sum, o) => {
            const itemCount = o.items.reduce((c, i) => c + (i.teethNumbers.length || 0), 0);
            // Note: In real app, we should store snapshot price on order. For now, use user unitRate.
            return sum + (itemCount * (user?.unitRate || 0));
        }, 0);

    const pendingCount = orders.filter(o => !o.designStatus || o.designStatus === 'pending').length;

    return (
        <div className="space-y-6 animate-in fade-in">
            {/* Header Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
                    <div className="p-4 bg-purple-50 text-purple-600 rounded-xl">
                        <FolderKanban size={32} />
                    </div>
                    <div>
                        <p className="text-sm text-gray-500 font-bold">الحالات قيد الانتظار</p>
                        <p className="text-2xl font-bold text-gray-800">{isLoading ? '...' : pendingCount}</p>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
                    <div className="p-4 bg-green-50 text-green-600 rounded-xl">
                        <DollarSign size={32} />
                    </div>
                    <div>
                        <p className="text-sm text-gray-500 font-bold">إجمالي الأرباح (مكتمل)</p>
                        <p className="text-2xl font-bold text-gray-800">{totalEarnings.toLocaleString()} ج.م</p>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
                    <div className="p-4 bg-blue-50 text-blue-600 rounded-xl">
                        <Clock size={32} />
                    </div>
                    <div>
                        <p className="text-sm text-gray-500 font-bold">سعر الوحدة الحالي</p>
                        <p className="text-2xl font-bold text-gray-800">{user?.unitRate || 0} ج.م</p>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                {/* Tabs */}
                <div className="flex border-b border-gray-100">
                    <button
                        onClick={() => setFilter('pending')}
                        className={`px-6 py-4 text-sm font-bold transition-all ${filter === 'pending' ? 'text-purple-600 border-b-2 border-purple-600' : 'text-gray-500 hover:bg-gray-50'}`}
                    >
                        قيد الانتظار ({orders.filter(o => (!o.designStatus || o.designStatus === 'pending')).length})
                    </button>
                    <button
                        onClick={() => setFilter('in_progress')}
                        className={`px-6 py-4 text-sm font-bold transition-all ${filter === 'in_progress' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
                    >
                        جاري العمل ({orders.filter(o => o.designStatus === 'in_progress').length})
                    </button>
                    <button
                        onClick={() => setFilter('completed')}
                        className={`px-6 py-4 text-sm font-bold transition-all ${filter === 'completed' ? 'text-green-600 border-b-2 border-green-600' : 'text-gray-500 hover:bg-gray-50'}`}
                    >
                        مكتمل ({orders.filter(o => o.designStatus === 'completed').length})
                    </button>
                </div>

                {/* List */}
                <div className="p-6">
                    {filteredOrders.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                            <FolderKanban size={48} className="mx-auto mb-4 opacity-20" />
                            <p>لا توجد حالات في هذه القائمة</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {filteredOrders.map(order => (
                                <div key={order.id} className="border border-gray-100 rounded-xl p-4 hover:shadow-md transition-all bg-gray-50/50">
                                    <div className="flex flex-col md:flex-row justify-between gap-4">
                                        <div className="flex-1 space-y-2">
                                            <div className="flex items-center gap-3">
                                                <span className="bg-gray-200 text-gray-700 px-2 py-1 rounded text-xs font-bold">{order.caseId}</span>
                                                <h3 className="font-bold text-gray-800">{order.patientName}</h3>
                                                {order.priority === 'Urgent' && (
                                                    <span className="bg-red-100 text-red-600 px-2 py-0.5 rounded-full text-xs font-bold animate-pulse">مستعجل</span>
                                                )}
                                            </div>
                                            <div className="text-sm text-gray-500">
                                                د. {doctors.find(d => d.id === order.doctorId)?.name} • تسليم: {order.deliveryDate}
                                            </div>
                                            {order.instructions && (
                                                <div className="bg-yellow-50 p-2 rounded border border-yellow-100 text-xs text-yellow-800 mt-2">
                                                    ملاحظات: {order.instructions}
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex flex-col gap-2 items-end">
                                            <div className="text-left ltr">
                                                {order.items.map((item, idx) => (
                                                    <div key={idx} className="text-xs font-medium text-gray-700 bg-white px-2 py-1 rounded border border-gray-200 mb-1">
                                                        {item.serviceType} <span className="text-gray-400">x</span> {item.teethNumbers.length}
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Actions */}
                                            <div className="flex gap-2 mt-auto">
                                                {order.stlUrl && (
                                                    <a
                                                        href={order.stlUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs font-bold rounded-lg hover:bg-gray-300 flex items-center gap-1"
                                                    >
                                                        <Upload size={14} /> Scan
                                                    </a>
                                                )}

                                                {(!order.designStatus || order.designStatus === 'pending') && (
                                                    <button
                                                        onClick={() => handleStatusUpdate(order.id, 'in_progress')}
                                                        className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 flex items-center gap-1"
                                                    >
                                                        <PlayCircle size={14} /> ابدأ التصميم
                                                    </button>
                                                )}

                                                {order.designStatus === 'in_progress' && (
                                                    <button
                                                        onClick={() => handleStatusUpdate(order.id, 'completed')}
                                                        className="px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 flex items-center gap-1"
                                                    >
                                                        <CheckCircle2 size={14} /> إنهاء
                                                    </button>
                                                )}

                                                {order.designStatus === 'completed' && (
                                                    <span className="px-3 py-1.5 bg-green-100 text-green-700 text-xs font-bold rounded-lg flex items-center gap-1">
                                                        <CheckCircle2 size={14} /> تم التسليم
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
