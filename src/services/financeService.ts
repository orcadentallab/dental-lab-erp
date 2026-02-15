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

export const financeService = {
    // --- Capital Entries ---
    async getCapitalEntries() {
        const { data, error } = await supabase
            .from('capital_entries')
            .select('*')
            .order('date', { ascending: false });

        if (error) throw error;
        return data as CapitalEntry[];
    },

    async addCapitalEntry(entry: Omit<CapitalEntry, 'id' | 'created_at'>) {
        const { data, error } = await supabase
            .from('capital_entries')
            .insert(entry)
            .select()
            .single();

        if (error) throw error;
        return data as CapitalEntry;
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
        return data as FixedAsset[];
    },

    async addFixedAsset(asset: Omit<FixedAsset, 'id' | 'created_at'>) {
        const { data, error } = await supabase
            .from('fixed_assets')
            .insert(asset)
            .select()
            .single();

        if (error) throw error;
        return data as FixedAsset;
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
        return data as Adjustment[];
    },

    async addAdjustment(adjustment: Omit<Adjustment, 'id' | 'created_at'>) {
        const { data, error } = await supabase
            .from('adjustments')
            .insert(adjustment)
            .select()
            .single();

        if (error) throw error;
        return data as Adjustment;
    },

    async updateAdjustment(id: string, updates: Partial<Omit<Adjustment, 'id' | 'created_at'>>) {
        const { data, error } = await supabase
            .from('adjustments')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return data as Adjustment;
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
            .select('amount')
            .eq('type', 'expense');
        const totalExpenses = expenses?.reduce((sum, item) => sum + item.amount, 0) || 0;

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
    }
};
