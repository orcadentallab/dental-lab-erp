import { useMemo, useState } from 'react';
import { Wrench } from 'lucide-react';
import clsx from 'clsx';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Input } from '../ui/Input';
import IssueCauseFields from './IssueCauseFields';
import type { Order } from '../../services/db';
import { db } from '../../services/db';
import { getEffectiveIssueState } from '../../constants/orderLifecycle';
import { ISSUE_STATE_LABELS_AR } from '../../constants/workflow';
import { getStageForCause } from '../../constants/issueCauses';
import {
    getIssueCorrectionTargets,
    type CorrectableTargetState,
} from '../../constants/issueStateCorrection';
import {
    REJECTION_DOCTOR_DECISIONS,
    resolveRejectionDoctorDecision,
    type RejectionDoctorDecision,
} from '../../constants/rejectionFinancialDecision';

interface Props {
    order: Order;
    isOpen: boolean;
    onClose: () => void;
    /** Called after a successful correction so the caller can refresh. */
    onCorrected: () => void;
}

const DOCTOR_DECISION_OPTIONS = [
    { value: REJECTION_DOCTOR_DECISIONS.decideLater, label: 'لاحقًا' },
    { value: REJECTION_DOCTOR_DECISIONS.fullPrice, label: 'كامل السعر' },
    { value: 'half', label: '50%' },
    { value: REJECTION_DOCTOR_DECISIONS.zero, label: 'صفر' },
    { value: REJECTION_DOCTOR_DECISIONS.customAmount, label: 'مخصص' },
] as const;

type DoctorDecisionOption = RejectionDoctorDecision | 'half';

function isDoctorDecisionOption(value: string): value is DoctorDecisionOption {
    return value === 'half'
        || value === REJECTION_DOCTOR_DECISIONS.decideLater
        || value === REJECTION_DOCTOR_DECISIONS.fullPrice
        || value === REJECTION_DOCTOR_DECISIONS.zero
        || value === REJECTION_DOCTOR_DECISIONS.customAmount;
}

/**
 * Admin-only repair of an issue state recorded by mistake.
 *
 * Deliberately NOT presented as a workflow action: the case did not move
 * forward, we are saying the previous record was wrong. So it asks for the
 * corrected state, a mandatory reason, and — when the corrected state is
 * itself an issue — the same cause/decision fields the original action would
 * have asked for, so the repaired row is indistinguishable from one recorded
 * correctly the first time.
 *
 * The financial consequences are not computed here. The database rebuilds
 * every obligation from the corrected order row; see
 * supabase/migrations/20260825000000_admin_correct_order_issue_state.sql.
 */
export default function IssueStateCorrectionModal({ order, isOpen, onClose, onCorrected }: Props) {
    const currentIssueState = getEffectiveIssueState(order);

    const targets = useMemo(() => getIssueCorrectionTargets({
        issueState: currentIssueState,
        hasDeliveryEvidence: Boolean(
            order.firstDeliveredAt || order.legacyDeliveryConfirmed
        ),
        hasDesignSubmitted: Boolean(order.designSubmittedAt),
        // The order list does not carry the replacement link; `redo` already
        // covers the reachable case and the RPC re-checks authoritatively.
        hasReplacementOrder: false,
    }), [
        currentIssueState,
        order.firstDeliveredAt,
        order.legacyDeliveryConfirmed,
        order.designSubmittedAt,
    ]);

    const [target, setTarget] = useState<CorrectableTargetState | ''>('');
    const [reason, setReason] = useState('');
    const [causeCategory, setCauseCategory] = useState('');
    const [responsibleStage, setResponsibleStage] = useState('');
    const [doctorDecision, setDoctorDecision] = useState<DoctorDecisionOption>(
        REJECTION_DOCTOR_DECISIONS.fullPrice
    );
    const [customDoctorAmount, setCustomDoctorAmount] = useState<number | ''>('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const selected = targets.find((option) => option.value === target);
    const causeContext = selected?.causeContext;
    const needsDoctorDecision = target === 'doctor_rejected';
    const orderTotal = order.totalPrice || 0;

    const reset = () => {
        setTarget('');
        setReason('');
        setCauseCategory('');
        setResponsibleStage('');
        setDoctorDecision(REJECTION_DOCTOR_DECISIONS.fullPrice);
        setCustomDoctorAmount('');
        setError(null);
    };

    const handleCancel = () => {
        if (submitting) return;
        reset();
        onClose();
    };

    const invalidCustomAmount = needsDoctorDecision
        && doctorDecision === REJECTION_DOCTOR_DECISIONS.customAmount
        && (customDoctorAmount === '' || customDoctorAmount < 0 || customDoctorAmount > orderTotal);

    const confirmDisabled = submitting
        || !target
        || !reason.trim()
        || (!!causeContext && !causeCategory)
        || invalidCustomAmount;

    const handleConfirm = async () => {
        if (confirmDisabled || !target) return;
        setSubmitting(true);
        setError(null);
        try {
            let decision: RejectionDoctorDecision | null = null;
            let amount: number | null = null;
            if (needsDoctorDecision) {
                const resolved = resolveRejectionDoctorDecision({
                    decision: doctorDecision === 'half'
                        ? REJECTION_DOCTOR_DECISIONS.customAmount
                        : doctorDecision,
                    orderTotal,
                    customAmount: doctorDecision === 'half'
                        ? orderTotal / 2
                        : (customDoctorAmount === '' ? null : customDoctorAmount),
                });
                decision = resolved.decision;
                amount = resolved.doctorAmount;
            }

            await db.adminCorrectOrderIssueState(order.id, target, reason.trim(), {
                doctorDecision: decision,
                customDoctorAmount: amount,
                causeCategory: causeContext ? causeCategory : null,
                responsibleStage: causeContext
                    ? (responsibleStage || getStageForCause(causeContext, causeCategory))
                    : null,
            });
            reset();
            onCorrected();
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'تعذّر تصحيح حالة المشكلة');
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <ConfirmDialog
            isOpen={isOpen}
            title="تصحيح حالة المشكلة"
            message={`الحالة مسجّلة حالياً كـ «${ISSUE_STATE_LABELS_AR[currentIssueState]}». اختر ما كان يجب تسجيله.`}
            variant="warning"
            confirmLabel={submitting ? 'جارٍ التصحيح…' : 'تأكيد التصحيح'}
            cancelLabel="تراجع"
            isLoading={submitting}
            confirmDisabled={confirmDisabled}
            onConfirm={() => void handleConfirm()}
            onCancel={handleCancel}
        >
            <div className="space-y-3 text-right">
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-800">
                    <Wrench size={14} className="mt-0.5 shrink-0" />
                    <span>
                        ده تصحيح لقرار اتسجّل غلط، مش خطوة في المسار. الحسابات
                        (مستحق الطبيب، مستحق المعمل الخارجي والمصمم) هيتم إعادة
                        بنائها تلقائياً من حالة الأوردر بعد التصحيح، والدفعات
                        المسجّلة بتتنقل للالتزام الجديد أو تتحوّل رصيد للطبيب.
                        الأوردر هيرجع لمراجعة المحاسب.
                    </span>
                </div>

                {targets.length === 0 ? (
                    <p className="rounded-lg border border-surface-200 bg-surface-50 p-2 text-xs text-surface-600">
                        لا توجد حالة بديلة مسموح بها لهذا الأوردر.
                    </p>
                ) : (
                    <div>
                        <label className="mb-1 block text-sm font-medium text-surface-700">
                            الحالة الصحيحة <span className="text-red-500">*</span>
                        </label>
                        <div className="space-y-1.5">
                            {targets.map((option) => (
                                <label
                                    key={option.value}
                                    className={clsx(
                                        'flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-xs',
                                        target === option.value
                                            ? 'border-primary-500 bg-primary-50'
                                            : 'border-surface-200 bg-white hover:bg-surface-50'
                                    )}
                                >
                                    <input
                                        type="radio"
                                        name="issue-correction-target"
                                        className="mt-0.5"
                                        value={option.value}
                                        checked={target === option.value}
                                        onChange={() => {
                                            setTarget(option.value);
                                            setCauseCategory('');
                                            setResponsibleStage('');
                                        }}
                                    />
                                    <span>
                                        <span className="block font-bold text-surface-800">{option.label}</span>
                                        <span className="block text-[11px] text-surface-500">{option.description}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                )}

                {causeContext && (
                    <IssueCauseFields
                        issueContext={causeContext}
                        causeCategory={causeCategory}
                        onCauseCategoryChange={setCauseCategory}
                        responsibleStage={responsibleStage}
                        onResponsibleStageChange={setResponsibleStage}
                        notes={reason}
                        onNotesChange={setReason}
                        notesPlaceholder="سبب التصحيح…"
                    />
                )}

                {needsDoctorDecision && (
                    <div className="space-y-2">
                        <label className="block text-xs font-bold text-surface-800">
                            المبلغ الذي يتحمله الطبيب
                        </label>
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                            {DOCTOR_DECISION_OPTIONS.map((option) => (
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
                                        name="issue-correction-doctor-decision"
                                        value={option.value}
                                        checked={doctorDecision === option.value}
                                        onChange={() => {
                                            if (!isDoctorDecisionOption(option.value)) return;
                                            setDoctorDecision(option.value);
                                            if (option.value === 'half') setCustomDoctorAmount(orderTotal / 2);
                                        }}
                                    />
                                    {option.label}
                                </label>
                            ))}
                        </div>
                        {doctorDecision === REJECTION_DOCTOR_DECISIONS.customAmount && (
                            <div>
                                <Input
                                    type="number"
                                    min="0"
                                    max={orderTotal}
                                    value={customDoctorAmount}
                                    onChange={(e) => setCustomDoctorAmount(
                                        e.target.value === '' ? '' : Number(e.target.value)
                                    )}
                                    placeholder="0"
                                />
                                <p className="mt-1 text-[11px] text-surface-500">
                                    الحد الأقصى: {orderTotal.toLocaleString('en-EG')} ج.م
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {!causeContext && (
                    <div>
                        <label className="mb-1 block text-sm font-medium text-surface-700">
                            سبب التصحيح <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            rows={3}
                            placeholder="مثال: اتسجّلت مرتجع طبيب بالغلط على الحالة دي…"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="w-full resize-none rounded-lg border border-surface-300 px-3 py-2 text-right text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                        />
                    </div>
                )}

                {error && (
                    <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs font-bold text-red-700">
                        {error}
                    </p>
                )}
            </div>
        </ConfirmDialog>
    );
}
