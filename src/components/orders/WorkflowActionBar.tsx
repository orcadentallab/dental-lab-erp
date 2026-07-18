import { useState, useRef, useEffect } from 'react';
import {
    Play, PenTool, ArrowRight, Package, PackageCheck, Truck,
    CheckCircle, RotateCcw, XCircle, Ban, MoreHorizontal, RefreshCw,
    AlertTriangle, ChevronDown
} from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Input } from '../ui/Input';
import type { Order } from '../../services/db';
import { getEffectiveProductionStatus, getEffectiveIssueState } from '../../constants/orderLifecycle';
import { getForwardActions, getIssueActions, type WorkflowAction } from '../../constants/workflowTransitions';
import clsx from 'clsx';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
    Play, PenTool, ArrowRight, Package, PackageCheck, Truck,
    CheckCircle, RotateCcw, XCircle, Ban, RefreshCw,
};

const LEGACY_STATUS_LABELS_AR: Record<string, string> = {
    'New Case':                   'حالة جديدة',
    'Pending Review':             'قيد المراجعة',
    'Under Design':               'قيد التصميم',
    'Waiting Dr Approval':        'انتظار موافقة الطبيب',
    'Under Production':           'قيد التنفيذ',
    'Sent to External Lab':       'أُرسل للمعمل',
    'Try In':                     'البروفة',
    'Try In Approved':            'موافقة البروفة',
    'Ready':                      'جاهز للتسليم',
    'Delivered':                  'تم التسليم',
    'Returned for Adjustments':   'مرتجع للتعديل',
    'Doctor Rejected':            'مرتجع طبيب',
    'Lab Rejected':               'رفض معمل',
    'Rejected':                   'مرفوض',
    'Cancelled':                  'ملغي',
};

function isValidOrderStatus(status: string): status is Order['status'] {
    const validStatuses: string[] = [
        'Pending', 'In Progress', 'Completed', 'Delivered', 'New Case', 'Under Design',
        'Waiting Dr Approval', 'Under Production', 'Try In', 'Try In Approved', 'Ready',
        'Returned for Adjustments', 'Doctor Rejected', 'Lab Rejected', 'Cancelled', 'Pending Review'
    ];
    return validStatuses.includes(status);
}

interface Props {
    order: Order;
    userRole?: string;
    onStatusChange: (id: string, status: Order['status'] | 'same', context?: { rejectedLabCost?: number; comment?: string }) => void;
    onRedo?: (order: Order) => void;
    showLegacyFallback?: boolean;
    disabled?: boolean;
}

export default function WorkflowActionBar({ order, userRole, onStatusChange, onRedo, showLegacyFallback, disabled }: Props) {
    const [confirmAction, setConfirmAction] = useState<WorkflowAction | null>(null);
    const [showIssueMenu, setShowIssueMenu] = useState(false);
    const [rejectedLabCost, setRejectedLabCost] = useState<number | ''>('');
    const [noteText, setNoteText] = useState('');
    const issueMenuRef = useRef<HTMLDivElement>(null);

    const productionStatus = getEffectiveProductionStatus(order);
    const issueState = getEffectiveIssueState(order);

    const forwardActions = getForwardActions(productionStatus, issueState, {
        workflowType: order.workflowType,
        deliveryType: order.deliveryType,
        designUrl: order.designUrl,
        status: order.status,
    });

    const issueActions = getIssueActions(issueState, userRole);
    const canRedo = (userRole === 'admin' || userRole === 'representative')
        && !!onRedo
        && order.issueState !== 'cancelled'
        && order.issueState !== 'redo';
    const hasIssueOptions = issueActions.length > 0 || canRedo;

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (e.target instanceof Node) {
                if (issueMenuRef.current && !issueMenuRef.current.contains(e.target)) {
                    setShowIssueMenu(false);
                }
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const handleActionClick = (action: WorkflowAction) => {
        setShowIssueMenu(false);
        if (action.requiresConfirmation) {
            setConfirmAction(action);
            setRejectedLabCost('');
            setNoteText('');
        } else {
            if (isValidOrderStatus(action.targetLegacyStatus)) {
                onStatusChange(order.id, action.targetLegacyStatus);
            }
        }
    };

    const handleConfirm = () => {
        if (!confirmAction) return;
        if (confirmAction.requiresNote && !noteText.trim()) return;
        const context: { rejectedLabCost?: number; comment?: string } = {};
        if (['reject', 'cancel'].includes(confirmAction.id)) {
            context.rejectedLabCost = rejectedLabCost !== '' ? Number(rejectedLabCost) : 0;
        }
        if (noteText.trim()) {
            context.comment = noteText.trim();
        }
        if (isValidOrderStatus(confirmAction.targetLegacyStatus)) {
            onStatusChange(order.id, confirmAction.targetLegacyStatus, Object.keys(context).length ? context : undefined);
        }
        setConfirmAction(null);
        setRejectedLabCost('');
        setNoteText('');
    };

    const getButtonClass = (variant: string) => {
        switch (variant) {
            case 'primary': return 'bg-primary-600 hover:bg-primary-700 text-white border-primary-600';
            case 'success': return 'bg-green-600 hover:bg-green-700 text-white border-green-600';
            case 'warning': return 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500';
            case 'danger':  return 'bg-red-600 hover:bg-red-700 text-white border-red-600';
            default:        return 'bg-white hover:bg-surface-50 text-surface-700 border-surface-200';
        }
    };

    const renderActionButton = (action: WorkflowAction) => {
        const Icon = action.icon ? ICON_MAP[action.icon] : null;
        return (
            <button
                key={action.id}
                onClick={() => handleActionClick(action)}
                aria-label={action.label}
                disabled={disabled}
                className={clsx(
                    'inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm transition-all sm:min-h-0',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    getButtonClass(action.variant)
                )}
                title={action.label}
            >
                {Icon && <Icon size={13} />}
                <span>{action.label}</span>
            </button>
        );
    };

    const currentStatusLabel = LEGACY_STATUS_LABELS_AR[order.status] || order.status;

    return (
        <>
            <div className="flex flex-wrap items-center gap-1.5">
                {/* Current Status Pill */}
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-surface-100 border border-surface-300 text-surface-600 dark:bg-surface-800 dark:border-surface-600 dark:text-surface-300 shrink-0 select-none">
                    {currentStatusLabel}
                </span>

                {(forwardActions.length > 0 || hasIssueOptions) && (
                    <span className="text-surface-300 text-xs select-none">←</span>
                )}

                {/* Forward Actions */}
                {forwardActions.map(renderActionButton)}

                {/* Issue Dropdown — all issue + redo actions collapsed */}
                {hasIssueOptions && (
                    <div className="relative" ref={issueMenuRef}>
                        <button
                            onClick={() => setShowIssueMenu(v => !v)}
                            disabled={disabled}
                            aria-label="فتح إجراءات المشكلة"
                            aria-expanded={showIssueMenu}
                            className={clsx(
                                'inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm transition-all sm:min-h-0',
                                'disabled:opacity-50 disabled:cursor-not-allowed',
                                showIssueMenu
                                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                                    : 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200'
                            )}
                        >
                            <AlertTriangle size={13} />
                            <span>مشكلة</span>
                            <ChevronDown size={11} className={clsx('transition-transform duration-150', showIssueMenu && 'rotate-180')} />
                        </button>

                        {showIssueMenu && (
                            <div className="absolute bottom-full mb-1.5 right-0 z-50 bg-white border border-surface-200 rounded-xl shadow-xl p-1.5 min-w-[175px]">
                                {issueActions.map(action => {
                                    const Icon = action.icon ? ICON_MAP[action.icon] : null;
                                    return (
                                        <button
                                            key={action.id}
                                            onClick={() => handleActionClick(action)}
                                            disabled={disabled}
                                            className={clsx(
                                                'flex min-h-11 w-full items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition-colors sm:min-h-0',
                                                action.variant === 'danger'
                                                    ? 'text-red-600 hover:bg-red-50'
                                                    : 'text-amber-700 hover:bg-amber-50'
                                            )}
                                        >
                                            {Icon && <Icon size={13} />}
                                            <span>{action.label}</span>
                                        </button>
                                    );
                                })}
                                {canRedo && (
                                    <>
                                        {issueActions.length > 0 && (
                                            <div className="my-1 border-t border-surface-100" />
                                        )}
                                        <button
                                            onClick={() => { setShowIssueMenu(false); onRedo!(order); }}
                                            disabled={disabled}
                                            className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg text-amber-600 hover:bg-amber-50 transition-colors sm:min-h-0"
                                        >
                                            <RefreshCw size={13} />
                                            <span>إعادة إنتاج</span>
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Legacy Fallback — admin override dropdown */}
                {showLegacyFallback && userRole === 'admin' && (
                    <div className="relative flex items-center">
                        <button
                            className="inline-flex min-h-10 min-w-10 items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-bold border border-surface-200 bg-white hover:bg-surface-50 text-surface-500 transition-all focus-within:ring-2 focus-within:ring-primary-500 sm:min-h-0 sm:min-w-0"
                            title="خيارات إضافية"
                            aria-label="تغيير الحالة"
                        >
                            <MoreHorizontal size={14} />
                        </button>
                        <select
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            aria-label="تغيير الحالة"
                            value=""
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val && isValidOrderStatus(val)) {
                                    onStatusChange(order.id, val);
                                }
                            }}
                        >
                            <option value="" disabled>اختر حالة...</option>
                            {[
                                { label: 'Pending Review', value: 'Pending Review' },
                                { label: 'New Case', value: 'New Case' },
                                { label: 'Under Design', value: 'Under Design' },
                                { label: 'Waiting Dr Approval', value: 'Waiting Dr Approval' },
                                { label: 'Under Production', value: 'Under Production' },
                                { label: 'Try In', value: 'Try In' },
                                { label: 'Try In Approved', value: 'Try In Approved' },
                                { label: 'Ready', value: 'Ready' },
                                { label: 'Delivered', value: 'Delivered' },
                                { label: 'Returned', value: 'Returned for Adjustments' },
                                { label: 'Doctor Rejected', value: 'Doctor Rejected' },
                                { label: 'Lab Rejected', value: 'Lab Rejected' },
                                { label: 'Rejected', value: 'Rejected' },
                                { label: 'Cancelled', value: 'Cancelled' },
                            ].map(opt => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            <ConfirmDialog
                isOpen={!!confirmAction}
                title={confirmAction?.label || ''}
                message={confirmAction?.confirmMessage || ''}
                variant={confirmAction?.variant === 'danger' ? 'danger' : 'warning'}
                confirmLabel="نعم، متأكد"
                cancelLabel="تراجع"
                onConfirm={handleConfirm}
                confirmDisabled={confirmAction?.requiresNote && !noteText.trim()}
                onCancel={() => { setConfirmAction(null); setRejectedLabCost(''); setNoteText(''); }}
            >
                {confirmAction?.requiresNote && (
                    <div className="text-right">
                        <label className="block text-sm font-medium text-surface-700 mb-1">
                            السبب <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            autoFocus
                            rows={3}
                            placeholder={confirmAction.notePlaceholder || 'أدخل السبب…'}
                            value={noteText}
                            onChange={(e) => setNoteText(e.target.value)}
                            className="w-full text-sm border border-surface-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none text-right"
                        />
                    </div>
                )}
                {['reject', 'cancel'].includes(confirmAction?.id || '') && (order.supplierId || order.designerId) && (
                    <div className="text-right">
                        <label className="block text-sm font-medium text-surface-700 mb-1">
                            تكلفة الاستحقاق للمعمل/المصمم في حالة الرفض أو الإلغاء (تلقائياً 0 إذا تُركت فارغة)
                        </label>
                        <Input
                            type="number"
                            min="0"
                            placeholder="أدخل التكلفة (اختياري)"
                            value={rejectedLabCost}
                            onChange={(e) => setRejectedLabCost(e.target.value ? Number(e.target.value) : '')}
                        />
                    </div>
                )}
            </ConfirmDialog>
        </>
    );
}
