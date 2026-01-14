import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface OrderListModalProps {
    title: string;
    isOpen: boolean;
    onClose: () => void;
    children: ReactNode;
}

export default function OrderListModal({ title, isOpen, onClose, children }: OrderListModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                    <h2 className="text-xl font-bold text-gray-800 dark:text-white">{title}</h2>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4">
                    {/* Headers */}
                    <div className="grid grid-cols-5 gap-4 pb-3 mb-3 border-b border-gray-300 dark:border-gray-600 font-bold text-sm text-gray-700 dark:text-gray-300">
                        <div>رقم الكيس</div>
                        <div>المريض</div>
                        <div>الخدمات</div>
                        <div>المعمل/المصمم</div>
                        <div>الحالة</div>
                    </div>

                    {/* Order List */}
                    <div className="space-y-1">
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );
}
