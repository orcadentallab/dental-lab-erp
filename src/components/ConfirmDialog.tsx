import { useId } from 'react';
import { X } from 'lucide-react';
import { useDialogBehavior } from '../hooks/useDialogBehavior';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    onCancel: () => void;
    variant?: 'danger' | 'warning' | 'info';
}

export default function ConfirmDialog({
    isOpen,
    title,
    message,
    confirmText = 'تأكيد',
    cancelText = 'إلغاء',
    onConfirm,
    onCancel,
    variant = 'danger'
}: ConfirmDialogProps) {
    const titleId = useId();
    const messageId = useId();
    const dialogRef = useDialogBehavior(isOpen, onCancel);
    if (!isOpen) return null;

    const variantStyles = {
        danger: 'bg-red-600 hover:bg-red-700',
        warning: 'bg-amber-600 hover:bg-amber-700',
        info: 'bg-blue-600 hover:bg-blue-700'
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId} tabIndex={-1} className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h3 id={titleId} className="text-lg font-bold text-gray-800">{title}</h3>
                    <button 
                        onClick={onCancel} 
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                        aria-label="إغلاق"
                    >
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6">
                    <p id={messageId} className="text-gray-700 mb-6">{message}</p>
                    <div className="flex gap-3 justify-end [&>button]:min-h-11">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            {cancelText}
                        </button>
                        <button
                            type="button"
                            onClick={onConfirm}
                            className={`px-4 py-2 text-white font-bold rounded-lg transition-colors ${variantStyles[variant]}`}
                        >
                            {confirmText}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
