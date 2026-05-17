import type { Order } from '../services/db';
import { getProductionStatus } from '../constants/orderLifecycle';

export const DELIVERY_DATE_AUDIT_PREFIX = '__delivery_date_change__';

type OrderComment = NonNullable<Order['comments']>[number];

export function isInternalDeliveryDateAuditComment(comment?: Pick<OrderComment, 'text'> | null): boolean {
    return Boolean(comment?.text?.includes(DELIVERY_DATE_AUDIT_PREFIX));
}

export function filterVisibleOrderComments(comments?: Order['comments']): OrderComment[] {
    return (comments || []).filter(comment => !isInternalDeliveryDateAuditComment(comment));
}

export function getLatestVisibleOrderComment(comments?: Order['comments']): OrderComment | null {
    const visibleComments = filterVisibleOrderComments(comments);
    return visibleComments.length > 0 ? visibleComments[visibleComments.length - 1] : null;
}

export function getOrderCardDisplayDate(order: Pick<Order, 'status' | 'deliveryDate' | 'actualDeliveryDate'>) {
    const isDeliveredLike = getProductionStatus(order) === 'delivered';

    if (isDeliveredLike) {
        return {
            label: 'تاريخ التسليم الفعلي',
            date: order.actualDeliveryDate || order.deliveryDate || '',
        };
    }

    return {
        label: 'تاريخ التسليم المطلوب',
        date: order.deliveryDate || '',
    };
}
