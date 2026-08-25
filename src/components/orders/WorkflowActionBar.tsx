import { useState, useRef, useEffect } from 'react';
import {
    Play, PenTool, ArrowRight, Package, PackageCheck, Truck,
    CheckCircle, RotateCcw, XCircle, Ban, MoreHorizontal, RefreshCw,
    AlertTriangle, ChevronDown, Factory, Wrench
} from 'lucide-react';
import { startProduction } from '../../services/supabase/production';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Input } from '../ui/Input';
import IssueCauseFields from './IssueCauseFields';
import IssueStateCorrectionModal from './IssueStateCorrectionModal';
import { canCorrectIssueState } from '../../constants/issueStateCorrection';
import type { Order } from '../../services/db';
import { getEffectiveProductionStatus, getEffectiveIssueState } from '../../constants/orderLifecycle';
import { getForwardActions, getIssueActions, type WorkflowAction } from '../../constants/workflowTransitions';
import {
    REJECTION_DOCTOR_DECISIONS,
    resolveRejectionDoctorDecision,
    type RejectionDoctorDecision,
    type RejectionFinancialReviewStatus,
    type RejectionPartyCostStatus,
} from '../../constants/rejectionFinancialDecision';
import { issueCauseLabel, getStageForCause, type IssueContext } from '../../constants/issueCauses';
import clsx from 'clsx';

/** Actions whose "reason" is now an explicit cause pick, not free text. */
const CAUSE_SELECT_ACTION_CONTEXT: Record<string, IssueContext> = {
    reject: 'post_delivery',
    return: 'post_delivery',
    cancel: 'cancellation',
};

const ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
    Play, PenTool, ArrowRight, Package, PackageCheck, Truck,
    CheckCircle, RotateCcw, XCircle, Ban, RefreshCw,
};

function isDoctorDecisionOption(value: string): value is RejectionDoctorDecision | 'half' {
    return value === 'half'
        || value === REJECTION_DOCTOR_DECISIONS.decideLater
        || value === REJECTION_DOCTOR_DECISIONS.fullPrice
        || value === REJECTION_DOCTOR_DECISIONS.zero
        || value === REJECTION_DOCTOR_DECISIONS.customAmount;
}

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
    onStatusChange: (id: string, status: Order['status'] | 'same', context?: {
        rejectedLabCost?: number;
        rejectedDesignerCost?: number;
        rejectionDoctorDecision?: RejectionDoctorDecision;
        rejectedDoctorAmount?: number | null;
        rejectionFinancialReviewStatus?: RejectionFinancialReviewStatus;
        rejectedLabCostStatus?: RejectionPartyCostStatus;
        rejectedDesignerCostStatus?: RejectionPartyCostStatus;
        comment?: string;
        causeCategory?: string | null;
        responsibleStage?: string | null;
    }) => void;
    showRejectedDesignerCost?: boolean;
    onRedo?: (order: Order) => void;
    showLegacyFallback?: boolean;
    disabled?: boolean;
}

export default function WorkflowActionBar({ order, userRole, onStatusChange, onRedo, showLegacyFallback, disabled }: Props) {
    const [confirmAction, setConfirmAction] = useState<WorkflowAction | null>(null);
    const [showIssueMenu, setShowIssueMenu] = useState(false);
    const [showIssueCorrection, setShowIssueCorrection] = useState(false);
    const [doctorDecision, setDoctorDecision] = useState<RejectionDoctorDecision | 'half'>(
        REJECTION_DOCTOR_DECISIONS.fullPrice
    );
    const [customDoctorAmount, setCustomDoctorAmount] = useState<number | ''>('');
    const [noteText, setNoteText] = useState('');
    const [causeCategory, setCauseCategory] = useState('');
    const [responsibleStage, setResponsibleStage] = useState('');
    const issueMenuRef = useRef<HTMLDivElement>(null);
    const [startingProduction, setStartingProduction] = useState(false);

    /**
     * Builds the stage chain for this case. Reports what happened rather than
     * failing silently: a button that appears to do nothing is worse than one
     * that says it already did.
     */
    const handleStartProduction = async () => {
        setStartingProduction(true);
        try {
            const result = await startProduction(order.id);
            window.alert(result.alreadyStarted
                ? 'الحالة دي داخلة الإنتاج بالفعل.'
                : `اتعمل ${result.jobCount ?? 1} أمر شغل. شوف لوحة الإنتاج.`);
        } catch (e) {
            console.error('[WorkflowActionBar] start production failed', e);
            window.alert(e instanceof Error ? e.message : 'تعذّر بدء الإنتاج');
        } finally {
            setStartingProduction(false);
        }
    };

    const productionStatus = getEffectiveProductionStatus(order);
    const issueState = getEffectiveIssueState(order);

    const forwardActions = getForwardActions(productionStatus, issueState, {
        workflowType: order.workflowType,
        deliveryType: order.deliveryType,
        designUrl: order.designUrl,
        status: order.status,
    });

    const hasDeliveryEvidence = Boolean(
        order.firstDeliveredAt || order.legacyDeliveryConfirmed || order.actualDeliveryDate
        || productionStatus === 'final_delivered'
        || order.status === 'Delivered' || order.status === 'Completed'
    );
    const issueActions = getIssueActions(issueState, userRole, {
        firstDeliveredAt: order.firstDeliveredAt,
        legacyDeliveryConfirmed: order.legacyDeliveryConfirmed,
        actualDeliveryDate: order.actualDeliveryDate,
        productionStatus,
        legacyStatus: order.status,
    });
    const canRedo = (userRole === 'admin' || userRole === 'representative')
        && !!onRedo
        && hasDeliveryEvidence
        && order.issueState !== 'cancelled'
        && order.issueState !== 'redo';
    const redoBlockedByReplacement = (userRole === 'admin' || userRole === 'representative')
        && !!onRedo
        && issueState === 'redo';
    // Repairing a mis-clicked issue state is an admin-only correction, not a
    // workflow step — the same idea as the admin "…" legacy-status override,
    // applied to the issue axis instead of the production axis.
    const canCorrectIssue = userRole === 'admin' && canCorrectIssueState({
        issueState,
        hasDeliveryEvidence: Boolean(order.firstDeliveredAt || order.legacyDeliveryConfirmed),
        hasDesignSubmitted: Boolean(order.designSubmittedAt),
        hasReplacementOrder: false,
    });
    const hasIssueOptions = issueActions.length > 0 || canRedo || redoBlockedByReplacement
        || canCorrectIssue;

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
            setDoctorDecision(REJECTION_DOCTOR_DECISIONS.fullPrice);
            setCustomDoctorAmount('');
            setNoteText('');
            setCauseCategory('');
            setResponsibleStage('');
        } else {
            if (isValidOrderStatus(action.targetLegacyStatus)) {
                onStatusChange(order.id, action.targetLegacyStatus);
            }
        }
    };

    const causeContext = confirmAction ? CAUSE_SELECT_ACTION_CONTEXT[confirmAction.id] : undefined;

    const handleConfirm = () => {
        if (!confirmAction) return;
        if (causeContext) {
            if (!causeCategory) return;
        } else if (confirmAction.requiresNote && !noteText.trim()) {
            return;
        }
        const context: {
            rejectedLabCost?: number;
            rejectedDesignerCost?: number;
            rejectionDoctorDecision?: RejectionDoctorDecision;
            rejectedDoctorAmount?: number | null;
            rejectionFinancialReviewStatus?: RejectionFinancialReviewStatus;
            rejectedLabCostStatus?: RejectionPartyCostStatus;
            rejectedDesignerCostStatus?: RejectionPartyCostStatus;
            comment?: string;
            causeCategory?: string | null;
            responsibleStage?: string | null;
        } = {};
        const isRejection = confirmAction.id === 'reject';
        if (isRejection) {
            const resolved = resolveRejectionDoctorDecision({
                decision: doctorDecision === 'half' ? REJECTION_DOCTOR_DECISIONS.customAmount : doctorDecision,
                orderTotal: order.totalPrice || 0,
                customAmount: doctorDecision === 'half'
                    ? (order.totalPrice || 0) / 2
                    : (customDoctorAmount === '' ? null : customDoctorAmount),
            });
            context.rejectionDoctorDecision = resolved.decision;
            context.rejectedDoctorAmount = resolved.doctorAmount;
            context.rejectionFinancialReviewStatus = resolved.reviewStatus;
            context.rejectedLabCostStatus = order.supplierId ? 'pending' : 'not_applicable';
            context.rejectedDesignerCostStatus = order.designerId ? 'pending' : 'not_applicable';
        }
        if (causeContext) {
            context.causeCategory = causeCategory;
            context.responsibleStage = responsibleStage || getStageForCause(causeContext, causeCategory);
            // p_reason is required by the RPC; fall back to the cause label
            // when the optional notes field was left empty.
            context.comment = noteText.trim() || issueCauseLabel(causeCategory);
        } else if (noteText.trim()) {
            context.comment = noteText.trim();
        }
        if (isValidOrderStatus(confirmAction.targetLegacyStatus)) {
            onStatusChange(order.id, confirmAction.targetLegacyStatus, Object.keys(context).length ? context : undefined);
        }
        setConfirmAction(null);
        setDoctorDecision(REJECTION_DOCTOR_DECISIONS.fullPrice);
        setCustomDoctorAmount('');
        setNoteText('');
        setCauseCategory('');
        setResponsibleStage('');
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

                {/* Entry into the stage pipeline. Deliberately a separate,
                    manual action rather than a side effect of a status change:
                    while the cutover flag is off these two systems run in
                    parallel, and cases should join the new one by decision.
                    Idempotent, so a second press is harmless. */}
                {(userRole === 'admin' || userRole === 'lab') && (
                    <button
                        type="button"
                        disabled={disabled || startingProduction}
                        onClick={() => void handleStartProduction()}
                        title="ينشئ سلسلة مراحل الإنتاج للحالة — شغلانة لكل خريطة خدمة"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold border border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 shrink-0"
                    >
                        <Factory size={12} />
                        {startingProduction ? '…' : 'ابدأ الإنتاج'}
                    </button>
                )}

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
                                {redoBlockedByReplacement && (
                                    <div className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-xs font-bold text-slate-400 sm:min-h-0" title="لا يمكن عمل إعادة من حالة تم استبدالها؛ افتح آخر حالة في السلسلة.">
                                        <RefreshCw size={13} />
                                        <span>الإعادة متاحة من آخر حالة في السلسلة فقط</span>
                                    </div>
                                )}
                                {canCorrectIssue && (
                                    <>
                                        {(issueActions.length > 0 || canRedo || redoBlockedByReplacement) && (
                                            <div className="my-1 border-t border-surface-100" />
                                        )}
                                        <button
                                            onClick={() => { setShowIssueMenu(false); setShowIssueCorrection(true); }}
                                            disabled={disabled}
                                            title="لو المشكلة اتسجّلت بالغلط — تصحيح نوعها أو إلغائها تماماً"
                                            className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg text-slate-600 hover:bg-slate-100 transition-colors sm:min-h-0"
                                        >
                                            <Wrench size={13} />
                                            <span>تصحيح حالة المشكلة</span>
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
                            ].map(opt => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            <IssueStateCorrectionModal
                order={order}
                isOpen={showIssueCorrection}
                onClose={() => setShowIssueCorrection(false)}
                onCorrected={() => onStatusChange(order.id, 'same')}
            />

            <ConfirmDialog
                isOpen={!!confirmAction}
                title={confirmAction?.label || ''}
                message={confirmAction?.confirmMessage || ''}
                variant={confirmAction?.variant === 'danger' ? 'danger' : 'warning'}
                confirmLabel="نعم، متأكد"
                cancelLabel="تراجع"
                onConfirm={handleConfirm}
                confirmDisabled={
                    (causeContext ? !causeCategory : (confirmAction?.requiresNote && !noteText.trim()))
                    || (
                        confirmAction?.id === 'reject'
                        && doctorDecision === REJECTION_DOCTOR_DECISIONS.customAmount
                        && (
                            customDoctorAmount === ''
                            || customDoctorAmount < 0
                            || customDoctorAmount > (order.totalPrice || 0)
                        )
                    )
                }
                onCancel={() => {
                    setConfirmAction(null);
                    setDoctorDecision(REJECTION_DOCTOR_DECISIONS.fullPrice);
                    setCustomDoctorAmount('');
                    setNoteText('');
                    setCauseCategory('');
                    setResponsibleStage('');
                }}
            >
                {causeContext ? (
                    <IssueCauseFields
                        issueContext={causeContext}
                        causeCategory={causeCategory}
                        onCauseCategoryChange={setCauseCategory}
                        responsibleStage={responsibleStage}
                        onResponsibleStageChange={setResponsibleStage}
                        notes={noteText}
                        onNotesChange={setNoteText}
                        notesPlaceholder={confirmAction?.notePlaceholder}
                    />
                ) : confirmAction?.requiresNote && (
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
                {confirmAction?.id === 'reject' && (
                    <div className="space-y-2 text-right">
                        <label className="block text-xs font-bold text-surface-800">
                            المبلغ الذي يتحمله الطبيب
                        </label>
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                            {[
                                { value: REJECTION_DOCTOR_DECISIONS.decideLater, label: 'لاحقًا' },
                                { value: REJECTION_DOCTOR_DECISIONS.fullPrice, label: 'كامل السعر' },
                                { value: 'half', label: '50%' },
                                { value: REJECTION_DOCTOR_DECISIONS.zero, label: 'صفر' },
                                { value: REJECTION_DOCTOR_DECISIONS.customAmount, label: 'مخصص' },
                            ].map(option => (
                                <label
                                    key={option.value}
                                    className={clsx(
                                        'flex cursor-pointer items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium',
                                        doctorDecision === option.value
                                            ? 'border-primary-500 bg-primary-50 text-primary-800'
                                            : 'border-surface-200 bg-white text-surface-700'
                                    )}
                                >
                                    <input
                                        type="radio"
                                        name="doctor-rejection-decision"
                                        value={option.value}
                                        checked={doctorDecision === option.value}
                                        onChange={() => {
                                            if (!isDoctorDecisionOption(option.value)) return;
                                            setDoctorDecision(option.value);
                                            if (option.value === 'half') setCustomDoctorAmount((order.totalPrice || 0) / 2);
                                        }}
                                    />
                                    {option.label}
                                </label>
                            ))}
                        </div>
                        {doctorDecision === REJECTION_DOCTOR_DECISIONS.decideLater && (
                            <p className="rounded-md border border-amber-200 bg-amber-50 p-1.5 text-[11px] text-amber-800">
                                سيُحمّل الطبيب كامل قيمة الطلب مؤقتًا لحماية رصيد المعمل، ويظل القرار المالي معلقًا حتى يحدده الأدمن.
                            </p>
                        )}
                        {doctorDecision === REJECTION_DOCTOR_DECISIONS.customAmount && (
                            <div>
                                <label className="mb-1 block text-xs font-medium text-surface-700">
                                    المبلغ المتفق أن يتحمله الطبيب
                                </label>
                                <Input
                                    type="number"
                                    min="0"
                                    max={order.totalPrice || 0}
                                    value={customDoctorAmount}
                                    onChange={(e) => setCustomDoctorAmount(e.target.value === '' ? '' : Number(e.target.value))}
                                    placeholder="0"
                                />
                                <p className="mt-1 text-[11px] text-surface-500">
                                    الحد الأقصى: {(order.totalPrice || 0).toLocaleString('en-EG')} ج.م
                                </p>
                            </div>
                        )}
                        <div className="rounded-md border border-amber-200 bg-amber-50 p-1.5 text-[11px] text-amber-800">
                            استحقاق المورد والمصمم يظل معلقًا ويحدده الـAdmin لاحقًا من المراجعة المالية.
                        </div>
                    </div>
                )}
            </ConfirmDialog>
        </>
    );
}
