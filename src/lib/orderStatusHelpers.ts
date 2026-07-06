export const TERMINAL_STATUSES = ['Delivered', 'Completed', 'Doctor Rejected', 'Lab Rejected', 'Cancelled', 'Rejected'];

export interface OrderLike {
    status?: string | null;
    isDeleted?: boolean | null;
}

export const isVisibleInAccountStatement = (order: OrderLike): boolean => {
    if (!order) return false;
    if (order.isDeleted) return false;
    return !!order.status && TERMINAL_STATUSES.includes(order.status);
};

export const isDoctorRejectedStatus = (status: string | undefined | null): boolean => {
    return status === 'Doctor Rejected' || status === 'Rejected';
};

export const isLabRejectedStatus = (status: string | undefined | null): boolean => {
    return status === 'Lab Rejected';
};
