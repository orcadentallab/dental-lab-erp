import { describe, expect, it } from 'vitest';
import {
    getDoctorReceivableAmount,
    isBillableToDoctor,
} from '../../src/constants/orderLifecycle';
import {
    shouldCreateDesignerPayableObligationForDesignStatusChange,
    shouldCreateDoctorReceivableObligationForStatusChange,
    shouldCreateExternalLabPayableObligationForStatusChange,
    shouldVoidDesignerPayableObligationForDesignStatusChange,
    shouldVoidDoctorReceivableForStatusOrIssueChange,
    shouldVoidExternalLabReadyObligationForStatusChange,
} from '../../src/constants/financialObligations';

describe('order financial-obligation lifecycle decisions', () => {
    it('does not silently bill historical rejected orders without a recorded decision', () => {
        const historicalRejectedOrder = {
            status: 'Doctor Rejected',
            issueState: 'doctor_rejected',
            totalPrice: 2000,
        };

        expect(isBillableToDoctor(historicalRejectedOrder)).toBe(false);
        expect(getDoctorReceivableAmount(historicalRejectedOrder)).toBe(0);
    });

    it('uses the recorded quick rejection decision amount immediately', () => {
        const reviewedRejectedOrder = {
            status: 'Doctor Rejected',
            issueState: 'doctor_rejected',
            totalPrice: 2000,
            rejectionDoctorDecision: 'custom_amount' as const,
            rejectedDoctorAmount: 750,
        };

        expect(isBillableToDoctor(reviewedRejectedOrder)).toBe(true);
        expect(getDoctorReceivableAmount(reviewedRejectedOrder)).toBe(750);
    });

    it('creates the doctor receivable only when entering Delivered', () => {
        expect(shouldCreateDoctorReceivableObligationForStatusChange('Ready', 'Delivered')).toBe(true);
        expect(shouldCreateDoctorReceivableObligationForStatusChange('Delivered', 'Delivered')).toBe(false);
        expect(shouldCreateDoctorReceivableObligationForStatusChange('Delivered', 'Ready')).toBe(false);
    });

    it.each(['cancelled', 'doctor_rejected', 'lab_rejected', 'redo'] as const)(
        'voids the doctor receivable when a delivered order enters %s',
        issueState => {
            const previous = {
                status: 'Delivered',
                productionStatus: 'final_delivered',
                issueState: 'none',
            };
            const updated = {
                ...previous,
                status: issueState === 'cancelled' ? 'Cancelled' : previous.status,
                productionStatus: 'not_started',
                issueState,
            };

            expect(shouldVoidDoctorReceivableForStatusOrIssueChange(previous, updated)).toBe(true);
        }
    );

    it('preserves the doctor receivable while a delivered order is temporarily returned/on hold', () => {
        const previous = {
            status: 'Delivered',
            productionStatus: 'final_delivered',
            issueState: 'none',
        };

        expect(shouldVoidDoctorReceivableForStatusOrIssueChange(previous, {
            ...previous,
            issueState: 'returned',
        })).toBe(false);
        expect(shouldVoidDoctorReceivableForStatusOrIssueChange(previous, {
            ...previous,
            issueState: 'on_hold',
        })).toBe(false);
    });

    it('creates an external-lab payable at final-ready or direct final delivery', () => {
        expect(shouldCreateExternalLabPayableObligationForStatusChange(
            { productionStatus: 'in_production' },
            { productionStatus: 'final_ready' }
        )).toEqual({ shouldCreate: true, impliedFinalReady: false });

        expect(shouldCreateExternalLabPayableObligationForStatusChange(
            { productionStatus: 'in_production' },
            { productionStatus: 'final_delivered' }
        )).toEqual({ shouldCreate: true, impliedFinalReady: true });
    });

    it('preserves normal external-lab payables during issue settlement workflows', () => {
        const previous = {
            productionStatus: 'final_ready',
            issueState: 'none',
        };

        for (const issueState of ['returned', 'doctor_rejected', 'lab_rejected', 'cancelled', 'redo'] as const) {
            expect(shouldVoidExternalLabReadyObligationForStatusChange(previous, {
                productionStatus: 'not_started',
                issueState,
            })).toBe(false);
        }
    });

    it('creates and voids designer payables at the completed-design boundary', () => {
        const pending = {
            workflowType: 'split',
            designerId: 'designer-id',
            designPrice: 250,
            designStatus: 'in_progress',
        };
        const completed = { ...pending, designStatus: 'completed' };

        expect(shouldCreateDesignerPayableObligationForDesignStatusChange(pending, completed)).toBe(true);
        expect(shouldVoidDesignerPayableObligationForDesignStatusChange(completed, {
            ...completed,
            designStatus: 'returned',
        })).toBe(true);
    });
});
