/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef } from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../../context/ToastContext';
import {
    Check, MessageCircle, Clock, Link as LinkIcon, AlertTriangle,
    User, UserCheck, PenTool, Calendar, Settings, Building2, StickyNote, Image as ImageIcon,
    Trash2, History, Box, FileDown, Archive as ArchiveIcon, RotateCcw,
    Edit3, DollarSign
} from 'lucide-react';
import OrderHistoryModal from './OrderHistoryModal';
import { db } from '../../services/db';
import type { Order, OrderEvent, OrderHistoryEntry } from '../../services/db';
import clsx from 'clsx';
import { checkIsLate } from '../../utils/orderUtils';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { motion } from 'framer-motion';
import { canAccessDesignerFeatures } from '../../lib/userRoles';
import { filterVisibleOrderComments, getLatestVisibleOrderComment, getOrderCardDisplayDate } from '../../utils/orderDisplay';
import { ensureAbsoluteUrl } from '../../lib/urlUtils';
import ProductionStatusBadge from './ProductionStatusBadge';
import IssueStateBadge from './IssueStateBadge';
import CaseLocationChip from './CaseLocationChip';
import { getEffectiveProductionStatus, getEffectiveIssueState, getCaseLocation } from '../../constants/orderLifecycle';
import WorkflowActionBar from './WorkflowActionBar';

interface OrderCardProps {
    order: Order;
    fullDoctors?: any[];
    doctors: Record<string, string>;
    suppliers: Record<string, string>;
    users: Record<string, string>;
    userRole?: string;
    onStatusChange: (id: string, status: Order['status'] | 'same', context?: { rejectedLabCost?: number; comment?: string }) => void;
    onUpdate?: () => void;
    showFinancials?: boolean;
    onEdit?: (order: Order) => void;
    onAddNote?: (order: Order) => void;
    onUpdateDesignUrl?: (order: Order) => void;
    onTechAction?: (id: string, action: 'Approved' | 'Rejected' | 'NeedDetails' | 'PMMA_First') => void;
    onRedo?: (order: Order) => void;
    onFeedback?: (order: Order) => void;
    hideSensitiveInfo?: boolean;
    onDelete?: (order: Order) => void;
    isHighlighted?: boolean;
    onAccept?: (order: Order) => void;
    // onPrint removed
    onExportInvoice?: (order: Order) => void;

    currentUser?: any;
}

export default function OrderCard({
    order,
    fullDoctors,
    doctors,
    suppliers,
    users,
    userRole,
    onStatusChange,
    onEdit,
    onAddNote,
    onUpdateDesignUrl,
    onTechAction,
    hideSensitiveInfo,
    onDelete,
    isHighlighted = false,
    onAccept,
    onRedo,
    // onPrint removed
    onExportInvoice,

    currentUser
}: OrderCardProps) {
    const { success, error: toastError } = useToast();

    const handleOpenExternalUrl = (rawUrl: string | undefined | null, errorMsg: string) => {
        if (!rawUrl) return;
        const absoluteUrl = ensureAbsoluteUrl(rawUrl);
        if (!absoluteUrl) {
            toastError(errorMsg);
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

    // Confirmation State — handled by WorkflowActionBar
    const [isEditingCost, setIsEditingCost] = useState(false);
    const [editCostValue, setEditCostValue] = useState<number | ''>('');


    const handleUpdateRejectedCost = () => {
        onStatusChange(order.id, 'same', { rejectedLabCost: editCostValue === '' ? 0 : Number(editCostValue) });
        success('تم تحديث تكلفة الرفض بنجاح');
        setIsEditingCost(false);
    };

    const isLate = checkIsLate(order);
    const cardRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isHighlighted && cardRef.current) {
            cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [isHighlighted]);

    const [showHistory, setShowHistory] = useState(false);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyData, setHistoryData] = useState<OrderHistoryEntry[]>([]);
    const [eventsLoading, setEventsLoading] = useState(false);
    const [eventsError, setEventsError] = useState(false);
    const [eventsData, setEventsData] = useState<OrderEvent[]>([]);
    const canViewBusinessTimeline = ['admin', 'accountant', 'representative'].includes(userRole || '');

    const handleShowHistory = async () => {
        setShowHistory(true);
        setHistoryLoading(true);
        setEventsError(false);
        if (canViewBusinessTimeline) {
            setEventsLoading(true);
        }
        try {
            const data = await db.getOrderHistory(order.id);
            setHistoryData(data);
        } catch (error) {
            console.error('Failed to load history', error);
        } finally {
            setHistoryLoading(false);
        }

        if (canViewBusinessTimeline) {
            try {
                const events = await db.getOrderTimeline(order.id);
                setEventsData(events);
            } catch (error) {
                console.error('Failed to load order events', error);
                setEventsError(true);
            } finally {
                setEventsLoading(false);
            }
        }
    };

    const visibleComments = filterVisibleOrderComments(order.comments);
    const latestComment = getLatestVisibleOrderComment(order.comments);
    const displayDate = getOrderCardDisplayDate(order);

    // Terminal statuses (red): Rejected/Cancelled only — these get archive button and red styling
    const isRedStatus = order.status === 'Rejected' || order.status === 'Cancelled' || order.technicianStatus === 'Rejected';
    // Active-but-returned: amber styling, NO archive button — case needs rework before delivery
    const isReturnedStatus = order.status === 'Returned for Adjustments';
    const isDelivered = order.status === 'Delivered';
    const canArchiveOrders = userRole === 'admin';
    const deleteConfirmMessage = order.isArchived
        ? 'حذف نهائي؟ سيتم حذف الأوردر تماما من السيستم ولا يمكن استرجاعه.'
        : 'حذف؟ سيتم نقل الأوردر إلى الأرشيف ويمكن استرجاعه لاحقا.';
    const deleteTitle = order.isArchived ? 'حذف نهائي' : 'حذف';

    const resolvedDoctor = fullDoctors?.find((d: any) => d.id === order.doctorId);
    const parentDoctor = resolvedDoctor?.parentId ? fullDoctors?.find((d: any) => d.id === resolvedDoctor.parentId) : null;
    const doctorDisplayName = parentDoctor ? `${parentDoctor.name}` : `${doctors[order.doctorId] || 'غير معروف'}`;

    const handleArchive = async (archive: boolean) => {
        if (!canArchiveOrders) return;
        if (!confirm(archive ? 'أرشفة الطلب؟ سيختفي من القائمة الرئيسية.' : 'إلغاء الأرشفة؟')) return;
        try {
            await db.updateOrder(order.id, { isArchived: archive });
            if (onStatusChange) onStatusChange(order.id, 'same');
            success(archive ? 'تمت الأرشفة بنجاح' : 'تم إلغاء الأرشفة');
        } catch (error) {
            console.error(error);
        }
    };

    return (
        <motion.div
            ref={cardRef}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
        >
            <Card
                variant={isHighlighted ? 'glass' : 'default'}
                className={clsx(
                    "relative overflow-hidden transition-all duration-200 border-l-4",
                    isHighlighted ? 'ring-2 ring-primary-500 shadow-lg scale-[1.01] z-10' : 'hover:shadow-md',
                    order.isArchived
                        ? 'bg-gray-50 dark:bg-gray-800/50 border-l-gray-400 border-gray-200 opacity-75'
                        : isDelivered
                            ? 'bg-green-50 dark:bg-green-900/20 border-l-green-500 border-green-200 dark:border-green-800'
                            : isReturnedStatus
                                ? 'bg-amber-50 dark:bg-amber-900/20 border-l-amber-500 border-amber-200 dark:border-amber-800'
                                : isRedStatus
                                    ? 'bg-red-50 dark:bg-red-900/20 border-l-red-500 border-red-200 dark:border-red-800'
                                    : 'bg-white dark:bg-surface-800 border-l-primary-500 border-surface-200 dark:border-surface-700'
                )}
            >
                {/* Urgent Strip */}
                {(order.isUrgent || order.priority === 'Urgent') && (
                    <div className="absolute top-0 right-0 w-16 h-16 pointer-events-none overflow-hidden">
                        <div className="absolute top-0 right-0 transform translate-x-1/2 -translate-y-1/2 rotate-45 bg-red-500 text-white text-[9px] font-bold py-1 w-24 text-center shadow-sm">
                            عاجل 🔥
                        </div>
                    </div>
                )}

                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-black/5 dark:bg-white/5 border-b border-black/5 dark:border-white/5">
                        <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/30 px-1.5 py-0.5 rounded-md border border-primary-100 dark:border-primary-800">
                                #{order.caseId}
                            </span>

                            {(userRole === 'admin' || userRole === 'representative') && order.representativeId && users[order.representativeId] && (
                                <span
                                    className="inline-flex max-w-[160px] items-center gap-1.5 rounded-md border border-blue-100 bg-blue-50 px-2 py-0.5 text-xs dark:border-blue-800/30 dark:bg-blue-900/10"
                                    title={`المندوب: ${users[order.representativeId]}`}
                                >
                                    <UserCheck size={12} className="shrink-0 text-blue-600 dark:text-blue-400" />
                                    <span className="truncate font-semibold text-blue-800 dark:text-blue-200">{users[order.representativeId]}</span>
                                </span>
                            )}

                            {isDelivered && (
                                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 border border-green-200 dark:border-green-800 flex items-center gap-1">
                                    <Check size={9} strokeWidth={3} /> تم التسليم
                                </span>
                            )}
                            {isLate && (
                                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-1 animate-pulse">
                                    <Clock size={9} /> متأخر
                                </span>
                            )}
                            {order.deliveryType && (
                                <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold border flex items-center gap-1 ${order.deliveryType === 'Final'
                                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800'
                                    : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800'
                                    }`}>
                                    {order.deliveryType === 'Final' ? '✨ Final' : '🦷 Try In'}
                                </span>
                            )}
                            {order.isArchived && (
                                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-gray-100 text-gray-600 border border-gray-300 flex items-center gap-1">
                                    <ArchiveIcon size={9} /> مؤرشف
                                </span>
                            )}
                            {order.workflowType === 'split' && (
                                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-cyan-50 text-cyan-700 border border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-800 flex items-center gap-1">
                                    <Settings size={9} /> خراطة
                                </span>
                            )}
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2 flex-1 min-w-[150px]">
                            {/* Designer Action */}
                            {onUpdateDesignUrl && canAccessDesignerFeatures(currentUser) && (
                                <Button
                                    size="sm"
                                    variant={order.designUrl ? 'outline' : 'primary'}
                                    className={clsx(
                                        "h-6 px-2 text-xs",
                                        !order.designUrl ? "bg-orange-600 hover:bg-orange-700 text-white border-orange-600" : "text-blue-600 border-blue-200 hover:bg-blue-50"
                                    )}
                                    onClick={() => onUpdateDesignUrl(order)}
                                    title={order.designUrl ? "تحديث رابط التصميم" : "رفع رابط التصميم"}
                                >
                                    <LinkIcon size={12} />
                                    <span className="hidden sm:inline ml-1">{order.designUrl ? 'تحديث' : 'رفع تصميم'}</span>
                                </Button>
                            )}

                            {order.designUrl && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleOpenExternalUrl(order.designUrl, 'رابط التحميل غير صالح أو معطوب')}

                                    className="h-6 px-2 text-xs text-orange-600 border-orange-200 hover:bg-orange-50 bg-white"
                                    title="تحميل التصميم"
                                >
                                    <LinkIcon size={12} />
                                    <span className="hidden sm:inline ml-1">تحميل</span>
                                </Button>
                            )}

                            {order.stlUrl && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleOpenExternalUrl(order.stlUrl, 'رابط ملف STL غير صالح أو معطوب')}

                                    className="h-6 px-2 text-xs text-blue-600 border-blue-200 hover:bg-blue-50 bg-white"
                                    title="STL File"
                                >
                                    <Box size={12} />
                                    <span className="hidden sm:inline ml-1">STL</span>
                                </Button>
                            )}

                            {/* Accept Order Action (for Pending Review) */}
                            {onAccept && order.status === 'Pending Review' && (
                                <Button
                                    size="sm"
                                    onClick={() => onAccept(order)}
                                    className="h-6 px-3 text-xs bg-teal-600 hover:bg-teal-700 text-white border-teal-600 shadow-sm shadow-teal-200 animate-pulse"
                                    title="Accept Order"
                                >
                                    <Check size={12} strokeWidth={3} />
                                    <span className="ml-1 font-bold">قبول الحالة</span>
                                </Button>
                            )}

                            {order.imagesUrl && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleOpenExternalUrl(order.imagesUrl, 'رابط الصور غير صالح أو معطوب')}
                                    className="h-6 px-2 text-xs text-teal-600 border-teal-200 hover:bg-teal-50 bg-white"
                                    title="Images"
                                >
                                    <ImageIcon size={12} />
                                    <span className="hidden sm:inline ml-1">IMG</span>
                                </Button>
                            )}

                            {onAddNote && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => onAddNote(order)}
                                    className="h-6 w-6 p-0 relative text-surface-600 border-surface-200 hover:bg-surface-50 bg-white"
                                    title="ملاحظات"
                                >
                                    <MessageCircle size={12} />
                                    {visibleComments.length > 0 && (
                                        <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white ring-1 ring-white">
                                            {visibleComments.length}
                                        </span>
                                    )}
                                </Button>
                            )}

                            <div className="h-4 w-px bg-surface-200 dark:bg-surface-700/50 mx-1"></div>

                            <div className="flex items-center gap-2 text-[10px] font-semibold text-surface-500 font-mono tracking-tight">
                                <span
                                    className="flex items-center gap-1"
                                    title="تاريخ استلام العمل"
                                >
                                    <Calendar size={11} className="text-surface-400" />
                                    <span className="text-surface-400 font-bold">استلام</span>
                                    <span className="font-black text-surface-600">{order.createdAt ? order.createdAt.split('T')[0] : '-'}</span>
                                </span>
                                <span className="h-3 w-px bg-surface-200 dark:bg-surface-700/50" />
                                <span
                                    className={clsx(
                                        "flex items-center gap-1",
                                        isLate ? "text-red-600" : "text-surface-500"
                                    )}
                                    title={displayDate.label}
                                >
                                    <Clock size={11} className={isLate ? "text-red-500" : "text-surface-400"} />
                                    <span className={clsx("font-bold", isLate ? "text-red-500" : "text-surface-400")}>{displayDate.label}</span>
                                    <span className={clsx("font-black", isLate ? "text-red-700" : "text-surface-600")}>{displayDate.date || '-'}</span>
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="p-3 grid grid-cols-2 md:grid-cols-12 gap-3">
                        {/* Patient Info */}
                        <div className={`col-span-2 ${userRole === 'admin' ? 'md:col-span-4' : 'md:col-span-4'} flex flex-col sm:flex-row md:flex-col gap-2 border-l-0 md:border-l border-surface-100 dark:border-surface-700 pl-0 md:pl-3`}>
                            <div className="flex items-center gap-2 flex-1">
                                <div className="p-1.5 rounded-lg bg-primary-50 dark:bg-primary-900/20 text-primary-600 shrink-0">
                                    <User size={16} />
                                </div>
                                <div className="min-w-0">
                                    <p className="font-bold text-base md:text-lg text-surface-900 dark:text-surface-100 leading-tight truncate">{order.patientName}</p>
                                    <p className="text-[10px] sm:text-xs text-surface-500">اسم المريض</p>
                                    {/* WF-4: Workflow status badges */}
                                    <div className="flex items-center gap-1 flex-wrap mt-1">
                                        <ProductionStatusBadge status={getEffectiveProductionStatus(order)} />
                                        <IssueStateBadge state={getEffectiveIssueState(order)} />
                                        <CaseLocationChip location={getCaseLocation(
                                            getEffectiveProductionStatus(order),
                                            getEffectiveIssueState(order),
                                            { workflowType: order.workflowType, supplierId: order.supplierId }
                                        )} />
                                    </div>
                                </div>
                            </div>

                            {!hideSensitiveInfo && (
                                <div className="flex items-center gap-2 flex-1">
                                    <div className="p-1.5 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 shrink-0">
                                        <User size={14} />
                                    </div>
                                    <div className="min-w-0 flex items-center gap-3 max-w-full">
                                        <div>
                                            <p className="font-semibold text-sm md:text-base text-surface-700 dark:text-surface-300 leading-tight truncate">d. {doctorDisplayName}</p>
                                            <p className="text-[10px] sm:text-xs text-surface-400">الطبيب المعالج</p>
                                        </div>
                                        {parentDoctor && (
                                            <div className="shrink-0">
                                                <span className="text-[11px] font-bold bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 px-2 py-1 mt-1 rounded-md border border-purple-200 dark:border-purple-800 flex items-center shadow-sm">
                                                    د. {resolvedDoctor?.name}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Order Details */}
                        <div className={`col-span-2 ${userRole === 'admin' ? 'md:col-span-4' : 'md:col-span-8'} flex flex-col gap-2`}>
                            <div>
                                <span className="text-[9px] font-bold text-surface-400 uppercase tracking-wider mb-1 block">الخدمات المطلوبة</span>
                                <div className="flex flex-wrap gap-1.5">
                                    {(order.items || []).map((item, idx) => (
                                        <div key={idx} className="flex flex-col bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 px-2 py-1 rounded-md max-w-[140px]">
                                            <span className="text-xs font-bold text-primary-700 dark:text-primary-300 truncate" title={item.serviceType}>{item.serviceType}</span>
                                            {item.teethNumbers && (
                                                <span className="text-[9px] text-surface-500 font-mono mt-0.5 truncate">
                                                    Tooth: {Array.isArray(item.teethNumbers) ? item.teethNumbers.join(',') : item.teethNumbers}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                    {order.shade && (
                                        <div className="flex flex-col bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30 px-2 py-1 rounded-md items-center justify-center min-w-[50px]">
                                            <span className="text-[8px] font-bold text-amber-600 uppercase">Shade</span>
                                            <span className="text-xs font-black text-amber-800 dark:text-amber-400">{order.shade}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Assignment Info */}
                            <div className="flex flex-wrap gap-2 mt-1.5 origin-right">
                                {order.supplierId && suppliers[order.supplierId] && (
                                    <div
                                        className="inline-flex max-w-full items-center gap-1.5 bg-teal-50 dark:bg-teal-900/10 px-2 py-0.5 rounded-md text-xs border border-teal-100 dark:border-teal-800/30"
                                        title={`المعمل: ${suppliers[order.supplierId]}`}
                                    >
                                        <Building2 size={12} className="text-teal-600 dark:text-teal-400 shrink-0" />
                                        <span className="text-[10px] font-black text-teal-700 dark:text-teal-300">المعمل</span>
                                        <span className="h-3 w-px bg-teal-200 dark:bg-teal-700/60" />
                                        <span className="max-w-[130px] truncate font-semibold text-teal-800 dark:text-teal-200">{suppliers[order.supplierId]}</span>
                                    </div>
                                )}
                                {order.designerId && users[order.designerId] && (
                                    <div
                                        className="inline-flex max-w-full items-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/10 px-2 py-0.5 rounded-md text-xs border border-indigo-100 dark:border-indigo-800/30"
                                        title={`المصمم: ${users[order.designerId]}`}
                                    >
                                        <PenTool size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                                        <span className="text-[10px] font-black text-indigo-700 dark:text-indigo-300">المصمم</span>
                                        <span className="h-3 w-px bg-indigo-200 dark:bg-indigo-700/60" />
                                        <span className="max-w-[130px] truncate font-semibold text-indigo-800 dark:text-indigo-200">{users[order.designerId]}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Supplier/Designer Box - Admin Only */}
                        {userRole === 'admin' && (
                            <div className="col-span-1 md:col-span-2 flex items-center justify-center min-h-[80px]">
                                <div className="h-full w-full flex flex-col items-center justify-center bg-gradient-to-br from-teal-50 to-indigo-50 dark:from-teal-900/20 dark:to-indigo-900/20 border border-teal-200 dark:border-teal-800/50 rounded-xl p-2">
                                    {/* Split Workflow: Designer + Supplier */}
                                    {order.workflowType === 'split' ? (
                                        <div className="flex flex-col items-center justify-center gap-1 w-full">
                                            {/* Designer (Top) */}
                                            <div className="flex items-center gap-1 text-center">
                                                <User size={14} className="text-indigo-600 dark:text-indigo-400" />
                                                <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 truncate max-w-[80px]">
                                                    {order.designerId && users[order.designerId] ? users[order.designerId] : 'مصمم'}
                                                </span>
                                            </div>
                                            {/* Divider */}
                                            <div className="w-full h-px bg-teal-200 dark:bg-teal-700/50 my-0.5"></div>
                                            {/* Supplier (Bottom) */}
                                            <div className="flex items-center gap-1 text-center">
                                                <Building2 size={14} className="text-teal-600 dark:text-teal-400" />
                                                <span className="text-xs font-bold text-teal-700 dark:text-teal-300 truncate max-w-[80px]">
                                                    {order.supplierId && suppliers[order.supplierId] ? suppliers[order.supplierId] : 'خراطة'}
                                                </span>
                                            </div>
                                        </div>
                                    ) : order.supplierId && suppliers[order.supplierId] ? (
                                        /* Full External Lab */
                                        <>
                                            <Building2 size={16} className="text-teal-600 dark:text-teal-400 mb-1" />
                                            <span className="text-[10px] font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wider">المعمل</span>
                                            <span className="text-sm font-black text-teal-700 dark:text-teal-300 leading-tight text-center mt-0.5">
                                                {suppliers[order.supplierId]}
                                            </span>
                                        </>
                                    ) : order.designerId && users[order.designerId] ? (
                                        /* Designer Only */
                                        <>
                                            <User size={16} className="text-indigo-600 dark:text-indigo-400 mb-1" />
                                            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">المصمم</span>
                                            <span className="text-sm font-black text-indigo-700 dark:text-indigo-300 leading-tight text-center mt-0.5">
                                                {users[order.designerId]}
                                            </span>
                                        </>
                                    ) : (
                                        /* Internal Lab */
                                        <>
                                            <Building2 size={16} className="text-surface-400 mb-1" />
                                            <span className="text-[10px] font-bold text-surface-400 uppercase tracking-wider">معمل داخلي</span>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Invoice Total - Admin Only - Far Right Column */}
                        {userRole === 'admin' && (
                            <div className="col-span-1 md:col-span-2 flex flex-col gap-2 items-center justify-center min-h-[80px]">
                                <div className="h-full w-full flex flex-col items-center justify-center bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border border-green-200 dark:border-green-800/50 rounded-xl p-3">
                                    <span className="text-[10px] font-bold text-green-600 dark:text-green-400 uppercase tracking-wider mb-1">الإجمالي</span>
                                    <span className="text-xl font-black text-green-700 dark:text-green-300 leading-none">
                                        {(order.totalPrice || 0).toLocaleString('en-EG')}
                                    </span>
                                    <span className="text-[10px] font-bold text-green-600 dark:text-green-400 mt-0.5">ج.م</span>
                                </div>

                                {/* Rejection Cost Display - Admin Only */}
                                {order.status === 'Rejected' && (order.supplierId || order.designerId) && (
                                    <div 
                                        className="w-full flex flex-col items-center justify-center bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-xl p-2 cursor-pointer hover:bg-red-100 transition-colors group"
                                        onClick={() => {
                                            setEditCostValue(order.rejectedLabCost ?? '');
                                            setIsEditingCost(true);
                                        }}
                                        title="تعديل تكلفة الرفض"
                                    >
                                        <div className="flex items-center gap-1">
                                            <span className="text-[9px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wider">تكلفة الرفض</span>
                                            <Edit3 size={10} className="text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                        <div className="flex items-baseline gap-1">
                                            <span className="text-sm font-black text-red-700 dark:text-red-300">
                                                {(order.rejectedLabCost || 0).toLocaleString('en-EG')}
                                            </span>
                                            <span className="text-[9px] font-bold text-red-600 dark:text-red-400 uppercase">ج.م</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Notes & Instructions */}
                    {(order.instructions || latestComment) && (
                        <div className="px-3 py-1.5 bg-yellow-50/40 dark:bg-yellow-900/5 border-t border-dashed border-surface-200 dark:border-surface-700">
                            {order.instructions && (
                                <div className="flex items-start gap-1.5 mb-0.5">
                                    <StickyNote size={12} className="text-yellow-600 mt-0.5 shrink-0" />
                                    <p className="text-[10px] text-surface-700 dark:text-surface-300 leading-relaxed font-medium">
                                        <span className="text-yellow-700 font-bold ml-1">تعليمات:</span>
                                        {order.instructions}
                                    </p>
                                </div>
                            )}
                            {latestComment && (
                                <div className="flex items-start gap-1.5">
                                    <MessageCircle size={12} className="text-primary-500 mt-0.5 shrink-0" />
                                    <p className="text-[10px] text-surface-600 dark:text-surface-400 leading-relaxed">
                                        <span className="text-primary-700 font-bold ml-1">{latestComment.userName}:</span>
                                        "{latestComment.text}"
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Footer Actions */}
                    <div className="bg-black/5 dark:bg-white/5 px-2 sm:px-3 py-2 border-t border-black/5 dark:border-white/5 flex flex-col sm:flex-row flex-wrap justify-between items-stretch sm:items-center gap-3">
                        {/* Left: Quick Actions */}
                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 flex-1">
                            {/* Workflow Action Bar (WF-4) */}
                            <WorkflowActionBar
                                order={order}
                                userRole={userRole}
                                onStatusChange={onStatusChange}
                                onRedo={onRedo}
                                showLegacyFallback={userRole === 'admin'}
                                disabled={userRole === 'lab' && order.status === 'Delivered'}
                            />

                            {/* Archive Action for Cancelled/Rejected only — NOT for Returned orders */}
                            {canArchiveOrders && isRedStatus && !order.isArchived && (
                                <button
                                    onClick={() => handleArchive(true)}
                                    className="flex items-center gap-1 bg-red-50 hover:bg-red-100 text-red-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border border-red-200"
                                    title="أرشفة الحالة (إخفاء)"
                                >
                                    <ArchiveIcon size={14} />
                                    <span>أرشفة</span>
                                </button>
                            )}

                            {/* Unarchive Action */}
                            {canArchiveOrders && order.isArchived && (
                                <button
                                    onClick={() => handleArchive(false)}
                                    className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border border-gray-300"
                                    title="إلغاء الأرشفة"
                                >
                                    <RotateCcw size={14} />
                                    <span>استعادة</span>
                                </button>
                            )}

                            {/* Tech Actions - Only for admin, designer, lab */}
                            {onTechAction && canAccessDesignerFeatures(currentUser) && (
                                <>
                                    <div className="h-4 w-px bg-surface-300 mx-1 hidden sm:block"></div>
                                    <div className="flex bg-white rounded-lg border border-surface-200 p-0.5 shadow-sm">
                                        <button
                                            onClick={() => onTechAction(order.id, 'Approved')}
                                            className={`p-1.5 rounded hover:bg-green-50 text-surface-400 hover:text-green-600 transition-colors ${order.technicianStatus === 'Approved' ? 'bg-green-100 text-green-700' : ''}`}
                                            title="قبول"
                                        >
                                            <Check size={14} />
                                        </button>
                                        <button
                                            onClick={() => onTechAction(order.id, 'NeedDetails')}
                                            className={`p-1.5 rounded hover:bg-orange-50 text-surface-400 hover:text-orange-600 transition-colors ${order.technicianStatus === 'NeedDetails' ? 'bg-orange-100 text-orange-700' : ''}`}
                                            title="تفاصيل"
                                        >
                                            <MessageCircle size={14} />
                                        </button>
                                        <button
                                            onClick={() => onTechAction(order.id, 'Rejected')}
                                            className={`p-1.5 rounded hover:bg-red-50 text-surface-400 hover:text-red-600 transition-colors ${order.technicianStatus === 'Rejected' ? 'bg-red-100 text-red-700' : ''}`}
                                            title="رفض"
                                        >
                                            <AlertTriangle size={14} />
                                        </button>
                                    </div>
                                </>
                            )}

                        </div>

                        {/* Right: Admin Tools */}
                        <div className="flex items-center justify-end gap-1.5 sm:gap-2 mt-2 sm:mt-0 border-t border-surface-200/50 sm:border-0 pt-2 sm:pt-0">
                            {(userRole === 'admin' || userRole === 'representative' || currentUser?.customPermissions?.edit_orders) && onEdit && (
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onEdit(order)} title="تعديل">
                                    <Settings size={14} />
                                </Button>
                            )}
                            {userRole === 'admin' && onDelete && (
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => { if (confirm(deleteConfirmMessage)) onDelete(order); }} title={deleteTitle}>
                                    <Trash2 size={14} />
                                </Button>
                            )}


                            {onExportInvoice && (
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-blue-500 hover:text-blue-700 hover:bg-blue-50" onClick={() => onExportInvoice(order)} title="فاتورة PDF">
                                    <FileDown size={14} />
                                </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-primary-500" onClick={handleShowHistory} title="سجل">
                                <History size={14} />
                            </Button>
                        </div>
                    </div>
                </div>
            </Card>

            <OrderHistoryModal
                isOpen={showHistory}
                onClose={() => setShowHistory(false)}
                history={historyData}
                isLoading={historyLoading}
                events={eventsData}
                eventsLoading={eventsLoading}
                eventsError={eventsError}
                showBusinessTimeline={canViewBusinessTimeline}
                doctors={doctors}
                suppliers={suppliers}
                users={users}
            />


            {/* Edit Rejection Cost Dialog */}
            <ConfirmDialog
                isOpen={isEditingCost}
                title="تعديل تكلفة الرفض"
                message="قم بتعديل المبلغ المستحق للمعمل/المصمم عن هذا الأوردر المرفوض."
                variant="info"
                confirmLabel="حفظ التعديلات"
                cancelLabel="إلغاء"
                onConfirm={handleUpdateRejectedCost}
                onCancel={() => setIsEditingCost(false)}
            >
                <div className="text-right">
                    <label className="block text-sm font-medium text-surface-700 mb-1">
                        المبلغ المستحق (ج.م)
                    </label>
                    <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" size={16} />
                        <Input
                            type="number"
                            min="0"
                            className="pl-10"
                            value={editCostValue}
                            onChange={(e) => setEditCostValue(e.target.value ? Number(e.target.value) : '')}
                            autoFocus
                        />
                    </div>
                </div>
            </ConfirmDialog>
        </motion.div>
    );
};
