import { describe, expect, it } from 'vitest';
import type { Order } from '../../src/services/db';
import {
    isAccountingRegistrationCandidate,
} from '../../src/constants/accountingRegistration';

const order = (overrides: Partial<Order> = {}): Order => ({
    id: 'order-1',
    caseId: 'CASE-1',
    doctorId: 'doctor-1',
    patientName: 'Patient',
    items: [],
    discount: 0,
    totalPrice: 100,
    shade: '',
    status: 'Delivered',
    deliveryDate: '2026-07-31',
    cost: 50,
    createdAt: '2026-07-31T00:00:00Z',
    priority: 'Normal',
    ...overrides,
});

describe('accounting registration candidates', () => {
    it('keeps genuinely unregistered delivered orders in the pending queue', () => {
        expect(isAccountingRegistrationCandidate(order({ isRegistered: false }), 'pending')).toBe(true);
    });

    it('shows a newly changed archived order as a normal accounting change', () => {
        const archived = order({
            isArchived: true,
            isRegistered: false,
            needsAccountingReregistration: true,
        });

        expect(isAccountingRegistrationCandidate(archived, 'pending')).toBe(true);
    });

    it('does not show a previously registered archived order after its legacy marker is cleared', () => {
        expect(isAccountingRegistrationCandidate(order({
            isArchived: true,
            isRegistered: true,
            needsAccountingReregistration: false,
        }), 'pending')).toBe(false);
    });

    it('never shows deleted rows in either registration tab', () => {
        const deleted = order({ isDeleted: true, needsAccountingReregistration: true });
        expect(isAccountingRegistrationCandidate(deleted, 'pending')).toBe(false);
        expect(isAccountingRegistrationCandidate(deleted, 'history')).toBe(false);
    });
});
