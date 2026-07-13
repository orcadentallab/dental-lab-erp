/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { supabase } from './supabase';

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
    transfers: CashboxTransfer[];
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
            
        // Filter out employee daily expenses (which have entity_id and entity_type is 'general' or empty, and category is NOT 'مرتبات وأجور' or 'salaries')
        const filteredExpenses = expenses?.filter(t => {
            const isEmployeeTx = t.entity_id && (t.entity_type === 'general' || !t.entity_type);
            if (isEmployeeTx) {
                return t.category === 'مرتبات وأجور' || t.category === 'salaries';
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
        const { data, error } = await supabase
            .from('cashbox_transfers')
            .select('*')
            .order('date', { ascending: false })
            .order('created_at', { ascending: false });

        if (error) throw error;

        return (data ?? []).map(row => ({
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
        const { data, error } = await supabase
            .from('cashbox_reconciliations')
            .select('*')
            .order('date', { ascending: false })
            .order('created_at', { ascending: false });

        if (error) throw error;

        return (data ?? []).map(row => ({
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
        const [cashboxes, transfers, reconciliations, txResult] = await Promise.all([
            this.getCashboxes(true),
            this.getCashboxTransfers(),
            this.getCashboxReconciliations(),
            supabase
                .from('transactions')
                .select('id, type, amount, cashbox_id, is_system_generated_fee, date')
        ]);

        if (txResult.error) throw txResult.error;
        type TxRow = { id: string; type: string; amount: number; cashbox_id: string | null; is_system_generated_fee: boolean; date: string };
        const transactions = (txResult.data ?? []) as TxRow[];

        const latestReconciliationByCashbox = new Map<string, CashboxReconciliation>();
        reconciliations.forEach(rec => {
            if (!latestReconciliationByCashbox.has(rec.cashboxId)) {
                latestReconciliationByCashbox.set(rec.cashboxId, rec);
            }
        });

        let totalExpected = 0;
        let openingBalancesTotal = 0;
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

            return {
                cashbox,
                income,
                expenses,
                transferIn,
                transferOut,
                expectedBalance,
                lastReconciliation: latestReconciliationByCashbox.get(cashbox.id) || null
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
        const now = new Date();
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const monthTx = transactions.filter(t => t.date && t.date >= monthStart && !t.is_system_generated_fee);
        const monthIncome = monthTx.filter(t => t.type === 'income').reduce((sum, t) => sum + Number(t.amount || 0), 0);
        const monthExpenses = monthTx.filter(t => t.type === 'expense').reduce((sum, t) => sum + Number(t.amount || 0), 0);
        const currentMonthNetCashflow = monthIncome - monthExpenses;

        // Days since last reconciliation (across all cashboxes)
        let lastReconciliationDate: string | null = null;
        if (reconciliations.length > 0) {
            // reconciliations are already sorted desc by date
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
            transfers
        };
    }
};
