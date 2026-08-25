// Admin-only correction of a wrongly recorded issue state.
//
// A rejection / cancellation is terminal by design: it settles money. The
// workflow deliberately has no "un-reject" button. This module describes the
// one narrow escape hatch for a MISCLICK — the issue-axis twin of the admin
// "…" legacy-status override in WorkflowActionBar.
//
// Every rule below mirrors a guard inside
// supabase/migrations/20260825000000_admin_correct_order_issue_state.sql and
// the `orders_issue_timing_v2_check` constraint. The database is the seat of
// enforcement; this file exists so the UI never offers a target the RPC will
// reject.

import type { IssueState } from './workflow';
import type { IssueContext } from './issueCauses';

/** Issue states an admin may correct an order INTO. `redo` is excluded. */
export const CORRECTABLE_TARGET_STATES = [
    'none',
    'returned',
    'doctor_rejected',
    'cancelled',
    'lab_rejected',
] as const;

export type CorrectableTargetState = typeof CORRECTABLE_TARGET_STATES[number];

export interface IssueCorrectionTarget {
    value: CorrectableTargetState;
    label: string;
    /** What the case looks like after the correction, in the admin's words. */
    description: string;
    /** Cause vocabulary to collect, when the target is itself an issue. */
    causeContext?: IssueContext;
}

const TARGETS: Record<CorrectableTargetState, IssueCorrectionTarget> = {
    none: {
        value: 'none',
        label: 'من غير مشاكل',
        description: 'تُلغى المشكلة تماماً وترجع الحالة لمسارها الطبيعي.',
    },
    returned: {
        value: 'returned',
        label: 'إرجاع للتعديل',
        description: 'الحالة رجعت للتعديل وما زالت نشطة — بدون تسوية مالية.',
        causeContext: 'post_delivery',
    },
    doctor_rejected: {
        value: 'doctor_rejected',
        label: 'مرتجع طبيب',
        description: 'مرتجع من الطبيب مع تحديد المبلغ الذي يتحمّله.',
        causeContext: 'post_delivery',
    },
    cancelled: {
        value: 'cancelled',
        label: 'إلغاء',
        description: 'الحالة ملغاة بأثر مالي صفري.',
        causeContext: 'cancellation',
    },
    lab_rejected: {
        value: 'lab_rejected',
        label: 'رفض معمل',
        description: 'رفض داخلي قبل بدء الإنتاج، بأثر مالي صفري.',
        causeContext: 'lab_rejection',
    },
};

export interface IssueCorrectionContext {
    /** Current issue state of the order. */
    issueState: IssueState;
    /**
     * True when delivery is evidenced — `first_delivered_at` or the reviewed
     * legacy confirmation. Same evidence `orders_issue_timing_v2_check` takes.
     */
    hasDeliveryEvidence: boolean;
    /** `design_submitted_at` is set; lab rejection is no longer possible. */
    hasDesignSubmitted: boolean;
    /** A replacement order points at this one — the chain must stay intact. */
    hasReplacementOrder: boolean;
}

/**
 * Whether an admin may correct this order's issue state at all.
 *
 * A redo owns a replacement order; clearing it would orphan a real case, so
 * the RPC refuses and the UI must not offer the action.
 */
export function canCorrectIssueState(context: IssueCorrectionContext): boolean {
    if (context.issueState === 'none' || context.issueState === 'on_hold') return false;
    if (context.issueState === 'redo') return false;
    return !context.hasReplacementOrder;
}

/**
 * Targets that are legal for this specific order, in the order they should be
 * offered. Excludes the state the order is already in.
 */
export function getIssueCorrectionTargets(
    context: IssueCorrectionContext
): IssueCorrectionTarget[] {
    if (!canCorrectIssueState(context)) return [];

    return CORRECTABLE_TARGET_STATES
        .filter((target) => target !== context.issueState)
        .filter((target) => {
            switch (target) {
                // Post-delivery issues need a delivery to have happened.
                case 'returned':
                case 'doctor_rejected':
                    return context.hasDeliveryEvidence;
                // Zero-impact issues only exist before delivery…
                case 'cancelled':
                    return !context.hasDeliveryEvidence;
                // …and lab rejection also only before the design was sent.
                case 'lab_rejected':
                    return !context.hasDeliveryEvidence && !context.hasDesignSubmitted;
                default:
                    return true;
            }
        })
        .map((target) => TARGETS[target]);
}

export function issueCorrectionTargetLabel(target: string): string {
    return TARGETS[target as CorrectableTargetState]?.label ?? target;
}
