import { describe, it, expect } from 'vitest';
import { financeService } from '../../src/services/financeService';
import type { Cashbox } from '../../src/services/financeService';

describe('Cashbox Fee Calculation logic', () => {
    const mockCashboxNoFee: Cashbox = {
        id: 'box-1',
        name: 'درج الكاش الرئيسي',
        type: 'cash',
        openingBalance: 0,
        openingDate: '2026-07-12',
        feeEnabled: false,
        feePercentage: 1.5,
        feeMinAmount: 1,
        feeMaxAmount: null,
        isSaving: false,
        isActive: true,
        createdAt: '2026-07-12T00:00:00Z',
    };

    const mockCashboxPercentageFee: Cashbox = {
        id: 'box-2',
        name: 'فودافون كاش',
        type: 'wallet',
        openingBalance: 0,
        openingDate: '2026-07-12',
        feeEnabled: true,
        feePercentage: 1.5,
        feeMinAmount: 1,
        feeMaxAmount: 200,
        isSaving: false,
        isActive: true,
        createdAt: '2026-07-12T00:00:00Z',
    };

    const mockCashboxFixedFee: Cashbox = {
        id: 'box-3',
        name: 'إنستاباي',
        type: 'wallet',
        openingBalance: 0,
        openingDate: '2026-07-12',
        feeEnabled: true,
        feePercentage: 0,
        feeMinAmount: 10,
        feeMaxAmount: 10,
        isSaving: false,
        isActive: true,
        createdAt: '2026-07-12T00:00:00Z',
    };

    it('should calculate 0 fee if fee is disabled', () => {
        const fee = financeService.calculateCashboxFee(mockCashboxNoFee, 1000);
        expect(fee).toBe(0);
    });

    it('should calculate correct percentage fee', () => {
        const fee = financeService.calculateCashboxFee(mockCashboxPercentageFee, 1000);
        expect(fee).toBe(15);
    });

    it('should calculate correct fixed fee', () => {
        const fee = financeService.calculateCashboxFee(mockCashboxFixedFee, 1000);
        expect(fee).toBe(10);
    });

    it('should return 0 fee if amount is 0 or less', () => {
        const fee1 = financeService.calculateCashboxFee(mockCashboxPercentageFee, 0);
        const fee2 = financeService.calculateCashboxFee(mockCashboxPercentageFee, -100);
        expect(fee1).toBe(0);
        expect(fee2).toBe(0);
    });
});

describe('Cashbox Statement Running Balance and Reconciliation Logic', () => {
    it('calculates running balance chronologically from opening balance', () => {
        const openingBalance = 10000;
        const movements = [
            { type: 'income', inAmount: 2500, outAmount: 0 },
            { type: 'expense', inAmount: 0, outAmount: 1200 },
            { type: 'transfer_in', inAmount: 3000, outAmount: 0 },
            { type: 'transfer_out', inAmount: 0, outAmount: 800 },
        ];

        let running = openingBalance;
        const balances = movements.map(m => {
            if (m.type === 'income' || m.type === 'transfer_in') running += m.inAmount;
            if (m.type === 'expense' || m.type === 'transfer_out') running -= m.outAmount;
            return running;
        });

        expect(balances).toEqual([
            12500, // 10000 + 2500
            11300, // 12500 - 1200
            14300, // 11300 + 3000
            13500  // 14300 - 800
        ]);
        expect(running).toBe(13500);
    });

    it('identifies cross-cashbox discrepancy offsets when net difference is 0', () => {
        const cashboxA = { name: 'الخزينة', expected: 75000, actual: 74500 }; // -500 deficit
        const cashboxB = { name: 'انستا باي', expected: 105000, actual: 105500 }; // +500 surplus

        const diffA = cashboxA.actual - cashboxA.expected; // -500
        const diffB = cashboxB.actual - cashboxB.expected; // +500
        const totalNetDiff = diffA + diffB; // 0

        expect(totalNetDiff).toBe(0);
        expect(diffA).toBe(-500);
        expect(diffB).toBe(500);
        expect(Math.abs(diffB - Math.abs(diffA))).toBeLessThan(0.01);
    });

    it('accurately distinguishes between fully reconciled cashboxes and partially overdue cashboxes', () => {
        const now = new Date('2026-09-03T12:00:00Z');
        const cashboxes = [
            { id: '1', name: 'الخزينة', isActive: true, lastRecDate: '2026-08-05' }, // 29 days ago -> overdue
            { id: '2', name: 'انستا باي', isActive: true, lastRecDate: '2026-09-03' }, // 0 days ago -> today
            { id: '3', name: 'عهدة سليم', isActive: true, lastRecDate: null }, // never reconciled
            { id: '4', name: 'فودافون كاش', isActive: true, lastRecDate: '2026-08-30' }, // 4 days ago -> recent
            { id: '5', name: 'صندوق معطل', isActive: false, lastRecDate: null }, // inactive should be ignored
        ];

        const activeBoxes = cashboxes.filter(c => c.isActive);
        const statuses = activeBoxes.map(b => {
            if (!b.lastRecDate) return { ...b, status: 'never', days: null };
            const diffDays = Math.floor((now.getTime() - new Date(b.lastRecDate).getTime()) / (1000 * 60 * 60 * 24));
            let status: 'today' | 'recent' | 'overdue' = 'overdue';
            if (diffDays === 0) status = 'today';
            else if (diffDays <= 7) status = 'recent';
            return { ...b, status, days: diffDays };
        });

        const overdueOrNever = statuses.filter(s => s.status === 'overdue' || s.status === 'never');
        const allActiveReconciled = overdueOrNever.length === 0;

        expect(allActiveReconciled).toBe(false);
        expect(overdueOrNever.length).toBe(2); // Box 1 (overdue) and Box 3 (never)
        expect(statuses.find(s => s.id === '2')?.status).toBe('today');
        expect(statuses.find(s => s.id === '4')?.status).toBe('recent');
    });
});

