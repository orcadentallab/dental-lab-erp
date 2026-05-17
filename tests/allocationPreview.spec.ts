import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    DOCTOR_OVERPAYMENT_PREVIEW_WARNING,
    SUPPLIER_OVERPAYMENT_PREVIEW_WARNING,
    buildFifoAllocationPreview,
    filterOpenObligationsForPreview,
    sortObligationsForFifoPreview,
    validateAllocationPreviewParams,
    type AllocationPreviewObligation,
} from '../src/constants/allocationEngine';
import { BILLING_ENTITY_TYPES } from '../src/constants/billingSettings';
import { OBLIGATION_DIRECTIONS, OBLIGATION_STATUSES, OBLIGATION_TRIGGER_TYPES } from '../src/constants/financialObligations';

function obligation(overrides: Partial<AllocationPreviewObligation>): AllocationPreviewObligation {
    return {
        id: overrides.id || 'obligation-1',
        orderId: overrides.orderId || 'order-1',
        caseId: overrides.caseId ?? 'CASE-1',
        patientName: overrides.patientName ?? 'Patient',
        triggerType: overrides.triggerType || OBLIGATION_TRIGGER_TYPES.doctorDelivered,
        dueDate: overrides.dueDate || '2026-05-10',
        triggerDate: overrides.triggerDate || '2026-05-01',
        netAmount: overrides.netAmount ?? 1000,
        allocatedAmount: overrides.allocatedAmount ?? 0,
        remainingAmount: overrides.remainingAmount ?? 1000,
        status: overrides.status || OBLIGATION_STATUSES.unpaid,
        createdAt: overrides.createdAt || '2026-05-01T10:00:00.000Z',
    };
}

test.describe('FIFO allocation preview helpers', () => {
    test('sorts by due date, then trigger date, then created at', () => {
        const sorted = sortObligationsForFifoPreview([
            obligation({ id: 'third', dueDate: '2026-05-12', triggerDate: '2026-05-01', createdAt: '2026-05-01T09:00:00.000Z' }),
            obligation({ id: 'second', dueDate: '2026-05-10', triggerDate: '2026-05-03', createdAt: '2026-05-01T09:00:00.000Z' }),
            obligation({ id: 'first', dueDate: '2026-05-10', triggerDate: '2026-05-01', createdAt: '2026-05-02T09:00:00.000Z' }),
            obligation({ id: 'tie-breaker', dueDate: '2026-05-10', triggerDate: '2026-05-01', createdAt: '2026-05-01T09:00:00.000Z' }),
        ]);

        expect(sorted.map(item => item.id)).toEqual(['tie-breaker', 'first', 'second', 'third']);
    });

    test('builds partial FIFO allocation preview', () => {
        const result = buildFifoAllocationPreview(
            {
                entityType: BILLING_ENTITY_TYPES.doctor,
                entityId: 'doctor-1',
                direction: OBLIGATION_DIRECTIONS.receivable,
                amount: 2000,
            },
            [
                obligation({ id: 'one', orderId: 'order-1', remainingAmount: 1000, netAmount: 1000, dueDate: '2026-05-10' }),
                obligation({ id: 'two', orderId: 'order-2', remainingAmount: 800, netAmount: 800, dueDate: '2026-05-12' }),
                obligation({ id: 'three', orderId: 'order-3', remainingAmount: 700, netAmount: 700, dueDate: '2026-05-20' }),
            ]
        );

        expect(result.totalAllocated).toBe(2000);
        expect(result.unallocatedAmount).toBe(0);
        expect(result.creditPreviewAmount).toBe(0);
        expect(result.allocationPlan).toMatchObject([
            { obligationId: 'one', previewAllocatedAmount: 1000, previewRemainingAmountAfter: 0 },
            { obligationId: 'two', previewAllocatedAmount: 800, previewRemainingAmountAfter: 0 },
            { obligationId: 'three', previewAllocatedAmount: 200, previewRemainingAmountAfter: 500 },
        ]);
    });

    test('builds exact allocation preview', () => {
        const result = buildFifoAllocationPreview(
            {
                entityType: BILLING_ENTITY_TYPES.doctor,
                entityId: 'doctor-1',
                direction: OBLIGATION_DIRECTIONS.receivable,
                amount: 1800,
            },
            [
                obligation({ id: 'one', remainingAmount: 1000, netAmount: 1000, dueDate: '2026-05-10' }),
                obligation({ id: 'two', remainingAmount: 800, netAmount: 800, dueDate: '2026-05-12' }),
            ]
        );

        expect(result.totalAllocated).toBe(1800);
        expect(result.unallocatedAmount).toBe(0);
        expect(result.allocationPlan).toHaveLength(2);
        expect(result.warnings).toEqual([]);
    });

    test('doctor overpayment returns credit preview only', () => {
        const result = buildFifoAllocationPreview(
            {
                entityType: BILLING_ENTITY_TYPES.doctor,
                entityId: 'doctor-1',
                direction: OBLIGATION_DIRECTIONS.receivable,
                amount: 1200,
                transactionId: 'transaction-1',
            },
            [obligation({ id: 'one', remainingAmount: 1000, netAmount: 1000 })]
        );

        expect(result.totalAllocated).toBe(1000);
        expect(result.unallocatedAmount).toBe(200);
        expect(result.creditPreviewAmount).toBe(200);
        expect(result.transactionId).toBe('transaction-1');
        expect(result.warnings).toContain(DOCTOR_OVERPAYMENT_PREVIEW_WARNING);
    });

    test('external lab overpayment returns warning and no credit by default', () => {
        const result = buildFifoAllocationPreview(
            {
                entityType: BILLING_ENTITY_TYPES.externalLab,
                entityId: 'supplier-1',
                direction: OBLIGATION_DIRECTIONS.payable,
                amount: 1200,
            },
            [obligation({
                id: 'one',
                triggerType: OBLIGATION_TRIGGER_TYPES.externalLabReady,
                remainingAmount: 1000,
                netAmount: 1000,
            })]
        );

        expect(result.totalAllocated).toBe(1000);
        expect(result.unallocatedAmount).toBe(200);
        expect(result.creditPreviewAmount).toBe(0);
        expect(result.warnings).toContain(SUPPLIER_OVERPAYMENT_PREVIEW_WARNING);
    });

    test('excludes void, paid, written off, zero remaining, and not-due obligations when requested', () => {
        const filtered = filterOpenObligationsForPreview(
            [
                obligation({ id: 'open', dueDate: '2026-05-10', status: OBLIGATION_STATUSES.unpaid, remainingAmount: 100 }),
                obligation({ id: 'partial', dueDate: '2026-05-10', status: OBLIGATION_STATUSES.partiallyPaid, remainingAmount: 50 }),
                obligation({ id: 'void', dueDate: '2026-05-10', status: OBLIGATION_STATUSES.void, remainingAmount: 100 }),
                obligation({ id: 'paid', dueDate: '2026-05-10', status: OBLIGATION_STATUSES.paid, remainingAmount: 100 }),
                obligation({ id: 'written-off', dueDate: '2026-05-10', status: OBLIGATION_STATUSES.writtenOff, remainingAmount: 100 }),
                obligation({ id: 'zero', dueDate: '2026-05-10', status: OBLIGATION_STATUSES.unpaid, remainingAmount: 0 }),
                obligation({ id: 'future', dueDate: '2026-05-20', status: OBLIGATION_STATUSES.unpaid, remainingAmount: 100 }),
            ],
            { includeNotDue: false, paymentDate: '2026-05-12' }
        );

        expect(filtered.map(item => item.id)).toEqual(['open', 'partial']);
    });

    test('rejects zero or negative amount and invalid values', () => {
        expect(() => validateAllocationPreviewParams({
            entityType: BILLING_ENTITY_TYPES.doctor,
            entityId: 'doctor-1',
            direction: OBLIGATION_DIRECTIONS.receivable,
            amount: 0,
        })).toThrow('Allocation preview amount must be greater than zero');

        expect(() => validateAllocationPreviewParams({
            entityType: 'designer' as 'doctor',
            entityId: 'designer-1',
            direction: OBLIGATION_DIRECTIONS.receivable,
            amount: 100,
        })).toThrow('Invalid allocation preview entity type');

        expect(() => validateAllocationPreviewParams({
            entityType: BILLING_ENTITY_TYPES.doctor,
            entityId: 'doctor-1',
            direction: 'other' as 'receivable',
            amount: 100,
        })).toThrow('Invalid allocation preview direction');
    });
});

test.describe('allocation preview service boundaries', () => {
    const serviceSource = readFileSync(resolve('src/services/supabase/allocationPreview.ts'), 'utf8');
    const dbSource = readFileSync(resolve('src/services/db.ts'), 'utf8');
    const statementSource = readFileSync(resolve('src/services/statementService.ts'), 'utf8');
    const financeSource = readFileSync(resolve('src/pages/Finance.tsx'), 'utf8');
    const analyticsSource = readFileSync(resolve('src/pages/Analytics.tsx'), 'utf8');

    test('service reads open financial obligations only and exposes db facade method', () => {
        expect(serviceSource).toContain("from('financial_obligations')");
        expect(serviceSource).toContain(".eq('entity_type', params.entityType)");
        expect(serviceSource).toContain(".eq('entity_id', params.entityId)");
        expect(serviceSource).toContain(".eq('direction', params.direction)");
        expect(serviceSource).toContain(".in('status', [OBLIGATION_STATUSES.unpaid, OBLIGATION_STATUSES.partiallyPaid])");
        expect(serviceSource).toContain(".gt('remaining_amount', 0)");
        expect(serviceSource).toContain("orders(case_id, patient_name)");
        expect(dbSource).toContain('async previewPaymentAllocation(params: AllocationPreviewParams)');
        expect(dbSource).toContain("import('./supabase/allocationPreview')");
    });

    test('service has no writes and does not touch allocation or credit tables', () => {
        expect(serviceSource).not.toContain('.insert(');
        expect(serviceSource).not.toContain('.update(');
        expect(serviceSource).not.toContain('.delete(');
        expect(serviceSource).not.toContain("from('payment_allocations')");
        expect(serviceSource).not.toContain("from('account_credits')");
        expect(serviceSource).not.toContain("from('allocation_events')");
        expect(serviceSource).not.toContain("from('financial_exception_reviews')");
        expect(serviceSource).not.toContain('allocated_amount =');
        expect(serviceSource).not.toContain('status =');
        expect(serviceSource).not.toContain('.update({');
    });

    test('does not wire official statements or analytics to allocation preview', () => {
        expect(statementSource).not.toContain('previewPaymentAllocation');
        expect(statementSource).not.toContain('payment_allocations');
        expect(statementSource).not.toContain('account_credits');
        expect(analyticsSource).not.toContain('previewPaymentAllocation');
        expect(analyticsSource).not.toContain('payment_allocations');
        expect(analyticsSource).not.toContain('account_credits');
    });

    test('finance allocation preview UI is read-only and calls preview service only', () => {
        const panelSource = readFileSync(resolve('src/components/finance/AllocationPreviewPanel.tsx'), 'utf8');

        expect(financeSource).toContain('معاينة توزيع الدفعات');
        expect(financeSource).toContain('<AllocationPreviewPanel doctors={doctors} suppliers={suppliers} />');
        expect(financeSource).toContain("['admin', 'accountant'].includes(user?.role || '')");
        expect(panelSource).toContain('db.previewPaymentAllocation');
        expect(panelSource).toContain('معاينة التوزيع');
        expect(panelSource).toContain('لا توجد التزامات مفتوحة لهذا الطرف');
        expect(panelSource).toContain('رصيد دائن متوقع للطبيب');
        expect(panelSource).toContain('تعذر تنفيذ معاينة التوزيع');
        expect(panelSource).not.toContain('db.createFinancialObligation');
        expect(panelSource).not.toContain('db.voidFinancialObligation');
        expect(panelSource).not.toContain('db.addTransaction');
        expect(panelSource).not.toContain('db.updateTransaction');
        expect(panelSource).not.toContain('.insert(');
        expect(panelSource).not.toContain('.update(');
        expect(panelSource).not.toContain('.delete(');
        expect(panelSource).not.toContain('payment_allocations');
        expect(panelSource).not.toContain('account_credits');
        expect(panelSource).not.toContain('allocation_events');
        expect(panelSource).not.toContain('financial_exception_reviews');
        expect(panelSource).not.toContain('تطبيق التوزيع');
        expect(panelSource).not.toContain('حفظ التوزيع');
        expect(panelSource).not.toContain('إنشاء رصيد');
        expect(panelSource).not.toContain('ربط معاملة');
        expect(panelSource).not.toContain('تأكيد الدفع');
    });
});
