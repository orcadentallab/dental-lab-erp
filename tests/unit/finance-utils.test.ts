import { describe, expect, it } from 'vitest';
import { calculatePayableAdjustmentTotals } from '../../src/utils/finance';

describe('payable account adjustments', () => {
    it('matches the supplier statement debit and credit directions', () => {
        expect(calculatePayableAdjustmentTotals([
            { type: 'charge', amount: 4_920 },
            { type: 'credit', amount: 2_780 },
        ])).toEqual({
            additionalWork: 2_780,
            additionalPaid: 4_920,
        });
    });
});
