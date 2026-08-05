import type { AccountingOrderSnapshot, AccountingReviewType, Order } from '../services/db';

export const ACCOUNTING_CHANGE_MARKER = 'بعد التسجيل المحاسبي';

export const ACCOUNTING_REGISTRABLE_STATUSES: Order['status'][] = [
    'Delivered',
    'Completed',
    'Doctor Rejected',
    'Lab Rejected',
    'Rejected',
];

export function hasZeroAccountingImpact(order: Pick<Order, 'status'>): boolean {
    return order.status === 'Cancelled' || order.status === 'Lab Rejected';
}

export function getCurrentAccountingSnapshot(order: Order): AccountingOrderSnapshot {
    const zeroImpact = hasZeroAccountingImpact(order);
    const rejected = order.status === 'Doctor Rejected' || order.status === 'Rejected';

    return {
        status: order.status,
        // A doctor rejection is zero unless an explicit financial decision
        // recorded a doctor amount; never fall back to the order total.
        saleAmount: zeroImpact ? 0 : (rejected ? (order.rejectedDoctorAmount ?? 0) : order.totalPrice),
        labCost: zeroImpact ? 0 : (rejected ? (order.rejectedLabCost ?? 0) : (order.manualCost ?? order.cost ?? 0)),
        designCost: zeroImpact ? 0 : (rejected ? (order.rejectedDesignerCost ?? 0) : (order.manualDesignPrice ?? order.designPrice ?? 0)),
        doctorId: order.doctorId || null,
        supplierId: order.supplierId || null,
        designerId: order.designerId || null,
        discount: zeroImpact ? 0 : (order.discount || 0),
    };
}

export function getAccountingReviewType(order: Order): AccountingReviewType {
    if (order.status === 'Cancelled' && hasPostRegistrationChange(order)) return 'cancellation';
    if (hasPostRegistrationChange(order)) return 'change';
    return order.accountingLastReviewType || (order.status === 'Cancelled' ? 'cancellation' : 'new');
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
        return !order.isArchived && ACCOUNTING_REGISTRABLE_STATUSES.includes(order.status);
    }

    return Boolean(
        order.isRegistered
        && (
            order.isArchived
            || order.status === 'Cancelled'
            || ACCOUNTING_REGISTRABLE_STATUSES.includes(order.status)
        )
    );
}
