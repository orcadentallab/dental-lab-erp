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
