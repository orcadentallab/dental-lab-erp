import { describe, it, expect } from 'vitest';
import { statementService } from '../../src/services/statementService';
import { buildExternalLabPayableCandidate, shouldCreateExternalLabPayableObligationForStatusChange } from '../../src/constants/financialObligations';
import type { Order, Transaction } from '../../src/services/db';

describe('Financial Obligations & Doctor Merge Parity (Day 5)', () => {
    const canonicalDoctorId = 'doc-canonical-100';
    const mergedChildDoctorId = 'doc-merged-child-200';

    const baseOrder: Partial<Order> = {
        id: 'ord-1',
        caseId: 'CASE-001',
        doctorId: canonicalDoctorId,
        patientName: 'أحمد محمود',
        totalPrice: 1000,
        cost: 400,
        workflowType: 'split',
        productionStatus: 'final_delivered',
        actualDeliveryDate: '2026-11-05',
        deliveryDate: '2026-11-05',
        createdAt: '2026-11-01',
        issueState: 'none',
        items: [{ serviceType: 'Zirconia Crown', teethNumbers: ['11'] }] as any
    };

    const mergedDoctorOrder: Partial<Order> = {
        id: 'ord-2',
        caseId: 'CASE-002',
        doctorId: mergedChildDoctorId, // Belongs to merged doctor
        patientName: 'سارة علي',
        totalPrice: 1500,
        cost: 600,
        workflowType: 'split',
        productionStatus: 'final_delivered',
        actualDeliveryDate: '2026-11-06',
        deliveryDate: '2026-11-06',
        createdAt: '2026-11-02',
        issueState: 'none',
        items: [{ serviceType: 'Emax Crown', teethNumbers: ['21'] }] as any
    };

    const transactions: Partial<Transaction>[] = [
        {
            id: 'tx-1',
            type: 'income',
            amount: 1000,
            date: '2026-11-07',
            entityType: 'doctor',
            entityId: canonicalDoctorId,
            description: 'تحصيل كاش'
        },
        {
            id: 'tx-2',
            type: 'income',
            amount: 500,
            date: '2026-11-08',
            entityType: 'doctor',
            entityId: mergedChildDoctorId, // Payment recorded on merged child doctor
            description: 'تحصيل فودافون كاش'
        }
    ];

    it('aggregates merged doctor accounts into canonical statement without data loss', () => {
        const result = statementService.calculateDoctorStatement(
            canonicalDoctorId,
            [baseOrder, mergedDoctorOrder] as Order[],
            transactions as Transaction[],
            '2026-11-01',
            '2026-11-10',
            [],
            false,
            [mergedChildDoctorId] // related merged IDs passed
        );

        expect(result.items).toHaveLength(4); // 2 orders + 2 transactions
        expect(result.totals.totalDebit).toBe(2500); // 1000 + 1500
        expect(result.totals.totalCredit).toBe(1500); // 1000 + 500
        expect(result.totals.balance).toBe(1000); // 2500 - 1500
    });

    it('handles overpayments / advances cleanly leaving negative balance as credit', () => {
        const overpaymentTx: Partial<Transaction> = {
            id: 'tx-adv',
            type: 'income',
            amount: 3000, // Pays 3,000 against 2,500 total charges
            date: '2026-11-09',
            entityType: 'doctor',
            entityId: canonicalDoctorId,
            description: 'دفعة مقدمة كبيرة'
        };

        const result = statementService.calculateDoctorStatement(
            canonicalDoctorId,
            [baseOrder, mergedDoctorOrder] as Order[],
            [overpaymentTx] as Transaction[],
            '2026-11-01',
            '2026-11-10',
            [],
            false,
            [mergedChildDoctorId]
        );

        expect(result.totals.totalDebit).toBe(2500);
        expect(result.totals.totalCredit).toBe(3000);
        expect(result.totals.balance).toBe(-500); // 500 EGP credit to doctor
    });

    it('preserves cutoff dates: items past end date do not affect period totals or balance', () => {
        const futureOrder: Partial<Order> = {
            id: 'ord-future',
            caseId: 'CASE-FUT',
            doctorId: canonicalDoctorId,
            totalPrice: 4000,
            productionStatus: 'final_delivered',
            actualDeliveryDate: '2026-11-20',
            deliveryDate: '2026-11-20',
            createdAt: '2026-11-20',
            issueState: 'none'
        };

        const result = statementService.calculateDoctorStatement(
            canonicalDoctorId,
            [baseOrder, futureOrder] as Order[],
            transactions as Transaction[],
            '2026-11-01',
            '2026-11-10',
            [],
            false,
            [mergedChildDoctorId]
        );

        // futureOrder delivered on 2026-11-20 is past cutoff 2026-11-10
        expect(result.items.some(i => i.id === 'ord-future')).toBe(false);
        expect(result.totals.totalDebit).toBe(1000);
    });

    it('supplier liability arises strictly at final_delivered, not at Ready, Try-In, or QC', () => {
        const testOrder = {
            id: 'order-timing',
            supplierId: 'supplier-lab-1',
            cost: 500,
            designPrice: 100,
            workflowType: 'split',
            designerId: 'designer-1',
            issueState: 'none'
        };

        // Ready state does NOT accrue supplier payable
        const readyCandidate = buildExternalLabPayableCandidate({
            ...testOrder,
            productionStatus: 'final_ready'
        });
        expect(readyCandidate).toBeNull();

        // Try-In ready state does NOT accrue supplier payable
        const tryInCandidate = buildExternalLabPayableCandidate({
            ...testOrder,
            productionStatus: 'try_in_ready'
        });
        expect(tryInCandidate).toBeNull();

        // Waiting doctor does NOT accrue supplier payable
        const waitingCandidate = buildExternalLabPayableCandidate({
            ...testOrder,
            productionStatus: 'waiting_doctor'
        });
        expect(waitingCandidate).toBeNull();

        // Only final_delivered accrues supplier payable
        const deliveredCandidate = buildExternalLabPayableCandidate({
            ...testOrder,
            productionStatus: 'final_delivered',
            actualDeliveryDate: '2026-11-15'
        });
        expect(deliveredCandidate).not.toBeNull();
        expect(deliveredCandidate?.grossAmount).toBe(400); // 500 cost - 100 design = 400 lab split
        expect(deliveredCandidate?.triggerDate).toBe('2026-11-15');
    });
});
