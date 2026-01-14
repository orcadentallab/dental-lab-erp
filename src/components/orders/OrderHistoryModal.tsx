import { X, Clock, User, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import type { OrderHistoryEntry } from '../../services/db';

interface OrderHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    history: OrderHistoryEntry[];
    isLoading: boolean;

}

export default function OrderHistoryModal({ isOpen, onClose, history, isLoading }: OrderHistoryModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                            <Clock size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-800">سجل النشاط (Audit Log)</h3>
                            <p className="text-xs text-gray-500">تتبع جميع التعديلات والحالات لهذا الطلب</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="إغلاق">
                        <X size={24} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        </div>
                    ) : history.length === 0 ? (
                        <div className="text-center py-8 text-gray-400">
                            <p>لا يوجد سجل نشاط لهذا الطلب بعد.</p>
                        </div>
                    ) : (
                        <div className="space-y-6 relative before:absolute before:inset-y-0 before:right-[19px] before:w-0.5 before:bg-gray-200">
                            {history.map((item) => (
                                <div key={item.id} className="relative flex gap-4 pr-10">
                                    {/* Timeline Dot */}
                                    <div className={`absolute right-0 top-1 w-10 h-10 rounded-full flex items-center justify-center border-4 border-white shadow-sm z-10 ${item.action_type === 'CREATE' ? 'bg-green-100 text-green-600' :
                                        item.action_type === 'STATUS_CHANGE' ? 'bg-purple-100 text-purple-600' :
                                            item.action_type === 'UPDATE' ? 'bg-blue-100 text-blue-600' :
                                                'bg-gray-100 text-gray-600'
                                        }`}>
                                        {item.action_type === 'CREATE' ? <Clock size={16} /> : <User size={16} />}
                                    </div>

                                    {/* Content Card */}
                                    <div className="flex-1 bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold text-gray-800 text-sm">{item.user_name || 'System'}</span>
                                                <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-mono">
                                                    {item.action_type}
                                                </span>
                                            </div>
                                            <span className="text-xs text-gray-400" dir="ltr">
                                                {format(new Date(item.created_at), 'dd/MM/yyyy hh:mm a', { locale: ar })}
                                            </span>
                                        </div>

                                        <p className="text-sm text-gray-600 font-medium mb-2">{item.details}</p>

                                        {/* Changes Diff */}
                                        {item.changes && Object.keys(item.changes).length > 0 && (
                                            <div className="bg-gray-50 rounded-lg p-2 text-xs text-gray-500 space-y-1">
                                                {/* Special handling for CREATE - show subset of fields or nothing */}
                                                {item.action_type === 'CREATE' ? (
                                                    <div className="text-gray-400 italic">تم إنشاء الطلب</div>
                                                ) : (
                                                    Object.entries(item.changes).map(([key, val]) => {
                                                        // Safety check: ensure val is an object with old/new
                                                        if (!val || typeof val !== 'object') return null;
                                                        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                                                        const safeVal = val as Record<string, unknown>;

                                                        return (
                                                            <div key={key} className="flex items-center gap-2">
                                                                <span className="font-semibold text-gray-400">{key}:</span>
                                                                <span className="text-red-500 line-through bg-red-50 px-1 rounded">{String(safeVal.old || 'Empty')}</span>
                                                                <ArrowRight size={10} className="text-gray-400" />
                                                                <span className="text-green-600 font-bold bg-green-50 px-1 rounded">{String(safeVal.new || 'Empty')}</span>
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
