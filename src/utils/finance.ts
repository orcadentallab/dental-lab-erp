import type { Order, Transaction } from '../services/db';

export interface StatementTotals {
    totalDebit: number;
    totalCredit: number;
    balance: number;
    openingBalance: number;
}

export interface LabInfo {
    name: string;
    address: string;
    phone: string;
    logoUrl?: string;
}

const VALID_STATUSES = ['delivered', 'completed', 'ready', 'cancelled'];

export function calculateOpeningBalance(
    orders: Order[],
    transactions: Transaction[],
    doctorId: string,
    beforeDate: string
): number {
    if (!beforeDate) return 0;

    const openingDebit = orders
        .filter(o => {
            if (o.doctorId !== doctorId) return false;
            const sortDate = o.deliveryDate || o.createdAt.split('T')[0];
            if (sortDate >= beforeDate) return false;
            if (o.status === 'Rejected') return false;
            return VALID_STATUSES.includes((o.status || '').toLowerCase());
        })
        .reduce((sum, o) => sum + (o.status === 'Cancelled' ? 0 : (o.totalPrice || 0)), 0);

    const openingCredit = transactions
        .filter(t =>
            (t.entityType === 'doctor' || !t.entityType) &&
            t.entityId === doctorId &&
            t.type === 'income' &&
            t.date.split('T')[0] < beforeDate
        )
        .reduce((sum, t) => sum + t.amount, 0);

    return openingDebit - openingCredit;
}

export function calculateStatementTotals(
    items: { type: 'debit' | 'credit' | 'opening'; amount: number }[],
    openingBalance: number = 0
): StatementTotals {
    const totalDebit = items
        .filter(i => i.type === 'debit')
        .reduce((sum, i) => sum + i.amount, 0);
    const totalCredit = items
        .filter(i => i.type === 'credit')
        .reduce((sum, i) => sum + i.amount, 0);
    const balance = openingBalance + totalDebit - totalCredit;

    return { totalDebit, totalCredit, balance, openingBalance };
}

export function formatCurrency(amount: number): string {
    return amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export const DEFAULT_LAB_INFO: LabInfo = {
    name: 'ORCA Dental Lab',
    address: 'Cairo, Egypt',
    phone: '01034141917',
};
