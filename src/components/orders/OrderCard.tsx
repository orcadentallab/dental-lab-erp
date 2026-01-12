import { Check, MessageCircle, Clock, Link as LinkIcon, AlertTriangle, ChevronRight, User, Calendar, Settings, Building2, StickyNote, Image as ImageIcon, Trash2 } from 'lucide-react';
import type { Order } from '../../services/db';
import clsx from 'clsx';
import { getTechStatusBadge, checkIsLate } from '../../utils/orderUtils';

interface OrderCardProps {
    order: Order;
    doctors: Record<string, string>;
    suppliers: Record<string, string>;
    userRole?: string;
    onStatusChange: (id: string, status: string) => void;
    onEdit?: (order: Order) => void;
    onAddNote?: (order: Order) => void;
    onTechAction?: (id: string, action: 'Approved' | 'Rejected' | 'NeedDetails' | 'PMMA_First') => void;
    onRequestRedo?: (order: Order) => void;
    onFeedback?: (order: Order) => void;
    onRegister?: (id: string) => void;
    hideSensitiveInfo?: boolean;
    onDelete?: (order: Order) => void;
}

export default function OrderCard({
    order,
    doctors,
    suppliers,
    userRole,
    onStatusChange,
    onEdit,
    onAddNote,
    onTechAction,
    hideSensitiveInfo,
    onDelete
}: OrderCardProps) {

    const isLate = checkIsLate(order);

    // Latest comment
    const latestComment = order.comments && order.comments.length > 0
        ? order.comments[order.comments.length - 1]
        : null;

    const isReturnedOrRejected = order.status === 'Returned for Adjustments' || order.technicianStatus === 'Rejected';

    return (
        <div className={clsx(
            "group relative border rounded-xl shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden bg-white dark:bg-gray-800",
            order.status === 'Delivered'
                ? 'border-green-200/60 dark:border-green-800'
                : isReturnedOrRejected
                    ? 'border-red-200/60 dark:border-red-800'
                    : 'border-gray-200 dark:border-gray-700'
        )}>
            {/* Urgent Status Strip (Left Side) */}
            {(order.isUrgent || order.priority === 'Urgent') && (
                <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-red-500 z-10" />
            )}

            <div className="flex flex-col h-full">
                {/* 1. Header Row: ID | Date | Status */}
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-gray-700 dark:text-gray-200">
                            #{order.caseId}
                        </span>
                        {(order.isUrgent || order.priority === 'Urgent') && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-bold bg-red-100 text-red-600 border border-red-200">
                                Urgent
                            </span>
                        )}
                        {order.status === 'Delivered' && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700 border border-green-200 flex items-center gap-1">
                                <Check size={10} strokeWidth={3} /> Delivered
                            </span>
                        )}
                        {isLate && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-600 border border-rose-200 flex items-center gap-1">
                                <Clock size={10} /> Late
                            </span>
                        )}
                    </div>

                    {/* Right Side: Actions & Date */}
                    <div className="flex items-center gap-2">
                        {/* Header Actions - Wide & Colored */}
                        <div className="flex items-center gap-2">
                            {onAddNote && (
                                <button
                                    onClick={() => onAddNote(order)}
                                    className={clsx(
                                        "flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold transition-all relative",
                                        order.comments && order.comments.length > 0
                                            ? "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                                            : "bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100 hover:text-blue-600"
                                    )}
                                    title="Notes"
                                >
                                    <MessageCircle size={14} />
                                    <span>ملاحظات</span>
                                    {(order.comments && order.comments.length > 0) && (
                                        <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white shadow-sm ring-1 ring-white">
                                            {order.comments.length}
                                        </span>
                                    )}
                                </button>
                            )}

                            {order.stlUrl && (
                                <a
                                    href={order.stlUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-all"
                                    title="Download STL"
                                >
                                    <LinkIcon size={14} />
                                    <span>STL</span>
                                </a>
                            )}

                            {order.imagesUrl && (
                                <a
                                    href={order.imagesUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-all"
                                    title="View Images"
                                >
                                    <ImageIcon size={14} />
                                    <span>صور</span>
                                </a>
                            )}

                            <button
                                onClick={handleShowHistory}
                                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 transition-all"
                                title="سجل النشاط"
                            >
                                <History size={14} />
                            </button>

                            {userRole === 'admin' && onEdit && (
                                <button
                                    onClick={() => onEdit(order)}
                                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100 transition-all"
                                    title="Edit Order"
                                >
                                    <Settings size={14} />
                                </button>
                            )}

                            {userRole === 'admin' && onDelete && (
                                <button
                                    onClick={() => {
                                        if (confirm(`⚠️ هل أنت متأكد من حذف هذا الأوردر (${order.caseId}) نهائياً؟`)) {
                                            onDelete(order);
                                        }
                                    }}
                                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-all"
                                    title="Delete Order"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>

                        <div className="h-4 w-px bg-gray-200 dark:bg-gray-700 mx-1"></div>

                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1" dir="ltr">
                            <Calendar size={12} className="text-gray-400" />
                            {order.deliveryDate}
                        </span>
                    </div>
                </div>

                {/* 2. Main Content Grid */}
                <div className="p-3 grid grid-cols-12 gap-3 items-center">
                    {/* Right Block (Patient & Doctor) - 5 Cols */}
                    <div className="col-span-12 md:col-span-5 flex flex-col gap-1.5 border-l-0 md:border-l border-gray-100 dark:border-gray-700 pl-0 md:pl-3">
                        {/* Patient */}
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 shrink-0">
                                <User size={16} />
                            </div>
                            <div className="flex flex-col overflow-hidden">
                                <span className="font-bold text-base text-gray-900 dark:text-gray-100 truncate leading-tight">
                                    {order.patientName}
                                </span>
                                <span className="text-[10px] text-gray-400 dark:text-gray-500">المريض</span>
                            </div>
                        </div>

                        {/* Doctor */}
                        {!hideSensitiveInfo && (
                            <div className="flex items-center gap-2 mt-0.5">
                                <div className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 shrink-0">
                                    <User size={14} />
                                </div>
                                <div className="flex flex-col overflow-hidden">
                                    <span className="font-bold text-sm text-gray-700 dark:text-gray-300 truncate leading-tight">
                                        d. {doctors[order.doctorId] || 'غير معروف'}
                                    </span>
                                    <span className="text-[10px] text-gray-400 dark:text-gray-500">الطبيب</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Middle Block (Services & Lab) - 7 Cols */}
                    <div className="col-span-12 md:col-span-7 flex flex-col gap-2">
                        {/* Services List */}
                        <div>
                            <span className="text-[10px] font-bold text-gray-400 mb-1 block">الخدمات المطلوبة</span>
                            <div className="flex flex-wrap gap-1.5">
                                {(order.items || []).map((item, idx) => (
                                    <span key={idx} className="inline-flex flex-col px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50">
                                        <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">{item.serviceType}</span>
                                        {item.teethNumbers && (
                                            <span className="text-[10px] text-indigo-500 dark:text-indigo-400 font-mono tracking-wide">
                                                Tooth: {Array.isArray(item.teethNumbers) ? item.teethNumbers.join(',') : item.teethNumbers}
                                            </span>
                                        )}
                                    </span>
                                ))}
                            </div>
                        </div>

                        {/* Lab / Supplier */}
                        {order.supplierId && suppliers[order.supplierId] && (
                            <div className="flex items-center gap-2 mt-1">
                                <Building2 size={14} className="text-purple-500" />
                                <span className="text-xs font-bold text-purple-700 dark:text-purple-400">
                                    معمل: {suppliers[order.supplierId]}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* 3. Instructions & Comments Area (Full Width, Distinct Background) */}
                {(order.instructions || latestComment) && (
                    <div className="px-3 py-2 bg-yellow-50/50 dark:bg-yellow-900/5 border-t border-dashed border-gray-100 dark:border-gray-700 flex flex-col gap-2">
                        {order.instructions && (
                            <div className="flex items-start gap-2">
                                <StickyNote size={14} className="text-yellow-600 mt-0.5 shrink-0" />
                                <p className="text-xs text-gray-700 dark:text-gray-300 leading-snug">
                                    <span className="font-bold text-yellow-700 ml-1">تعليمات:</span>
                                    {order.instructions}
                                </p>
                            </div>
                        )}
                        {latestComment && (
                            <div className="flex items-start gap-2">
                                <MessageCircle size={14} className="text-blue-500 mt-0.5 shrink-0" />
                                <p className="text-xs text-gray-700 dark:text-gray-300 leading-snug w-full">
                                    <span className="font-bold text-blue-600 ml-1">{latestComment.userName}:</span>
                                    "{latestComment.text}"
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {/* 4. Footer Actions (Robust Size) */}
                <div className="mt-auto px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700 flex flex-wrap items-center gap-3">

                    {/* Left Side: Status & Tech Actions */}
                    <div className="flex flex-wrap items-center gap-2 mr-auto w-full">
                        {/* Status Select (First on Left) */}
                        <div className="relative">
                            <select
                                value={order.status || 'New Case'}
                                onChange={(e) => onStatusChange(order.id, e.target.value)}
                                className={clsx(
                                    "appearance-none pl-2 pr-8 py-1.5 rounded-lg text-xs font-bold border shadow-sm cursor-pointer outline-none focus:ring-1 transition-all w-[140px]",
                                    order.status === 'Delivered'
                                        ? 'bg-green-100 text-green-800 border-green-200 ring-green-200'
                                        : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
                                )}
                                disabled={userRole === 'lab' && order.status === 'Delivered'}
                            >
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
                            <div className="absolute inset-y-0 right-2 flex items-center pointer-events-none text-gray-400">
                                <ChevronRight size={14} className="rotate-90" />
                            </div>
                        </div>

                        {/* Tech Actions */}
                        {onTechAction && (userRole === 'technician' || userRole === 'admin' || userRole === 'lab') && (
                            <div className="flex flex-wrap gap-2 items-center">
                                <button
                                    onClick={() => onTechAction(order.id, 'Approved')}
                                    className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all flex items-center gap-1.5 shadow-sm ${order.technicianStatus === 'Approved'
                                        ? 'bg-green-100 text-green-800 border-green-400 ring-2 ring-green-500/20'
                                        : 'bg-white text-gray-500 border-gray-200 hover:bg-green-50 hover:text-green-600 hover:border-green-200'
                                        }`}
                                >
                                    <Check size={12} strokeWidth={3} /> قبول
                                </button>
                                <button
                                    onClick={() => onTechAction(order.id, 'NeedDetails')}
                                    className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all flex items-center gap-1.5 shadow-sm ${order.technicianStatus === 'NeedDetails'
                                        ? 'bg-orange-100 text-orange-800 border-orange-400 ring-2 ring-orange-500/20'
                                        : 'bg-white text-gray-500 border-gray-200 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200'
                                        }`}
                                >
                                    <MessageCircle size={12} strokeWidth={3} /> تفاصيل
                                </button>
                                <button
                                    onClick={() => onTechAction(order.id, 'PMMA_First')}
                                    className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all flex items-center gap-1.5 shadow-sm ${order.technicianStatus === 'PMMA_First'
                                        ? 'bg-blue-100 text-blue-800 border-blue-400 ring-2 ring-blue-500/20'
                                        : 'bg-white text-gray-500 border-gray-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200'
                                        }`}
                                >
                                    <Clock size={12} strokeWidth={3} /> PMMA
                                </button>
                                <button
                                    onClick={() => onTechAction(order.id, 'Rejected')}
                                    className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all flex items-center gap-1.5 shadow-sm ${order.technicianStatus === 'Rejected'
                                        ? 'bg-red-100 text-red-800 border-red-400 ring-2 ring-red-500/20'
                                        : 'bg-white text-gray-500 border-gray-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200'
                                        }`}
                                >
                                    <AlertTriangle size={12} strokeWidth={3} /> رفض
                                </button>
                            </div>
                        )}

                        <div className="mr-auto">
                            {getTechStatusBadge(order.technicianStatus)}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
