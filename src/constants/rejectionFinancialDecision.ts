export const REJECTION_DOCTOR_DECISIONS = {
    decideLater: 'decide_later',
    fullPrice: 'full_price',
    zero: 'zero',
    customAmount: 'custom_amount',
} as const;

export type RejectionDoctorDecision =
    typeof REJECTION_DOCTOR_DECISIONS[keyof typeof REJECTION_DOCTOR_DECISIONS];

export type RejectionFinancialReviewStatus = 'pending' | 'resolved';
export type RejectionPartyCostStatus = 'pending' | 'resolved' | 'not_applicable';

export interface RejectionFinancialContext {
    rejectedLabCost?: number;
    rejectedDesignerCost?: number;
    rejectionDoctorDecision?: RejectionDoctorDecision;
    rejectedDoctorAmount?: number;
    rejectionFinancialReviewStatus?: RejectionFinancialReviewStatus;
    rejectedLabCostStatus?: RejectionPartyCostStatus;
    rejectedDesignerCostStatus?: RejectionPartyCostStatus;
    comment?: string;
}

export interface RejectionFinancialDecisionInput {
    decision: RejectionDoctorDecision;
    orderTotal: number;
    customAmount?: number | null;
}

export interface ResolvedRejectionDoctorDecision {
    decision: RejectionDoctorDecision;
    doctorAmount: number;
    reviewStatus: RejectionFinancialReviewStatus;
}

export function resolveRejectionDoctorDecision(
    input: RejectionFinancialDecisionInput
): ResolvedRejectionDoctorDecision {
    const orderTotal = Number(input.orderTotal);
    if (!Number.isFinite(orderTotal) || orderTotal < 0) {
        throw new Error('Order total must be a non-negative number');
    }

    switch (input.decision) {
        case REJECTION_DOCTOR_DECISIONS.decideLater:
            return {
                decision: input.decision,
                doctorAmount: orderTotal,
                reviewStatus: 'pending',
            };
        case REJECTION_DOCTOR_DECISIONS.fullPrice:
            return {
                decision: input.decision,
                doctorAmount: orderTotal,
                reviewStatus: 'resolved',
            };
        case REJECTION_DOCTOR_DECISIONS.zero:
            return {
                decision: input.decision,
                doctorAmount: 0,
                reviewStatus: 'resolved',
            };
        case REJECTION_DOCTOR_DECISIONS.customAmount: {
            const customAmount = Number(input.customAmount);
            if (!Number.isFinite(customAmount) || customAmount < 0 || customAmount > orderTotal) {
                throw new Error('Custom doctor amount must be between zero and the order total');
            }
            return {
                decision: input.decision,
                doctorAmount: customAmount,
                reviewStatus: 'resolved',
            };
        }
    }
}
