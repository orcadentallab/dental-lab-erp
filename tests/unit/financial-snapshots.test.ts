import { describe, expect, it } from 'vitest';
import { classifyFinancialSnapshotIssues } from '../../src/services/supabase/financialSnapshots';
import type { FinancialReconciliationPreviewRow } from '../../src/services/supabase/financialReconciliationPreview';

const row = (
    overrides: Partial<FinancialReconciliationPreviewRow>
): FinancialReconciliationPreviewRow => ({
    entityType: 'doctor',
    entityId: 'entity-1',
    entityName: 'Test entity',
    officialBalance: 1_000,
    obligationTotal: 1_000,
    transactionPaymentTotal: 0,
    adjustmentDebitTotal: 0,
    adjustmentCreditTotal: 0,
    obligationBasedBalance: 1_000,
    difference: 0,
    flags: ['difference_zero'],
    notes: [],
    ...overrides,
});

describe('financial snapshot issue classification', () => {
    it('blocks approval when the official and obligation balances differ', () => {
        const issues = classifyFinancialSnapshotIssues([
            row({
                entityType: 'designer',
                officialBalance: 800,
                obligationBasedBalance: 500,
                difference: -300,
                flags: ['difference_nonzero'],
            }),
        ]);

        expect(issues.critical).toHaveLength(1);
        expect(issues.critical[0]).toMatchObject({
            entityType: 'designer',
            difference: -300,
        });
        expect(issues.warnings).toHaveLength(0);
    });

    it('keeps non-blocking review flags as warnings when balances reconcile', () => {
        const issues = classifyFinancialSnapshotIssues([
            row({
                difference: 0,
                flags: ['difference_zero', 'issue_settlement_present'],
            }),
        ]);

        expect(issues.critical).toHaveLength(0);
        expect(issues.warnings).toHaveLength(1);
    });

    it('does not create an issue for a fully reconciled clean row', () => {
        const issues = classifyFinancialSnapshotIssues([row({})]);

        expect(issues).toEqual({ critical: [], warnings: [] });
    });
});
