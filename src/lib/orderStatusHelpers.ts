export const TERMINAL_STATUSES = ['Delivered', 'Completed', 'Doctor Rejected', 'Lab Rejected', 'Cancelled', 'Rejected'];

export interface OrderLike {
    status?: string | null;
    isDeleted?: boolean | null;
    workflowType?: string | null;
    designStatus?: string | null;
}

export const isVisibleInAccountStatement = (order: OrderLike): boolean => {
    if (!order) return false;
    if (order.isDeleted) return false;
    return !!order.status && TERMINAL_STATUSES.includes(order.status);
};

/**
 * Returns true when an order should count towards a designer's payable balance.
 *
 * A designer is owed as soon as they complete the design stage (designStatus='completed'),
 * regardless of whether the overall order has reached a terminal status.
 * Soft-deleted orders are excluded: deletion means the order was a mistake and the
 * designer credit is voided (matching the obligation layer behavior).
 */
export const isDesignerPayable = (order: OrderLike): boolean => {
    if (!order) return false;
    if (order.isDeleted) return false;
    return (
        (!!order.status && TERMINAL_STATUSES.includes(order.status))
        || (order.workflowType === 'split' && order.designStatus === 'completed')
    );
};

export const isDoctorRejectedStatus = (status: string | undefined | null): boolean => {
    return status === 'Doctor Rejected' || status === 'Rejected';
};

export const isLabRejectedStatus = (status: string | undefined | null): boolean => {
    return status === 'Lab Rejected';
};
