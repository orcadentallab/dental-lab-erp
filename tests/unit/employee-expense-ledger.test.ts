import { describe, expect, it } from 'vitest';
import { isEmployeeExpenseClaim, isLedgerTransaction } from '../../src/utils/transactions';
import {
    ALL_EXPENSE_CATEGORIES,
    EMPLOYEE_EXPENSE_CATEGORIES,
    EXPENSE_CATEGORY,
    normalizeExpenseCategory,
} from '../../src/constants/expenseCategories';

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

describe('canonical expense categories', () => {
    it('exposes exactly the ten approved categories to general expenses', () => {
        expect(ALL_EXPENSE_CATEGORIES).toEqual([
            'مرتبات وأجور',
            'شحن وتوصيل',
            'انتقالات ووقود',
            'دعاية وتسويق',
            'ضيافة واجتماعات',
            'خامات ومستهلكات',
            'عمولات ورسوم بنكية',
            'إيجارات ومرافق',
            'صيانة وإصلاحات',
            'مصروفات أخرى',
        ]);
        expect(ALL_EXPENSE_CATEGORIES).not.toContain('أدوات ومهمات');
    });

    it('limits employee registration to the approved five-category subset', () => {
        expect(EMPLOYEE_EXPENSE_CATEGORIES).toEqual([
            EXPENSE_CATEGORY.shipping,
            EXPENSE_CATEGORY.transport,
            EXPENSE_CATEGORY.hospitality,
            EXPENSE_CATEGORY.materials,
            EXPENSE_CATEGORY.other,
        ]);
    });

    it('maps historical and automatic names into the canonical taxonomy', () => {
        expect(normalizeExpenseCategory('transfer_fee')).toBe(EXPENSE_CATEGORY.bankFees);
        expect(normalizeExpenseCategory('أدوات ومهمات')).toBe(EXPENSE_CATEGORY.materials);
        expect(normalizeExpenseCategory('بوفيه وضيافة')).toBe(EXPENSE_CATEGORY.hospitality);
        expect(normalizeExpenseCategory('انتقالات')).toBe(EXPENSE_CATEGORY.transport);
        expect(normalizeExpenseCategory('قيمة قديمة غير معروفة')).toBe(EXPENSE_CATEGORY.other);
    });
});
