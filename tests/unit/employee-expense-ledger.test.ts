import { describe, expect, it } from 'vitest';
import { isEmployeeExpenseClaim, isLedgerTransaction } from '../../src/utils/transactions';

describe('employee expense ledger boundary', () => {
    it('keeps pending, approved, and settled employee claims out of the ledger', () => {
        for (const status of ['pending', 'approved', 'settled'] as const) {
            const claim = {
                type: 'expense' as const,
                amount: 100,
                category: 'شحن وتوصيل',
                entityId: 'employee-1',
                entityType: 'representative' as const,
                status,
            };
            expect(isEmployeeExpenseClaim(claim)).toBe(true);
            expect(isLedgerTransaction(claim)).toBe(false);
        }
    });

    it('also recognizes legacy general employee claims', () => {
        expect(isEmployeeExpenseClaim({
            type: 'expense',
            category: 'انتقالات',
            entityId: 'employee-1',
            entityType: 'general',
        })).toBe(true);
    });

    it('keeps paid salaries and settlement ledger rows in the ledger', () => {
        expect(isLedgerTransaction({
            type: 'expense',
            category: 'مرتبات وأجور',
            entityId: 'employee-1',
            entityType: 'general',
        })).toBe(true);
        expect(isLedgerTransaction({
            type: 'expense',
            category: 'شحن وتوصيل',
            entityType: 'general',
            status: 'approved',
        })).toBe(true);
    });
});
