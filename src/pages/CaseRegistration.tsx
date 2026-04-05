import { useState, useEffect } from 'react';
import { useTranslation } from '../translations';
import { db } from '../services/db';
import { 
    CheckCircle2, 
    History, 
    AlertCircle, 
    Search, 
    User,
    ClipboardList,
    Layers,
    ArrowLeftRight,
    Loader2,
    MessageSquare,
    Download,
    X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import * as XLSX from 'xlsx';
import clsx from 'clsx';
import type { Order, Doctor, Supplier } from '../services/db';

export default function CaseRegistration() {
    const { t } = useTranslation();
    const { info, success, error: toastError } = useToast();
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
    const [orders, setOrders] = useState<Order[]>([]);
    const [doctors, setDoctors] = useState<Record<string, { name: string; code: string }>>({});
    const [suppliers, setSuppliers] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [doctorFilter, setDoctorFilter] = useState('');
    const [supplierFilter, setSupplierFilter] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [commentModal, setCommentModal] = useState<{ isOpen: boolean; orderId: string; text: string }>({
        isOpen: false,
        orderId: '',
        text: ''
    });
    const [isExporting, setIsExporting] = useState(false);

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                const [docs, sups] = await Promise.all([
                    db.getDoctors(),
                    db.getSuppliers()
                ]);
                
                const docMap: Record<string, { name: string; code: string }> = {};
                docs.forEach((d: Doctor) => docMap[d.id] = { name: d.name, code: d.doctorCode });
                setDoctors(docMap);

                const supMap: Record<string, string> = {};
                sups.forEach((s: Supplier) => supMap[s.id] = s.name);
                setSuppliers(supMap);

                await fetchOrders();
            } catch (error) {
                console.error('Failed to load data:', error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [activeTab]);

    const fetchOrders = async () => {
        setLoading(true);
        try {
            const statuses = ['Delivered', 'Completed', 'Returned for Adjustments', 'Rejected', 'Cancelled'];
            
            const { data } = await db.getOrders(1, 1000, {
                // Fetch recent orders, we'll filter locally for now to support complex search/filters easily
                includeArchived: true
            });

            const filtered = data.filter(order => 
                (statuses.includes(order.status) || order.isArchived) && 
                (activeTab === 'pending' ? !order.isRegistered : order.isRegistered)
            ).sort((a, b) => {
                const dateA = a.actualDeliveryDate || a.deliveryDate || a.createdAt;
                const dateB = b.actualDeliveryDate || b.deliveryDate || b.createdAt;
                return dateB.localeCompare(dateA);
            });

            setOrders(filtered);
        } catch (error) {
            console.error('Failed to fetch orders:', error);
            toastError(t.common.error);
        } finally {
            setLoading(false);
        }
    };

    const handleRegister = async (orderId: string) => {
        setProcessingId(orderId);
        try {
            await db.updateOrder(orderId, { isRegistered: true });
            success(t.common.success);
            setOrders(prev => prev.filter(o => o.id !== orderId));
            setSelectedIds(prev => prev.filter(id => id !== orderId));
        } catch (error) {
            console.error('Failed to register order:', error);
            toastError(t.common.error);
        } finally {
            setProcessingId(null);
        }
    };

    const handleBulkRegister = async () => {
        if (selectedIds.length === 0) return;
        
        setLoading(true);
        try {
            // Note: For simplicity and using existing service layer, we process in parallel
            // In a real high-scale app, a single RPC call .in('id', selectedIds) would be better
            await Promise.all(selectedIds.map(id => db.updateOrder(id, { isRegistered: true })));
            
            success(`تم تسجيل ${selectedIds.length} حالة بنجاح`);
            setOrders(prev => prev.filter(o => !selectedIds.includes(o.id)));
            setSelectedIds([]);
        } catch (error) {
            console.error('Bulk registration failed:', error);
            toastError(t.common.error);
        } finally {
            setLoading(false);
        }
    };

    const toggleSelectAll = () => {
        if (selectedIds.length === filteredOrders.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(filteredOrders.map(o => o.id));
        }
    };

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => 
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const handleSaveComment = async () => {
        if (!commentModal.orderId || !user) return;
        
        try {
            const order = orders.find(o => o.id === commentModal.orderId);
            if (!order) return;

            const newComment = {
                id: crypto.randomUUID(),
                text: commentModal.text,
                userId: user.id,
                userName: user.name,
                createdAt: new Date().toISOString()
            };

            const updatedComments = [...(order.comments || []), newComment];
            await db.updateOrder(commentModal.orderId, { comments: updatedComments });
            
            setOrders(prev => prev.map(o => 
                o.id === commentModal.orderId ? { ...o, comments: updatedComments } : o
            ));
            
            success('تم حفظ التعليق بنجاح');
            setCommentModal({ isOpen: false, orderId: '', text: '' });
        } catch (error) {
            console.error('Failed to save comment:', error);
            toastError('فشل حفظ التعليق');
        }
    };

    const handleExport = () => {
        setIsExporting(true);
        try {
            const exportData = filteredOrders.map(order => ({
                'رقم الحالة': order.caseId,
                'التاريخ': order.deliveryDate || order.createdAt.split('T')[0],
                'المريض': order.patientName,
                'الطبيب': doctors[order.doctorId]?.name || order.doctorId,
                'الخدمات': order.items.map(i => `${i.serviceType} (x${i.teethNumbers.length})`).join(', '),
                'سعر البيع': order.totalPrice,
                'التكلفة': order.cost,
                'المعمل': (order.supplierId && suppliers[order.supplierId]) || 'داخلي',
                'الحالة': t.orders.status[order.status.toLowerCase().replace(/ /g, '') as keyof typeof t.orders.status] || order.status,
                'الملاحظات': (order.comments || []).map(c => `${c.userName}: ${c.text}`).join(' | ')
            }));

            const ws = XLSX.utils.json_to_sheet(exportData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Cases');
            XLSX.writeFile(wb, `dental_cases_${new Date().toISOString().split('T')[0]}.xlsx`);
            success('تم التصدير بنجاح');
        } catch (error) {
            console.error('Export failed:', error);
            toastError('فشل تصدير الملف');
        } finally {
            setIsExporting(false);
        }
    };

    const filteredOrders = orders.filter(order => {
        const doctor = doctors[order.doctorId];
        
        const matchesSearch = 
            order.caseId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            order.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (doctor?.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (doctor?.code || '').toLowerCase().includes(searchTerm.toLowerCase());

        const matchesDoctor = !doctorFilter || order.doctorId === doctorFilter;
        const matchesSupplier = !supplierFilter || 
            (supplierFilter === 'internal' ? !order.supplierId : order.supplierId === supplierFilter);
        
        const orderDate = order.deliveryDate || (order.createdAt ? order.createdAt.split('T')[0] : '');
        const matchesDateFrom = !dateFrom || orderDate >= dateFrom;
        const matchesDateTo = !dateTo || orderDate <= dateTo;

        return matchesSearch && matchesDoctor && matchesSupplier && matchesDateFrom && matchesDateTo;
    });

    return (
        <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                        <div className="p-2 bg-cyan-100 text-cyan-600 rounded-xl">
                            <ClipboardList size={24} />
                        </div>
                        {t.registration.title}
                    </h1>
                    <p className="text-slate-500 mt-1 text-sm">
                        {activeTab === 'pending' ? 'مراجعة وتسجيل الحالات المستلمة والماليات' : 'سجل الحالات التي تم تسجيلها مسبقاً'}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {activeTab === 'pending' && selectedIds.length > 0 && (
                        <button
                            onClick={handleBulkRegister}
                            className="flex items-center gap-2 px-6 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-bold hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-200"
                        >
                            <CheckCircle2 size={18} />
                            تسجيل المحد ({selectedIds.length})
                        </button>
                    )}

                    <button
                        onClick={handleExport}
                        disabled={isExporting || filteredOrders.length === 0}
                        className="flex items-center gap-2 px-6 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-all shadow-sm disabled:opacity-50"
                    >
                        {isExporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} className="text-cyan-500" />}
                        {t.common.export}
                    </button>

                    <div className="flex items-center gap-2 bg-white p-1 rounded-2xl border border-slate-200 shadow-sm w-fit">
                        <button
                            onClick={() => setActiveTab('pending')}
                            className={clsx(
                                "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300",
                                activeTab === 'pending' 
                                    ? "bg-cyan-500 text-white shadow-lg shadow-cyan-200 scale-[1.02]" 
                                    : "text-slate-500 hover:bg-slate-50"
                            )}
                        >
                            <AlertCircle size={18} />
                            {t.registration.pending}
                            {activeTab === 'pending' && orders.length > 0 && (
                                <span className="bg-white/20 px-2 py-0.5 rounded-md text-[10px] font-bold">
                                    {orders.length}
                                </span>
                            )}
                        </button>
                        <button
                            onClick={() => setActiveTab('history')}
                            className={clsx(
                                "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300",
                                activeTab === 'history' 
                                    ? "bg-cyan-500 text-white shadow-lg shadow-cyan-200 scale-[1.02]" 
                                    : "text-slate-500 hover:bg-slate-50"
                            )}
                        >
                            <History size={18} />
                            {t.registration.history}
                        </button>
                    </div>
                </div>
            </div>

            {/* Filters & Search */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
                <div className="md:col-span-4 relative group">
                    <label className="block text-xs font-bold text-slate-400 mb-2 mr-1">البحث (حالة، مريض، طبيب)</label>
                    <div className="relative">
                        <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-cyan-500 transition-colors" size={18} />
                            <input
                                type="text"
                                title="بحث"
                                placeholder="بحث..."
                                className="w-full pr-11 pl-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all text-sm"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                    </div>
                </div>

                <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-400 mb-2 mr-1">الطبيب</label>
                    <select
                        title="فلتر الطبيب"
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/20 text-sm font-medium"
                        value={doctorFilter}
                        onChange={(e) => setDoctorFilter(e.target.value)}
                    >
                        <option value="">الكل</option>
                        {Object.entries(doctors).map(([id, doc]) => (
                            <option key={id} value={id}>{doc.name}</option>
                        ))}
                    </select>
                </div>

                <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-400 mb-2 mr-1">المعمل</label>
                    <select
                        title="فلتر المعمل"
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/20 text-sm font-medium"
                        value={supplierFilter}
                        onChange={(e) => setSupplierFilter(e.target.value)}
                    >
                        <option value="">{t.common.all}</option>
                        <option value="internal">{t.registration.internalLab}</option>
                        {Object.entries(suppliers).map(([id, name]) => (
                            <option key={id} value={id}>{name}</option>
                        ))}
                    </select>
                </div>

                <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-400 mb-2 mr-1">من تاريخ</label>
                    <input
                        type="date"
                        title="من تاريخ"
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/20 text-sm"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                    />
                </div>

                <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-400 mb-2 mr-1">إلى تاريخ</label>
                    <input
                        type="date"
                        title="إلى تاريخ"
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/20 text-sm"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                    />
                </div>
            </div>

            {/* List */}
            <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-xl shadow-slate-200/50 overflow-hidden min-h-[400px]">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-4">
                        <Loader2 className="animate-spin text-cyan-500" size={40} />
                        <p className="text-slate-400 font-medium tracking-wide">جاري تحميل البيانات...</p>
                    </div>
                ) : filteredOrders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-4">
                        <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center text-slate-300">
                            <Layers size={40} />
                        </div>
                        <div className="text-center">
                            <p className="text-slate-400 font-medium tracking-tight">لا توجد حالات في هذه القائمة</p>
                            <p className="text-slate-300 text-sm mt-1">جرب تغيير الفلاتر أو البحث عن حالات أخرى</p>
                        </div>
                    </div>
                ) : (
                    <div className="overflow-x-auto overflow-y-auto max-h-[700px]">
                        <table className="w-full text-right border-collapse">
                            <thead>
                                <tr className="bg-slate-50/80 border-b border-slate-100">
                                    <th className="px-4 py-5 w-10">
                                        <div className="flex justify-center">
                                            <input
                                                type="checkbox"
                                                title="تحديد الكل"
                                                className="w-4 h-4 rounded border-slate-300 text-cyan-500 focus:ring-cyan-500"
                                                checked={filteredOrders.length > 0 && selectedIds.length === filteredOrders.length}
                                                onChange={toggleSelectAll}
                                            />
                                        </div>
                                    </th>
                                    <th className="px-6 py-5 text-xs font-bold text-slate-400 uppercase tracking-widest leading-none">{t.registration.caseId}</th>
                                    <th className="px-6 py-5 text-sm font-extrabold text-slate-700 tracking-wide min-w-[100px]" title="تاريخ التسليم هو تاريخ الاستلام النهائي للحالة، وفي حالة عدم وجوده يظهر تاريخ إنشاء الأوردر.">
                                        تاريخ التسليم
                                        <div className="text-[10px] text-slate-400 font-normal mt-0.5">(تلقائي)</div>
                                    </th>
                                    <th className="px-6 py-5 text-sm font-extrabold text-slate-700 tracking-wide">{t.registration.patientName}</th>
                                    <th className="px-6 py-5 text-sm font-extrabold text-slate-700 tracking-wide">الطبيب</th>
                                    <th className="px-6 py-5 text-sm font-extrabold text-slate-700 tracking-wide min-w-[180px]">{t.registration.services}</th>
                                    <th className="px-6 py-5 text-sm font-extrabold text-slate-700 tracking-wide min-w-[150px]">الأسعار (بيع/تكلفة)</th>
                                    <th className="px-6 py-5 text-sm font-extrabold text-slate-700 tracking-wide min-w-[140px]">المعمل الخارجي</th>
                                    <th className="px-6 py-5 text-sm font-extrabold text-slate-700 tracking-wide min-w-[140px]">{t.registration.status}</th>
                                    <th className="px-6 py-5 text-sm font-extrabold text-slate-700 tracking-wide sticky left-0 bg-slate-50 z-10 text-center">{t.common.actions}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filteredOrders.map((order) => {
                                    const dateStr = order.deliveryDate || (order.createdAt ? order.createdAt.split('T')[0] : '');
                                    const formattedDate = dateStr ? dateStr.split('-').slice(1).join('-') : '-'; // MM-DD
                                    
                                    return (
                                        <motion.tr
                                            layout
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            key={order.id}
                                            className={clsx(
                                                "hover:bg-cyan-50/40 transition-colors group border-b border-slate-50",
                                                selectedIds.includes(order.id) && "bg-cyan-50/60",
                                                activeTab === 'pending' && order.comments?.some(c => c.text.includes('بعد التسجيل المحاسبي')) && "bg-cyan-50/20 border-r-4 border-r-cyan-500",
                                                order.status === 'Rejected' && "bg-red-50/10",
                                                order.status === 'Returned for Adjustments' && "bg-amber-50/10"
                                            )}
                                        >
                                            <td className="px-4 py-4">
                                                <div className="flex justify-center">
                                                    <input
                                                        type="checkbox"
                                                        title="تحديد"
                                                        className="w-4 h-4 rounded border-slate-300 text-cyan-500 focus:ring-cyan-500"
                                                        checked={selectedIds.includes(order.id)}
                                                        onChange={() => toggleSelect(order.id)}
                                                    />
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-slate-400 text-[10px] group-hover:text-cyan-600 transition-colors tracking-tighter">#{order.caseId}</span>
                                                    <div className="flex items-center gap-1 mt-0.5">
                                                        <span className="text-[9px] text-slate-300 font-mono">{order.id.split('-')[0]}</span>
                                                        {activeTab === 'pending' && order.comments?.some(c => c.text.includes('بعد التسجيل المحاسبي')) && (
                                                            <span className="px-1.5 py-0.5 bg-cyan-500 text-white text-[8px] font-black rounded uppercase tracking-tighter animate-pulse">
                                                                {t.registration.changesDetected || 'تعديل'}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2 text-slate-900 font-black text-xs bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 whitespace-nowrap">
                                                    <History size={13} className="text-slate-400" />
                                                    {formattedDate}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <User size={15} className="text-cyan-500" />
                                                    <span className="font-black text-slate-900 text-[15px] leading-tight block">{order.patientName}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-sm text-slate-700 font-black leading-tight">
                                                        {doctors[order.doctorId]?.name || order.doctorId}
                                                    </span>
                                                    {doctors[order.doctorId]?.code && (
                                                        <span className="text-[10px] bg-slate-800 text-white px-1.5 py-0.5 rounded shadow-sm font-mono font-bold w-fit">
                                                            #{doctors[order.doctorId].code}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-wrap gap-1.5 max-w-[220px]">
                                                    {order.items.map((item, idx) => (
                                                        <span 
                                                            key={idx}
                                                            className="px-2.5 py-1 bg-white text-xs font-black text-slate-800 rounded-lg border border-slate-200 shadow-sm flex items-center gap-1.5 whitespace-nowrap"
                                                        >
                                                            {item.serviceType} <span className="text-cyan-600 font-bold">×{item.teethNumbers.length}</span>
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-1 bg-slate-50/50 p-2 rounded-xl border border-slate-100 w-fit">
                                                    <div className="flex items-center justify-between gap-3 font-black text-emerald-600 text-sm">
                                                        <span className="text-[10px] text-slate-400 font-bold">بيع:</span>
                                                        <span>{order.totalPrice.toLocaleString()}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between gap-3 font-black text-slate-700 text-sm">
                                                        <span className="text-[10px] text-slate-400 font-bold">تكلفة:</span>
                                                        <span>{order.cost.toLocaleString()}</span>
                                                    </div>
                                                    {order.discount > 0 && (
                                                        <span className="text-[10px] text-red-500 font-black bg-red-50 px-1.5 py-0.5 rounded">خصم: {order.discount.toLocaleString()}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2 font-black text-slate-900 text-xs">
                                                    <span className="whitespace-nowrap max-w-[120px] truncate">
                                                        {(order.supplierId && suppliers[order.supplierId]) || (order.supplierId === 'internal' ? 'داخلي' : 'داخلي')}
                                                    </span>
                                                    {order.status === 'Rejected' && order.rejectedLabCost !== undefined && (
                                                        <div className="flex items-center gap-1 px-2 py-1 bg-amber-500 text-white rounded-lg text-[10px] font-black shadow-lg shadow-amber-200 border border-amber-600 animate-bounce">
                                                            <AlertCircle size={10} />
                                                            <span>خصم: {order.rejectedLabCost}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex">
                                                    <span className={clsx(
                                                        "px-2.5 py-1 rounded-xl text-[9px] font-black border uppercase tracking-wider whitespace-nowrap inline-flex items-center justify-center",
                                                        order.status === 'Delivered' ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                                                        order.status === 'Rejected' ? "bg-red-50 text-red-700 border-red-200" :
                                                        order.status === 'Returned for Adjustments' ? "bg-amber-50 text-amber-700 border-amber-200" :
                                                        "bg-cyan-50 text-cyan-700 border-cyan-200 shadow-sm shadow-cyan-100"
                                                    )}>
                                                        {t.orders.status[order.status.toLowerCase().replace(/ /g, '') as keyof typeof t.orders.status] || order.status}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 sticky left-0 bg-white group-hover:bg-cyan-50/40 z-10 transition-colors">
                                                <div className="flex items-center justify-center gap-2">
                                                    {activeTab === 'pending' ? (
                                                        <button
                                                            onClick={() => handleRegister(order.id)}
                                                            disabled={processingId === order.id}
                                                            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-2xl text-xs font-black transition-all shadow-lg shadow-emerald-200/50 hover:-translate-y-0.5 whitespace-nowrap"
                                                        >
                                                            {processingId === order.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={16} />}
                                                            {t.registration.markAsRegistered}
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => {
                                                                 // Logic to reset to pending for review
                                                                 db.updateOrder(order.id, { isRegistered: false });
                                                                 setOrders(prev => prev.filter(o => o.id !== order.id));
                                                                 info('تمت إعادة الحالة للمراجعة');
                                                            }}
                                                            className="p-3 text-slate-400 hover:text-cyan-600 hover:bg-white hover:shadow-md rounded-2xl transition-all"
                                                            title="إعادة للمراجعة"
                                                        >
                                                            <ArrowLeftRight size={20} />
                                                        </button>
                                                    )}
                                                    
                                                    <button
                                                        onClick={() => setCommentModal({
                                                            isOpen: true,
                                                            orderId: order.id,
                                                            text: order.comments?.[order.comments.length - 1]?.text || ''
                                                        })}
                                                        className={clsx(
                                                            "p-3 rounded-2xl transition-all relative group",
                                                            order.comments && order.comments.length > 0 
                                                                ? "text-cyan-600 bg-cyan-50" 
                                                                : "text-slate-400 hover:text-cyan-600 hover:bg-cyan-50"
                                                        )}
                                                        title="ملاحظات المحاسب"
                                                    >
                                                        <MessageSquare size={20} />
                                                        {order.comments && order.comments.length > 0 && (
                                                            <span className="absolute top-2 right-2 w-2 h-2 bg-cyan-500 rounded-full border-2 border-white" />
                                                        )}
                                                        
                                                        {/* Tooltip for latest comment */}
                                                        {order.comments && order.comments.length > 0 && (
                                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-800 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl">
                                                                <span className="font-bold block mb-1">{order.comments[order.comments.length - 1].userName}</span>
                                                                {order.comments[order.comments.length - 1].text}
                                                            </div>
                                                        )}
                                                    </button>
                                                </div>
                                            </td>
                                        </motion.tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Comment Modal */}
            <AnimatePresence>
                {commentModal.isOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setCommentModal({ isOpen: false, orderId: '', text: '' })}
                            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="relative w-full max-w-md bg-white rounded-[2rem] shadow-2xl overflow-hidden"
                        >
                            <div className="p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3">
                                        <div className="p-2 bg-cyan-100 text-cyan-600 rounded-xl">
                                            <MessageSquare size={20} />
                                        </div>
                                        ملاحظات المحاسب للمراجعة
                                    </h3>
                                    <button 
                                        onClick={() => setCommentModal({ isOpen: false, orderId: '', text: '' })}
                                        className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                                        title="إغلاق"
                                    >
                                        <X size={20} className="text-slate-400" />
                                    </button>
                                </div>

                                <textarea
                                    value={commentModal.text}
                                    onChange={(e) => setCommentModal(prev => ({ ...prev, text: e.target.value }))}
                                    placeholder="اكتب ملاحظاتك للمراجعة كحالة مالية أو إدارية..."
                                    className="w-full h-40 p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all text-sm resize-none"
                                />

                                <div className="flex gap-3 mt-6">
                                    <button
                                        onClick={handleSaveComment}
                                        className="flex-1 py-3 bg-cyan-500 text-white rounded-xl font-bold hover:bg-cyan-600 shadow-lg shadow-cyan-200 transition-all"
                                    >
                                        حفظ الملاحظة
                                    </button>
                                    <button
                                        onClick={() => setCommentModal({ isOpen: false, orderId: '', text: '' })}
                                        className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all"
                                    >
                                        إغلاق
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
