import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    DELIVERY_ROUTES,
    canRecognizeCashRevenue,
    getDeliveryRoute,
    getFinancialSummary,
    getOfficialStatementDate,
    getIssueStatus,
    getMainStatus,
    getProductionStatus,
    isBillableToDoctor,
    canTransitionTo,
    isDeliveredForDoctorReceivable,
    isExternalLabPayableEligible,
    isFinalReady,
    isReadyForExternalLabPayable,
    isTryInOrder,
    isTryInReady,
} from '../src/constants/orderLifecycle';
import { shouldVoidExternalLabReadyObligationForStatusChange } from '../src/constants/financialObligations';

const order = (overrides: Record<string, unknown>) => ({
    id: 'order-1',
    totalPrice: 1000,
    ...overrides,
});

test.describe('legacy lifecycle mapping', () => {
    test('maps completed and delivered as delivered and doctor billable for legacy accounts', () => {
        for (const status of ['Completed', 'Delivered']) {
            const mappedOrder = order({ status });

            expect(getProductionStatus(mappedOrder)).toBe('delivered');
            expect(getMainStatus(mappedOrder)).toBe('delivered');
            expect(isDeliveredForDoctorReceivable(mappedOrder)).toBe(true);
            expect(isBillableToDoctor(mappedOrder)).toBe(true);
        }
    });

    test('maps ready as operational ready but not doctor billable', () => {
        const readyOrder = order({ status: 'Ready' });

        expect(getProductionStatus(readyOrder)).toBe('ready');
        expect(isBillableToDoctor(readyOrder)).toBe(false);
        expect(isDeliveredForDoctorReceivable(readyOrder)).toBe(false);
    });

    test('maps try-in statuses as not doctor billable', () => {
        for (const status of ['Try In', 'Try In Approved']) {
            const tryInOrder = order({ status });

            expect(isTryInOrder(tryInOrder)).toBe(true);
            expect(isBillableToDoctor(tryInOrder)).toBe(false);
        }
    });

    test('maps production, design, and new statuses', () => {
        expect(getProductionStatus(order({ status: 'Under Production' }))).toBe('in_production');
        expect(getProductionStatus(order({ status: 'In Progress' }))).toBe('in_production');
        expect(getProductionStatus(order({ status: 'Under Design' }))).toBe('designing');
        expect(getProductionStatus(order({ status: 'Waiting Dr Approval' }))).toBe('designing');
        expect(getProductionStatus(order({ status: 'Sent to External Lab' }))).toBe('sent_to_lab');
        expect(getProductionStatus(order({ status: 'New Case' }))).toBe('not_started');
        expect(getProductionStatus(order({ status: 'Pending' }))).toBe('not_started');
        expect(getProductionStatus(order({ status: 'Pending Review' }))).toBe('not_started');
    });

    test('maps returned, rejected, and cancelled issue states', () => {
        const returned = order({ status: 'Returned for Adjustments' });
        const rejected = order({ status: 'Rejected' });
        const cancelled = order({ status: 'Cancelled' });

        expect(getProductionStatus(returned)).toBe('in_production');
        expect(getIssueStatus(returned)).toBe('remake_requested');
        expect(getIssueStatus(rejected)).toBe('rejected');
        expect(isBillableToDoctor(rejected)).toBe(false);
        expect(getMainStatus(cancelled)).toBe('cancelled');
        expect(getIssueStatus(cancelled)).toBe('cancelled');
        expect(isBillableToDoctor(cancelled)).toBe(false);
    });

    test('allows the basic approved forward transitions', () => {
        expect(canTransitionTo(order({ status: 'New Case' }), 'designing')).toBe(true);
        expect(canTransitionTo(order({ status: 'Under Design' }), 'sent_to_lab')).toBe(true);
        expect(canTransitionTo(order({ status: 'Sent to External Lab' }), 'in_production')).toBe(true);
        expect(canTransitionTo(order({ status: 'Under Production' }), 'ready')).toBe(true);
        expect(canTransitionTo(order({ status: 'Ready' }), 'delivered')).toBe(true);
    });
});

test.describe('try-in ready and final ready', () => {
    test('treats final ready as external lab payable eligible only', () => {
        const finalReady = order({ status: 'Ready' });

        expect(isFinalReady(finalReady)).toBe(true);
        expect(isTryInReady(finalReady)).toBe(false);
        expect(isReadyForExternalLabPayable(finalReady)).toBe(true);
        expect(isExternalLabPayableEligible(finalReady)).toBe(true);
        expect(isBillableToDoctor(finalReady)).toBe(false);
    });

    test('treats ready with TryIn delivery type as try-in ready', () => {
        for (const deliveryType of ['TryIn', 'try_in']) {
            const tryInReady = order({ status: 'Ready', deliveryType });

            expect(isTryInOrder(tryInReady)).toBe(true);
            expect(isTryInReady(tryInReady)).toBe(true);
            expect(isFinalReady(tryInReady)).toBe(false);
            expect(isExternalLabPayableEligible(tryInReady)).toBe(false);
            expect(isBillableToDoctor(tryInReady)).toBe(false);
        }
    });

    test('detects snake_case TryIn delivery type', () => {
        const tryInReady = order({ status: 'Ready', delivery_type: 'TryIn' });

        expect(isTryInReady(tryInReady)).toBe(true);
        expect(isReadyForExternalLabPayable(tryInReady)).toBe(false);
    });

    test('leaving final ready workflow requires normal external lab payable review/voiding', () => {
        expect(shouldVoidExternalLabReadyObligationForStatusChange(
            order({ status: 'Ready' }),
            order({ status: 'Rejected' })
        )).toBe(true);
        expect(shouldVoidExternalLabReadyObligationForStatusChange(
            order({ status: 'Delivered' }),
            order({ status: 'Returned for Adjustments' })
        )).toBe(true);
        expect(shouldVoidExternalLabReadyObligationForStatusChange(
            order({ status: 'Ready' }),
            order({ status: 'Ready', deliveryType: 'TryIn' })
        )).toBe(true);
        expect(shouldVoidExternalLabReadyObligationForStatusChange(
            order({ status: 'Ready' }),
            order({ status: 'Delivered' })
        )).toBe(false);
    });
});

test.describe('delivery route and phase 1 finance summary', () => {
    test('defaults delivery route and keeps route out of finance logic', () => {
        const finalReady = order({ status: 'Ready' });
        const routedFinalReady = order({
            status: 'Ready',
            delivery_route: DELIVERY_ROUTES.externalLabToOurLabToDoctor,
        });

        expect(getDeliveryRoute(finalReady)).toBe(DELIVERY_ROUTES.externalLabToDoctor);
        expect(getDeliveryRoute(routedFinalReady)).toBe(DELIVERY_ROUTES.externalLabToOurLabToDoctor);
        expect(getFinancialSummary(finalReady)).toEqual(getFinancialSummary(routedFinalReady));
    });

    test('recognizes cash revenue only for positive doctor income candidates', () => {
        expect(canRecognizeCashRevenue({ type: 'income', entityType: 'doctor', amount: 100 })).toBe(true);
        expect(canRecognizeCashRevenue({ type: 'expense', entityType: 'doctor', amount: 100 })).toBe(false);
        expect(canRecognizeCashRevenue({ type: 'income', entityType: 'supplier', amount: 100 })).toBe(false);
        expect(canRecognizeCashRevenue({ type: 'income', entityType: 'doctor', amount: 0 })).toBe(false);
    });
});

test.describe('official statement dates', () => {
    test('uses actualDeliveryDate over deliveryDate for Delivered and legacy Completed orders', () => {
        for (const status of ['Delivered', 'Completed']) {
            const deliveredOrder = order({
                status,
                actualDeliveryDate: '2026-05-08',
                deliveryDate: '2026-05-01',
                createdAt: '2026-04-20T12:00:00.000Z',
            });

            expect(getOfficialStatementDate(deliveredOrder)).toBe('2026-05-08');
        }
    });

    test('falls back to deliveryDate for delivered legacy records missing actualDeliveryDate', () => {
        const deliveredOrder = order({
            status: 'Delivered',
            deliveryDate: '2026-05-01',
            createdAt: '2026-04-20T12:00:00.000Z',
        });

        expect(getOfficialStatementDate(deliveredOrder)).toBe('2026-05-01');
    });

    test('falls back to createdAt for delivered records missing delivery dates', () => {
        const deliveredOrder = order({
            status: 'Delivered',
            createdAt: '2026-04-20T12:00:00.000Z',
        });

        expect(getOfficialStatementDate(deliveredOrder)).toBe('2026-04-20');
    });

    test('returns planned deliveryDate for Ready display without making it doctor receivable', () => {
        const readyOrder = order({
            status: 'Ready',
            deliveryDate: '2026-05-10',
            actualDeliveryDate: '2026-05-08',
            createdAt: '2026-04-20T12:00:00.000Z',
        });

        expect(getOfficialStatementDate(readyOrder)).toBe('2026-05-10');
        expect(isDeliveredForDoctorReceivable(readyOrder)).toBe(false);
        expect(isBillableToDoctor(readyOrder)).toBe(false);
    });

    test('keeps try-in statuses out of doctor receivables', () => {
        for (const status of ['Try In', 'Try In Approved']) {
            const tryInOrder = order({
                status,
                deliveryDate: '2026-05-10',
                createdAt: '2026-04-20T12:00:00.000Z',
            });

            expect(getOfficialStatementDate(tryInOrder)).toBe('2026-05-10');
            expect(isDeliveredForDoctorReceivable(tryInOrder)).toBe(false);
            expect(isBillableToDoctor(tryInOrder)).toBe(false);
        }
    });

    test('official receivable amount logic remains status-based and unchanged', () => {
        expect(getFinancialSummary(order({ status: 'Delivered' })).doctorReceivableEligible).toBe(true);
        expect(getFinancialSummary(order({ status: 'Ready' })).doctorReceivableEligible).toBe(false);
    });
});

test.describe('delivered date persistence hotfix', () => {
    const ordersSource = readFileSync(resolve('src/services/supabase/orders.ts'), 'utf8');
    const statementSource = readFileSync(resolve('src/services/statementService.ts'), 'utf8');

    test('sets actual_delivery_date only when status becomes Delivered and preserves planned delivery_date', () => {
        expect(ordersSource).toContain("if (updates.status === 'Delivered') {");
        expect(ordersSource).toContain("const deliveredDate = timestamp.split('T')[0];");
        expect(ordersSource).toContain('dbUpdates.actual_delivery_date = deliveredDate;');
        expect(ordersSource).not.toContain('dbUpdates.delivery_date = deliveredDate;');
        expect(ordersSource).toContain('delivery_date remains the planned/requested date');

        expect(ordersSource).not.toContain("updates.status === 'Ready'");
        expect(ordersSource).not.toContain("updates.status === 'Try In'");
        expect(ordersSource).not.toContain("updates.status === 'Try In Approved'");
    });

    test('clears actual_delivery_date when Delivered is reverted without touching planned delivery_date', () => {
        expect(ordersSource).toContain("} else if (updates.status !== undefined && getProductionStatus({ status: updates.status }) !== 'delivered') {");
        expect(ordersSource).toContain('dbUpdates.actual_delivery_date = null;');
        expect(ordersSource).not.toContain('dbUpdates.delivery_date = null;');
    });

    test('statement filtering uses the official statement date helper', () => {
        expect(statementSource).toContain('getOfficialStatementDate(o)');
        expect(statementSource).not.toContain('const getOrderStatementDate');
    });
});
