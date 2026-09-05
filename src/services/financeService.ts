 
import { supabase } from './supabase';
import { EXPENSE_CATEGORY } from '../constants/expenseCategories';

export type CapitalEntry = {
    id: string;
    source: string;
    amount: number;
    date: string;
    notes?: string;
    created_at: string;
};

export type FixedAsset = {
    id: string;
    name: string;
    value: number;
    purchase_date: string;
    notes?: string;
    created_at: string;
};

export type Adjustment = {
    id: string;
    entity_type: 'doctor' | 'supplier' | 'designer';
    entity_id: string;
    amount: number;
    type: 'charge' | 'credit';
    date: string;
    reason?: string;
    created_at: string;
};

export type CashboxType = 'cash' | 'bank' | 'wallet' | 'other';

export interface Cashbox {
    id: string;
    name: string;
    type: CashboxType;
    openingBalance: number;
    openingDate: string;
    isActive: boolean;
    feeEnabled: boolean;
    feePercentage: number;
    feeMinAmount: number;
    feeMaxAmount?: number | null;
    isSaving: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface CashboxTransfer {
    id: string;
    fromCashboxId: string;
    toCashboxId: string;
    amount: number;
    date: string;
    description?: string | null;
    createdBy?: string | null;
    createdAt?: string;
}

export interface CashboxReconciliation {
    id: string;
    cashboxId: string;
    expectedBalance: number;
    actualBalance: number;
    difference: number;
    date: string;
    notes?: string | null;
    createdBy?: string | null;
    createdAt?: string;
}

export interface CashboxSummaryRow {
    cashbox: Cashbox;
    income: number;
    expenses: number;
    transferIn: number;
    transferOut: number;
    expectedBalance: number;
    lastReconciliation?: CashboxReconciliation | null;
    daysSinceLastReconciliation: number | null;
    reconciliationStatus: 'today' | 'recent' | 'overdue' | 'never';
}

export interface CashboxSummary {
    rows: CashboxSummaryRow[];
    totalExpected: number;
    openingBalancesTotal: number;
    unassignedTransactionsCount: number;
    unassignedTransactionsTotal: number;
    transferFeesTotal: number;
    currentMonthNetCashflow: number;
    daysSinceLastReconciliation: number | null;
    lastReconciliationDate: string | null;
    unreconciledCount: number;
    oldestReconciliationDays: number | null;
    oldestReconciliationDate: string | null;
    allActiveReconciled: boolean;
    hasNeverReconciledActive: boolean;
    transfers: CashboxTransfer[];
}

export interface CashboxStatementItem {
    id: string;
    date: string;
    createdAt?: string;
    type: 'opening' | 'income' | 'expense' | 'transfer_in' | 'transfer_out' | 'reconciliation';
    title: string;
    description?: string;
    entityName?: string;
    entityType?: string;
    category?: string;
    inAmount: number;
    outAmount: number;
    runningBalance: number;
    reconciliationExpected?: number;
    reconciliationActual?: number;
    reconciliationDifference?: number;
    notes?: string;
    isSystemGeneratedFee?: boolean;
}

export interface CashboxStatement {
    cashbox: Cashbox;
    openingBalance: number;
    openingDate: string;
    totalInflow: number;
    totalOutflow: number;
    netTransfers: number;
    currentExpectedBalance: number;
    lastReconciliation: CashboxReconciliation | null;
    items: CashboxStatementItem[];
}

export const financeService = {
    // --- Capital Entries ---
    async getCapitalEntries() {
        const { data, error } = await supabase
            .from('capital_entries')
            .select('*')
            .order('date', { ascending: false });

        if (error) throw error;
        return (data ?? []) as unknown as CapitalEntry[];
    },

    async addCapitalEntry(entry: Omit<CapitalEntry, 'id' | 'created_at'>) {
        const { data, error } = await supabase
            .from('capital_entries')
            .insert(entry)
            .select()
            .single();

        if (error) throw error;
        return data as unknown as CapitalEntry;
    },

    async deleteCapitalEntry(id: string) {
        const { error } = await supabase
            .from('capital_entries')
            .delete()
            .eq('id', id);

        if (error) throw error;
    },

    // --- Fixed Assets ---
    async getFixedAssets() {
        const { data, error } = await supabase
            .from('fixed_assets')
            .select('*')
            .order('purchase_date', { ascending: false });

        if (error) throw error;
        return (data ?? []) as unknown as FixedAsset[];
    },

    async addFixedAsset(asset: Omit<FixedAsset, 'id' | 'created_at'>) {
        const { data, error } = await supabase
            .from('fixed_assets')
            .insert(asset)
            .select()
            .single();

        if (error) throw error;
        return data as unknown as FixedAsset;
    },

    async deleteFixedAsset(id: string) {
        const { error } = await supabase
            .from('fixed_assets')
            .delete()
            .eq('id', id);

        if (error) throw error;
    },

    // --- Adjustments ---
    async getAdjustments(entityType?: string, entityId?: string) {
        let query = supabase
            .from('adjustments')
            .select('*')
            .order('date', { ascending: false });

        if (entityType) {
            query = query.eq('entity_type', entityType);
        }
        if (entityId) {
            query = query.eq('entity_id', entityId);
        }

        const { data, error } = await query;
        if (error) throw error;
        return (data ?? []) as unknown as Adjustment[];
    },

    async addAdjustment(adjustment: Omit<Adjustment, 'id' | 'created_at'>) {
        const { data, error } = await supabase
            .from('adjustments')
            .insert(adjustment)
            .select()
            .single();

        if (error) throw error;
        return data as unknown as Adjustment;
    },

    async updateAdjustment(id: string, updates: Partial<Omit<Adjustment, 'id' | 'created_at'>>) {
        const { data, error } = await supabase
            .from('adjustments')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return data as unknown as Adjustment;
    },

    async deleteAdjustment(id: string) {
        const { error } = await supabase
            .from('adjustments')
            .delete()
            .eq('id', id);

        if (error) throw error;
    },

    // --- Financial Summary ---
    async getProjectSummary() {
        // Fetch all capital
        const { data: capital } = await supabase.from('capital_entries').select('amount');
        const totalCapital = capital?.reduce((sum, item) => sum + (item.amount || 0), 0) || 0;

        // Fetch all assets
        const { data: assets } = await supabase.from('fixed_assets').select('value');
        const totalAssets = assets?.reduce((sum, item) => sum + (item.value || 0), 0) || 0;

        // Fetch all cash transactions (Income - Expense) excluding 'general' maybe? 
        // No, current logic is: Transaction Type Income = Cash In, Expense = Cash Out.
        // We need to verify if Transactions are ALL Cash. 
        // In this system, it seems Transactions are indeed Cash movements.

        const { data: income } = await supabase
            .from('transactions')
            .select('amount')
            .eq('type', 'income');
        const totalIncome = income?.reduce((sum, item) => sum + item.amount, 0) || 0;

        const { data: expenses } = await supabase
            .from('transactions')
            .select('amount, entity_id, entity_type, category')
            .eq('type', 'expense');
            
        // Employee claims are review records, not ledger/cash movements.
        const filteredExpenses = expenses?.filter(t => {
            const isEmployeeTx = t.entity_id && ['representative', 'general', null].includes(t.entity_type);
            if (isEmployeeTx) {
                return t.category === EXPENSE_CATEGORY.salaries || t.category === 'salaries';
            }
            return true;
        }) || [];
        const totalExpenses = filteredExpenses.reduce((sum, item) => sum + (item.amount || 0), 0) || 0;

        // Start Cash = Capital - Assets
        const startCash = totalCapital - totalAssets;

        // Current Cash = Start Cash + (Income - Expenses)
        const currentCash = startCash + (totalIncome - totalExpenses);

        return {
            totalCapital,
            totalAssets,
            startCash,
            totalIncome,
            totalExpenses,
            currentCash
        };
    },

    // --- Cashbox / Treasury ---
    async getCashboxes(activeOnly = false) {
        let query = supabase
            .from('cashboxes')
            .select('*')
            .order('name', { ascending: true });

        if (activeOnly) {
            query = query.eq('is_active', true);
        }

        const { data, error } = await query;
        if (error) throw error;

        return (data ?? []).map(row => ({
            id: row.id,
            name: row.name,
            type: row.type as CashboxType,
            openingBalance: Number(row.opening_balance),
            openingDate: row.opening_date,
            isActive: row.is_active,
            feeEnabled: row.fee_enabled,
            feePercentage: Number(row.fee_percentage),
            feeMinAmount: Number(row.fee_min_amount),
            feeMaxAmount: row.fee_max_amount !== null ? Number(row.fee_max_amount) : null,
            isSaving: row.is_saving,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        })) as Cashbox[];
    },

    async addCashbox(cashbox: Omit<Cashbox, 'id' | 'createdAt' | 'updatedAt'>) {
        const { data, error } = await supabase
            .from('cashboxes')
            .insert({
                name: cashbox.name,
                type: cashbox.type,
                opening_balance: cashbox.openingBalance,
                opening_date: cashbox.openingDate,
                is_active: cashbox.isActive,
                fee_enabled: cashbox.feeEnabled,
                fee_percentage: cashbox.feePercentage,
                fee_min_amount: cashbox.feeMinAmount,
                fee_max_amount: cashbox.feeMaxAmount,
                is_saving: cashbox.isSaving
            })
            .select()
            .single();

        if (error) throw error;
        return {
            id: data.id,
            name: data.name,
            type: data.type as CashboxType,
            openingBalance: Number(data.opening_balance),
            openingDate: data.opening_date,
            isActive: data.is_active,
            feeEnabled: data.fee_enabled,
            feePercentage: Number(data.fee_percentage),
            feeMinAmount: Number(data.fee_min_amount),
            feeMaxAmount: data.fee_max_amount !== null ? Number(data.fee_max_amount) : null,
            isSaving: data.is_saving,
            createdAt: data.created_at,
            updatedAt: data.updated_at
        } as Cashbox;
    },

    async updateCashbox(id: string, updates: Partial<Omit<Cashbox, 'id' | 'createdAt' | 'updatedAt'>>) {
        const dbUpdates: Record<string, string | number | boolean | null | undefined> = {};
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.type !== undefined) dbUpdates.type = updates.type;
        if (updates.openingBalance !== undefined) dbUpdates.opening_balance = updates.openingBalance;
        if (updates.openingDate !== undefined) dbUpdates.opening_date = updates.openingDate;
        if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
        if (updates.feeEnabled !== undefined) dbUpdates.fee_enabled = updates.feeEnabled;
        if (updates.feePercentage !== undefined) dbUpdates.fee_percentage = updates.feePercentage;
        if (updates.feeMinAmount !== undefined) dbUpdates.fee_min_amount = updates.feeMinAmount;
        if (updates.feeMaxAmount !== undefined) dbUpdates.fee_max_amount = updates.feeMaxAmount;
        if (updates.isSaving !== undefined) dbUpdates.is_saving = updates.isSaving;

        const { data, error } = await supabase
            .from('cashboxes')
            .update(dbUpdates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return {
            id: data.id,
            name: data.name,
            type: data.type as CashboxType,
            openingBalance: Number(data.opening_balance),
            openingDate: data.opening_date,
            isActive: data.is_active,
            feeEnabled: data.fee_enabled,
            feePercentage: Number(data.fee_percentage),
            feeMinAmount: Number(data.fee_min_amount),
            feeMaxAmount: data.fee_max_amount !== null ? Number(data.fee_max_amount) : null,
            isSaving: data.is_saving,
            createdAt: data.created_at,
            updatedAt: data.updated_at
        } as Cashbox;
    },

    async deactivateCashbox(id: string) {
        const { error } = await supabase
            .from('cashboxes')
            .update({ is_active: false })
            .eq('id', id);

        if (error) throw error;
    },

    async getCashboxTransfers() {
        let allData: Array<Record<string, unknown>> = [];
        let from = 0;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await supabase
                .from('cashbox_transfers')
                .select('*')
                .order('date', { ascending: false })
                .order('created_at', { ascending: false })
                .order('id')
                .range(from, from + pageSize - 1);

            if (error) throw error;
            const batch = data ?? [];
            allData = allData.concat(batch);
            if (batch.length < pageSize) {
                hasMore = false;
            } else {
                from += pageSize;
            }
        }

        return allData.map(row => ({
            id: row.id,
            fromCashboxId: row.from_cashbox_id,
            toCashboxId: row.to_cashbox_id,
            amount: Number(row.amount),
            date: row.date,
            description: row.description,
            createdBy: row.created_by,
            createdAt: row.created_at
        })) as CashboxTransfer[];
    },

    async addCashboxTransfer(transfer: Omit<CashboxTransfer, 'id' | 'createdAt'>) {
        const { data, error } = await supabase
            .from('cashbox_transfers')
            .insert({
                from_cashbox_id: transfer.fromCashboxId,
                to_cashbox_id: transfer.toCashboxId,
                amount: transfer.amount,
                date: transfer.date,
                description: transfer.description,
                created_by: transfer.createdBy
            })
            .select()
            .single();

        if (error) throw error;
        return {
            id: data.id,
            fromCashboxId: data.from_cashbox_id,
            toCashboxId: data.to_cashbox_id,
            amount: Number(data.amount),
            date: data.date,
            description: data.description,
            createdBy: data.created_by,
            createdAt: data.created_at
        } as CashboxTransfer;
    },

    async getCashboxReconciliations() {
        let allData: Array<Record<string, unknown>> = [];
        let from = 0;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await supabase
                .from('cashbox_reconciliations')
                .select('*')
                .order('date', { ascending: false })
                .order('created_at', { ascending: false })
                .order('id')
                .range(from, from + pageSize - 1);

            if (error) throw error;
            const batch = data ?? [];
            allData = allData.concat(batch);
            if (batch.length < pageSize) {
                hasMore = false;
            } else {
                from += pageSize;
            }
        }

        return allData.map(row => ({
            id: row.id,
            cashboxId: row.cashbox_id,
            expectedBalance: Number(row.expected_balance),
            actualBalance: Number(row.actual_balance),
            difference: Number(row.difference),
            date: row.date,
            notes: row.notes,
            createdBy: row.created_by,
            createdAt: row.created_at
        })) as CashboxReconciliation[];
    },

    async addCashboxReconciliation(reconciliation: Omit<CashboxReconciliation, 'id' | 'createdAt'>) {
        const { data, error } = await supabase
            .from('cashbox_reconciliations')
            .insert({
                cashbox_id: reconciliation.cashboxId,
                expected_balance: reconciliation.expectedBalance,
                actual_balance: reconciliation.actualBalance,
                difference: reconciliation.difference,
                date: reconciliation.date,
                notes: reconciliation.notes,
                created_by: reconciliation.createdBy
            })
            .select()
            .single();

        if (error) throw error;
        return {
            id: data.id,
            cashboxId: data.cashbox_id,
            expectedBalance: Number(data.expected_balance),
            actualBalance: Number(data.actual_balance),
            difference: Number(data.difference),
            date: data.date,
            notes: data.notes,
            createdBy: data.created_by,
            createdAt: data.created_at
        } as CashboxReconciliation;
    },

    calculateCashboxFee(cashbox: Cashbox | undefined, amount: number): number {
        if (!cashbox || !cashbox.feeEnabled || amount <= 0) return 0;
        let fee = (amount * cashbox.feePercentage) / 100;
        if (fee < cashbox.feeMinAmount) {
            fee = cashbox.feeMinAmount;
        }
        if (cashbox.feeMaxAmount !== null && cashbox.feeMaxAmount !== undefined && fee > cashbox.feeMaxAmount) {
            fee = cashbox.feeMaxAmount;
        }
        return Math.round(fee * 100) / 100;
    },

    async getCashboxSummary(): Promise<CashboxSummary> {
        type TxRow = { id: string; type: string; amount: number; cashbox_id: string | null; is_system_generated_fee: boolean; date: string; entity_id: string | null; entity_type: string | null; category: string };
        const fetchAllTransactions = async (): Promise<TxRow[]> => {
            let all: TxRow[] = [];
            let from = 0;
            const pageSize = 1000;
            let hasMore = true;
            while (hasMore) {
                const { data, error } = await supabase
                    .from('transactions')
                    .select('id, type, amount, cashbox_id, is_system_generated_fee, date, entity_id, entity_type, category')
                    .order('id')
                    .range(from, from + pageSize - 1);

                if (error) throw error;
                const batch = (data ?? []) as TxRow[];
                all = all.concat(batch);
                if (batch.length < pageSize) {
                    hasMore = false;
                } else {
                    from += pageSize;
                }
            }
            return all;
        };

        const [cashboxes, transfers, reconciliations, rawTransactions] = await Promise.all([
            this.getCashboxes(true),
            this.getCashboxTransfers(),
            this.getCashboxReconciliations(),
            fetchAllTransactions()
        ]);

        const transactions = rawTransactions.filter(t => {
            const employeeClaim = t.type === 'expense'
                && !!t.entity_id
                && ['representative', 'general', null].includes(t.entity_type)
                && ![EXPENSE_CATEGORY.salaries, 'salaries'].includes(t.category);
            return !employeeClaim;
        });

        const latestReconciliationByCashbox = new Map<string, CashboxReconciliation>();
        reconciliations.forEach(rec => {
            if (!latestReconciliationByCashbox.has(rec.cashboxId)) {
                latestReconciliationByCashbox.set(rec.cashboxId, rec);
            }
        });

        let totalExpected = 0;
        let openingBalancesTotal = 0;
        const now = new Date();
        const rows = cashboxes.map(cashbox => {
            const relatedTx = transactions.filter(t => t.cashbox_id === cashbox.id);
            const income = relatedTx
                .filter(t => t.type === 'income')
                .reduce((sum, t) => sum + Number(t.amount || 0), 0);
            const expenses = relatedTx
                .filter(t => t.type === 'expense')
                .reduce((sum, t) => sum + Number(t.amount || 0), 0);

            const transferIn = transfers
                .filter(t => t.toCashboxId === cashbox.id)
                .reduce((sum, t) => sum + t.amount, 0);
            const transferOut = transfers
                .filter(t => t.fromCashboxId === cashbox.id)
                .reduce((sum, t) => sum + t.amount, 0);

            const expectedBalance = cashbox.openingBalance + income - expenses + transferIn - transferOut;
            totalExpected += expectedBalance;
            openingBalancesTotal += cashbox.openingBalance;

            const lastRec = latestReconciliationByCashbox.get(cashbox.id) || null;
            let daysSinceReconciliation: number | null = null;
            let reconciliationStatus: 'today' | 'recent' | 'overdue' | 'never' = 'never';
            if (lastRec?.date) {
                // 'YYYY-MM-DD' parses as UTC midnight, which shifts the day
                // count against a local `now`. Compare local calendar days.
                const [y, m, d] = lastRec.date.split('-').map(Number);
                const recDate = new Date(y, (m || 1) - 1, d || 1);
                const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const diffMs = startOfToday.getTime() - recDate.getTime();
                daysSinceReconciliation = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
                if (daysSinceReconciliation === 0) reconciliationStatus = 'today';
                else if (daysSinceReconciliation <= 7) reconciliationStatus = 'recent';
                else reconciliationStatus = 'overdue';
            }

            return {
                cashbox,
                income,
                expenses,
                transferIn,
                transferOut,
                expectedBalance,
                lastReconciliation: lastRec,
                daysSinceLastReconciliation: daysSinceReconciliation,
                reconciliationStatus
            };
        });

        const unassignedTx = transactions.filter(t => t.cashbox_id === null || t.cashbox_id === undefined);
        const unassignedTransactionsCount = unassignedTx.length;
        const unassignedTransactionsTotal = unassignedTx
            .reduce((sum, t) => sum + (t.type === 'income' ? Number(t.amount || 0) : -Number(t.amount || 0)), 0);

        const transferFeesTotal = transactions
            .filter(t => t.is_system_generated_fee === true)
            .reduce((sum, t) => sum + Number(t.amount || 0), 0);

        // Current month net cashflow
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const monthTx = transactions.filter(t => t.date && t.date >= monthStart && !t.is_system_generated_fee);
        const monthIncome = monthTx.filter(t => t.type === 'income').reduce((sum, t) => sum + Number(t.amount || 0), 0);
        const monthExpenses = monthTx.filter(t => t.type === 'expense').reduce((sum, t) => sum + Number(t.amount || 0), 0);
        const currentMonthNetCashflow = monthIncome - monthExpenses;

        // Reconciliation metrics across active cashboxes
        const activeRows = rows.filter(r => r.cashbox.isActive);
        const overdueOrNeverRows = activeRows.filter(r => r.reconciliationStatus === 'overdue' || r.reconciliationStatus === 'never');
        const unreconciledCount = overdueOrNeverRows.length;
        const allActiveReconciled = activeRows.length > 0 && unreconciledCount === 0;
        const hasNeverReconciledActive = activeRows.some(r => r.daysSinceLastReconciliation === null);

        let oldestReconciliationDays: number | null = null;
        let oldestReconciliationDate: string | null = null;
        const activeReconciledDays = activeRows
            .map(r => r.daysSinceLastReconciliation)
            .filter((d): d is number => d !== null);

        if (activeReconciledDays.length > 0) {
            oldestReconciliationDays = Math.max(...activeReconciledDays);
            const oldestRow = activeRows.find(r => r.daysSinceLastReconciliation === oldestReconciliationDays);
            oldestReconciliationDate = oldestRow?.lastReconciliation?.date || null;
        }

        // Backwards compatibility legacy field
        let lastReconciliationDate: string | null = null;
        if (reconciliations.length > 0) {
            lastReconciliationDate = reconciliations[0].date;
        }
        let daysSinceLastReconciliation: number | null = null;
        if (lastReconciliationDate) {
            const lastDate = new Date(lastReconciliationDate);
            const diffMs = now.getTime() - lastDate.getTime();
            daysSinceLastReconciliation = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        }

        return {
            rows,
            totalExpected,
            openingBalancesTotal,
            unassignedTransactionsCount,
            unassignedTransactionsTotal,
            transferFeesTotal,
            currentMonthNetCashflow,
            daysSinceLastReconciliation,
            lastReconciliationDate,
            unreconciledCount,
            oldestReconciliationDays,
            oldestReconciliationDate,
            allActiveReconciled,
            hasNeverReconciledActive,
            transfers
        };
    },

    async getCashboxStatement(cashboxId: string): Promise<CashboxStatement> {
        const { data: cbData, error: cbErr } = await supabase
            .from('cashboxes')
            .select('*')
            .eq('id', cashboxId)
            .single();

        if (cbErr) throw cbErr;
        const cashbox: Cashbox = {
            id: cbData.id,
            name: cbData.name,
            type: cbData.type as CashboxType,
            openingBalance: Number(cbData.opening_balance),
            openingDate: cbData.opening_date,
            isActive: cbData.is_active,
            feeEnabled: cbData.fee_enabled,
            feePercentage: Number(cbData.fee_percentage),
            feeMinAmount: Number(cbData.fee_min_amount),
            feeMaxAmount: cbData.fee_max_amount ? Number(cbData.fee_max_amount) : null,
            isSaving: cbData.is_saving || false,
            createdAt: cbData.created_at,
            updatedAt: cbData.updated_at
        };

        type TxRow = {
            id: string;
            type: string;
            amount: number;
            category: string;
            date: string;
            description: string | null;
            entity_id: string | null;
            entity_type: string | null;
            created_at: string;
            is_system_generated_fee?: boolean;
        };

        const fetchCashboxTransactions = async (): Promise<TxRow[]> => {
            let all: TxRow[] = [];
            let from = 0;
            const pageSize = 1000;
            let hasMore = true;
            while (hasMore) {
                const { data, error } = await supabase
                    .from('transactions')
                    .select('*')
                    .eq('cashbox_id', cashboxId)
                    .order('date', { ascending: true })
                    .order('created_at', { ascending: true })
                    .order('id')
                    .range(from, from + pageSize - 1);

                if (error) throw error;
                const batch = (data ?? []) as TxRow[];
                all = all.concat(batch);
                if (batch.length < pageSize) {
                    hasMore = false;
                } else {
                    from += pageSize;
                }
            }
            return all;
        };

        const [txList, transfersRes, recsRes, allCashboxesRes, docsRes, suppsRes, usersRes] = await Promise.all([
            fetchCashboxTransactions(),
            supabase
                .from('cashbox_transfers')
                .select('*')
                .or(`from_cashbox_id.eq.${cashboxId},to_cashbox_id.eq.${cashboxId}`)
                .order('date', { ascending: true })
                .order('created_at', { ascending: true }),
            supabase
                .from('cashbox_reconciliations')
                .select('*')
                .eq('cashbox_id', cashboxId)
                .order('date', { ascending: true })
                .order('created_at', { ascending: true }),
            supabase.from('cashboxes').select('id, name'),
            supabase.from('doctors').select('id, name'),
            supabase.from('suppliers').select('id, name'),
            supabase.from('users').select('id, name')
        ]);

        if (transfersRes.error) throw transfersRes.error;
        if (recsRes.error) throw recsRes.error;

        const cashboxNames = new Map<string, string>((allCashboxesRes.data ?? []).map(c => [c.id, c.name]));
        const doctorNames = new Map<string, string>((docsRes.data ?? []).map(d => [d.id, d.name]));
        const supplierNames = new Map<string, string>((suppsRes.data ?? []).map(s => [s.id, s.name]));
        const userNames = new Map<string, string>((usersRes.data ?? []).map(u => [u.id, u.name]));

        const validTransactions = txList.filter(t => {
            const employeeClaim = t.type === 'expense'
                && !!t.entity_id
                && ['representative', 'general', null].includes(t.entity_type)
                && ![EXPENSE_CATEGORY.salaries, 'salaries'].includes(t.category);
            return !employeeClaim;
        });

        type RawMovement = {
            id: string;
            date: string;
            createdAt?: string;
            type: 'opening' | 'income' | 'expense' | 'transfer_in' | 'transfer_out' | 'reconciliation';
            title: string;
            description?: string;
            entityName?: string;
            entityType?: string;
            category?: string;
            inAmount: number;
            outAmount: number;
            reconciliationExpected?: number;
            reconciliationActual?: number;
            reconciliationDifference?: number;
            notes?: string;
            isSystemGeneratedFee?: boolean;
        };

        const rawList: RawMovement[] = [];

        // 1. Opening balance
        rawList.push({
            id: `opening-${cashbox.id}`,
            date: cashbox.openingDate,
            createdAt: cashbox.createdAt || `${cashbox.openingDate}T00:00:00.000Z`,
            type: 'opening',
            title: 'رصيد البداية الافتتاحي',
            description: 'الرصيد عند إنشاء/افتتاح الصندوق',
            inAmount: cashbox.openingBalance,
            outAmount: 0
        });

        // 2. Transactions
        validTransactions.forEach(t => {
            let entityName = '';
            if (t.entity_id) {
                if (t.entity_type === 'doctor') entityName = doctorNames.get(t.entity_id) || '';
                else if (t.entity_type === 'supplier') entityName = supplierNames.get(t.entity_id) || '';
                else if (t.entity_type === 'user' || t.entity_type === 'designer') entityName = userNames.get(t.entity_id) || '';
            }
            const isIncome = t.type === 'income';
            rawList.push({
                id: t.id,
                date: t.date,
                createdAt: t.created_at,
                type: isIncome ? 'income' : 'expense',
                title: isIncome
                    ? (entityName ? `تحصيل من د. ${entityName}` : 'إيراد نقدي وارد')
                    : (entityName ? `صرف إلى ${entityName}` : 'مصروف صادر'),
                description: t.description || '',
                entityName: entityName || undefined,
                entityType: t.entity_type || undefined,
                category: t.category,
                inAmount: isIncome ? Number(t.amount || 0) : 0,
                outAmount: isIncome ? 0 : Number(t.amount || 0),
                isSystemGeneratedFee: t.is_system_generated_fee
            });
        });

        // 3. Transfers
        type TrRow = {
            id: string;
            from_cashbox_id: string;
            to_cashbox_id: string;
            amount: number;
            date: string;
            description: string | null;
            created_at: string;
        };
        ((transfersRes.data ?? []) as TrRow[]).forEach(tr => {
            const isIncoming = tr.to_cashbox_id === cashboxId;
            const otherName = isIncoming
                ? (cashboxNames.get(tr.from_cashbox_id) || 'صندوق آخر')
                : (cashboxNames.get(tr.to_cashbox_id) || 'صندوق آخر');
            rawList.push({
                id: tr.id,
                date: tr.date,
                createdAt: tr.created_at,
                type: isIncoming ? 'transfer_in' : 'transfer_out',
                title: isIncoming ? `تحويل وارد من: ${otherName}` : `تحويل صادر إلى: ${otherName}`,
                description: tr.description || 'تحويل داخلي بين الصناديق',
                inAmount: isIncoming ? Number(tr.amount || 0) : 0,
                outAmount: isIncoming ? 0 : Number(tr.amount || 0)
            });
        });

        // Sort chronologically: opening balance first, then date, then createdAt
        rawList.sort((a, b) => {
            if (a.type === 'opening') return -1;
            if (b.type === 'opening') return 1;
            const dateComp = a.date.localeCompare(b.date);
            if (dateComp !== 0) return dateComp;
            return (a.createdAt || '').localeCompare(b.createdAt || '');
        });

        // Calculate running balance
        let runningBalance = 0;
        let totalInflow = 0;
        let totalOutflow = 0;
        let netTransfers = 0;

        const items: CashboxStatementItem[] = rawList.map(item => {
            if (item.type === 'opening') {
                runningBalance = item.inAmount;
            } else if (item.type === 'income') {
                runningBalance += item.inAmount;
                totalInflow += item.inAmount;
            } else if (item.type === 'expense') {
                runningBalance -= item.outAmount;
                totalOutflow += item.outAmount;
            } else if (item.type === 'transfer_in') {
                runningBalance += item.inAmount;
                netTransfers += item.inAmount;
            } else if (item.type === 'transfer_out') {
                runningBalance -= item.outAmount;
                netTransfers -= item.outAmount;
            }
            return {
                ...item,
                runningBalance: Math.round(runningBalance * 100) / 100
            };
        });

        type RecRow = {
            id: string;
            cashbox_id: string;
            expected_balance: number;
            actual_balance: number;
            difference: number;
            date: string;
            notes: string | null;
            created_at: string;
        };
        const recList = (recsRes.data ?? []) as RecRow[];
        const latestRec = recList.length > 0
            ? {
                id: recList[recList.length - 1].id,
                cashboxId: recList[recList.length - 1].cashbox_id,
                expectedBalance: Number(recList[recList.length - 1].expected_balance),
                actualBalance: Number(recList[recList.length - 1].actual_balance),
                difference: Number(recList[recList.length - 1].difference),
                date: recList[recList.length - 1].date,
                notes: recList[recList.length - 1].notes,
                createdAt: recList[recList.length - 1].created_at
            } as CashboxReconciliation
            : null;

        return {
            cashbox,
            openingBalance: cashbox.openingBalance,
            openingDate: cashbox.openingDate,
            totalInflow,
            totalOutflow,
            netTransfers,
            currentExpectedBalance: Math.round(runningBalance * 100) / 100,
            lastReconciliation: latestRec,
            items
        };
    },

    async batchSaveCashboxReconciliations(
        reconciliations: Array<{
            cashboxId: string;
            expectedBalance: number;
            actualBalance: number;
            difference: number;
            notes?: string;
        }>,
        date: string,
        createdBy?: string | null
    ) {
        if (reconciliations.length === 0) return [];
        const rowsToInsert = reconciliations.map(rec => ({
            cashbox_id: rec.cashboxId,
            expected_balance: rec.expectedBalance,
            actual_balance: rec.actualBalance,
            difference: rec.difference,
            date,
            notes: rec.notes || null,
            created_by: createdBy || null
        }));

        const { data, error } = await supabase
            .from('cashbox_reconciliations')
            .insert(rowsToInsert)
            .select();

        if (error) throw error;
        return data;
    },

    async getCashboxReconciliationHistory(cashboxId?: string) {
        let query = supabase
            .from('cashbox_reconciliations')
            .select('*')
            .order('date', { ascending: false })
            .order('created_at', { ascending: false });

        if (cashboxId) {
            query = query.eq('cashbox_id', cashboxId);
        }

        const { data, error } = await query;
        if (error) throw error;
        return (data ?? []).map((row: Record<string, unknown>) => ({
            id: String(row.id),
            cashboxId: String(row.cashbox_id),
            expectedBalance: Number(row.expected_balance),
            actualBalance: Number(row.actual_balance),
            difference: Number(row.difference),
            date: String(row.date),
            notes: row.notes as string | undefined,
            createdBy: row.created_by as string | undefined,
            createdAt: row.created_at as string | undefined
        })) as CashboxReconciliation[];
    }
};
