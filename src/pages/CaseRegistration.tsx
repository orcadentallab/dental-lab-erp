import { useState, useEffect, useCallback } from 'react';
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
import type { AccountingReviewChange, Order, Doctor, Supplier, User as DbUser } from '../services/db';
import { filterVisibleOrderComments, getLatestVisibleOrderComment } from '../utils/orderDisplay';
import { isDateInOpenRange } from '../utils/dateRange';
import { hasCustomPermission, FIXED_SALARY_DESIGNER_PERMISSION } from '../lib/userRoles';
import { getLabCostMetadata } from '../constants/financialObligations';
import {
    hasPostRegistrationChange,
    hasZeroAccountingImpact,
    getAccountingComparison,
    getMissingAccountingDecisions,
    isAccountingFinanciallyReady,
    isAccountingRegistrationCandidate,
} from '../constants/accountingRegistration';
import type { AccountingReviewType } from '../services/db';

const normalizeArabic = (text: string) => {
    if (!text) return '';
    return text
        .replace(/[أإآ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[\u064B-\u0652]/g, '') // remove diacritics
        .trim()
        .toLowerCase();
};

const REVIEW_LABELS: Record<AccountingReviewType, string> = {
    new: 'تسجيل جديد',
    change: 'تعديل',
    cancellation: 'إلغاء قيد',
};
const REVIEW_TYPES: AccountingReviewType[] = ['new', 'change', 'cancellation'];

const REVIEW_BADGE_CLASSES: Record<AccountingReviewType, string> = {
    new: 'bg-emerald-500 text-white',
    change: 'bg-cyan-500 text-white',
    cancellation: 'bg-rose-500 text-white',
};

// Keep the operational state readable here without exposing database enum values.
// A redo is deliberately distinct from a doctor rejection even when its source
// order was originally returned by the doctor.
const getOrderStatusPresentation = (order: Order, fallbackLabel: string) => {
    if (order.issueState === 'redo') {
        return { label: 'إعادة إنتاج', className: 'bg-violet-50 text-violet-700 border-violet-200' };
    }

    if (order.status === 'Doctor Rejected' || order.status === 'Rejected') {
        return { label: 'مرتجع طبيب', className: 'bg-amber-50 text-amber-700 border-amber-200' };
    }

    if (order.status === 'Lab Rejected') {
        return { label: 'رفض معمل', className: 'bg-rose-50 text-rose-700 border-rose-200' };
    }

    if (order.status === 'Delivered') {
        return { label: 'تم التسليم', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    }

    if (order.status === 'Cancelled') {
        return { label: 'ملغي', className: 'bg-rose-50 text-rose-700 border-rose-200' };
    }

    if (order.status === 'Returned for Adjustments') {
        return { label: 'مرتجع للتعديل', className: 'bg-amber-50 text-amber-700 border-amber-200' };
    }

    return { label: fallbackLabel, className: 'bg-cyan-50 text-cyan-700 border-cyan-200' };
};

export default function CaseRegistration() {
    const { t } = useTranslation();
    const { info, success, error: toastError } = useToast();
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
    const [orders, setOrders] = useState<Order[]>([]);
    const [doctors, setDoctors] = useState<Record<string, { name: string; code: string; parentId?: string }>>({});
    const [suppliers, setSuppliers] = useState<Record<string, string>>({});
    const [designers, setDesigners] = useState<DbUser[]>([]);
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
    const [auditTimeline, setAuditTimeline] = useState<{ orderId: string; rows: AccountingReviewChange[] } | null>(null);

    const openAuditTimeline = async (orderId: string) => {
        try {
            setAuditTimeline({ orderId, rows: await db.getAccountingReviewChanges(orderId) });
        } catch (error) {
            console.error('Failed to load accounting audit timeline:', error);
            toastError('تعذر تحميل سجل التعديلات المحاسبية');
        }
    };

    const fetchOrders = useCallback(async () => {
        setLoading(true);
        try {
            const allOrders = await db.getOrdersForAccountingRegistration();
            const filtered = allOrders.filter(order =>
                isAccountingRegistrationCandidate(order, activeTab)
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
    }, [activeTab, t.common.error, toastError]);

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                const [docs, sups, users] = await Promise.all([
                    db.getDoctors(),
                    db.getSuppliers(),
                    db.getUsers()
                ]);
                
                const docMap: Record<string, { name: string; code: string; parentId?: string }> = {};
                docs.forEach((d: Doctor) => docMap[d.id] = { name: d.name, code: d.doctorCode, parentId: d.parentId });
                setDoctors(docMap);

                const supMap: Record<string, string> = {};
                sups.forEach((s: Supplier) => supMap[s.id] = s.name);
                setSuppliers(supMap);

                setDesigners(users.filter((u: DbUser) => u.role === 'designer' || (u.customPermissions && u.customPermissions['secondary_designer'])));

                await fetchOrders();
            } catch (error) {
                console.error('Failed to load data:', error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [activeTab, fetchOrders]);

    const handleRegister = async (orderId: string) => {
        const order = orders.find(candidate => candidate.id === orderId);
        if (order && !isAccountingFinanciallyReady(order)) {
            toastError(`لا يمكن الاعتماد قبل حسم: ${getMissingAccountingDecisions(order).join('، ')}`);
            return;
        }
        const isCancellation = order?.status === 'Cancelled';
        setProcessingId(orderId);
        try {
            await db.updateOrder(orderId, { isRegistered: true });
            success(isCancellation ? 'تم تأكيد إلغاء القيد المحاسبي' : t.common.success);
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
            const selectedOrders = orders.filter(order => selectedIds.includes(order.id));
            const blocked = selectedOrders.filter(order => !isAccountingFinanciallyReady(order));
            if (blocked.length > 0) {
                throw new Error(`توجد ${blocked.length} حالات بقرارات مالية معلقة`);
            }
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
        if (selectedIds.length === bulkSelectableOrders.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(bulkSelectableOrders.map(o => o.id));
        }
    };

    const toggleSelect = (id: string) => {
        const selectedOrder = orders.find(order => order.id === id);
        if (activeTab === 'pending' && selectedOrder?.status === 'Cancelled') return;
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
            const exportData = filteredOrders.map(order => {
                const designer = designers.find(d => d.id === order.designerId);
                const isSalaried = designer ? hasCustomPermission(designer, FIXED_SALARY_DESIGNER_PERMISSION) : false;
                const labCost = getLabCostMetadata(order, isSalaried).cost;
                const isZeroImpact = hasZeroAccountingImpact(order);

                return {
                    'رقم الحالة': order.caseId,
                    'التاريخ': order.deliveryDate || order.createdAt.split('T')[0],
                    'المريض': order.patientName,
                    'الطبيب': getBillingDoctor(order.doctorId).name,
                    'الخدمات': order.items.map(i => `${i.serviceType} (x${i.teethNumbers.length})`).join(', '),
                    'سعر البيع': isZeroImpact ? 0 : order.totalPrice,
                    'التكلفة': isZeroImpact ? 0 : ((order.status === 'Doctor Rejected' || order.status === 'Rejected') ? (order.rejectedLabCost || 0) : labCost),
                    'المعمل': (order.supplierId && suppliers[order.supplierId]) || 'داخلي',
                    'الحالة': (() => {
                        const statusMap: Record<string, string> = t.orders.status;
                        const key = order.status.toLowerCase().replace(/ /g, '');
                        return statusMap[key] || order.status;
                    })(),
                    'الملاحظات': (order.comments || []).map(c => `${c.userName}: ${c.text}`).join(' | ')
                };
            });

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

    const getBillingDoctor = (doctorId: string) => {
        const doctor = doctors[doctorId];
        const parentDoctor = doctor?.parentId ? doctors[doctor.parentId] : undefined;
        return {
            id: doctor?.parentId || doctorId,
            name: parentDoctor?.name || doctor?.name || doctorId,
            code: parentDoctor?.code || doctor?.code || ''
        };
    };

    const filteredOrders = orders.filter(order => {
        const doctor = doctors[order.doctorId];
        const billingDoctor = getBillingDoctor(order.doctorId);
        
        const normalizedSearch = normalizeArabic(searchTerm);
        const matchesSearch = 
            normalizeArabic(order.caseId).includes(normalizedSearch) ||
            normalizeArabic(order.patientName).includes(normalizedSearch) ||
            normalizeArabic(doctor?.name || '').includes(normalizedSearch) ||
            normalizeArabic(doctor?.code || '').includes(normalizedSearch) ||
            normalizeArabic(billingDoctor.name).includes(normalizedSearch) ||
            normalizeArabic(billingDoctor.code).includes(normalizedSearch);

        const matchesDoctor = !doctorFilter || order.doctorId === doctorFilter || billingDoctor.id === doctorFilter;
        const matchesSupplier = !supplierFilter || 
            (supplierFilter === 'internal' ? !order.supplierId : order.supplierId === supplierFilter);
        
        const orderDate = order.deliveryDate || (order.createdAt ? order.createdAt.split('T')[0] : '');
        const matchesDate = isDateInOpenRange(orderDate, { start: dateFrom, end: dateTo });

        return matchesSearch && matchesDoctor && matchesSupplier && matchesDate;
    });
    const bulkSelectableOrders = filteredOrders.filter(order =>
        !(activeTab === 'pending' && order.status === 'Cancelled')
    );
    const reviewCounts = orders.reduce<Record<AccountingReviewType, number>>((counts, order) => {
        const type = getAccountingComparison(order).type;
        counts[type] += 1;
        return counts;
    }, { new: 0, change: 0, cancellation: 0 });
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
                    <div className="mt-3 flex flex-wrap gap-2">
                        {REVIEW_TYPES.map(type => (
                            <span key={type} className={clsx('rounded-full px-2.5 py-1 text-[10px] font-black', REVIEW_BADGE_CLASSES[type])}>
                                {REVIEW_LABELS[type]}: {reviewCounts[type]}
                            </span>
                        ))}
                    </div>
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

            {activeTab === 'pending' && reviewCounts.cancellation > 0 && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-800 shadow-sm">
                    يوجد {reviewCounts.cancellation} إلغاء قيد يحتاج مراجعة منفصلة. القيم الجديدة صفر، والفرق السالب هو المبلغ المطلوب حذفه من البرنامج المحاسبي.
                </div>
            )}

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
                    <div className="overflow-x-auto xl:overflow-x-hidden overflow-y-auto max-h-[700px]">
                        <table className="w-full min-w-[720px] xl:min-w-0 table-fixed text-right border-collapse">
                            <thead>
                                <tr className="bg-slate-50/80 border-b border-slate-100">
                                    <th className="px-4 py-5 w-10">
                                        <div className="flex justify-center">
                                            <input
                                                type="checkbox"
                                                title="تحديد الكل"
                                                className="w-4 h-4 rounded border-slate-300 text-cyan-500 focus:ring-cyan-500"
                                                checked={bulkSelectableOrders.length > 0 && selectedIds.length === bulkSelectableOrders.length}
                                                disabled={bulkSelectableOrders.length === 0}
                                                onChange={toggleSelectAll}
                                            />
                                        </div>
                                    </th>
                                    <th className="w-[180px] px-4 py-5 text-xs font-bold text-slate-400 uppercase tracking-widest leading-none">{t.registration.caseId}</th>
                                    <th className="hidden" title="تاريخ التسليم هو تاريخ الاستلام النهائي للحالة، وفي حالة عدم وجوده يظهر تاريخ إنشاء الأوردر.">
                                        تاريخ التسليم
                                        <div className="text-[10px] text-slate-400 font-normal mt-0.5">(تلقائي)</div>
                                    </th>
                                    <th className="w-[125px] px-4 py-5 text-sm font-extrabold text-slate-700 tracking-wide">{t.registration.patientName}</th>
                                    <th className="w-[155px] px-4 py-5 text-sm font-extrabold text-slate-700 tracking-wide">الطبيب / المعمل</th>
                                    <th className="w-[180px] px-4 py-5 text-sm font-extrabold text-slate-700 tracking-wide">{t.registration.services}</th>
                                    <th className="w-[205px] px-4 py-5 text-sm font-extrabold text-slate-700 tracking-wide">الأسعار (بيع/تكلفة)</th>
                                    <th className="hidden">المعمل الخارجي</th>
                                    <th className="hidden">{t.registration.status}</th>
                                    <th className="w-[155px] px-3 py-5 text-sm font-extrabold text-slate-700 tracking-wide sticky left-0 bg-slate-50 z-10 text-center">{t.common.actions}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filteredOrders.map((order) => {
                                    const dateStr = order.deliveryDate || (order.createdAt ? order.createdAt.split('T')[0] : '');
                                    const formattedDate = dateStr ? dateStr.split('-').slice(1).join('-') : '-'; // MM-DD
                                    const billingDoctor = getBillingDoctor(order.doctorId);
                                    const visibleComments = filterVisibleOrderComments(order.comments);
                                    const latestComment = getLatestVisibleOrderComment(order.comments);
                                    const isChangedAfterRegistration = hasPostRegistrationChange(order);
                                    const isZeroImpact = hasZeroAccountingImpact(order);
                                    const accounting = getAccountingComparison(order);
                                    const hasFinancialComparison = accounting.type !== 'new';
                                    const oldSnapshot = accounting.previous;
                                    const oldDoctorName = oldSnapshot?.doctorId ? getBillingDoctor(oldSnapshot.doctorId).name : null;
                                    const oldSupplierName = oldSnapshot?.supplierId ? suppliers[oldSnapshot.supplierId] : 'داخلي';
                                    const statusKey = order.status.toLowerCase().replace(/ /g, '');
                                    const statusLabel = Object.entries(t.orders.status).find(([key]) => key === statusKey)?.[1] || order.status;
                                    const statusPresentation = getOrderStatusPresentation(order, statusLabel);
                                    
                                    return (
                                        <motion.tr
                                            layout
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            key={order.id}
                                            className={clsx(
                                                "hover:bg-cyan-50/40 transition-colors group border-b border-slate-50",
                                                selectedIds.includes(order.id) && "bg-cyan-50/60",
                                                activeTab === 'pending' && isChangedAfterRegistration && "bg-cyan-50/20 border-r-4 border-r-cyan-500",
                                                ['Doctor Rejected', 'Lab Rejected', 'Rejected'].includes(order.status) && "bg-red-50/10",
                                                order.status === 'Cancelled' && "bg-rose-50/20 border-r-4 border-r-rose-500",
                                                order.status === 'Returned for Adjustments' && "bg-amber-50/10"
                                            )}
                                        >
                                            <td className="px-4 py-4">
                                                <div className="flex justify-center">
                                                    <input
                                                        type="checkbox"
                                                        title={activeTab === 'pending' && order.status === 'Cancelled' ? 'إلغاء القيد يحتاج تأكيدًا منفصلًا' : 'تحديد'}
                                                        className="w-4 h-4 rounded border-slate-300 text-cyan-500 focus:ring-cyan-500"
                                                        checked={selectedIds.includes(order.id)}
                                                        disabled={activeTab === 'pending' && order.status === 'Cancelled'}
                                                        onChange={() => toggleSelect(order.id)}
                                                    />
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-slate-400 text-[10px] group-hover:text-cyan-600 transition-colors tracking-tighter">#{order.caseId}</span>
                                                        <span className={clsx('rounded px-1.5 py-0.5 text-[8px] font-black', REVIEW_BADGE_CLASSES[accounting.type])}>
                                                            {REVIEW_LABELS[accounting.type]}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1 mt-0.5">
                                                        <span className="text-[9px] text-slate-300 font-mono">{order.id.split('-')[0]}</span>
                                                    </div>
                                                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] font-black text-slate-600">
                                                        <span className="rounded bg-slate-100 px-1.5 py-0.5">{formattedDate}</span>
                                                        <span className={clsx('rounded border px-1.5 py-0.5', statusPresentation.className)}>{statusPresentation.label}</span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="hidden px-4 py-4">
                                                <div className="flex items-center gap-2 text-slate-900 font-black text-xs bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 whitespace-nowrap">
                                                    <History size={13} className="text-slate-400" />
                                                    {formattedDate}
                                                </div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <div className="flex items-center gap-2">
                                                    <User size={15} className="text-cyan-500" />
                                                    <span className="font-black text-slate-900 text-[15px] leading-tight block">{order.patientName}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-sm text-slate-800 font-black leading-tight">{billingDoctor.name}</span>
                                                    {billingDoctor.code && (
                                                        <span className="text-[10px] bg-slate-800 text-white px-1.5 py-0.5 rounded shadow-sm font-mono font-bold w-fit">
                                                            #{billingDoctor.code}
                                                        </span>
                                                    )}
                                                    <span className="mt-1 text-xs font-black text-slate-700 truncate">
                                                        {(order.supplierId && suppliers[order.supplierId]) || 'داخلي'}
                                                    </span>
                                                    {hasFinancialComparison && oldDoctorName && oldSnapshot?.doctorId !== order.doctorId && (
                                                        <span className="text-[10px] font-bold text-amber-600">الطبيب السابق: {oldDoctorName}</span>
                                                    )}
                                                    {hasFinancialComparison && oldSnapshot && oldSnapshot.supplierId !== (order.supplierId || null) && (
                                                        <span className="text-[10px] font-bold text-amber-600">المعمل السابق: {oldSupplierName || oldSnapshot.supplierId}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <div className="flex flex-wrap gap-1.5 max-w-[180px]">
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
                                            <td className="px-4 py-4">
                                                <div className={clsx('min-w-[160px] rounded-xl border p-2 text-sm font-black', isZeroImpact ? 'border-rose-200 bg-rose-50/60' : 'border-slate-100 bg-slate-50/50')}>
                                                    <div className="flex items-center justify-between gap-3 text-emerald-600">
                                                        <span className="text-[10px] font-bold text-slate-400">سعر الطبيب:</span>
                                                        <span className={isZeroImpact ? 'text-rose-600' : undefined}>{accounting.current.saleAmount.toLocaleString('en-EG')}</span>
                                                    </div>
                                                    <div className="mt-1 flex items-center justify-between gap-3 text-slate-700">
                                                        <span className="text-[10px] font-bold text-slate-400">سعر المورد:</span>
                                                        <span className={isZeroImpact ? 'text-rose-600' : undefined}>{accounting.current.labCost.toLocaleString('en-EG')}</span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="hidden px-4 py-4">
                                                <div className="flex items-center gap-2 font-black text-slate-900 text-xs">
                                                    <span className="whitespace-nowrap max-w-[120px] truncate">
                                                        {(order.supplierId && suppliers[order.supplierId]) || (order.supplierId === 'internal' ? 'داخلي' : 'داخلي')}
                                                    </span>
                                                </div>
                                                {hasFinancialComparison && oldSnapshot && oldSnapshot.supplierId !== (order.supplierId || null) && (
                                                    <span className="mt-1 block text-[10px] font-bold text-amber-600">كان: {oldSupplierName || oldSnapshot.supplierId}</span>
                                                )}
                                            </td>
                                            <td className="hidden px-4 py-4">
                                                <div className="flex">
                                                    <span className={clsx(
                                                        "px-2.5 py-1 rounded-xl text-[9px] font-black border uppercase tracking-wider whitespace-nowrap inline-flex items-center justify-center",
                                                        statusPresentation.className
                                                    )}>
                                                        {statusPresentation.label}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-3 py-4 sticky left-0 bg-white group-hover:bg-cyan-50/40 z-10 transition-colors">
                                                <div className="flex items-center justify-center gap-2">
                                                    {activeTab === 'pending' ? (
                                                        <button
                                                            onClick={() => handleRegister(order.id)}
                                                            disabled={processingId === order.id || !isAccountingFinanciallyReady(order)}
                                                            title={!isAccountingFinanciallyReady(order)
                                                                ? `معلق: ${getMissingAccountingDecisions(order).join('، ')}`
                                                                : undefined}
                                                            className={clsx(
                                                                "flex items-center gap-1.5 px-3 py-2.5 2xl:px-5 disabled:opacity-50 text-white rounded-2xl text-xs font-black transition-all hover:-translate-y-0.5 whitespace-nowrap",
                                                                order.status === 'Cancelled'
                                                                    ? "bg-rose-500 hover:bg-rose-600 shadow-lg shadow-rose-200/50"
                                                                    : "bg-emerald-500 hover:bg-emerald-600 shadow-lg shadow-emerald-200/50"
                                                            )}
                                                        >
                                                            {processingId === order.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={16} />}
                                                            {order.status === 'Cancelled' ? 'تأكيد إلغاء القيد' : t.registration.markAsRegistered}
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
                                                            text: latestComment?.text || ''
                                                        })}
                                                        className={clsx(
                                                            "p-3 rounded-2xl transition-all relative group",
                                                            visibleComments.length > 0
                                                                ? "text-cyan-600 bg-cyan-50" 
                                                                : "text-slate-400 hover:text-cyan-600 hover:bg-cyan-50"
                                                        )}
                                                        title="ملاحظات المحاسب"
                                                    >
                                                        <MessageSquare size={20} />
                                                        {visibleComments.length > 0 && (
                                                            <span className="absolute top-2 right-2 w-2 h-2 bg-cyan-500 rounded-full border-2 border-white" />
                                                        )}
                                                        
                                                        {/* Tooltip for latest comment */}
                                                        {latestComment && (
                                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-800 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl">
                                                                <span className="font-bold block mb-1">{latestComment.userName}</span>
                                                                {latestComment.text}
                                                            </div>
                                                        )}
                                                    </button>
                                                    {order.accountingReviewCycleId && (
                                                        <button
                                                            onClick={() => openAuditTimeline(order.id)}
                                                            className="p-3 text-violet-500 hover:bg-violet-50 rounded-2xl transition-all"
                                                            title="سجل التعديلات المحاسبية"
                                                        >
                                                            <History size={20} />
                                                        </button>
                                                    )}
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
                {auditTimeline && (
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                        <motion.div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setAuditTimeline(null)} />
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="relative max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
                            <div className="mb-5 flex items-center justify-between">
                                <h3 className="text-lg font-black text-slate-900">سجل التعديلات المحاسبية</h3>
                                <button onClick={() => setAuditTimeline(null)} className="rounded-full p-2 hover:bg-slate-100" title="إغلاق"><X size={20} /></button>
                            </div>
                            {auditTimeline.rows.length === 0 ? (
                                <p className="text-sm text-slate-500">لا توجد تعديلات مسجلة لهذه الدورة.</p>
                            ) : (
                                <ol className="space-y-3">
                                    {auditTimeline.rows.map(row => (
                                        <li key={row.id} className="rounded-2xl border border-slate-200 p-4">
                                            <div className="flex items-center justify-between text-xs">
                                                <strong>تعديل #{row.sequenceNo}</strong>
                                                <time className="text-slate-500">{new Date(row.createdAt).toLocaleString('ar-EG')}</time>
                                            </div>
                                            <p className="mt-2 text-xs text-slate-600">الحقول: {Object.keys(row.changedFields).join('، ') || 'غير محددة'}</p>
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

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
