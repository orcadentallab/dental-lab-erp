import CaseAttachments from '../../components/orders/CaseAttachments';
import { ACCEPTED_TYPES, SCAN_ACCEPTED_TYPES } from '../../lib/storage';
import { Link } from 'react-router-dom';
import { PICKUP_LABELS } from '../../services/doctorPortalService';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { db, type DoctorOrderSummary } from '../../services/db';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../../components/ui/Card';
import {
    Star,
    Search,
    Truck,
    MessageCircle,
    CheckCircle2,
    Clock,
    Sparkles,
    Smile,
    ShieldAlert
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/ui/Button';

type FilterTab = 'all' | 'in_progress' | 'in_delivery' | 'delivered' | 'issues';

interface StepperStage {
    key: string;
    label: string;
    description: string;
}

const ORDER_STAGES: StepperStage[] = [
    { key: 'received', label: 'استلام الطلب', description: 'مراجعة وتأكيد الحالة' },
    { key: 'design', label: 'التصميم الرقمي', description: 'CAD Design' },
    { key: 'production', label: 'التصنيع والمعالجة', description: 'خراطة وسيراميك' },
    { key: 'delivery', label: 'جاهزة للتسليم', description: 'بانتظار تنسيق التسليم' },
    { key: 'delivered', label: 'تم التسليم', description: 'وصلت للعيادة' },
];

export default function DoctorOrders() {
    const { user } = useAuth();
    const [orders, setOrders] = useState<DoctorOrderSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [filesOrderId, setFilesOrderId] = useState('');
    const { success, error: toastError } = useToast();

    // Filters and Search
    const [searchTerm, setSearchTerm] = useState('');
    const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

    // Rating Modal State
    const [ratingOrder, setRatingOrder] = useState<DoctorOrderSummary | null>(null);
    const [rating, setRating] = useState(5);
    const [feedbackNotes, setFeedbackNotes] = useState('');
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [isSubmittingRating, setIsSubmittingRating] = useState(false);

    const QUICK_FEEDBACK_TAGS = [
        'انطباق ممتاز 👌',
        'لون وتطابق دقيق 🎨',
        'تشريح طبيعي جداً 🦷',
        'تسليم سريع وفي الموعد ⚡',
        'يحتاج تعديل إطباق خفيف ✏️',
        'الكونتاكت ضيق قليلاً'
    ];

    const loadOrders = useCallback(async () => {
        if (!user?.entityId) return;
        setLoading(true);
        try {
            setOrders(await db.getMyDoctorOrders());
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, [user?.entityId]);

    useEffect(() => {
        loadOrders();
    }, [loadOrders]);

    // Handle Rating Submit
    const handleRateSubmit = async () => {
        if (!ratingOrder) return;
        setIsSubmittingRating(true);
        try {
            const combinedNotes = [
                selectedTags.length > 0 ? `[الملاحظات: ${selectedTags.join('، ')}]` : null,
                feedbackNotes.trim() || null
            ].filter(Boolean).join('\n');

            await db.submitMyOrderFeedback(ratingOrder.id, rating, combinedNotes);
            success('شكراً لتقييمك! نسعد دائماً بخدمتكم وتطوير عملنا.');
            setRatingOrder(null);
            setFeedbackNotes('');
            setSelectedTags([]);
            loadOrders();
        } catch (e: unknown) {
            console.error(e);
            toastError(e instanceof Error ? e.message : 'فشل إرسال التقييم');
        } finally {
            setIsSubmittingRating(false);
        }
    };

    const toggleFeedbackTag = (tag: string) => {
        if (selectedTags.includes(tag)) {
            setSelectedTags(selectedTags.filter(t => t !== tag));
        } else {
            setSelectedTags([...selectedTags, tag]);
        }
    };

    // Calculate Current Stage Index (0 to 4)
    const getOrderStageIndex = (order: DoctorOrderSummary): number => {
        if (order.issueState !== 'none') {
            return -1; // Special issue state
        }
        switch (order.productionStatus) {
            case 'final_delivered':
                return 4;
            case 'final_ready':
                return 3; // Ready; shipment dispatch must come from logistics data
            case 'in_production':
            case 'try_in_ready':
            case 'finalization':
                return 2; // Manufacturing
            case 'designing':
                return 1; // Design
            case 'not_started':
            default:
                return 0; // Received
        }
    };

    // Filtered orders
    const filteredOrders = useMemo(() => {
        return orders.filter(order => {
            // Search match
            const matchesSearch =
                (order.patientName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (order.caseId || '').toLowerCase().includes(searchTerm.toLowerCase());

            if (!matchesSearch) return false;

            // Tab filter
            if (activeFilter === 'all') return true;
            if (activeFilter === 'issues') return order.issueState !== 'none';
            if (activeFilter === 'delivered') return order.productionStatus === 'final_delivered';
            if (activeFilter === 'in_delivery') return (order.shipmentStatus === 'dispatched' || order.productionStatus === 'final_ready');
            if (activeFilter === 'in_progress') {
                return order.productionStatus !== 'final_delivered' &&
                       order.productionStatus !== 'final_ready' &&
                       order.issueState === 'none';
            }
            return true;
        });
    }, [orders, searchTerm, activeFilter]);

    // Counts for filter pills
    const inProgressCount = useMemo(() => orders.filter(o => o.productionStatus !== 'final_delivered' && o.productionStatus !== 'final_ready' && o.issueState === 'none').length, [orders]);
    const inDeliveryCount = useMemo(() => orders.filter(o => (o.shipmentStatus === 'dispatched' || o.productionStatus === 'final_ready') && o.issueState === 'none').length, [orders]);
    const deliveredCount = useMemo(() => orders.filter(o => o.productionStatus === 'final_delivered').length, [orders]);
    const issuesCount = useMemo(() => orders.filter(o => o.issueState !== 'none').length, [orders]);

    const labWhatsAppNumber = import.meta.env.VITE_LAB_WHATSAPP_NUMBER;

    return (
        <div className="space-y-6 max-w-4xl mx-auto" dir="rtl">
            {/* Header & Quick Stats */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <h1 className="text-2xl font-black text-slate-900 dark:text-white">حالاتي ومتابعة الإنتاج</h1>
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                        تتبع مراحل تصنيع وشحن الحالات لحظة بلحظة مع تقييم جودة الاستلام.
                    </p>
                </div>
            </div>

            {/* Search and Filters Bar */}
            <div className="space-y-3">
                <div className="relative">
                    <Search className="absolute right-3.5 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
                    <input
                        type="text"
                        placeholder="ابحث باسم المريض أو كود الحالة..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pr-11 pl-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs sm:text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white shadow-sm"
                    />
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs font-bold">
                    <button
                        type="button"
                        onClick={() => setActiveFilter('all')}
                        className={`px-3.5 py-2 rounded-xl whitespace-nowrap transition-all flex items-center gap-1.5 ${
                            activeFilter === 'all'
                                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                    >
                        <span>الكل</span>
                        <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeFilter === 'all' ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-800'}`}>
                            {orders.length}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveFilter('in_progress')}
                        className={`px-3.5 py-2 rounded-xl whitespace-nowrap transition-all flex items-center gap-1.5 ${
                            activeFilter === 'in_progress'
                                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                    >
                        <span>قيد التشغيل</span>
                        {inProgressCount > 0 && (
                            <span className="bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 px-1.5 py-0.2 rounded-full text-[10px]">
                                {inProgressCount}
                            </span>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveFilter('in_delivery')}
                        className={`px-3.5 py-2 rounded-xl whitespace-nowrap transition-all flex items-center gap-1.5 ${
                            activeFilter === 'in_delivery'
                                ? 'bg-amber-600 text-white shadow-md shadow-amber-500/20'
                                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                    >
                        <Truck size={14} />
                        <span>خرجت للشحن</span>
                        {inDeliveryCount > 0 && (
                            <span className="bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 px-1.5 py-0.2 rounded-full text-[10px]">
                                {inDeliveryCount}
                            </span>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveFilter('delivered')}
                        className={`px-3.5 py-2 rounded-xl whitespace-nowrap transition-all flex items-center gap-1.5 ${
                            activeFilter === 'delivered'
                                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20'
                                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                    >
                        <CheckCircle2 size={14} />
                        <span>تم التسليم</span>
                        <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeFilter === 'delivered' ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-800'}`}>
                            {deliveredCount}
                        </span>
                    </button>

                    {issuesCount > 0 && (
                        <button
                            type="button"
                            onClick={() => setActiveFilter('issues')}
                            className={`px-3.5 py-2 rounded-xl whitespace-nowrap transition-all flex items-center gap-1.5 ${
                                activeFilter === 'issues'
                                    ? 'bg-red-600 text-white shadow-md shadow-red-500/20'
                                    : 'bg-white dark:bg-slate-900 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 hover:bg-red-50'
                            }`}
                        >
                            <ShieldAlert size={14} />
                            <span>ملاحظات ومرتجعات</span>
                            <span className="bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 px-1.5 py-0.2 rounded-full text-[10px]">
                                {issuesCount}
                            </span>
                        </button>
                    )}
                </div>
            </div>

            {/* Orders List (Cards View) */}
            <div className="space-y-4">
                {loading ? (
                    <div className="py-16 text-center text-slate-400">
                        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                        <p className="text-xs font-bold">جاري تحميل حالاتك...</p>
                    </div>
                ) : filteredOrders.length === 0 ? (
                    <Card className="py-16 text-center text-slate-400 p-6">
                        <Truck size={40} className="mx-auto mb-2 text-slate-300 dark:text-slate-600 stroke-[1.2]" />
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-300">لا توجد أوردرات مطابقة للبحث</p>
                        <p className="text-xs text-slate-400 mt-1">يمكنك تقديم طلب حالة جديدة أو تغيير خيارات التصفية أعلاه.</p>
                    </Card>
                ) : (
                    filteredOrders.map(order => {
                        const stageIndex = getOrderStageIndex(order);
                        const isDelivered = order.productionStatus === 'final_delivered';
                        const isReadyForDelivery = (order.shipmentStatus === 'dispatched' || order.productionStatus === 'final_ready');
                        const hasIssue = order.issueState !== 'none';

                        // Lab WhatsApp prefilled link for this specific case
                        const whatsappInquiryUrl = `https://wa.me/${labWhatsAppNumber}?text=${encodeURIComponent(
                            `مرحباً معمل ORCA، أستفسر عن شحنة وتوصيل الحالة رقم (${order.caseId}) - المريض: (${order.patientName}).`
                        )}`;

                        return (
                            <Card
                                key={order.id}
                                className={`p-4 sm:p-5 transition-all border ${
                                    isReadyForDelivery
                                        ? 'border-amber-300/80 dark:border-amber-700/80 bg-gradient-to-b from-amber-50/20 via-white to-white dark:from-amber-950/10 dark:via-slate-900 dark:to-slate-900'
                                        : hasIssue
                                        ? 'border-red-200 dark:border-red-900/40 bg-red-50/10'
                                        : 'border-slate-200/80 dark:border-slate-800'
                                } shadow-sm hover:shadow-md rounded-2xl`}
                            >
                                {/* Card Header */}
                                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono font-bold text-xs sm:text-sm bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 px-2.5 py-1 rounded-lg border border-blue-200/60 dark:border-blue-800/40" dir="ltr">
                                            {order.caseId}
                                        </span>
                                        <h3 className="font-bold text-slate-900 dark:text-white text-sm sm:text-base">
                                            {order.patientName}
                                        </h3>
                                    </div>

                                    <div className="flex items-center gap-2 text-xs font-bold">
                                        {order.totalPrice > 0 && (
                                            <span className="text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-lg">
                                                {order.totalPrice.toLocaleString()} ج.م
                                            </span>
                                        )}
                                        {hasIssue && (
                                            <span className="bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300 px-2 py-0.5 rounded-md text-[11px]">
                                                {order.issueState === 'doctor_rejected' ? 'مرتجع طبيب' : 'ملاحظات المعمل'}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <p className="text-sm mt-3 font-bold">{order.doctorName} — المرحلة الحالية: {order.stageLabel}</p>
                                {order.pickupStatus && <p className="text-sm mt-2">{PICKUP_LABELS[order.pickupStatus]}</p>}
                                {order.shipmentStatus === 'dispatched' && <p className="text-emerald-700 mt-2">الحالة خرجت للشحن وفي طريقها للعيادة</p>}
                                <Link to={`/doctor/support?case=${order.id}`} className="inline-block text-blue-600 py-3">استفسار عن الحالة</Link>
                                <button type="button" className="text-blue-600 p-3" onClick={() => setFilesOrderId(filesOrderId === order.id ? '' : order.id)}>ملفات الحالة</button>
                                {filesOrderId === order.id && <div className="space-y-2">
                                    {order.stlUrl && /^https?:\/\//i.test(order.stlUrl) && <a className="inline-block text-blue-600 p-3" href={order.stlUrl} target="_blank" rel="noopener noreferrer">رابط السكان</a>}
                                    {order.imagesUrl && /^https?:\/\//i.test(order.imagesUrl) && <a className="inline-block text-blue-600 p-3" href={order.imagesUrl} target="_blank" rel="noopener noreferrer">رابط الصور</a>}
                                    <CaseAttachments orderId={order.id} kind="instruction" canUpload accept={`${ACCEPTED_TYPES},${SCAN_ACCEPTED_TYPES}`} label="السكان والصور المرفقة" />
                                </div>}
                                {/* Stepper Visual Progression */}
                                {!hasIssue && (
                                    <div className="py-4">
                                        <div className="grid grid-cols-5 gap-1 text-center relative">
                                            {/* Continuous progress track behind dots */}
                                            <div className="absolute top-3.5 inset-x-4 h-0.5 bg-slate-200 dark:bg-slate-700 -z-0" />

                                            {ORDER_STAGES.map((stage, idx) => {
                                                const isCompleted = idx < stageIndex;
                                                const isCurrent = idx === stageIndex;

                                                return (
                                                    <div key={stage.key} className="flex flex-col items-center relative z-10">
                                                        <div
                                                            className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                                                                isCurrent
                                                                    ? 'bg-blue-600 text-white ring-4 ring-blue-100 dark:ring-blue-900/60 scale-110 shadow-md shadow-blue-500/30'
                                                                    : isCompleted
                                                                    ? 'bg-emerald-600 text-white'
                                                                    : 'bg-white dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-600 text-slate-400'
                                                            }`}
                                                        >
                                                            {isCompleted ? (
                                                                <CheckCircle2 size={16} />
                                                            ) : (
                                                                idx + 1
                                                            )}
                                                        </div>
                                                        <span className={`text-[10px] sm:text-[11px] mt-1.5 font-bold leading-tight ${
                                                            isCurrent
                                                                ? 'text-blue-600 dark:text-blue-400'
                                                                : isCompleted
                                                                ? 'text-slate-800 dark:text-slate-200'
                                                                : 'text-slate-400'
                                                        }`}>
                                                            {stage.label}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Out for Delivery Special Notice & WhatsApp Button */}
                                {isReadyForDelivery && (
                                    <div className="my-2 p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                                        <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-bold">
                                            <Truck size={18} className="text-amber-600 shrink-0" />
                                            <span>{order.shipmentStatus === 'dispatched' ? 'الحالة خرجت للشحن وفي طريقها للعيادة' : 'الحالة جاهزة؛ تواصل مع المعمل لتأكيد ترتيبات التسليم.'}</span>
                                        </div>

                                        <a
                                            href={labWhatsAppNumber ? whatsappInquiryUrl : `/doctor/support?case=${order.id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition-colors flex items-center gap-1.5 shrink-0 self-end sm:self-auto shadow-sm"
                                        >
                                            <MessageCircle size={14} />
                                            <span>استفسار عن الشحنة</span>
                                        </a>
                                    </div>
                                )}

                                {/* Interactive Case Rating Prompt (CSAT) */}
                                {isDelivered && order.doctorId === user?.entityId && (
                                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                                        {order.feedback ? (
                                            <div className="flex items-center gap-2 text-xs">
                                                <span className="text-slate-500 dark:text-slate-400 font-bold">تقييمك للحالة:</span>
                                                <div className="flex text-amber-400">
                                                    {[...Array(5)].map((_, i) => (
                                                        <Star
                                                            key={i}
                                                            size={14}
                                                            fill={i < order.feedback!.rating ? "currentColor" : "none"}
                                                            className={i < order.feedback!.rating ? "" : "text-slate-200 dark:text-slate-700"}
                                                        />
                                                    ))}
                                                </div>
                                                {order.feedback.notes && (
                                                    <span className="text-slate-500 text-[11px] truncate max-w-xs">
                                                        ({order.feedback.notes})
                                                    </span>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="w-full flex items-center justify-between bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 p-2.5 rounded-xl border border-amber-200/80 dark:border-amber-800/60">
                                                <div className="flex items-center gap-1.5 text-xs text-amber-900 dark:text-amber-200 font-bold">
                                                    <Sparkles size={15} className="text-amber-500" />
                                                    <span>تم تسليم الحالة. كيف كانت جودة العمل والانطباق؟</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setRatingOrder(order);
                                                        setRating(5);
                                                        setSelectedTags([]);
                                                        setFeedbackNotes('');
                                                    }}
                                                    className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-lg transition-colors shadow-sm flex items-center gap-1 cursor-pointer"
                                                >
                                                    <Star size={13} fill="currentColor" />
                                                    <span>تقييم الحالة</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Dates & Delivery details footer */}
                                <div className="mt-3 pt-2 border-t border-slate-50 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400">

                                    <span className="flex items-center gap-1">
                                        <Clock size={12} />
                                        <span>تاريخ الإرسال: {order.createdAt ? new Date(order.createdAt).toLocaleDateString('ar-EG') : '-'}</span>
                                    </span>
                                </div>
                            </Card>
                        );
                    })
                )}
            </div>

            {/* Interactive Rating / CSAT Modal */}
            {ratingOrder && (
                <div className="fixed inset-0 bg-slate-950/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                    <Card className="w-full max-w-md p-6 space-y-5 animate-in zoom-in-95 rounded-3xl border border-slate-200 dark:border-slate-800">
                        <div className="text-center">
                            <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 mx-auto flex items-center justify-center mb-2 font-bold">
                                <Smile size={26} />
                            </div>
                            <h3 className="text-lg font-black text-slate-900 dark:text-white">تقييم جودة الحالة</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                الحالة: {ratingOrder.caseId} - المريض: {ratingOrder.patientName}
                            </p>
                        </div>

                        {/* Interactive Stars */}
                        <div className="flex justify-center gap-2 py-2">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                    key={star}
                                    type="button"
                                    onClick={() => setRating(star)}
                                    aria-label={`تقييم ${star} من 5 نجوم`}
                                    className="transition-transform hover:scale-125 focus:outline-none cursor-pointer"
                                >
                                    <Star
                                        size={36}
                                        className={star <= rating ? "text-amber-400 fill-amber-400" : "text-slate-200 dark:text-slate-700 fill-slate-100 dark:fill-slate-800"}
                                    />
                                </button>
                            ))}
                        </div>

                        {/* Quick Tags Chips */}
                        <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-2">
                                اختيارات سريعة:
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                                {QUICK_FEEDBACK_TAGS.map((tag) => {
                                    const isSelected = selectedTags.includes(tag);
                                    return (
                                        <button
                                            key={tag}
                                            type="button"
                                            onClick={() => toggleFeedbackTag(tag)}
                                            className={`text-[11px] font-bold px-2.5 py-1 rounded-xl transition-all ${
                                                isSelected
                                                    ? 'bg-amber-500 text-white shadow-sm'
                                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                                            }`}
                                        >
                                            {tag}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Optional Notes */}
                        <div>
                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                ملاحظات أو توجيهات لفريق المعمل (اختياري)
                            </label>
                            <textarea
                                className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-xs h-20 resize-none dark:text-white"
                                placeholder="اكتب أي ملاحظة عن الإطباق، اللون، أو وقت التسليم..."
                                value={feedbackNotes}
                                onChange={e => setFeedbackNotes(e.target.value)}
                            />
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2 pt-2">
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => setRatingOrder(null)}
                                className="flex-1 rounded-xl text-xs"
                            >
                                إلغاء
                            </Button>
                            <Button
                                type="button"
                                disabled={isSubmittingRating}
                                onClick={handleRateSubmit}
                                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs shadow-md shadow-amber-500/20"
                            >
                                {isSubmittingRating ? 'جاري الحفظ...' : 'إرسال التقييم'}
                            </Button>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
}
