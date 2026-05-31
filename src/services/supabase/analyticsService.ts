/* eslint-disable @typescript-eslint/consistent-type-assertions */
/**
 * analyticsService.ts
 * 
 * ARCHITECTURE BOUNDARY:
 * This service calls server-side RPCs that return AGGREGATED summary data only.
 * It does NOT fetch individual order rows.
 * 
 * For detailed data (invoices, statements, exports), continue using:
 *   - db.fetchFullEntityStatement()   → Individual account statements
 *   - db.fetchAllOrdersForExport()    → Full data exports
 *   - db.getOrders(page, limit)       → Paginated order browsing
 * 
 * Those functions remain COMPLETELY UNAFFECTED by this service.
 */

import { supabase } from '../../lib/supabase';

// ─── RESPONSE TYPES ─────────────────────────────────────────────

export interface AnalyticsSummary {
    // Order metrics
    total_sales_value: number;
    total_cost_of_goods: number;
    completed_order_count: number;
    active_order_count: number;
    return_count: number;
    redo_count: number;
    redo_cost: number;
    urgent_count: number;
    total_order_count: number;

    // Transaction metrics
    total_income: number;
    total_expenses: number;
    production_costs: number;
    operating_expenses: number;
    doctor_collections: number;
    supplier_payments: number;
    designer_payments: number;

    // Accounts receivable
    total_receivables: number;
    aging_0_30: number;
    aging_31_60: number;
    aging_61_90: number;
    aging_90_plus: number;

    // Accounts payable
    total_payables: number;
}

export interface TopDoctor {
    name: string;
    revenue: number;
    count: number;
}

export interface TopService {
    name: string;
    count: number;
    revenue: number;
}

export interface TopExpenseCategory {
    category: string;
    total: number;
}

export interface DoctorReceivable {
    doctorId: string;
    doctorName: string;
    doctorPhone: string | null;
    totalBilled: number;
    totalPaid: number;
    balance: number;
    aging_0_30: number;
    aging_31_60: number;
    aging_61_90: number;
    aging_90_plus: number;
    orderCount: number;
    unpaidOrderCount: number;
    oldestUnpaidDate: string | null;
    maxDaysOverdue: number | null;
}

export interface FinanceDashboard {
    total_income: number;
    production_costs: number;
    operating_expenses: number;
    total_capital: number;
    total_assets: number;
    starting_balance: number;
    current_balance: number;
}

// ─── SERVICE ─────────────────────────────────────────────────────

export const analyticsService = {

    /**
     * Fetches all KPI summary metrics in a single RPC call.
     * Returns aggregated numbers, NOT individual rows.
     * 
     * @param startDate  Optional ISO date string (YYYY-MM-DD)
     * @param endDate    Optional ISO date string (YYYY-MM-DD)
     */
    async getSummary(startDate?: string, endDate?: string): Promise<AnalyticsSummary> {
        const { data, error } = await supabase.rpc('get_analytics_summary', {
            p_start_date: startDate || null,
            p_end_date: endDate || null,
        });

        if (error) {
            console.error('Error fetching analytics summary:', error);
            throw error;
        }

        // Supabase returns the JSONB directly as a parsed JS object
        return data as unknown as AnalyticsSummary;
    },

    /**
     * Fetches top doctors by revenue.
     */
    async getTopDoctors(startDate?: string, endDate?: string, limit: number = 5): Promise<TopDoctor[]> {
        const { data, error } = await supabase.rpc('get_top_doctors', {
            p_start_date: startDate || null,
            p_end_date: endDate || null,
            p_limit: limit,
        });

        if (error) {
            console.error('Error fetching top doctors:', error);
            throw error;
        }

        return (data || []) as unknown as TopDoctor[];
    },

    /**
     * Fetches top services by unit count.
     */
    async getTopServices(startDate?: string, endDate?: string, limit: number = 5): Promise<TopService[]> {
        const { data, error } = await supabase.rpc('get_top_services', {
            p_start_date: startDate || null,
            p_end_date: endDate || null,
            p_limit: limit,
        });

        if (error) {
            console.error('Error fetching top services:', error);
            throw error;
        }

        return (data || []) as unknown as TopService[];
    },

    /**
     * Fetches top expense categories.
     */
    async getTopExpenseCategories(startDate?: string, endDate?: string, limit: number = 5): Promise<TopExpenseCategory[]> {
        const { data, error } = await supabase.rpc('get_top_expense_categories', {
            p_start_date: startDate || null,
            p_end_date: endDate || null,
            p_limit: limit,
        });

        if (error) {
            console.error('Error fetching expense categories:', error);
            throw error;
        }

        return (data || []) as unknown as TopExpenseCategory[];
    },

    /**
     * Fetches per-doctor receivables breakdown with aging.
     * Read-only — uses same calculation as get_analytics_summary, grouped by doctor.
     */
    async getDoctorReceivablesBreakdown(): Promise<DoctorReceivable[]> {
        const { data, error } = await supabase.rpc('get_doctor_receivables_breakdown');

        if (error) {
            console.error('Error fetching doctor receivables breakdown:', error);
            throw error;
        }

        return (data || []) as unknown as DoctorReceivable[];
    },

    /**
     * Fetches the Finance dashboard summary.
     * Includes capital, assets, starting balance, current balance.
     */
    async getFinanceDashboard(): Promise<FinanceDashboard> {
        const { data, error } = await supabase.rpc('get_finance_dashboard');

        if (error) {
            console.error('Error fetching finance dashboard:', error);
            throw error;
        }

        return data as unknown as FinanceDashboard;
    },
};
