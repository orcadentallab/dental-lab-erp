import { describe, expect, it } from 'vitest';
import { statementService } from '../../src/services/statementService';
import type { Order } from '../../src/services/db';

const rejectedOrder = (overrides: Partial<Order>): Order => ({
    id: 'order-1',
    caseId: 'CASE-1',
    doctorId: 'doctor-1',
    patientName: 'Patient',
    status: 'Doctor Rejected',
    issueState: 'doctor_rejected',
    totalPrice: 2_000,
    deliveryDate: '2026-07-24',
    createdAt: '2026-07-24T00:00:00Z',
    items: [],
    ...overrides,
} as Order);

describe('doctor statement rejection amounts', () => {
    it('keeps historical rejected orders at zero even in show-all mode', () => {
        const result = statementService.calculateDoctorStatement(
            'doctor-1',
            [rejectedOrder({})],
            [],
            '2026-07-01',
            '2026-07-31',
            [],
            true
        );

        expect(result.items[0]?.amount).toBe(0);
    });

    it('shows the approved provisional full amount in show-all mode', () => {
        const result = statementService.calculateDoctorStatement(
            'doctor-1',
            [rejectedOrder({
                rejectionDoctorDecision: 'decide_later',
                rejectedDoctorAmount: 2_000,
                rejectionFinancialReviewStatus: 'pending',
            })],
            [],
            '2026-07-01',
            '2026-07-31',
            [],
            true
        );

        expect(result.items[0]?.amount).toBe(2_000);
    });

    it('excludes soft-deleted terminal orders from normal and show-all statements', () => {
        const deleted = rejectedOrder({
            isDeleted: true,
            rejectionDoctorDecision: 'decide_later',
            rejectedDoctorAmount: 2_000,
        });

        const normal = statementService.calculateDoctorStatement(
            'doctor-1', [deleted], [], '2026-07-01', '2026-07-31', [], false
        );
        const showAll = statementService.calculateDoctorStatement(
            'doctor-1', [deleted], [], '2026-07-01', '2026-07-31', [], true
        );

        expect(normal.items).toHaveLength(0);
        expect(showAll.items).toHaveLength(0);
        expect(normal.totals.balance).toBe(0);
        expect(showAll.totals.balance).toBe(0);
    });
});
