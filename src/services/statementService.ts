import type { Order, Transaction } from './db';

export interface StatementItem {
    id: string;
    date: string;
    description: string;
    type: 'debit' | 'credit' | 'opening';
    amount: number;
    details?: string;
    status?: string;
    runningBalance?: number;
}

export interface StatementResult {
    items: StatementItem[];
    totals: {
        totalDebit: number;
        totalCredit: number;
        balance: number;
        openingBalance: number;
    };
    doctorName?: string;
    doctorCode?: string;
}

export const statementService = {
    /**
     * Calculates the statement for a specific doctor over a date range.
     * @param doctorId Valid Doctor ID
     * @param allOrders Array of ALL orders (will be filtered)
     * @param allTransactions Array of ALL transactions (will be filtered)
     * @param startDate YYYY-MM-DD
     * @param endDate YYYY-MM-DD
     */
    calculateDoctorStatement: (
        doctorId: string,
        allOrders: Order[],
        allTransactions: Transaction[],
        startDate: string,
        endDate: string
    ): StatementResult => {
        // 1. Calculate Opening Balance (Everything BEFORE startDate)
        let openingDebit = 0;
        let openingCredit = 0;

        // Filter Orders for Opening Balance
        const pastOrders = allOrders.filter(o => {
            if (o.doctorId !== doctorId) return false;
            // Use deliveryDate or createdAt
            const sortDate = o.deliveryDate || o.createdAt.split('T')[0];

            // Check if before start date
            if (startDate && sortDate >= startDate) return false;

            // Only include valid statuses
            if (o.status === 'Rejected') return false;
            // Standard inclusion criteria from Accounts.tsx
            const status = (o.status || '').toLowerCase();
            return ['delivered', 'completed', 'ready', 'cancelled'].includes(status);
        });

        openingDebit = pastOrders.reduce((sum, o) => {
            // Cancelled orders have 0 amount in statement usually, but let's follow Accounts.tsx logic:
            // "amount = (o.status === 'Cancelled' ? 0 : (o.totalPrice || 0))"
            const amount = o.status === 'Cancelled' ? 0 : (o.totalPrice || 0);
            return sum + amount;
        }, 0);

        // Filter Transactions for Opening Balance
        const pastTransactions = allTransactions.filter(t =>
            (t.entityType === 'doctor' || !t.entityType) &&
            t.entityId === doctorId &&
            t.type === 'income' &&
            (!startDate || t.date.split('T')[0] < startDate)
        );
        openingCredit = pastTransactions.reduce((sum, t) => sum + t.amount, 0);

        const openingBalance = openingDebit - openingCredit;

        // 2. Calculate Period Items (Between startDate and endDate)
        let items: StatementItem[] = [];

        // Current Period Orders
        const periodOrders = allOrders.filter(o => {
            if (o.doctorId !== doctorId) return false;
            const sortDate = o.deliveryDate || o.createdAt.split('T')[0];

            if (startDate && sortDate < startDate) return false;
            if (endDate && sortDate > endDate) return false;

            // In detailed view, we often show Rejected for reference, but usually with 0 amount.
            // Accounts.tsx: "if (showAllOrders) return true; ... if (o.status === 'Rejected') return false;"
            // For Bulk Statement, we probably want "Standard" view which excludes Rejected unless we want to allow configuration.
            // Let's assume Standard View: valid statuses only.
            // Actually, Accounts.tsx logic for `individualStatement` includes Cancelled/Rejected if showAll is true.
            // For a formal statement, we usually only want billable items.
            // Let's stick to the filtered list logic for safety:
            if (o.status === 'Rejected') return false;

            const status = (o.status || '').toLowerCase();
            return ['delivered', 'completed', 'ready', 'cancelled'].includes(status);
        });

        items = items.concat(periodOrders.map(o => ({
            id: o.id,
            date: o.deliveryDate || o.createdAt.split('T')[0],
            description: `حالة #${o.caseId} - المريض: ${o.patientName}`,
            details: o.items.map((i: { serviceType: string; teethNumbers: string[] }) => `${i.serviceType} (${i.teethNumbers.join(',')})`).join(' + '),
            type: 'debit',
            amount: (o.status === 'Cancelled' ? 0 : (o.totalPrice || 0)),
            status: o.status
        })));

        // Current Period Transactions
        const periodTransactions = allTransactions.filter(t =>
            (t.entityType === 'doctor' || !t.entityType) &&
            t.entityId === doctorId &&
            t.type === 'income' &&
            (!startDate || t.date.split('T')[0] >= startDate) &&
            (!endDate || t.date.split('T')[0] <= endDate)
        );

        items = items.concat(periodTransactions.map(t => ({
            id: t.id,
            date: t.date.split('T')[0],
            description: `دفعة نقدية - ${t.description || ''}`,
            type: 'credit',
            amount: t.amount
        })));

        // Sort by Date
        items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // Calculate Running Balance
        let runningBalance = openingBalance;
        items = items.map(item => {
            runningBalance += item.type === 'debit' ? item.amount : -item.amount;
            return { ...item, runningBalance };
        });

        const totalDebit = items.filter(i => i.type === 'debit').reduce((sum, i) => sum + i.amount, 0);
        const totalCredit = items.filter(i => i.type === 'credit').reduce((sum, i) => sum + i.amount, 0);
        const finalBalance = openingBalance + totalDebit - totalCredit;

        return {
            items,
            totals: {
                totalDebit,
                totalCredit,
                balance: finalBalance,
                openingBalance
            }
        };
    }
};
