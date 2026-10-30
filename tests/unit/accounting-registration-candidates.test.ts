import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Order } from '../../src/services/db';
import {
    getAccountingComparison,
    getAccountingReviewType,
    hasZeroAccountingImpact,
    getMissingAccountingDecisions,
    isAccountingFinanciallyReady,
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
    productionStatus: 'final_delivered',
    issueState: 'none',
    ...overrides,
});

describe('accounting registration candidates', () => {
    it('reports cancelled and lab-rejected orders as zero accounting impact', () => {
        expect(hasZeroAccountingImpact(order({ status: 'Cancelled', issueState: 'cancelled' }))).toBe(true);
        expect(hasZeroAccountingImpact(order({ status: 'Lab Rejected', issueState: 'lab_rejected' }))).toBe(true);
        expect(hasZeroAccountingImpact(order({ status: 'Delivered' }))).toBe(false);
    });

    it('classifies new, changed, and cancellation reviews separately', () => {
        expect(getAccountingReviewType(order())).toBe('new');
        expect(getAccountingReviewType(order({ needsAccountingReregistration: true }))).toBe('change');
        expect(getAccountingReviewType(order({ status: 'Cancelled', issueState: 'cancelled', needsAccountingReregistration: true }))).toBe('cancellation');
    });

    it('calculates the negative correction for a registered order that is cancelled', () => {
        const cancelled = order({
            status: 'Cancelled',
            issueState: 'cancelled',
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

    it('keeps an archived-but-never-registered order in the pending queue', () => {
        const archivedBeforeRegistration = order({
            isArchived: true,
            isRegistered: false,
        });

        expect(isAccountingRegistrationCandidate(archivedBeforeRegistration, 'pending')).toBe(true);
    });

    it('treats a V2 doctor rejection with no delivery timestamp as delivery evidence', () => {
        const legacyRejection = order({
            status: 'Doctor Rejected',
            issueState: 'doctor_rejected',
            isRegistered: false,
            firstDeliveredAt: undefined,
            actualDeliveryDate: undefined,
            productionStatus: 'not_started',
        });

        expect(isAccountingRegistrationCandidate(legacyRejection, 'pending')).toBe(true);
    });

    it('blocks doctor rejection accounting until every party decision is resolved', () => {
        const pending = order({
            issueState: 'doctor_rejected',
            rejectionDoctorDecision: 'decide_later',
            rejectedDoctorAmount: 100,
            rejectionFinancialReviewStatus: 'pending',
            rejectedLabCostStatus: 'pending',
            rejectedDesignerCostStatus: 'not_applicable',
        });
        expect(isAccountingFinanciallyReady(pending)).toBe(false);
        expect(getAccountingComparison(pending).current.saleAmount).toBe(100);
        expect(getMissingAccountingDecisions(pending)).toEqual(['قرار تحمّل الطبيب', 'تكلفة المورد']);
    });

    it('never sends a cancelled order that was never registered to accounting', () => {
        const cancelled = order({
            status: 'Cancelled',
            issueState: 'cancelled',
            isRegistered: false,
            needsAccountingReregistration: false,
        });

        expect(isAccountingRegistrationCandidate(cancelled, 'pending')).toBe(false);
        expect(isAccountingRegistrationCandidate(cancelled, 'history')).toBe(false);
    });

    it('sends a cancellation made after registration back for zero-value removal', () => {
        const cancelledChange = order({
            status: 'Cancelled',
            issueState: 'cancelled',
            isRegistered: false,
            needsAccountingReregistration: true,
        });

        expect(isAccountingRegistrationCandidate(cancelledChange, 'pending')).toBe(true);
    });

    it('keeps an acknowledged cancelled entry in registration history', () => {
        const acknowledgedCancellation = order({
            status: 'Cancelled',
            issueState: 'cancelled',
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

    it('uses V2 axes when legacy status conflicts with the accounting lifecycle', () => {
        const deliveredWithStaleCancellation = order({
            status: 'Cancelled',
            productionStatus: 'final_delivered',
            issueState: 'none',
            isRegistered: false,
        });
        const cancelledWithStaleDelivery = order({
            status: 'Delivered',
            productionStatus: 'not_started',
            issueState: 'cancelled',
            isRegistered: false,
        });

        expect(hasZeroAccountingImpact(deliveredWithStaleCancellation)).toBe(false);
        expect(getAccountingComparison(deliveredWithStaleCancellation).current).toMatchObject({
            status: 'Delivered',
            saleAmount: 100,
            labCost: 50,
        });
        expect(isAccountingRegistrationCandidate(deliveredWithStaleCancellation, 'pending')).toBe(true);

        expect(hasZeroAccountingImpact(cancelledWithStaleDelivery)).toBe(true);
        expect(getAccountingReviewType({
            ...cancelledWithStaleDelivery,
            needsAccountingReregistration: true,
        })).toBe('cancellation');
        expect(isAccountingRegistrationCandidate(cancelledWithStaleDelivery, 'pending')).toBe(false);
    });

    it('keeps accounting UI decisions and statement editing off legacy order status', () => {
        const registrationLogic = readFileSync(resolve('src/constants/accountingRegistration.ts'), 'utf8');
        const registrationPage = readFileSync(resolve('src/pages/CaseRegistration.tsx'), 'utf8');
        const accountsPage = readFileSync(resolve('src/pages/Accounts.tsx'), 'utf8');
        const submitStart = accountsPage.indexOf('const handleOrderSubmit');
        const submitEnd = accountsPage.indexOf('// -- BULK PRINT LOGIC --', submitStart);

        expect(registrationLogic).not.toMatch(/order\.status\s*(?:===|!==)/);
        expect(registrationLogic).not.toContain('ACCOUNTING_REGISTRABLE_STATUSES.includes(order.status)');
        expect(registrationPage).not.toMatch(/order\.status\s*(?:===|!==)/);
        expect(registrationPage).not.toContain('order.status.toLowerCase()');
        expect(submitStart).toBeGreaterThanOrEqual(0);
        expect(submitEnd).toBeGreaterThan(submitStart);
        expect(accountsPage.slice(submitStart, submitEnd)).not.toContain('db.updateOrderStatus');
    });
});
