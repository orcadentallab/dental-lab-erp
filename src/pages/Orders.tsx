import { useState, useEffect } from 'react';
import OrderList from '../components/orders/OrderList';
import OrderForm from '../components/orders/OrderForm';
import { db } from '../services/db';
import { Plus, X, Search, Filter, Send, MessageCircle, FileSpreadsheet, Printer } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { exportToExcelWithHeaders, printTable } from '../lib/exportUtils';

export default function Orders() {
    const { user } = useAuth();
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // Data State
    const [orders, setOrders] = useState<any[]>([]);
    const [doctors, setDoctors] = useState<any[]>([]);
    const [suppliers, setSuppliers] = useState<any[]>([]);

    // Filter State
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [doctorFilter, setDoctorFilter] = useState('');
    const [supplierFilter, setSupplierFilter] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // Toggle Options
    const [hideDelivered, setHideDelivered] = useState(false);

    // Edit State (Admin - Full Edit)
    const [fullEditingOrder, setFullEditingOrder] = useState<any | null>(null);

    // Note State (Chat Log)
    const [noteEditingOrder, setNoteEditingOrder] = useState<any | null>(null);
    const [newComment, setNewComment] = useState('');

    const refreshOrders = async () => {
        setIsLoading(true);
        try {
            const [ordersData, doctorsData, suppliersData] = await Promise.all([
                db.getOrders(),
                db.getDoctors(),
                db.getSuppliers()
            ]);
            setOrders(ordersData);
            setDoctors(doctorsData);
            setSuppliers(suppliersData);
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        refreshOrders();
    }, []);

    // Filter Logic
    const rbacFilteredOrders = orders.filter(order => {
        if (user?.role === 'lab') {
            return user.entityId && order.supplierId === user.entityId;
        }

        return true;
    });

    const filteredOrders = rbacFilteredOrders.filter(order => {
        const matchesSearch =
            (order.caseId && order.caseId.toLowerCase().includes(searchQuery.toLowerCase())) ||
            (order.patientName && order.patientName.toLowerCase().includes(searchQuery.toLowerCase()));

        // STRICT MATCH for Status
        const matchesStatus = statusFilter ? order.status === statusFilter : true;

        const matchesDoctor = doctorFilter ? order.doctorId === doctorFilter : true;
        const matchesSupplier = supplierFilter ? order.supplierId === supplierFilter : true;

        // Date Logic
        let matchesDate = true;
        if (startDate || endDate) {
            const orderDate = new Date(order.createdAt);
            // Reset times for accurate date-only comparison
            orderDate.setHours(0, 0, 0, 0);

            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                if (orderDate < start) matchesDate = false;
            }

            if (endDate) {
                const end = new Date(endDate);
                end.setHours(0, 0, 0, 0);
                if (orderDate > end) matchesDate = false;
            }
        }

        // Hide Delivered/Rejected Check
        const matchesDelivered = hideDelivered ? (order.status !== 'Delivered' && order.status !== 'Returned for Adjustments' && order.technicianStatus !== 'Rejected') : true;

        return matchesSearch && matchesStatus && matchesDoctor && matchesSupplier && matchesDelivered && matchesDate;
    });

    const handleCreateOrder = async (orderData: any) => {
        try {
            await db.addOrder(orderData);
            setIsFormOpen(false);
            await refreshOrders();
        } catch (error) {
            console.error('Error creating order:', error);
        }
    };

    const handleUpdateOrder = async (orderData: any) => {
        if (!fullEditingOrder) return;
        try {
            await db.updateOrder(fullEditingOrder.id, orderData);
            setFullEditingOrder(null);
            await refreshOrders();
        } catch (error) {
            console.error('Error updating order:', error);
        }
    };

    const handleStatusUpdate = async (id: string, status: string) => {
        if (status === 'same') {
            await refreshOrders();
            return;
        }
        try {
            await db.updateOrder(id, { status: status as any });
            await refreshOrders();
        } catch (error: any) {
            console.error('Error updating status:', error);
            alert(`فشل تحديث الحالة: ${error.message || 'حدث خطأ غير متوقع'}`);
        }
    };

    const handleDeleteOrder = async (order: any) => {
        try {
            await db.deleteOrder(order.id);
            // alert('Order deleted successfully');
            await refreshOrders();
        } catch (error) {
            console.error('Error deleting order:', error);
            alert('Failed to delete order');
        }
    };

    const openFullEdit = (order: any) => {
        setFullEditingOrder(order);
    };

    const openAddNote = (order: any) => {
        setNoteEditingOrder(order);
        setNewComment('');
    };

    // Add Comment
    const handleAddComment = async () => {
        if (!noteEditingOrder || !newComment.trim()) return;

        const timestamp = new Date().toISOString();
        const commentObj = {
            id: Math.random().toString(36).substr(2, 9),
            text: newComment,
            userId: user?.id || 'unknown',
            userName: user?.name || user?.role || 'مستخدم',
            createdAt: timestamp
        };

        const updatedComments = [...(noteEditingOrder.comments || []), commentObj];

        try {
            await db.updateOrder(noteEditingOrder.id, { comments: updatedComments });
            setNoteEditingOrder((prev: any) => ({ ...prev, comments: updatedComments }));
            setNewComment('');
            await refreshOrders();
        } catch (error) {
            console.error('Error adding comment:', error);
        }
    };

    // Helpers
    const canFilterByDoctorAndSupplier = user?.role === 'admin' || user?.role === 'representative';

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">جاري تحميل البيانات...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">إدارة الأوردرات</h1>
                    <p className="text-gray-500 mt-1">إنشاء ومتابعة طلبات المعمل</p>
                </div>
                {(user?.role === 'admin' || user?.role === 'representative') && (
                    <button
                        onClick={() => setIsFormOpen(true)}
                        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl hover:bg-blue-700 transition-colors shadow-sm shadow-blue-200"
                    >
                        <Plus size={20} />
                        <span>أوردر جديد</span>
                    </button>
                )}
                <div className="flex gap-2">
                    {['admin', 'accountant', 'lab'].includes(user?.role || '') && (
                        <>
                            <button
                                onClick={() => {
                                    const exportData = filteredOrders.map(order => ({
                                        'رقم الحالة': order.caseId,
                                        'الطبيب': doctors.find((d: any) => d.id === order.doctorId)?.name || '-',
                                        'المريض': order.patientName,
                                        'الحالة': order.status,
                                        'السعر': order.totalPrice,
                                        'تاريخ التسليم': order.deliveryDate,
                                        'الأولوية': order.priority === 'Urgent' ? 'عاجل' : 'عادي'
                                    }));
                                    exportToExcelWithHeaders(exportData, {} as any, `orders_${new Date().toISOString().split('T')[0]}`);
                                }}
                                className="flex items-center gap-2 bg-green-600 text-white px-3 py-2 rounded-xl hover:bg-green-700 transition-colors"
                                title="تصدير Excel"
                            >
                                <FileSpreadsheet size={18} />
                                <span className="hidden sm:inline">Excel</span>
                            </button>
                            <button
                                onClick={() => {
                                    printTable(
                                        filteredOrders.map(order => ({
                                            caseId: order.caseId,
                                            doctor: doctors.find((d: any) => d.id === order.doctorId)?.name || '-',
                                            patient: order.patientName,
                                            status: order.status,
                                            price: order.totalPrice,
                                            date: order.deliveryDate
                                        })),
                                        [
                                            { key: 'caseId', label: 'رقم الحالة' },
                                            { key: 'doctor', label: 'الطبيب' },
                                            { key: 'patient', label: 'المريض' },
                                            { key: 'status', label: 'الحالة' },
                                            { key: 'price', label: 'السعر' },
                                            { key: 'date', label: 'تاريخ التسليم' }
                                        ],
                                        'قائمة الأوردرات'
                                    );
                                }}
                                className="flex items-center gap-2 bg-gray-600 text-white px-3 py-2 rounded-xl hover:bg-gray-700 transition-colors"
                                title="طباعة"
                            >
                                <Printer size={18} />
                                <span className="hidden sm:inline">طباعة</span>
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Filter Bar */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 space-y-4">
                <div className="flex flex-wrap gap-4 items-center">

                    {/* Search */}
                    <div className="flex-1 min-w-[200px]">
                        <div className="relative">
                            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                placeholder="بحث برقم الحالة أو اسم المريض..."
                                className="w-full pl-4 pr-10 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 placeholder:text-gray-400 text-sm"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Hide Delivered Toggle */}
                    <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 h-[42px]">
                        <input
                            type="checkbox"
                            id="hideDelivered"
                            checked={hideDelivered}
                            onChange={(e) => setHideDelivered(e.target.checked)}
                            className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                        />
                        <label htmlFor="hideDelivered" className="text-sm font-medium text-gray-700 cursor-pointer select-none">
                            إخفاء المنتهية/المرفوضة
                        </label>
                    </div>

                    {/* Status Filter - UPDATED OPTIONS */}
                    <div className="relative">
                        <select
                            className="appearance-none pl-3 pr-8 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm font-medium text-gray-700 outline-none hover:bg-gray-100 cursor-pointer min-w-[160px]"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            <option value="">🧩 كل الحالات</option>
                            <option value="New Case">✨ New Case</option>
                            <option value="Under Design">🎨 Under Design</option>
                            <option value="Waiting Dr Approval">⏳ Waiting Approval</option>
                            <option value="Under Production">⚙️ Under Production</option>
                            <option value="Try In">🦷 Try In</option>
                            <option value="Try In Approved">✅ Try In Approved</option>
                            <option value="Ready">📦 Ready</option>
                            <option value="Delivered">🚚 Delivered</option>
                            <option value="Returned for Adjustments">↩️ Returned</option>
                        </select>
                        <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
                    </div>

                    {/* Filters for Admin/Rep Only */}
                    {canFilterByDoctorAndSupplier && (
                        <>
                            <select
                                className="pl-3 pr-8 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm font-medium text-gray-700 outline-none hover:bg-gray-100 cursor-pointer max-w-[180px]"
                                value={doctorFilter}
                                onChange={(e) => setDoctorFilter(e.target.value)}
                            >
                                <option value="">👨‍⚕️ كل الأطباء</option>
                                {doctors.map(doc => (
                                    <option key={doc.id} value={doc.id}>{doc.name}</option>
                                ))}
                            </select>

                            <select
                                className="pl-3 pr-8 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm font-medium text-gray-700 outline-none hover:bg-gray-100 cursor-pointer max-w-[180px]"
                                value={supplierFilter}
                                onChange={(e) => setSupplierFilter(e.target.value)}
                            >
                                <option value="">🏢 كل الموردين</option>
                                {suppliers.map(sup => (
                                    <option key={sup.id} value={sup.id}>{sup.name}</option>
                                ))}
                            </select>
                        </>
                    )}

                    {/* Date Filter */}
                    <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                        <span className="text-sm font-medium text-gray-600">من:</span>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="bg-transparent text-sm focus:outline-none text-gray-700"
                        />
                    </div>

                    <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                        <span className="text-sm font-medium text-gray-600">إلى:</span>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="bg-transparent text-sm focus:outline-none text-gray-700"
                        />
                    </div>

                    {/* Reset Button */}
                    {(searchQuery || statusFilter || doctorFilter || supplierFilter || startDate || endDate) && (
                        <button
                            onClick={() => { setSearchQuery(''); setStatusFilter(''); setDoctorFilter(''); setSupplierFilter(''); setStartDate(''); setEndDate(''); }}
                            className="text-red-500 text-sm font-medium hover:bg-red-50 px-3 py-2 rounded-lg transition-colors border border-transparent hover:border-red-100"
                        >
                            مسح الفلتر ✕
                        </button>
                    )}
                </div>
            </div>

            <OrderList
                orders={filteredOrders}
                onStatusChange={handleStatusUpdate}
                userRole={user?.role}
                onEdit={openFullEdit}
                onAddNote={openAddNote}
                onDelete={handleDeleteOrder}
            />

            {/* Create New Order Modal */}
            {
                isFormOpen && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                        <div className="bg-white w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl">
                            <div className="p-6">
                                <div className="flex justify-between items-center mb-6">
                                    <h2 className="text-xl font-bold text-gray-800">إنشاء أوردر جديد</h2>
                                    <button onClick={() => setIsFormOpen(false)} className="text-gray-400 hover:text-gray-600">
                                        <X size={24} />
                                    </button>
                                </div>
                                <OrderForm onSubmit={handleCreateOrder} onCancel={() => setIsFormOpen(false)} />
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Full Edit Modal (Admin Only) */}
            {
                fullEditingOrder && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                        <div className="bg-white w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl">
                            <div className="p-6">
                                <div className="flex justify-between items-center mb-6">
                                    <div className='flex items-center gap-2'>
                                        <h2 className="text-xl font-bold text-gray-800">تعديل الأوردر</h2>
                                        <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-sm font-mono">#{fullEditingOrder.caseId}</span>
                                    </div>
                                    <button onClick={() => setFullEditingOrder(null)} className="text-gray-400 hover:text-gray-600">
                                        <X size={24} />
                                    </button>
                                </div>
                                <OrderForm
                                    onSubmit={handleUpdateOrder}
                                    onCancel={() => setFullEditingOrder(null)}
                                    initialData={fullEditingOrder}
                                />
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Chat/History Modal */}
            {
                noteEditingOrder && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                        <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
                            {/* Header */}
                            <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                                <div>
                                    <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                                        <MessageCircle size={20} className="text-blue-600" />
                                        سجل الملاحظات
                                    </h3>
                                    <p className="text-xs text-gray-500">الحالة #{noteEditingOrder.caseId}</p>
                                </div>
                                <button onClick={() => setNoteEditingOrder(null)}><X className="text-gray-400 hover:text-red-500" /></button>
                            </div>

                            {/* Chat Area */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/30">
                                {/* Original Instructions if any */}
                                {noteEditingOrder.instructions && (
                                    <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-3">
                                        <p className="text-xs font-bold text-yellow-800 mb-1">التعليمات الأساسية:</p>
                                        <p className="text-sm text-gray-700">{noteEditingOrder.instructions}</p>
                                    </div>
                                )}

                                {/* Comments Log */}
                                {noteEditingOrder.comments && noteEditingOrder.comments.length > 0 ? (
                                    noteEditingOrder.comments.map((comment: any) => (
                                        <div key={comment.id} className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="text-xs font-bold text-blue-600">{comment.userName}</span>
                                                <span className="text-[10px] text-gray-400">{new Date(comment.createdAt).toLocaleDateString('ar-EG')} {new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                            <p className="text-sm text-gray-800 whitespace-pre-wrap">{comment.text}</p>
                                        </div>
                                    ))
                                ) : (
                                    !noteEditingOrder.instructions && <p className="text-center text-gray-400 text-sm py-4">لا توجد ملاحظات سابقة</p>
                                )}
                            </div>

                            {/* Input Area */}
                            <div className="p-4 border-t bg-white">
                                <label className="block text-xs font-bold text-gray-700 mb-2">إضافة تعليق جديد</label>
                                <div className="flex gap-2">
                                    <textarea
                                        className="flex-1 p-3 border border-gray-200 rounded-lg h-20 focus:ring-2 focus:ring-blue-100 outline-none resize-none text-sm"
                                        value={newComment}
                                        onChange={e => setNewComment(e.target.value)}
                                        placeholder="اكتب ملاحظاتك هنا..."
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleAddComment();
                                            }
                                        }}
                                    />
                                    <button
                                        onClick={handleAddComment}
                                        className="px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center transition-colors"
                                        disabled={!newComment.trim()}
                                    >
                                        <Send size={20} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
}
