import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    DERIVED_ORDER_STATUS_LABELS_AR,
    deriveOrderDisplayStatusV2,
    getOrderStatusV2Filter,
} from '../../src/constants/orderDerivedStatusV2';
import type { IssueState, ProductionStatus } from '../../src/constants/workflow';
import type { Order } from '../../src/services/db';
import { checkIsLate, wasRejected } from '../../src/utils/orderUtils';

const lifecycleOrder = (overrides: Partial<Order>): Order => ({
    id: 'order-1',
    caseId: 'CASE-1',
    doctorId: 'doctor-1',
    patientName: 'Patient',
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

describe('deriveOrderDisplayStatusV2', () => {
    test('keeps pending portal intake distinct from an accepted new case', () => {
        expect(deriveOrderDisplayStatusV2('not_started', 'none', 'pending_review')).toBe('Pending Review');
        expect(deriveOrderDisplayStatusV2('not_started', 'none', 'accepted')).toBe('New Case');
    });

    test.each<[ProductionStatus, string]>([
        ['not_started', 'New Case'],
        ['designing', 'Under Design'],
        ['in_production', 'Under Production'],
        ['try_in_ready', 'Try In'],
        ['waiting_doctor', 'Waiting Dr Approval'],
        ['finalization', 'Try In Approved'],
        ['final_ready', 'Ready'],
        ['final_delivered', 'Delivered'],
    ])('maps issue-free production state %s to %s', (productionStatus, expected) => {
        expect(deriveOrderDisplayStatusV2(productionStatus, 'none')).toBe(expected);
    });

    test.each<[IssueState, string]>([
        ['returned', 'Returned for Adjustments'],
        ['doctor_rejected', 'Doctor Rejected'],
        ['lab_rejected', 'Lab Rejected'],
        ['cancelled', 'Cancelled'],
        ['redo', 'Redo'],
    ])('lets issue state %s override the production stage', (issueState, expected) => {
        expect(deriveOrderDisplayStatusV2('final_delivered', issueState)).toBe(expected);
        expect(deriveOrderDisplayStatusV2('not_started', issueState)).toBe(expected);
    });

    test('renders redo with its own Arabic presentation label', () => {
        expect(DERIVED_ORDER_STATUS_LABELS_AR.Redo).toBe('إعادة إنتاج');
    });

    test('fails closed for unknown or missing workflow axes', () => {
        expect(deriveOrderDisplayStatusV2('unknown' as ProductionStatus, 'none')).toBeNull();
        expect(deriveOrderDisplayStatusV2('not_started', 'unknown' as IssueState)).toBeNull();
        expect(deriveOrderDisplayStatusV2(null, 'none')).toBeNull();
        expect(deriveOrderDisplayStatusV2('not_started', null)).toBeNull();
    });
});

describe('getOrderStatusV2Filter', () => {
    test.each([
        ['New Case', { productionStatus: 'not_started', issueState: 'none', intakeState: 'accepted' }],
        ['Pending', { productionStatus: 'not_started', issueState: 'none', intakeState: 'accepted' }],
        ['Pending Review', { productionStatus: 'not_started', issueState: 'none', intakeState: 'pending_review' }],
        ['Under Design', { productionStatus: 'designing', issueState: 'none' }],
        ['In Progress', { productionStatus: 'in_production', issueState: 'none' }],
        ['Under Production', { productionStatus: 'in_production', issueState: 'none' }],
        ['Try In', { productionStatus: 'try_in_ready', issueState: 'none' }],
        ['Waiting Dr Approval', { productionStatus: 'waiting_doctor', issueState: 'none' }],
        ['Try In Approved', { productionStatus: 'finalization', issueState: 'none' }],
        ['Ready', { productionStatus: 'final_ready', issueState: 'none' }],
        ['Completed', { productionStatus: 'final_delivered', issueState: 'none' }],
        ['Delivered', { productionStatus: 'final_delivered', issueState: 'none' }],
        ['Returned for Adjustments', { issueState: 'returned' }],
        ['Rejected', { issueState: 'doctor_rejected' }],
        ['Doctor Rejected', { issueState: 'doctor_rejected' }],
        ['Lab Rejected', { issueState: 'lab_rejected' }],
        ['Cancelled', { issueState: 'cancelled' }],
        ['Redo', { issueState: 'redo' }],
    ])('maps legacy display filter %s to V2 axes', (legacyStatus, expected) => {
        expect(getOrderStatusV2Filter(legacyStatus)).toEqual(expected);
    });

    test('fails closed for unknown legacy display filters', () => {
        expect(getOrderStatusV2Filter('Unknown Status')).toBeNull();
        expect(getOrderStatusV2Filter('')).toBeNull();
    });
});

describe('V2 presentation consumers', () => {
    test.each([
        'src/components/dashboard/OrderListItem.tsx',
        'src/components/GlobalSearch.tsx',
        'src/lib/smartSearch.ts',
        'src/utils/orderUtils.tsx',
        'src/pages/DesignerDashboard.tsx',
        'src/pages/DesignerStats.tsx',
        'src/pages/AIAnalytics.tsx',
        'src/pages/CashFlow.tsx',
        'src/components/finance/OrderAnalysisTab.tsx',
        'src/services/statementService.ts',
    ])('does not use legacy order status as presentation or grouping authority in %s', (path) => {
        const source = readFileSync(resolve(path), 'utf8');

        expect(source).not.toMatch(/\border\.status\b/);
        expect(source).not.toMatch(/\bstatus:\s*o\.status\b/);
    });

    test('uses V2 issue state for rejection classification despite stale legacy text', () => {
        expect(wasRejected(lifecycleOrder({ status: 'New Case', issueState: 'doctor_rejected' }))).toBe(true);
        expect(wasRejected(lifecycleOrder({ status: 'Doctor Rejected', issueState: 'none' }))).toBe(false);
    });

    test('uses V2 delivery and issue state for late classification', () => {
        expect(checkIsLate(lifecycleOrder({
            status: 'New Case',
            productionStatus: 'final_delivered',
            actualDeliveryDate: '2026-10-02T00:00:00.000Z',
        }))).toBe(true);
        expect(checkIsLate(lifecycleOrder({
            status: 'Under Production',
            productionStatus: 'in_production',
            issueState: 'cancelled',
            deliveryDate: '2020-01-01',
        }))).toBe(false);
    });
});
