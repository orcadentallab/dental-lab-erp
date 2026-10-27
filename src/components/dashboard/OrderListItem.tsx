import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import type { Order } from '../../services/db';
import { getTechStatusBadge, getStatusColor, getStatusText } from '../../utils/orderUtils';
import { getOrderCardDisplayDate } from '../../utils/orderDisplay';
import { getOrderListColumns, orderListActionsClass } from './orderListLayout';
import { getEffectiveIssueState, getEffectiveOrderDisplayStatus, getEffectiveProductionStatus } from '../../constants/orderLifecycle';

interface OrderListItemProps {
    order: Order;
    labName?: string;
    designerName?: string;
    doctorName?: string;
    showDoctor?: boolean;
    deliveryDateLabel?: React.ReactNode;
    deliveryDateValue?: React.ReactNode;
    showDeliveryDate?: boolean;
    hideCaseId?: boolean;
    onEditDeliveryDate?: (order: Order) => void;
    onMarkReviewed?: () => void;
    onRegister?: (orderId: string) => void;
    showRegister?: boolean;
    onAccept?: (order: Order) => void;
    onArchive?: (orderId: string) => void;
    customDetails?: React.ReactNode;
    customActions?: React.ReactNode;
}

const OrderListItem = React.memo(function OrderListItem({
    order,
    labName,
    designerName,
    doctorName,
    showDoctor = false,
    deliveryDateLabel,
    deliveryDateValue,
    showDeliveryDate = false,
    hideCaseId = false,
    onEditDeliveryDate,
    onMarkReviewed,
    onRegister,
    showRegister = false,
    onAccept,
    onArchive,
    customDetails,
    customActions
}: OrderListItemProps) {
    const navigate = useNavigate();
    const displayDate = getOrderCardDisplayDate(order);

    const handleNavigate = () => {
        navigate(`/orders?highlight=${order.id}`);
    };

    // Clicking anywhere on the row (except on an actual control) opens the case in the orders page
    const handleRowClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target;
        if (target instanceof Element && target.closest('button, a, input, select, textarea, label')) return;
        handleNavigate();
    };

    const assigneeDisplayName = [labName, designerName].filter(Boolean).join(' / ') || '-';
    const columns = getOrderListColumns(hideCaseId, showDeliveryDate);
    const displayStatus = getEffectiveOrderDisplayStatus(order) || 'غير محدد';
    const issueState = getEffectiveIssueState(order);
    const isDelivered = getEffectiveProductionStatus(order) === 'final_delivered' && issueState === 'none';
    const canArchiveIssue = ['doctor_rejected', 'lab_rejected', 'returned', 'redo'].includes(issueState);

    return (
        <div
            onClick={handleRowClick}
            title="فتح الحالة في صفحة الأوردرات"
            className="flex flex-col p-3 cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors border-b border-surface-200 dark:border-surface-700 last:border-0 gap-3"
        >
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 lg:gap-0 w-full">
                <div className={`flex-1 min-w-0 flex flex-col lg:grid ${columns} gap-2 lg:gap-4 lg:items-center`}>
                    <div className="flex flex-wrap items-center gap-2 lg:contents">
                        {!hideCaseId && (
                            <div className="min-w-0 max-w-full">
                                <button
                                    type="button"
                                    dir="ltr"
                                    onClick={handleNavigate}
                                    title="فتح الحالة في صفحة الأوردرات"
                                    className="max-w-full break-all font-mono text-xs lg:text-sm font-bold text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 px-1.5 py-0.5 rounded border border-primary-100 dark:border-primary-800 hover:bg-primary-100 dark:hover:bg-primary-900/50 hover:underline transition-colors"
                                >
                                    #{order.caseId}
                                </button>
                            </div>
                        )}

                        {/* Patient / Doctor */}
                        <div className="min-w-0 flex-1 lg:col-span-1">
                            <div className="flex flex-col items-start gap-1 break-words [overflow-wrap:anywhere]">
                                <span className="max-w-full text-sm font-bold text-surface-900 dark:text-surface-100">
                                    {order.patientName}
                                </span>
                                {showDoctor && (
                                    <span className="max-w-full text-xs text-surface-500 dark:text-surface-400">
                                        {doctorName || '-'}
                                    </span>
                                )}
                                {order.branchName && (
                                    <span className="text-[10px] bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900 px-1.5 py-0.5 rounded font-medium truncate max-w-[120px]" title={order.branchName}>
                                        {order.branchName}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col items-stretch gap-3 lg:contents">
                        {/* Services */}
                        <div className="min-w-0 lg:col-span-1">
                            <div className="flex flex-wrap gap-1">
                                {order.items?.slice(0, 2).map((item, idx) => (
                                    <span key={idx} dir="auto" className="max-w-full break-words [overflow-wrap:anywhere] text-xs bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 text-surface-700 dark:text-surface-300 px-1.5 py-0.5 rounded">
                                        {item.serviceType}
                                    </span>
                                ))}
                                {order.items && order.items.length > 2 && (
                                    <span className="text-[10px] md:text-xs text-surface-500 bg-surface-50 dark:bg-surface-800/50 px-1 rounded">+{order.items.length - 2}</span>
                                )}
                            </div>
                        </div>

                        {/* Lab/Designer Name */}
                        <div className="min-w-0 lg:col-span-1">
                            <span dir="auto" className="block break-words [overflow-wrap:anywhere] text-xs leading-relaxed text-surface-600 dark:text-surface-400">
                                {assigneeDisplayName}
                            </span>
                        </div>

                        {showDeliveryDate && (
                            <div className="lg:col-span-1 min-w-0 break-words">
                                <div className="flex flex-col gap-1">
                                    <div dir="auto" className="text-xs font-semibold text-surface-800 dark:text-surface-200">
                                        {deliveryDateValue || displayDate.date || '-'}
                                    </div>
                                    {(deliveryDateLabel || displayDate.label) && (
                                        <div className="text-[10px] text-surface-500 dark:text-surface-400">
                                            {deliveryDateLabel || displayDate.label}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Status */}
                        <div className="min-w-0 lg:col-span-1">
                            <div className="flex flex-wrap items-center gap-1">
                                <span className={`max-w-full break-words text-xs px-2 py-1 rounded font-bold border ${getStatusColor(displayStatus)}`}>
                                    {getStatusText(displayStatus)}
                                </span>
                                {/* Lab Rejection / Tech Status Badge */}
                                {(order.technicianStatus && order.technicianStatus !== 'Pending') && (
                                    <div className="scale-75 md:scale-90 origin-right">
                                        {getTechStatusBadge(order.technicianStatus)}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className={`flex flex-wrap gap-2 mt-2 lg:mt-0 ${orderListActionsClass} justify-end [&_button]:max-w-full`}>
                    {customActions ? (
                        customActions
                    ) : (
                        <>
                            {(canArchiveIssue || order.technicianStatus === 'Rejected') && onArchive && (
                                <button
                                    onClick={() => {
                                        if (confirm('هل أنت متأكد من أرشفة هذه الحالة؟')) {
                                            onArchive(order.id);
                                        }
                                    }}
                                    className="flex-1 md:flex-none justify-center text-xs bg-surface-100 hover:bg-red-50 text-surface-600 hover:text-red-600 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 border border-surface-200"
                                    title="أرشفة"
                                >
                                    <Trash2 size={14} />
                                    <span>أرشفة</span>
                                </button>
                            )}
                            <button
                                onClick={handleNavigate}
                                className="flex-1 md:flex-none justify-center text-xs font-bold bg-primary-600 hover:bg-primary-700 text-white px-4 py-1.5 rounded-lg transition-colors shadow-sm"
                            >
                                تفاصيل
                            </button>
                            {onEditDeliveryDate && (
                                <button
                                    onClick={() => onEditDeliveryDate(order)}
                                    className="flex-1 md:flex-none justify-center text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white px-4 py-1.5 rounded-lg transition-colors shadow-sm"
                                >
                                    تعديل التسليم
                                </button>
                            )}
                            {onMarkReviewed && (
                                <button
                                    onClick={onMarkReviewed}
                                    className="flex-1 md:flex-none justify-center text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded-lg transition-colors shadow-sm"
                                >
                                    تمت المراجعة
                                </button>
                            )}
                            {showRegister && !order.isRegistered && isDelivered && onRegister && (
                                <button
                                    onClick={() => onRegister(order.id)}
                                    className="flex-1 md:flex-none justify-center text-xs font-bold bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg transition-colors shadow-sm"
                                >
                                    تسجيل
                                </button>
                            )}
                            {onAccept && (
                                <button
                                    onClick={() => onAccept(order)}
                                    className="flex-1 md:flex-none justify-center text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white px-4 py-1.5 rounded-lg transition-colors shadow-sm shadow-teal-200"
                                >
                                    قبول الحالة
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {customDetails && (
                <div className="w-full min-w-0 break-words [overflow-wrap:anywhere]">
                    {customDetails}
                </div>
            )}
        </div>
    );
});

export default OrderListItem;
