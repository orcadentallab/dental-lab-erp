import type { Order } from '../services/db';
import { getExternalLabStatementAmount, getLabCostMetadata } from './financialObligations';
import {
    getEffectiveIssueState,
    getEffectiveProductionStatus,
} from './orderLifecycle';
import { deriveOrderDisplayStatusV2 } from './orderDerivedStatusV2';

type StatementOrder = Partial<Order>;

const isReviewedRejection = (order: StatementOrder): boolean => {
    const issue = getEffectiveIssueState(order);
    return issue === 'doctor_rejected' || issue === 'redo';
};

export function isStatementVisibleOrder(order: StatementOrder): boolean {
    if (order.isDeleted) return false;

    const issue = getEffectiveIssueState(order);
    return getEffectiveProductionStatus(order) === 'final_delivered'
        || ['cancelled', 'doctor_rejected', 'lab_rejected', 'returned', 'redo'].includes(issue);
}

export function isDesignerStatementPayable(order: StatementOrder): boolean {
    if (order.isDeleted) return false;
    return isStatementVisibleOrder(order)
        || (order.workflowType === 'split' && order.designStatus === 'completed');
}

export function getSupplierStatementAmount(
    order: StatementOrder,
    isSalariedDesigner: boolean,
    showAllOrders: boolean,
): number | null {
    if (order.isDeleted) return null;

    const officialAmount = getExternalLabStatementAmount(order, isSalariedDesigner);
    if (officialAmount !== null || !showAllOrders) return officialAmount;
    if (isReviewedRejection(order)) return null;

    return getLabCostMetadata(order, isSalariedDesigner).cost;
}

export function getDesignerStatementAmount(
    order: StatementOrder,
    showAllOrders: boolean,
    normalDesignAmount = order.designPrice ?? 0,
): number | null {
    if (order.isDeleted || order.workflowType !== 'split') return null;
    if (!showAllOrders && !isDesignerStatementPayable(order)) return null;

    const issue = getEffectiveIssueState(order);
    const isRelevant = showAllOrders
        || order.designStatus === 'completed'
        || ['cancelled', 'doctor_rejected', 'lab_rejected', 'redo'].includes(issue);

    if (!isRelevant) return null;
    if (issue === 'cancelled' || issue === 'lab_rejected') return 0;
    if (issue === 'doctor_rejected' || issue === 'redo') {
        return Math.max(0, order.rejectedDesignerCost ?? 0);
    }

    return Math.max(0, normalDesignAmount);
}

export function getOrderStatementDisplayStatus(order: StatementOrder): string {
    return deriveOrderDisplayStatusV2(
        getEffectiveProductionStatus(order),
        getEffectiveIssueState(order),
        order.intakeState,
    ) ?? 'New Case';
}
