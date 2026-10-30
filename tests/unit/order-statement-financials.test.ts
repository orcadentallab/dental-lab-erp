import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Order } from '../../src/services/db';
import {
    getDesignerStatementAmount,
    getSupplierStatementAmount,
} from '../../src/constants/orderStatementFinancials';
import {
    getDoctorOrderDisplayAmount,
    getLabCostAmount,
    isClosedCaseInPeriod,
    isDoctorStatementIncluded,
    isNonProductiveOrder,
    isZeroValueDelivery,
} from '../../src/constants/orderLifecycle';

const order = (overrides: Partial<Order> = {}): Order => ({
    id: 'order-1',
    caseId: 'CASE-1',
    status: 'Under Production',
    productionStatus: 'in_production',
    issueState: 'none',
    workflowType: 'split',
    designStatus: 'completed',
    totalPrice: 1000,
    cost: 500,
    designPrice: 200,
    isDeleted: false,
    ...overrides,
} as Order);

describe('V2 statement financial decisions', () => {
    it('uses V2 final delivery for supplier cost even when legacy status is stale', () => {
        expect(getSupplierStatementAmount(order({
            status: 'New Case',
            productionStatus: 'final_delivered',
            issueState: 'none',
        }), false, false)).toBe(300);
    });

    it.each([
        ['cancelled', 'Delivered'],
        ['lab_rejected', 'Delivered'],
    ] as const)('keeps supplier amount zero for %s regardless of legacy status', (issueState, status) => {
        expect(getSupplierStatementAmount(order({ issueState, status }), false, false)).toBe(0);
    });

    it.each([
        ['doctor_rejected', 350],
        ['redo', 425],
    ] as const)('uses the reviewed supplier amount for %s', (issueState, rejectedLabCost) => {
        expect(getSupplierStatementAmount(order({
            status: 'Delivered',
            issueState,
            rejectedLabCost,
        }), false, false)).toBe(rejectedLabCost);
    });

    it('excludes unresolved doctor rejection and preserves the earned returned-work payable', () => {
        expect(getSupplierStatementAmount(order({
            status: 'Delivered',
            issueState: 'doctor_rejected',
            rejectedLabCost: undefined,
        }), false, false)).toBeNull();
        expect(getSupplierStatementAmount(order({
            status: 'Delivered',
            issueState: 'returned',
        }), false, false)).toBe(300);
    });

    it('preserves designer amounts for completed work and reviewed rejection decisions', () => {
        expect(getDesignerStatementAmount(order({
            status: 'New Case',
            productionStatus: 'in_production',
            issueState: 'none',
            designStatus: 'completed',
        }), false)).toBe(200);
        expect(getDesignerStatementAmount(order({
            status: 'Delivered',
            issueState: 'doctor_rejected',
            rejectedDesignerCost: 125,
        }), false)).toBe(125);
        expect(getDesignerStatementAmount(order({
            status: 'Delivered',
            issueState: 'redo',
            rejectedDesignerCost: 150,
        }), false)).toBe(150);
    });

    it.each(['cancelled', 'lab_rejected'] as const)(
        'keeps designer amount zero for %s regardless of legacy status',
        (issueState) => {
            expect(getDesignerStatementAmount(order({
                status: 'Delivered',
                issueState,
            }), false)).toBe(0);
        },
    );

    it('uses V2 axes for doctor statement inclusion and displayed amount', () => {
        expect(isDoctorStatementIncluded(order({
            status: 'Under Production',
            productionStatus: 'final_delivered',
            issueState: 'none',
        }))).toBe(true);
        expect(isDoctorStatementIncluded(order({
            status: 'Delivered',
            productionStatus: 'in_production',
            issueState: 'none',
        }))).toBe(false);
        expect(getDoctorOrderDisplayAmount(order({
            status: 'Delivered',
            issueState: 'doctor_rejected',
            rejectionDoctorDecision: 'custom_amount',
            rejectedDoctorAmount: 275,
        }))).toBe(275);
        expect(getDoctorOrderDisplayAmount(order({
            status: 'Delivered',
            issueState: 'cancelled',
        }))).toBe(0);
    });

    it('uses V2 axes for monthly-report closed and zero-value classifications', () => {
        expect(isClosedCaseInPeriod(order({
            status: 'Delivered',
            productionStatus: 'in_production',
            issueState: 'returned',
        }))).toBe(false);
        expect(isZeroValueDelivery(order({
            status: 'Under Production',
            productionStatus: 'final_delivered',
            issueState: 'none',
            totalPrice: 0,
        }))).toBe(true);
    });

    it('does not zero productive cost because of a stale legacy status', () => {
        const delivered = order({
            status: 'Cancelled',
            productionStatus: 'final_delivered',
            issueState: 'none',
        });

        expect(isNonProductiveOrder(delivered)).toBe(false);
        expect(getLabCostAmount(delivered)).toBe(500);
    });

    it('keeps Statements business calculations free of direct legacy status decisions', () => {
        const source = readFileSync(resolve('src/pages/Statements.tsx'), 'utf8');

        expect(source).not.toContain('isDoctorRejectedStatus');
        expect(source).not.toContain('isLabRejectedStatus');
        expect(source).not.toMatch(/\bo\.status\s*===/);
        expect(source).not.toContain('status: o.status');
        expect(source).not.toContain('status: order.status');
    });

    it.each([
        'src/pages/Accounts.tsx',
        'src/pages/AgingReport.tsx',
        'src/pages/BalanceSnapshot.tsx',
        'src/components/finance/AccountInfoPanel.tsx',
        'src/components/finance/StatementTab.tsx',
        'src/components/finance/DoctorReceivablesModal.tsx',
        'src/components/finance/doctorReceivablesFallback.ts',
        'src/components/orders/OrderCard.tsx',
        'src/services/supabase/financialReconciliationPreview.ts',
    ])('keeps %s financial decisions free of direct legacy order status checks', (path) => {
        const source = readFileSync(resolve(path), 'utf8');

        expect(source).not.toContain('isDoctorRejectedStatus');
        expect(source).not.toContain('isLabRejectedStatus');
        expect(source).not.toMatch(/\bo(?:rder)?\.status\s*===/);
        expect(source).not.toMatch(/normalizeStatus\(o\.status\)/);
        expect(source).not.toMatch(/\.includes\(o\.status/);
    });
});
