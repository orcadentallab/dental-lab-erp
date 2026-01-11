import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { db, type Order, type Supplier, type Transaction } from '../services/db';
import { AlertTriangle, CheckCircle, Package, Building2, HelpCircle, User, CheckSquare, PlusCircle, UserPlus, Banknote, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(true);
    const [orders, setOrders] = useState<Order[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [doctorsMap, setDoctorsMap] = useState<Record<string, string>>({});

    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            try {
                const [allOrders, transactionsData, suppliersData, docs] = await Promise.all([
                    db.getOrders(),
                    db.getTransactions(),
                    db.getSuppliers(),
                    db.getDoctors()
                ]);

                // Removed sensitive debug logs

                // RBAC Filtering
                let filteredOrders = allOrders;
                if (user?.role === 'lab') {
                    filteredOrders = allOrders.filter(o => o.supplierId === user.entityId);
                } else if (user?.role === 'representative') {
                    filteredOrders = allOrders.filter(o => o.representativeId === user.id);
                }

                setOrders(filteredOrders);
                setTransactions(transactionsData);
                setSuppliers(suppliersData);

                // Map Doctors
                const dMap: Record<string, string> = {};
                docs.forEach(d => dMap[d.id] = d.name);
                setDoctorsMap(dMap);
            } catch (error) {
                console.error('Error loading dashboard data:', error);
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, [user]);

    const handleRegisterOrder = async (id: string) => {
        try {
            await db.updateOrder(id, { isRegistered: true });
            setOrders(prev => prev.map(o => o.id === id ? { ...o, isRegistered: true } : o));
        } catch (error) {
            console.error('Error registering order:', error);
        }
    };

    const handleRegisterTransaction = async (id: string) => {
        try {
            await db.updateTransaction(id, { isRegistered: true });
            setTransactions(prev => prev.map(t => t.id === id ? { ...t, isRegistered: true } : t));
        } catch (error) {
            console.error('Error registering transaction:', error);
        }
    };

    // Active: Not Delivered, Returned, or Rejected
    const rejectedOrders = orders.filter(o => o.status === 'Returned for Adjustments' || o.technicianStatus === 'Rejected');
    const activeOrders = orders.filter(o => o.status !== 'Delivered' && o.status !== 'Returned for Adjustments' && o.technicianStatus !== 'Rejected');

    // Group Active Orders
    const unassignedOrders = activeOrders.filter(o => !o.supplierId);

    // Unassigned + Delayed Logic
    const todayStr = new Date().toISOString().split('T')[0];
    const delayedOrders = activeOrders.filter(o => o.deliveryDate < todayStr);

    const supplierOrdersMap: Record<string, Order[]> = {};
    suppliers.forEach(sup => {
        supplierOrdersMap[sup.id] = activeOrders.filter(o => o.supplierId === sup.id);
    });

    const getStatusLabel = (status: string) => {
        const map: Record<string, string> = {
            'New Case': 'جديد',
            'Under Design': 'تصميم',
            'Waiting Dr Approval': 'موافقة',
            'Under Production': 'إنتاج',
            'Try In': 'تجربة',
            'Try In Approved': 'بروفة موافق',
            'Ready': 'جاهز',
            'Delivered': 'تم',
            'Returned for Adjustments': 'مرتجع'
        };
        return map[status] || status;
    };

    const getStatusBadgeClass = (status: string) => {
        switch (status) {
            case 'New Case': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300';
            case 'Under Design': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
            case 'Waiting Dr Approval': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300';
            case 'Under Production': return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300';
            case 'Try In': return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300';
            case 'Try In Approved': return 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300';
            case 'Ready': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
            case 'Delivered': return 'bg-green-600 text-white shadow-sm';
            case 'Returned for Adjustments': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
            default: return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
        }
    };

    const OrderTable = ({ title, icon: Icon, orders: tableOrders, colorClass, emptyMessage }: any) => (
        <div className={`bg-white dark:bg-gray-800 rounded-2xl shadow-sm border ${colorClass} dark:border-gray-700 overflow-hidden mb-8`}>
            {/* Header */}
            <div className={`p-6 border-b ${colorClass.replace('border-', 'border-b-')} dark:border-gray-700 bg-opacity-10 flex justify-between items-center bg-gray-50 dark:bg-gray-800`}>
                <h3 className="font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                    {Icon && <Icon size={20} />}
                    {title}
                </h3>
                <span className="bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-3 py-1 rounded-full text-xs font-bold border border-gray-200 dark:border-gray-600">{tableOrders.length} حالات</span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-right">
                    <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 font-medium border-b border-gray-100 dark:border-gray-700">
                        <tr>
                            <th className="p-4 w-[120px] font-bold text-xs uppercase tracking-wider">Case ID</th>
                            <th className="p-4 font-bold text-xs uppercase tracking-wider">الطبيب</th>
                            <th className="p-4 font-bold text-xs uppercase tracking-wider">المريض</th>
                            <th className="p-4 font-bold text-xs uppercase tracking-wider">التفاصيل</th>
                            <th className="p-4 w-[120px] font-bold text-xs uppercase tracking-wider">التسليم</th>
                            <th className="p-4 w-[120px] font-bold text-xs uppercase tracking-wider">الحالة</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {tableOrders.map((order: any) => (
                            <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors" onClick={() => navigate('/orders')}>
                                {/* Case ID */}
                                <td className="p-4 font-bold ltr text-left text-blue-600 dark:text-blue-400 font-mono">
                                    #{order.caseId}
                                    {(order.isUrgent || order.priority === 'Urgent') && <span className="ml-1 animate-pulse" title="Urgent">🔥</span>}
                                </td>

                                {/* Doctor */}
                                <td className="p-4">
                                    {user?.role !== 'lab' ? (
                                        <div className="flex items-center gap-1.5">
                                            <User size={14} className="text-gray-400" />
                                            <span className="font-semibold text-gray-700 dark:text-gray-300">{doctorsMap[order.doctorId] || '---'}</span>
                                        </div>
                                    ) : (
                                        <span className="text-gray-400 italic text-xs">مخفي</span>
                                    )}
                                </td>

                                {/* Patient */}
                                <td className="p-4 font-medium text-gray-800 dark:text-gray-200">{order.patientName}</td>

                                {/* Details (Items) */}
                                <td className="p-4">
                                    <div className="flex flex-wrap gap-1">
                                        {(order.items || []).map((item: any, idx: number) => (
                                            <span key={idx} className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200 border border-blue-100 dark:border-blue-800 px-1.5 py-0.5 rounded text-[11px]">
                                                {item.serviceType} {item.teethNumbers ? `(${Array.isArray(item.teethNumbers) ? item.teethNumbers.join(',') : item.teethNumbers})` : ''}
                                            </span>
                                        ))}
                                    </div>
                                </td>

                                {/* Delivery Date */}
                                <td className="p-4 text-gray-500 dark:text-gray-400 ltr font-mono text-xs">
                                    {order.deliveryDate}
                                    {order.deliveryDate < todayStr && <span className="block text-[10px] text-red-500 font-bold">متأخر</span>}
                                </td>

                                {/* Status */}
                                <td className="p-4">
                                    <span className={`px-2 py-1 rounded text-[11px] font-bold inline-block min-w-[60px] text-center ${getStatusBadgeClass(order.status)}`}>
                                        {getStatusLabel(order.status)}
                                    </span>
                                </td>
                            </tr>
                        ))}
                        {tableOrders.length === 0 && (
                            <tr><td colSpan={6} className="p-8 text-center text-gray-400 font-medium">{emptyMessage}</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-600 dark:text-gray-400">جاري تحميل البيانات...</p>
                </div>
            </div>
        );
    }

    // --- LAB SPECIFIC VIEW ---
    if (user?.role === 'lab') {
        if (!user.entityId) {
            return (
                <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
                    <AlertTriangle className="mx-auto h-12 w-12 text-red-500 mb-4" />
                    <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2">حساب غير مرتبط بمعمل</h2>
                    <p className="text-gray-600 dark:text-gray-400">هذا المستخدم غير مرتبط بأي معمل خارجي (Supplier). يرجى مراجعة المسؤول لربط الحساب.</p>
                </div>
            );
        }

        const myDelayed = orders.filter(o => o.deliveryDate < todayStr && o.status !== 'Delivered' && o.status !== 'Ready' && o.status !== 'Returned for Adjustments' && o.technicianStatus !== 'Rejected');
        const myActive = orders.filter(o => o.status !== 'Delivered' && o.status !== 'Ready' && o.status !== 'Returned for Adjustments' && o.technicianStatus !== 'Rejected');
        const myRejected = orders.filter(o => o.status === 'Returned for Adjustments' || o.technicianStatus === 'Rejected');
        const myReadyToday = orders.filter(o => o.status === 'Ready' && o.deliveryDate === todayStr);

        return (
            <div className="space-y-8">
                <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">لوحة تحكم المعمل</h1>
                        <p className="text-gray-500 dark:text-gray-400">أهلاً بك، {user.name} 👋</p>
                    </div>
                </div>

                {/* Lab Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 p-6 rounded-2xl shadow-lg shadow-indigo-200 dark:shadow-none text-white flex items-center gap-4 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><Package size={48} /></div>
                        <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm"><Package size={24} className="text-white" /></div>
                        <div>
                            <p className="text-xs text-indigo-100 font-bold uppercase tracking-wider mb-1">حالات قيد التنفيذ</p>
                            <h3 className="text-3xl font-black">{myActive.length}</h3>
                        </div>
                    </div>

                    <div className="bg-gradient-to-br from-red-500 to-red-600 p-6 rounded-2xl shadow-lg shadow-red-200 dark:shadow-none text-white flex items-center gap-4 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><AlertTriangle size={48} /></div>
                        <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm"><AlertTriangle size={24} className="text-white" /></div>
                        <div>
                            <p className="text-xs text-red-100 font-bold uppercase tracking-wider mb-1">حالات متأخرة</p>
                            <h3 className="text-3xl font-black">{myDelayed.length}</h3>
                        </div>
                    </div>

                    <div className="bg-gradient-to-br from-rose-500 to-rose-600 p-6 rounded-2xl shadow-lg shadow-rose-200 dark:shadow-none text-white flex items-center gap-4 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><AlertTriangle size={48} /></div>
                        <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm"><AlertTriangle size={24} className="text-white" /></div>
                        <div>
                            <p className="text-xs text-rose-100 font-bold uppercase tracking-wider mb-1">مرفوضة/مرتجع</p>
                            <h3 className="text-3xl font-black">{myRejected.length}</h3>
                        </div>
                    </div>

                    <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 p-6 rounded-2xl shadow-lg shadow-emerald-200 dark:shadow-none text-white flex items-center gap-4 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><CheckCircle size={48} /></div>
                        <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm"><CheckCircle size={24} className="text-white" /></div>
                        <div>
                            <p className="text-xs text-emerald-100 font-bold uppercase tracking-wider mb-1">جاهز اليوم</p>
                            <h3 className="text-3xl font-black">{myReadyToday.length}</h3>
                        </div>
                    </div>
                </div >

                {/* --- ALERTS SECTION --- */}

                {/* 0. Try In Approved (Action Required: Execute Final) */}
                {/* Cases that were Try In and are now Approved, needing Final execution */}
                {
                    orders.filter(o => o.status === 'Try In Approved').length > 0 && (
                        <div className="bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-2xl p-6 mb-6">
                            <h3 className="text-teal-800 dark:text-teal-400 font-bold flex items-center gap-2 mb-4">
                                <CheckSquare className="text-teal-600 dark:text-teal-400" />
                                حالات "بروفة موافق" - مطلوب تنفيذ Final (Try-In Approved)
                            </h3>
                            <p className="text-sm text-teal-700 dark:text-teal-500 mb-4">هذه الحالات تمت الموافقة على البروفة الخاصة بها. يرجى البدء في تنفيذ الـ Final مع مراعاة الملاحظات (إن وجدت).</p>
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-teal-100 dark:border-teal-900/50 overflow-hidden">
                                <table className="w-full text-right text-sm">
                                    <thead className="bg-teal-50 dark:bg-teal-900/40 text-teal-900 dark:text-teal-100 font-bold">
                                        <tr>
                                            <th className="p-3">رقم الحالة</th>
                                            <th className="p-3">المريض</th>
                                            <th className="p-3">التفاصيل</th>
                                            <th className="p-3 w-1/3">آخر ملاحظات (Comments)</th>
                                            <th className="p-3">تاريخ التسليم</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-teal-50 dark:divide-gray-700">
                                        {orders.filter(o => o.status === 'Try In Approved').map(order => {
                                            const latestComment = order.comments && order.comments.length > 0
                                                ? order.comments[order.comments.length - 1]
                                                : null;
                                            return (
                                                <tr key={order.id} className="hover:bg-teal-50/50 dark:hover:bg-gray-700 cursor-pointer" onClick={() => navigate('/orders')}>
                                                    <td className="p-3 font-bold font-mono text-gray-800 dark:text-gray-200">
                                                        #{order.caseId}
                                                        {(order.isUrgent || order.priority === 'Urgent') && <span className="ml-1 animate-pulse" title="Urgent">🔥</span>}
                                                    </td>
                                                    <td className="p-3 font-bold text-gray-800 dark:text-gray-200">{order.patientName}</td>
                                                    <td className="p-3 text-gray-600 dark:text-gray-400">{order.items.map((i: any) => i.serviceType).join(', ')}</td>
                                                    <td className="p-3">
                                                        {latestComment ? (
                                                            <div className="text-xs bg-yellow-50 dark:bg-yellow-900/30 p-2 rounded border border-yellow-100 dark:border-yellow-800">
                                                                <span className="font-bold text-yellow-700 dark:text-yellow-400 block mb-0.5">{latestComment.userName}:</span>
                                                                <span className="text-gray-700 dark:text-gray-300">{latestComment.text}</span>
                                                            </div>
                                                        ) : (
                                                            <span className="text-gray-400 text-xs italic">لا توجد ملاحظات</span>
                                                        )}
                                                    </td>
                                                    <td className="p-3 font-bold text-teal-600 dark:text-teal-400 ltr">{order.deliveryDate}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )
                }

                {/* 1. Pending Confirmation Alert */}
                {/* Show if status is Pending (default for assigned) OR explicit 'NeedDetails' */}
                {
                    orders.filter(o => o.technicianStatus === 'Pending' || !o.technicianStatus).length > 0 && (
                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 mb-6">
                            <h3 className="text-amber-800 dark:text-amber-400 font-bold flex items-center gap-2 mb-4">
                                <HelpCircle className="text-amber-600 dark:text-amber-400" />
                                حالات بانتظار الرد (Pending Confirmation)
                            </h3>
                            <p className="text-sm text-amber-700 dark:text-amber-500 mb-4">يرجى قبول أو رفض هذه الحالات الجديدة لتأكيد البدء فيها.</p>
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-amber-100 dark:border-amber-900/50 overflow-hidden">
                                <table className="w-full text-right text-sm">
                                    <thead className="bg-amber-50 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100 font-bold">
                                        <tr>
                                            <th className="p-3">رقم الحالة</th>
                                            <th className="p-3">المريض</th>
                                            <th className="p-3">التفاصيل</th>
                                            <th className="p-3">تاريخ التسليم</th>
                                            <th className="p-3">الإجراء</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-amber-50 dark:divide-gray-700">
                                        {orders.filter(o => o.technicianStatus === 'Pending' || !o.technicianStatus).map(order => (
                                            <tr key={order.id} className="hover:bg-amber-50/50 dark:hover:bg-gray-700 cursor-pointer" onClick={() => navigate('/orders')}>
                                                <td className="p-3 font-bold font-mono text-gray-800 dark:text-gray-200">
                                                    #{order.caseId}
                                                    {(order.isUrgent || order.priority === 'Urgent') && <span className="ml-1 animate-pulse" title="Urgent">🔥</span>}
                                                </td>
                                                <td className="p-3 font-bold text-gray-800 dark:text-gray-200">{order.patientName}</td>
                                                <td className="p-3 text-gray-600 dark:text-gray-400">{order.items.map((i: any) => i.serviceType).join(', ')}</td>
                                                <td className="p-3 font-bold text-amber-600 dark:text-amber-400 ltr">{order.deliveryDate}</td>
                                                <td className="p-3">
                                                    <span className="bg-blue-600 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-blue-700 shadow-sm">
                                                        الذهاب للرد
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )
                }

                {/* Delayed Alert Section */}
                {
                    myDelayed.length > 0 && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-6">
                            <h3 className="text-red-800 dark:text-red-400 font-bold flex items-center gap-2 mb-4">
                                <AlertTriangle className="text-red-600 dark:text-red-400" />
                                حالات عاجلة ومتأخرة (Requires Immediate Attention)
                            </h3>
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-red-100 dark:border-red-900/50 overflow-hidden">
                                <table className="w-full text-right text-sm">
                                    <thead className="bg-red-50 dark:bg-red-900/40 text-red-900 dark:text-red-100 font-bold">
                                        <tr>
                                            <th className="p-3">رقم الحالة</th>
                                            <th className="p-3">المريض</th>
                                            <th className="p-3">التفاصيل</th>
                                            <th className="p-3">تاريخ التسليم</th>
                                            <th className="p-3">الحالة</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-red-50 dark:divide-gray-700">
                                        {myDelayed.map(order => (
                                            <tr key={order.id} className="hover:bg-red-50/50 dark:hover:bg-gray-700 cursor-pointer" onClick={() => navigate('/orders')}>
                                                <td className="p-3 font-bold font-mono text-gray-800 dark:text-gray-200">
                                                    #{order.caseId}
                                                    {(order.isUrgent || order.priority === 'Urgent') && <span className="ml-1 animate-pulse" title="Urgent">🔥</span>}
                                                </td>
                                                <td className="p-3 font-bold text-gray-800 dark:text-gray-200">{order.patientName}</td>
                                                <td className="p-3 text-gray-600 dark:text-gray-400">{order.items.map((i: any) => i.serviceType).join(', ')}</td>
                                                <td className="p-3 font-bold text-red-600 ltr">{order.deliveryDate}</td>
                                                <td className="p-3"><span className="bg-white dark:bg-gray-700 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-2 py-1 rounded text-xs">{order.status}</span></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )
                }

                {/* Main Active Jobs Table */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                    <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
                        <h3 className="font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                            <Building2 className="text-blue-500" size={20} />
                            كل الحالات الجارية
                        </h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-right">
                            <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 font-medium">
                                <tr>
                                    <th className="p-4 w-[100px]">Case ID</th>
                                    {/* NO DOCTOR COLUMN FOR LAB */}
                                    <th className="p-4">المريض</th>
                                    <th className="p-4">التفاصيل</th>
                                    <th className="p-4 w-[120px]">التسليم</th>
                                    <th className="p-4 w-[120px]">الحالة</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                {myActive.map((order) => (
                                    <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors" onClick={() => navigate('/orders')}>
                                        <td className="p-4 font-bold ltr text-left text-blue-600 dark:text-blue-400 font-mono">
                                            #{order.caseId}
                                            {(order.isUrgent || order.priority === 'Urgent') && <span className="ml-1 animate-pulse" title="Urgent">🔥</span>}
                                        </td>
                                        <td className="p-4 font-medium text-gray-800 dark:text-gray-200">{order.patientName}</td>
                                        <td className="p-4">
                                            <div className="flex flex-wrap gap-1">
                                                {(order.items || []).map((item: any, idx: number) => (
                                                    <span key={idx} className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200 border border-blue-100 dark:border-blue-800 px-1.5 py-0.5 rounded text-[11px]">
                                                        {item.serviceType} {item.teethNumbers ? `(${Array.isArray(item.teethNumbers) ? item.teethNumbers.join(',') : item.teethNumbers})` : ''}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="p-4 text-gray-500 dark:text-gray-400 ltr font-mono text-xs">
                                            {order.deliveryDate}
                                            {order.deliveryDate < todayStr && <span className="block text-[10px] text-red-500 font-bold">متأخر</span>}
                                        </td>
                                        <td className="p-4">
                                            <span className={`px-2 py-1 rounded text-[11px] font-bold inline-block min-w-[80px] text-center ${getStatusBadgeClass(order.status)}`}>
                                                {getStatusLabel(order.status)}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                                {myActive.length === 0 && (
                                    <tr><td colSpan={5} className="p-8 text-center text-gray-400 font-medium">لا توجد حالات جارية حالياً</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>


                {/* Rejected/Returned Cases Table (Visible in Lab View) */}
                {
                    myRejected.length > 0 && (
                        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-red-200 dark:border-red-800 overflow-hidden">
                            <div className="p-6 border-b border-red-100 dark:border-red-800 flex justify-between items-center bg-red-50 dark:bg-red-900/20">
                                <h3 className="font-bold text-red-800 dark:text-red-300 flex items-center gap-2">
                                    <AlertTriangle className="text-red-500" size={20} />
                                    حالات مرفوضة / مرتجعة (Rejected / Returned)
                                </h3>
                                <span className="bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200 px-3 py-1 rounded-full text-xs font-bold border border-red-200 dark:border-red-700">{myRejected.length} حالات</span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-right">
                                    <thead className="bg-red-50 dark:bg-red-900/40 text-red-900 dark:text-red-300 font-medium">
                                        <tr>
                                            <th className="p-4 w-[100px]">Case ID</th>
                                            <th className="p-4">المريض</th>
                                            <th className="p-4">التفاصيل</th>
                                            <th className="p-4 w-[120px]">الحالة</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                        {myRejected.map((order) => (
                                            <tr key={order.id} className="hover:bg-red-50/30 dark:hover:bg-gray-700/50 cursor-pointer transition-colors" onClick={() => navigate('/orders')}>
                                                <td className="p-4 font-bold ltr text-left text-red-600 dark:text-red-400 font-mono">
                                                    #{order.caseId}
                                                    {(order.isUrgent || order.priority === 'Urgent') && <span className="ml-1 animate-pulse" title="Urgent">🔥</span>}
                                                </td>
                                                <td className="p-4 font-medium text-gray-800 dark:text-gray-200">{order.patientName}</td>
                                                <td className="p-4">
                                                    <div className="flex flex-wrap gap-1">
                                                        {(order.items || []).map((item: any, idx: number) => (
                                                            <span key={idx} className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-200 border border-red-100 dark:border-red-800 px-1.5 py-0.5 rounded text-[11px]">
                                                                {item.serviceType}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <span className={`px-2 py-1 rounded text-[11px] font-bold inline-block min-w-[80px] text-center ${getStatusBadgeClass(order.status)}`}>
                                                        {getStatusLabel(order.status)}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )
                }
            </div>
        );
    }

    // --- STANDARD VIEW (Admin/Rep/Accountant) ---
    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800 dark:text-white">لوحة التحكم</h1>
                    <p className="text-gray-500 dark:text-gray-400">متابعة الحالات والمعامل المفتوحة</p>
                </div>
            </div>

            {/* Quick Actions Bar */}
            <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-wrap gap-4 items-center">
                <span className="font-bold text-gray-700 dark:text-gray-300 ml-2">إجراءات سريعة:</span>

                {(user?.role === 'admin' || user?.role === 'representative') && (
                    <button onClick={() => navigate('/orders')} className="flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-xl transition-colors font-medium text-sm">
                        <PlusCircle size={18} />
                        <span>أوردر جديد</span>
                    </button>
                )}

                {(user?.role === 'admin' || user?.role === 'representative') && (
                    <button onClick={() => navigate('/doctors')} className="flex items-center gap-2 px-4 py-2 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 rounded-xl transition-colors font-medium text-sm">
                        <UserPlus size={18} />
                        <span>إضافة طبيب</span>
                    </button>
                )}

                {(user?.role === 'admin' || user?.role === 'accountant') && (
                    <>
                        <button onClick={() => navigate('/finance')} className="flex items-center gap-2 px-4 py-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40 rounded-xl transition-colors font-medium text-sm">
                            <Banknote size={18} />
                            <span>تسجيل مصروف</span>
                        </button>
                        <button onClick={() => navigate('/accounts')} className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded-xl transition-colors font-medium text-sm">
                            <FileText size={18} />
                            <span>كشف حساب</span>
                        </button>
                    </>
                )}
            </div>

            {/* Quick Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center gap-4">
                    <div className="p-3 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl"><Package size={24} /></div>
                    <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">إجمالي الحالات الجارية</p>
                        <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{activeOrders.length}</h3>
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center gap-4">
                    <div className="p-3 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-xl"><AlertTriangle size={24} /></div>
                    <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">حالات متأخرة</p>
                        <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{delayedOrders.length}</h3>
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center gap-4">
                    <div className="p-3 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-xl"><HelpCircle size={24} /></div>
                    <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">غير محدد معمل</p>
                        <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{unassignedOrders.length}</h3>
                    </div>
                </div>
            </div>

            {/* --- SECTIONS --- */}

            {/* ACCOUNTANT / ADMIN: Pending Registrations (Bibocad) */}
            {(user?.role === 'admin' || user?.role === 'accountant') && (
                (() => {
                    const pendingRegOrders = orders.filter(o => (o.status === 'Delivered' || o.status === 'Completed') && !o.isRegistered);
                    const pendingRegTx = transactions.filter(t => !t.isRegistered);

                    if (pendingRegOrders.length === 0 && pendingRegTx.length === 0) return null;

                    return (
                        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-6 mb-8">
                            <h3 className="text-indigo-800 dark:text-indigo-300 font-bold flex items-center gap-2 mb-4">
                                <CheckSquare className="text-indigo-600 dark:text-indigo-400" />
                                مهام التسجيل (Pending Registration)
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Pending Orders */}
                                {pendingRegOrders.length > 0 && (
                                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-indigo-100 dark:border-indigo-900/50 overflow-hidden">
                                        <div className="bg-indigo-100/50 dark:bg-indigo-900/40 p-3 border-b border-indigo-100 dark:border-indigo-800 font-bold text-indigo-900 dark:text-indigo-200 text-sm flex justify-between">
                                            <span>أوردرات مكتملة ({pendingRegOrders.length})</span>
                                        </div>
                                        <div className="max-h-[300px] overflow-y-auto">
                                            {pendingRegOrders.map(o => (
                                                <div key={o.id} className="p-3 border-b border-gray-50 dark:border-gray-700 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700">
                                                    <div>
                                                        <div className="font-bold text-sm text-gray-800 dark:text-gray-200">#{o.caseId} - {o.patientName}</div>
                                                        <div className="text-xs text-gray-500 dark:text-gray-400">{o.deliveryDate}</div>
                                                    </div>
                                                    <button
                                                        onClick={() => handleRegisterOrder(o.id)}
                                                        className="px-2 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 transition"
                                                    >
                                                        تسجيل
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Pending Transactions */}
                                {pendingRegTx.length > 0 && (
                                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-indigo-100 dark:border-indigo-900/50 overflow-hidden">
                                        <div className="bg-indigo-100/50 dark:bg-indigo-900/40 p-3 border-b border-indigo-100 dark:border-indigo-800 font-bold text-indigo-900 dark:text-indigo-200 text-sm flex justify-between">
                                            <span>معاملات مالية ({pendingRegTx.length})</span>
                                        </div>
                                        <div className="max-h-[300px] overflow-y-auto">
                                            {pendingRegTx.map(t => (
                                                <div key={t.id} className="p-3 border-b border-gray-50 dark:border-gray-700 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700">
                                                    <div>
                                                        <div className="font-bold text-sm text-gray-800 dark:text-gray-200">{t.description}</div>
                                                        <div className="text-xs text-gray-500 dark:text-gray-400">{t.amount.toLocaleString()} ج.م - {new Date(t.date).toLocaleDateString()}</div>
                                                    </div>
                                                    <button
                                                        onClick={() => handleRegisterTransaction(t.id)}
                                                        className="px-2 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 transition"
                                                    >
                                                        تسجيل
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })()
            )}

            {/* 1. Delayed Orders (ALWAYS VISIBLE IF EXISTS) */}
            {delayedOrders.length > 0 && (
                <OrderTable
                    title="⚠️ حالات متأخرة (Requires Attention)"
                    icon={AlertTriangle}
                    orders={delayedOrders}
                    colorClass="border-red-200 dark:border-red-900"
                    emptyMessage=""
                />
            )}

            {/* Rejected / Returned Orders (Admin View) */}
            {rejectedOrders.length > 0 && (
                <OrderTable
                    title="⚠️ حالات مرفوضة / مرتجعة (Rejected / Returned)"
                    icon={AlertTriangle}
                    orders={rejectedOrders}
                    colorClass="border-red-200 dark:border-red-900"
                    emptyMessage=""
                />
            )}

            {/* 2. Unassigned Orders */}
            <OrderTable
                title="حالات لم يتم تحديد معمل لها (Unassigned)"
                icon={HelpCircle}
                orders={unassignedOrders}
                colorClass="border-orange-200 dark:border-orange-900"
                emptyMessage="ممتاز! لا توجد حالات معلقة."
            />

            {/* 3. Suppliers Orders (Loop) */}
            {suppliers.length > 0 ? (
                suppliers.map(supplier => {
                    const supOrders = supplierOrdersMap[supplier.id] || [];
                    return (
                        <OrderTable
                            key={supplier.id}
                            title={`معمل: ${supplier.name}`}
                            icon={Building2}
                            orders={supOrders}
                            colorClass="border-blue-100 dark:border-blue-900"
                            emptyMessage="لا توجد حالات جارية حالياً"
                        />
                    );
                })
            ) : (
                <div className="p-8 text-center bg-gray-50 dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
                    <p className="text-gray-500 dark:text-gray-400">لا يوجد موردين خارجيين مضافين للنظام</p>
                </div>
            )}
        </div>
    );
}
