import { describe, expect, it } from 'vitest';
import { buildSmartSearchResults } from '../../src/lib/smartSearch';
import type { Order } from '../../src/services/db';

const searchOrder = (overrides: Partial<Order>): Order => ({
    id: 'order-1',
    caseId: 'CASE-1',
    doctorId: 'doctor-1',
    patientName: 'Ahmed Patient',
    items: [],
    discount: 0,
    totalPrice: 100,
    shade: '',
    status: 'New Case',
    productionStatus: 'not_started',
    issueState: 'none',
    intakeState: 'accepted',
    deliveryDate: '2026-10-01',
    cost: 50,
    createdAt: '2026-10-01T00:00:00.000Z',
    priority: 'Normal',
    ...overrides,
});

describe('smart search V2 grouping', () => {
    it('groups by V2 delivery state even when the legacy display status is stale', () => {
        const active = searchOrder({
            id: 'active',
            status: 'Delivered',
            productionStatus: 'in_production',
        });
        const delivered = searchOrder({
            id: 'delivered',
            status: 'New Case',
            productionStatus: 'final_delivered',
        });

        const results = buildSmartSearchResults('Ahmed', [active, delivered], []);

        expect(results.activeOrders.map(order => order.id)).toEqual(['active']);
        expect(results.deliveredOrders.map(order => order.id)).toEqual(['delivered']);
    });
});
