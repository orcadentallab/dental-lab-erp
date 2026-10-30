import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { getOrderListColumns, orderListActionsClass } from './orderListLayout';

interface OrderListModalProps {
    title: string;
    isOpen: boolean;
    onClose: () => void;
    children: ReactNode;
    showDoctor?: boolean;
    showDeliveryDate?: boolean;
    hideCaseId?: boolean;
    showOrderHeaders?: boolean;
}

export default function OrderListModal({ title, isOpen, onClose, children, showDoctor = false, showDeliveryDate = false, hideCaseId = false, showOrderHeaders = true }: OrderListModalProps) {
    if (!isOpen) return null;

    const columns = getOrderListColumns(hideCaseId, showDeliveryDate);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-7xl max-h-[90vh] overflow-hidden flex flex-col" dir="rtl">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                    <h2 className="text-xl font-bold text-gray-800 dark:text-white">{title}</h2>
                    <button
                        onClick={onClose}
                        aria-label="إغلاق"
                        className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 min-h-0 overflow-y-auto p-4">
                    {/* Headers — mirrors OrderListItem's row layout (content grid + fixed actions column) */}
                    {showOrderHeaders && <div className="hidden lg:flex lg:items-center w-full px-3 pb-3 mb-3 border-b border-gray-300 dark:border-gray-600 font-bold text-sm text-gray-700 dark:text-gray-300">
                        <div className={`flex-1 min-w-0 grid ${columns} gap-4`}>
                            {!hideCaseId && <div>رقم الكيس</div>}
                            <div>{showDoctor ? 'المريض / الطبيب' : 'المريض'}</div>
                            <div>الخدمات</div>
                            <div>المعمل/المصمم</div>
                            {showDeliveryDate && <div>تاريخ التسليم</div>}
                            <div>الحالة</div>
                        </div>
                        <div className={`${orderListActionsClass} text-left`}>الإجراءات</div>
                    </div>}

                    {/* Order List */}
                    <div className="space-y-1">
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );
}
