import { describe, expect, it } from 'vitest';
import type { Order } from '../../src/services/db';
import {
    getAccountingComparison,
    getAccountingReviewType,
    hasZeroAccountingImpact,
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
    it('reports cancelled and lab-rejected orders as zero accounting impact', () => {
        expect(hasZeroAccountingImpact(order({ status: 'Cancelled' }))).toBe(true);
        expect(hasZeroAccountingImpact(order({ status: 'Lab Rejected' }))).toBe(true);
        expect(hasZeroAccountingImpact(order({ status: 'Delivered' }))).toBe(false);
    });

    it('classifies new, changed, and cancellation reviews separately', () => {
        expect(getAccountingReviewType(order())).toBe('new');
        expect(getAccountingReviewType(order({ needsAccountingReregistration: true }))).toBe('change');
        expect(getAccountingReviewType(order({ status: 'Cancelled', needsAccountingReregistration: true }))).toBe('cancellation');
    });

    it('calculates the negative correction for a registered order that is cancelled', () => {
        const cancelled = order({
            status: 'Cancelled',
            needsAccountingReregistration: true,
            accountingPreviousSnapshot: {
                status: 'Delivered',
                saleAmount: 12000,
                labCost: 3950,
                designCost: 0,
                discount: 0,
                doctorId: 'doctor-1',
                supplierId: 'supplier-1',
                designerId: null,
            },
        });

        expect(getAccountingComparison(cancelled)).toMatchObject({
            type: 'cancellation',
            current: { saleAmount: 0, labCost: 0 },
            delta: { saleAmount: -12000, labCost: -3950 },
        });
    });

    it('calculates positive and negative deltas for a financial amendment', () => {
        const changed = order({
            totalPrice: 1500,
            cost: 400,
            needsAccountingReregistration: true,
            accountingSnapshot: {
                status: 'Delivered',
                saleAmount: 1000,
                labCost: 500,
                designCost: 0,
                discount: 0,
                doctorId: 'doctor-1',
                supplierId: null,
                designerId: null,
            },
        });

        expect(getAccountingComparison(changed).delta).toMatchObject({
            saleAmount: 500,
            labCost: -100,
        });
    });

    it('keeps genuinely unregistered delivered orders in the pending queue', () => {
        expect(isAccountingRegistrationCandidate(order({ isRegistered: false }), 'pending')).toBe(true);
    });

    it('never sends a cancelled order that was never registered to accounting', () => {
        const cancelled = order({
            status: 'Cancelled',
            isRegistered: false,
            needsAccountingReregistration: false,
        });

        expect(isAccountingRegistrationCandidate(cancelled, 'pending')).toBe(false);
        expect(isAccountingRegistrationCandidate(cancelled, 'history')).toBe(false);
    });

    it('sends a cancellation made after registration back for zero-value removal', () => {
        const cancelledChange = order({
            status: 'Cancelled',
            isRegistered: false,
            needsAccountingReregistration: true,
        });

        expect(isAccountingRegistrationCandidate(cancelledChange, 'pending')).toBe(true);
    });

    it('keeps an acknowledged cancelled entry in registration history', () => {
        const acknowledgedCancellation = order({
            status: 'Cancelled',
            isRegistered: true,
            needsAccountingReregistration: false,
        });

        expect(isAccountingRegistrationCandidate(acknowledgedCancellation, 'history')).toBe(true);
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
