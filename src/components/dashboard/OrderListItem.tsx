import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import type { Order } from '../../services/db';
import { getTechStatusBadge } from '../../utils/orderUtils';
import { getOrderCardDisplayDate } from '../../utils/orderDisplay';

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

    const assigneeDisplayName = [labName, designerName].filter(Boolean).join(' / ') || '-';
    const columns = hideCaseId
        ? (showDeliveryDate ? 'md:grid-cols-5' : 'md:grid-cols-4')
        : (showDeliveryDate ? 'md:grid-cols-6' : 'md:grid-cols-5');

    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between p-3 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors border-b border-surface-200 dark:border-surface-700 last:border-0 gap-3 md:gap-0">
            <div className={`flex-1 flex flex-col md:grid ${columns} gap-2 md:gap-4 md:items-center`}>
                <div className="flex items-center gap-2 md:contents">
                    {!hideCaseId && (
                        <div className="shrink-0 md:shrink">
                            <span className="font-mono text-xs md:text-sm font-bold text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 px-1.5 py-0.5 rounded border border-primary-100 dark:border-primary-800">
                                #{order.caseId}
                            </span>
                        </div>
                    )}

                    {/* Patient / Doctor */}
                    <div className="min-w-0 md:col-span-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-bold text-surface-900 dark:text-surface-100 truncate">
                                {order.patientName}
                            </span>
                            {showDoctor && (
                                <span className="text-xs text-surface-500 dark:text-surface-400 truncate">
                                    / {doctorName || '-'}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap md:contents">
                    {/* Services */}
                    <div className="md:col-span-1">
                        <div className="flex flex-wrap gap-1">
                            {order.items?.slice(0, 2).map((item, idx) => (
                                <span key={idx} className="text-[10px] md:text-xs bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 text-surface-700 dark:text-surface-300 px-1.5 py-0.5 rounded truncate max-w-[80px] md:max-w-[100px]">
                                    {item.serviceType}
                                </span>
                            ))}
                            {order.items && order.items.length > 2 && (
                                <span className="text-[10px] md:text-xs text-surface-500 bg-surface-50 dark:bg-surface-800/50 px-1 rounded">+{order.items.length - 2}</span>
                            )}
                        </div>
                    </div>

                    {/* Lab/Designer Name */}
                    <div className="md:col-span-1 hidden sm:block">
                        <span className="text-xs text-surface-600 dark:text-surface-400 truncate">
                            {assigneeDisplayName}
                        </span>
                    </div>

                    {showDeliveryDate && (
                        <div className="md:col-span-1 min-w-0">
                            <div className="flex flex-col gap-1">
                                <div className="text-xs font-semibold text-surface-800 dark:text-surface-200">
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
                    <div className="md:col-span-1">
                        <div className="flex items-center gap-1">
                            <span className={`text-[10px] md:text-xs px-2 py-0.5 md:py-1 rounded font-bold border ${order.status === 'Rejected' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-surface-50 dark:bg-surface-800 text-surface-700 dark:text-surface-300 border-surface-200 dark:border-surface-700'}`}>
                                {order.status === 'Rejected' ? 'رفض طبيب' : order.status}
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

            {customDetails && (
                <div className="mt-2 w-full">
                    {customDetails}
                </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 mt-2 md:mt-0 md:mr-4 justify-end">
                {customActions ? (
                    customActions
                ) : (
                    <>
                        {(order.status === 'Rejected' || order.status === 'Returned for Adjustments' || order.technicianStatus === 'Rejected') && onArchive && (
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
                        {showRegister && !order.isRegistered && order.status === 'Delivered' && onRegister && (
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
    );
});

export default OrderListItem;
