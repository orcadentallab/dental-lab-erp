import type { AccountingOrderSnapshot, AccountingReviewType, Order } from '../services/db';
import { deriveOrderDisplayStatusV2 } from './orderDerivedStatusV2';
import { getEffectiveIssueState, getEffectiveProductionStatus } from './orderLifecycle';

export const ACCOUNTING_CHANGE_MARKER = 'بعد التسجيل المحاسبي';

export function hasZeroAccountingImpact(order: Partial<Order>): boolean {
    const issue = getEffectiveIssueState(order);
    return issue === 'cancelled' || issue === 'lab_rejected';
}

export function isAccountingCancellation(order: Partial<Order>): boolean {
    return getEffectiveIssueState(order) === 'cancelled';
}

function isAccountingRecognizedLifecycle(order: Partial<Order>): boolean {
    const issue = getEffectiveIssueState(order);
    return getEffectiveProductionStatus(order) === 'final_delivered'
        || ['cancelled', 'doctor_rejected', 'lab_rejected', 'redo'].includes(issue);
}

function getAccountingSnapshotStatus(order: Partial<Order>): string {
    return deriveOrderDisplayStatusV2(
        getEffectiveProductionStatus(order),
        getEffectiveIssueState(order),
        order.intakeState,
    ) ?? 'New Case';
}

export function getMissingAccountingDecisions(order: Order): string[] {
    const issue = getEffectiveIssueState(order);
    if (issue !== 'doctor_rejected' && issue !== 'redo') return [];
    const missing: string[] = [];
    if (order.rejectionFinancialReviewStatus !== 'resolved') missing.push('قرار تحمّل الطبيب');
    if (!['resolved', 'not_applicable'].includes(order.rejectedLabCostStatus || '')) missing.push('تكلفة المورد');
    if (!['resolved', 'not_applicable'].includes(order.rejectedDesignerCostStatus || '')) missing.push('تكلفة المصمم');
    return missing;
}

export function isAccountingFinanciallyReady(order: Order): boolean {
    return getMissingAccountingDecisions(order).length === 0;
}

export function getCurrentAccountingSnapshot(order: Order): AccountingOrderSnapshot {
    const zeroImpact = hasZeroAccountingImpact(order);
    const issue = getEffectiveIssueState(order);
    const rejected = issue === 'doctor_rejected' || issue === 'redo';

    return {
        status: getAccountingSnapshotStatus(order),
        // A doctor rejection is zero unless an explicit financial decision
        // recorded a doctor amount; never fall back to the order total.
        saleAmount: zeroImpact ? 0 : (rejected ? (order.rejectedDoctorAmount ?? 0) : order.totalPrice),
        // Mirrors build_order_accounting_snapshot. The stored components are
        // authoritative; the old derivations remain only as a fallback for
        // orders read through a projection that does not select them.
        labCost: zeroImpact ? 0 : (rejected ? (order.rejectedLabCost ?? 0) : (order.labCost ?? order.manualCost ?? order.cost ?? 0)),
        designCost: zeroImpact ? 0 : (rejected ? (order.rejectedDesignerCost ?? 0) : (order.designerCost ?? order.manualDesignPrice ?? order.designPrice ?? 0)),
        doctorId: order.doctorId || null,
        supplierId: order.supplierId || null,
        designerId: order.designerId || null,
        discount: zeroImpact ? 0 : (order.discount || 0),
    };
}

export function getAccountingReviewType(order: Order): AccountingReviewType {
    if (isAccountingCancellation(order) && hasPostRegistrationChange(order)) return 'cancellation';
    if (hasPostRegistrationChange(order)) return 'change';
    return order.accountingLastReviewType || (isAccountingCancellation(order) ? 'cancellation' : 'new');
}

export function getAccountingComparison(order: Order) {
    const type = getAccountingReviewType(order);
    const current = getCurrentAccountingSnapshot(order);
    const previous = type === 'new'
        ? null
        : (order.accountingPreviousSnapshot || order.accountingSnapshot || null);

    return {
        type,
        previous,
        current,
        delta: {
            saleAmount: current.saleAmount - (previous?.saleAmount || 0),
            labCost: current.labCost - (previous?.labCost || 0),
            designCost: current.designCost - (previous?.designCost || 0),
        },
    };
}

export function hasPostRegistrationChange(order: Order): boolean {
    return Boolean(
        order.needsAccountingReregistration
        || order.comments?.some(comment => comment.text.includes(ACCOUNTING_CHANGE_MARKER))
    );
}

export function isAccountingRegistrationCandidate(
    order: Order,
    tab: 'pending' | 'history'
): boolean {
    if (order.isDeleted) return false;
    if (order.excludeFromAccountingRegistration) return false;

    if (tab === 'pending') {
        if (order.isRegistered) return false;
        if (hasPostRegistrationChange(order)) return true;
        if (hasZeroAccountingImpact(order)) return false;
        // A reviewed doctor rejection or redo is delivery evidence even when a
        // pre-V2 transition wiped the original delivery timestamps.
        const issue = getEffectiveIssueState(order);
        const hasDeliveryEvidence = Boolean(order.firstDeliveredAt || order.actualDeliveryDate)
            || getEffectiveProductionStatus(order) === 'final_delivered'
            || issue === 'doctor_rejected'
            || issue === 'redo';
        return hasDeliveryEvidence && isAccountingRecognizedLifecycle(order);
    }

    return Boolean(
        order.isRegistered
        && (
            order.isArchived
            || isAccountingRecognizedLifecycle(order)
        )
    );
}
