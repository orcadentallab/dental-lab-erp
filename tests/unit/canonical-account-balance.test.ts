import { describe, expect, it } from 'vitest';
import { calculateCanonicalAccountBalance } from '../../src/services/supabase/financialReconciliationPreview';

describe('canonical debit and credit account balance', () => {
    it('treats doctor receivables as debit-nature accounts', () => {
        expect(calculateCanonicalAccountBalance({
            accountNature: 'debit',
            obligationDebitTotal: 10_000,
            obligationCreditTotal: 0,
            adjustmentDebitTotal: 1_000,
            adjustmentCreditTotal: 2_000,
            cashDebitTotal: 0,
            cashCreditTotal: 3_000,
        })).toBe(6_000);
    });

    it('treats supplier and designer payables as credit-nature accounts', () => {
        expect(calculateCanonicalAccountBalance({
            accountNature: 'credit',
            obligationDebitTotal: 0,
            obligationCreditTotal: 10_000,
            adjustmentDebitTotal: 1_500,
            adjustmentCreditTotal: 500,
            cashDebitTotal: 4_000,
            cashCreditTotal: 0,
        })).toBe(5_000);
    });

    it('keeps debit and credit entries separate even when their net effect is zero', () => {
        expect(calculateCanonicalAccountBalance({
            accountNature: 'debit',
            obligationDebitTotal: 0,
            obligationCreditTotal: 0,
            adjustmentDebitTotal: 2_000,
            adjustmentCreditTotal: 2_000,
            cashDebitTotal: 0,
            cashCreditTotal: 0,
        })).toBe(0);
    });
});
