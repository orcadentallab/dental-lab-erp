import { Check, X, HelpCircle, FileSearch } from 'lucide-react';
import type { Order } from '../services/db';

export const getStatusColor = (status: string) => {
    switch (status) {
        case 'New Case': return 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800';
        case 'Under Design': return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800';
        case 'Waiting Dr Approval': return 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800';
        case 'Under Production': return 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800';
        case 'Try In': return 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800';
        case 'Try In Approved': return 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800';
        case 'Ready': return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800';
        case 'Delivered': return 'bg-green-600 text-white border-green-700 shadow-sm';
        case 'Returned for Adjustments': return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800';
        case 'Pending': return 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400';
        default: return 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';
    }
};

export const getStatusText = (status: string) => {
    const map: Record<string, string> = {
        'New Case': 'حالة جديدة',
        'Under Design': 'جاري التصميم',
        'Waiting Dr Approval': 'بانتظار موافقة الطبيب',
        'Under Production': 'جاري التصنيع',
        'Try In': 'بروفة (Try-In)',
        'Try In Approved': 'بروفة موافق - تنفيذ Final',
        'Ready': 'جاهز',
        'Delivered': 'تم التسليم',
        'Returned for Adjustments': 'مرتجع للتعديل',
        'Pending': 'قيد الانتظار',
        'In Progress': 'جاري العمل',
        'Completed': 'مكتمل'
    };
    return map[status] || status;
};

export const getTechStatusBadge = (status?: string) => {
    switch (status) {
        case 'Approved': return <span className="flex items-center gap-1 text-[10px] font-bold text-green-600 bg-green-50 dark:bg-green-900/30 px-1.5 py-0.5 rounded border border-green-100 dark:border-green-800"><Check size={10} /> مقبول</span>;
        case 'Rejected': return <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 dark:bg-red-900/30 px-1.5 py-0.5 rounded border border-red-100 dark:border-red-800"><X size={10} /> مرفوض</span>;
        case 'NeedDetails': return <span className="flex items-center gap-1 text-[10px] font-bold text-orange-600 bg-orange-50 dark:bg-orange-900/30 px-1.5 py-0.5 rounded border border-orange-100 dark:border-orange-800"><HelpCircle size={10} /> تفاصيل؟</span>;
        case 'PMMA_First': return <span className="flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded border border-blue-100 dark:border-blue-800"><FileSearch size={10} /> PMMA</span>;
        default: return null;
    }
};

export const checkIsLate = (order: Order) => {
    if (!order.deliveryDate) return false;
    const actualDate = order.actualDeliveryDate || (order.status !== 'Delivered' ? new Date().toISOString().split('T')[0] : '');
    if (!actualDate) return false;

    if (order.status === 'Delivered' && order.actualDeliveryDate) {
        return order.actualDeliveryDate > order.deliveryDate;
    } else if (order.status !== 'Delivered') {
        return new Date().toISOString().split('T')[0] > order.deliveryDate;
    }
    return false;
};
