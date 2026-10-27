import { describe, expect, it } from 'vitest';
import { computeClientSideReceivables } from '../../src/components/finance/doctorReceivablesFallback';
import type { Order } from '../../src/services/db';

const fallbackOrder = (overrides: Partial<Order>): Order => ({
    id: 'order-1',
    caseId: 'CASE-1',
    doctorId: 'doctor-1',
    patientName: 'Patient',
    items: [],
    discount: 0,
    totalPrice: 100,
    shade: '',
    status: 'New Case',
    productionStatus: 'final_delivered',
    issueState: 'none',
    intakeState: 'accepted',
    deliveryDate: '2026-10-01',
    actualDeliveryDate: '2026-10-02T00:00:00.000Z',
    firstDeliveredAt: '2026-10-02T00:00:00.000Z',
    cost: 50,
    createdAt: '2026-09-01T00:00:00.000Z',
    priority: 'Normal',
    ...overrides,
});

describe('doctor receivables client fallback', () => {
    it('uses V2 eligibility and reviewed amounts when legacy status is stale', () => {
        const rows = computeClientSideReceivables([
            fallbackOrder({ id: 'delivered', status: 'New Case' }),
            fallbackOrder({
                id: 'stale-delivered',
                status: 'Delivered',
                productionStatus: 'in_production',
            }),
            fallbackOrder({
                id: 'doctor-rejected',
                status: 'Under Production',
                issueState: 'doctor_rejected',
                rejectionDoctorDecision: 'custom_amount',
                rejectedDoctorAmount: 30,
            }),
            fallbackOrder({
                id: 'cancelled',
                status: 'Delivered',
                issueState: 'cancelled',
            }),
        ], [
            { entityId: 'doctor-1', entityType: 'doctor', type: 'income', amount: 20 },
        ], [
            { id: 'doctor-1', name: 'Doctor One' },
        ]);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            doctorId: 'doctor-1',
            totalBilled: 130,
            totalPaid: 20,
            balance: 110,
            orderCount: 2,
        });
        expect(
            rows[0].aging_0_30
            + rows[0].aging_31_60
            + rows[0].aging_61_90
            + rows[0].aging_90_plus,
        ).toBe(110);
    });
});
