import { describe, expect, it } from 'vitest';
import {
    REJECTION_DOCTOR_DECISIONS,
    resolveRejectionDoctorDecision,
} from '../../src/constants/rejectionFinancialDecision';

describe('rejection doctor financial decision', () => {
    it('keeps the full doctor amount but marks decide-later as pending', () => {
        expect(resolveRejectionDoctorDecision({
            decision: REJECTION_DOCTOR_DECISIONS.decideLater,
            orderTotal: 2_000,
        })).toEqual({
            decision: 'decide_later',
            doctorAmount: 2_000,
            reviewStatus: 'pending',
        });
    });

    it('resolves full price immediately', () => {
        expect(resolveRejectionDoctorDecision({
            decision: REJECTION_DOCTOR_DECISIONS.fullPrice,
            orderTotal: 2_000,
        })).toEqual({
            decision: 'full_price',
            doctorAmount: 2_000,
            reviewStatus: 'resolved',
        });
    });

    it('resolves zero immediately', () => {
        expect(resolveRejectionDoctorDecision({
            decision: REJECTION_DOCTOR_DECISIONS.zero,
            orderTotal: 2_000,
        })).toEqual({
            decision: 'zero',
            doctorAmount: 0,
            reviewStatus: 'resolved',
        });
    });

    it('uses the agreed custom amount immediately', () => {
        expect(resolveRejectionDoctorDecision({
            decision: REJECTION_DOCTOR_DECISIONS.customAmount,
            orderTotal: 2_000,
            customAmount: 750,
        })).toEqual({
            decision: 'custom_amount',
            doctorAmount: 750,
            reviewStatus: 'resolved',
        });
    });

    it.each([-1, 2_001, Number.NaN])('rejects unsafe custom amount %s', customAmount => {
        expect(() => resolveRejectionDoctorDecision({
            decision: REJECTION_DOCTOR_DECISIONS.customAmount,
            orderTotal: 2_000,
            customAmount,
        })).toThrow();
    });
});
