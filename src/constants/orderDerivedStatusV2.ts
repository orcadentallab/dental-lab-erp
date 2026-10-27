import {
    isIssueState,
    isProductionStatus,
    type IssueState,
    type ProductionStatus,
} from './workflow';

export const DERIVED_ORDER_DISPLAY_STATUSES = [
    'Pending Review',
    'New Case',
    'Under Design',
    'Under Production',
    'Try In',
    'Waiting Dr Approval',
    'Try In Approved',
    'Ready',
    'Delivered',
    'Returned for Adjustments',
    'Doctor Rejected',
    'Lab Rejected',
    'Cancelled',
    'Redo',
] as const;

export type DerivedOrderDisplayStatus = typeof DERIVED_ORDER_DISPLAY_STATUSES[number];

export interface OrderStatusV2Filter {
    productionStatus?: ProductionStatus;
    issueState: IssueState;
    intakeState?: OrderIntakeState;
}

export type OrderIntakeState = 'pending_review' | 'accepted';

const PRODUCTION_DISPLAY_STATUS: Record<ProductionStatus, DerivedOrderDisplayStatus> = {
    not_started: 'New Case',
    designing: 'Under Design',
    in_production: 'Under Production',
    try_in_ready: 'Try In',
    waiting_doctor: 'Waiting Dr Approval',
    finalization: 'Try In Approved',
    final_ready: 'Ready',
    final_delivered: 'Delivered',
};

const ISSUE_DISPLAY_STATUS: Record<Exclude<IssueState, 'none'>, DerivedOrderDisplayStatus> = {
    returned: 'Returned for Adjustments',
    doctor_rejected: 'Doctor Rejected',
    lab_rejected: 'Lab Rejected',
    cancelled: 'Cancelled',
    redo: 'Redo',
};

const LEGACY_ORDER_STATUS_V2_FILTERS: Record<string, OrderStatusV2Filter> = {
    'New Case': { productionStatus: 'not_started', issueState: 'none', intakeState: 'accepted' },
    Pending: { productionStatus: 'not_started', issueState: 'none', intakeState: 'accepted' },
    'Pending Review': { productionStatus: 'not_started', issueState: 'none', intakeState: 'pending_review' },
    'Under Design': { productionStatus: 'designing', issueState: 'none' },
    'In Progress': { productionStatus: 'in_production', issueState: 'none' },
    'Under Production': { productionStatus: 'in_production', issueState: 'none' },
    'Try In': { productionStatus: 'try_in_ready', issueState: 'none' },
    'Waiting Dr Approval': { productionStatus: 'waiting_doctor', issueState: 'none' },
    'Try In Approved': { productionStatus: 'finalization', issueState: 'none' },
    Ready: { productionStatus: 'final_ready', issueState: 'none' },
    Completed: { productionStatus: 'final_delivered', issueState: 'none' },
    Delivered: { productionStatus: 'final_delivered', issueState: 'none' },
    'Returned for Adjustments': { issueState: 'returned' },
    Rejected: { issueState: 'doctor_rejected' },
    'Doctor Rejected': { issueState: 'doctor_rejected' },
    'Lab Rejected': { issueState: 'lab_rejected' },
    Cancelled: { issueState: 'cancelled' },
    Redo: { issueState: 'redo' },
};

export const DERIVED_ORDER_STATUS_LABELS_AR: Record<DerivedOrderDisplayStatus, string> = {
    'Pending Review': 'بانتظار المراجعة',
    'New Case': 'حالة جديدة',
    'Under Design': 'قيد التصميم',
    'Under Production': 'قيد التنفيذ',
    'Try In': 'Try-In',
    'Waiting Dr Approval': 'في انتظار موافقة الطبيب',
    'Try In Approved': 'تنفيذ الفاينال',
    Ready: 'جاهز نهائي',
    Delivered: 'تم التسليم النهائي',
    'Returned for Adjustments': 'مرتجع للتعديل',
    'Doctor Rejected': 'مرتجع طبيب',
    'Lab Rejected': 'رفض معمل',
    Cancelled: 'ملغي',
    Redo: 'إعادة إنتاج',
};

/**
 * Derives presentation-only order status from the V2 workflow axes.
 * Unknown or missing axes fail closed instead of falling back to legacy state.
 */
export function deriveOrderDisplayStatusV2(
    productionStatus: string | null | undefined,
    issueState: string | null | undefined,
    intakeState: string | null | undefined = 'accepted',
): DerivedOrderDisplayStatus | null {
    if (!productionStatus || !isProductionStatus(productionStatus)) return null;
    if (!issueState || !isIssueState(issueState)) return null;
    if (intakeState === 'pending_review') {
        return productionStatus === 'not_started' && issueState === 'none'
            ? 'Pending Review'
            : null;
    }
    if (intakeState !== 'accepted') return null;

    if (issueState !== 'none') return ISSUE_DISPLAY_STATUS[issueState];
    return PRODUCTION_DISPLAY_STATUS[productionStatus];
}

/**
 * Translates the temporary legacy display-filter API to authoritative V2 axes.
 * Issue filters intentionally omit a production stage because issues override it.
 */
export function getOrderStatusV2Filter(status: string): OrderStatusV2Filter | null {
    return LEGACY_ORDER_STATUS_V2_FILTERS[status.trim()] ?? null;
}
