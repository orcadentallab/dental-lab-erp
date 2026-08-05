import type { Order } from '../services/db';

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
