import type { Order } from '../services/db';
import { getEffectiveIssueState, getEffectiveProductionStatus } from './orderLifecycle';

type DashboardOrder = Partial<Order>;

export interface DoctorReturnedBreakdown {
    doctorRejected: number;
    redo: number;
    total: number;
}

export function getDoctorReturnedBreakdown(orders: DashboardOrder[]): DoctorReturnedBreakdown {
    let doctorRejected = 0;
    let redo = 0;

    for (const order of orders) {
        const issueState = getEffectiveIssueState(order);
        if (issueState === 'doctor_rejected') doctorRejected += 1;
        if (issueState === 'redo') redo += 1;
    }

    return { doctorRejected, redo, total: doctorRejected + redo };
}

export function isDashboardTerminal(order: DashboardOrder): boolean {
    const issueState = getEffectiveIssueState(order);
    if (issueState === 'returned') return false;
    if (['doctor_rejected', 'lab_rejected', 'cancelled', 'redo'].includes(issueState)) return true;
    return getEffectiveProductionStatus(order) === 'final_delivered';
}

export function isLabDashboardVisible(order: DashboardOrder): boolean {
    const issueState = getEffectiveIssueState(order);
    if (issueState === 'returned') return true;
    if (issueState !== 'none') return false;

    return [
        'in_production',
        'try_in_ready',
        'finalization',
        'final_ready',
        'final_delivered',
    ].includes(getEffectiveProductionStatus(order));
}
