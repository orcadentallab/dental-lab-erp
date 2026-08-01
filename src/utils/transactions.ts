import type { Transaction } from '../services/db';
import { EXPENSE_CATEGORY } from '../constants/expenseCategories';

const EMPLOYEE_LEDGER_CATEGORIES = new Set([EXPENSE_CATEGORY.salaries, 'salaries']);

/** Employee-entered claims are review records, not ledger/cash movements. */
export function isEmployeeExpenseClaim(transaction: Partial<Transaction>): boolean {
    if (transaction.type !== 'expense' || !transaction.entityId) return false;
    if (EMPLOYEE_LEDGER_CATEGORIES.has(transaction.category || '')) return false;

    return transaction.entityType === 'representative'
        || transaction.entityType === 'general'
        || !transaction.entityType;
}

export function isLedgerTransaction(transaction: Partial<Transaction>): boolean {
    return !isEmployeeExpenseClaim(transaction);
}
