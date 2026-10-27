import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Order } from '../../src/services/db';
import {
    isDashboardTerminal,
    isLabDashboardVisible,
} from '../../src/constants/dashboardOrderGroups';

const dashboardOrder = (overrides: Partial<Order>): Order => ({
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
    deliveryDate: '2026-10-25',
    cost: 50,
    createdAt: '2026-10-25T00:00:00.000Z',
    priority: 'Normal',
    ...overrides,
});

describe('dashboard V2 order grouping', () => {
    it('classifies terminal orders from V2 axes when legacy status is stale', () => {
        expect(isDashboardTerminal(dashboardOrder({
            status: 'New Case',
            productionStatus: 'final_delivered',
        }))).toBe(true);
        expect(isDashboardTerminal(dashboardOrder({
            status: 'Delivered',
            productionStatus: 'in_production',
        }))).toBe(false);
        expect(isDashboardTerminal(dashboardOrder({
            status: 'Under Production',
            issueState: 'cancelled',
        }))).toBe(true);
        expect(isDashboardTerminal(dashboardOrder({
            status: 'Delivered',
            productionStatus: 'final_delivered',
            issueState: 'returned',
        }))).toBe(false);
    });

    it('shows split lab work from production and issue axes only', () => {
        expect(isLabDashboardVisible(dashboardOrder({
            status: 'Under Design',
            productionStatus: 'in_production',
        }))).toBe(true);
        expect(isLabDashboardVisible(dashboardOrder({
            status: 'Under Production',
            productionStatus: 'designing',
        }))).toBe(false);
        expect(isLabDashboardVisible(dashboardOrder({
            status: 'New Case',
            issueState: 'returned',
        }))).toBe(true);
    });

    it.each([
        'src/pages/DashboardNew.tsx',
        'src/pages/Dashboard.tsx',
        'src/services/dashboardService.ts',
    ])('keeps %s free of direct legacy order status reads', (path) => {
        const source = readFileSync(resolve(path), 'utf8');

        expect(source).not.toMatch(/\b(?:order|o)\.status\b/);
    });
});
