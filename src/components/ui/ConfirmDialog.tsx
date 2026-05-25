import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import clsx from 'clsx';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'warning' | 'info';
    onConfirm: () => void;
    onCancel: () => void;
    isLoading?: boolean;
    confirmDisabled?: boolean;
    children?: React.ReactNode;
}

export function ConfirmDialog({
    isOpen,
    title,
    message,
    confirmLabel = 'تأكيد',
    cancelLabel = 'إلغاء',
    variant = 'danger',
    onConfirm,
    onCancel,
    isLoading = false,
    confirmDisabled = false,
    children
}: ConfirmDialogProps) {
    if (!isOpen) return null;

    const colors = {
        danger: 'bg-red-50 text-red-600 border-red-100',
        warning: 'bg-yellow-50 text-yellow-600 border-yellow-100',
        info: 'bg-blue-50 text-blue-600 border-blue-100'
    };

    const confirmButtonVariants = {
        danger: 'bg-red-600 hover:bg-red-700 text-white shadow-red-200',
        warning: 'bg-yellow-600 hover:bg-yellow-700 text-white shadow-yellow-200',
        info: 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200'
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                    onClick={onCancel}
                />

                <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    className="relative bg-white dark:bg-surface-800 rounded-2xl shadow-xl w-full max-w-sm overflow-hidden border border-surface-200 dark:border-surface-700"
                >
                    <div className="p-6 text-center">
                        <div className={clsx("w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center border-4 border-white dark:border-surface-800 shadow-sm", colors[variant])}>
                            <AlertTriangle size={32} />
                        </div>

                        <h3 className="text-xl font-bold text-surface-900 dark:text-white mb-2">{title}</h3>
                        <p className="text-surface-500 text-sm leading-relaxed mb-6">{message}</p>

                        {children && (
                            <div className="mb-6 text-right">
                                {children}
                            </div>
                        )}

                        <div className="flex gap-3 justify-center">
                            <Button
                                variant="ghost"
                                onClick={onCancel}
                                disabled={isLoading}
                                className="flex-1"
                            >
                                {cancelLabel}
                            </Button>
                            <Button
                                onClick={onConfirm}
                                isLoading={isLoading}
                                disabled={confirmDisabled || isLoading}
                                className={clsx("flex-1 shadow-lg", confirmButtonVariants[variant])}
                            >
                                {confirmLabel}
                            </Button>
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
