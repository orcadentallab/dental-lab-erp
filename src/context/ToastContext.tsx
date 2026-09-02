import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import clsx from 'clsx';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
    id: string;
    message: string;
    type: ToastType;
}

interface ToastContextType {
    showToast: (message: string, type: ToastType) => void;
    success: (message: string) => void;
    error: (message: string) => void;
    warning: (message: string) => void;
    info: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    const showToast = useCallback((message: string, type: ToastType = 'info') => {
        const id = Math.random().toString(36).substring(2, 9);
        setToasts((prev) => [...prev, { id, message, type }]);
        setTimeout(() => removeToast(id), 4000);
    }, [removeToast]);

    /**
     * These MUST stay referentially stable, and the context value with them.
     * Consumers put `toastError` in a useCallback dependency list and then
     * feed that callback to useEffect. When these were rebuilt every render,
     * one failed fetch became an infinite loop: the toast re-rendered the
     * provider, the provider handed out a new `error`, the effect saw a new
     * dependency and fetched again. The production board hammered Supabase
     * hundreds of times a second until the database started timing out other
     * pages' queries.
     */
    const success = useCallback((msg: string) => showToast(msg, 'success'), [showToast]);
    const error = useCallback((msg: string) => showToast(msg, 'error'), [showToast]);
    const warning = useCallback((msg: string) => showToast(msg, 'warning'), [showToast]);
    const info = useCallback((msg: string) => showToast(msg, 'info'), [showToast]);

    const value = useMemo(
        () => ({ showToast, success, error, warning, info }),
        [showToast, success, error, warning, info]
    );

    return (
        <ToastContext.Provider value={value}>
            {children}
            <div className="fixed bottom-4 left-4 z-[9999] flex flex-col gap-2 pointer-events-none">
                <AnimatePresence>
                    {toasts.map((toast) => (
                        <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
                    ))}
                </AnimatePresence>
            </div>
        </ToastContext.Provider>
    );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
    const icons = {
        success: <CheckCircle size={20} />,
        error: <AlertCircle size={20} />,
        warning: <AlertTriangle size={20} />,
        info: <Info size={20} />
    };

    const styles = {
        success: 'bg-white border-green-200 text-green-800 shadow-green-100',
        error: 'bg-white border-red-200 text-red-800 shadow-red-100',
        warning: 'bg-white border-yellow-200 text-yellow-800 shadow-yellow-100',
        info: 'bg-white border-blue-200 text-blue-800 shadow-blue-100'
    };

    const iconColors = {
        success: 'text-green-500',
        error: 'text-red-500',
        warning: 'text-yellow-500',
        info: 'text-blue-500'
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
            layout
            className={clsx(
                "pointer-events-auto flex items-center gap-3 min-w-[300px] max-w-md p-4 rounded-xl border shadow-lg backdrop-blur-sm",
                styles[toast.type]
            )}
        >
            <div className={clsx("shrink-0", iconColors[toast.type])}>{icons[toast.type]}</div>
            <p className="text-sm font-bold flex-1 leading-snug">{toast.message}</p>
            <button onClick={onClose} className="shrink-0 opacity-50 hover:opacity-100 transition-opacity">
                <X size={16} />
            </button>
        </motion.div>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
}
