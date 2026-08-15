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
    total_cost_of_goods_suppliers: number;
    total_cost_of_goods_designers: number;
    completed_order_count: number;
    active_order_count: number;
    doctor_rejected_count: number;
    lab_rejected_count: number;
    returned_count: number;
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
    pending_revenue_period: number;

    // Accounts payable
    total_payables: number;
    total_payables_suppliers: number;
    total_payables_designers: number;
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

// ─── SERVICE ─────────────────────────────────────────────────────

/**
 * Issue counts sourced from `order_issues` — the event log — NOT from
 * orders.status, which only reflects an order's current state and therefore
 * loses any problem that was later resolved.
 *
 * `distinct_orders_with_issues` counts ORDERS, so an order carrying more than
 * one issue type is counted once. `total_issue_events` counts rows, so it can
 * legitimately exceed it.
 */
export interface OrderIssuesSummary {
    distinct_orders_with_issues: number;
    total_issue_events: number;
    /** Which date column the period filter was applied to. Show this in the UI. */
    date_axis: string;
    /** returned | doctor_rejected | lab_rejected | cancelled | redo */
    by_type: Record<string, number>;
    by_cause: Record<string, number>;
}

/**
 * One doctor x one service, over the selected period.
 *
 * `cost` is the ACTUAL settlement-aware order cost distributed across the
 * order's items — not a catalog price-list model — so gross profit here is
 * drawn from the same basis as `get_analytics_summary`.
 *
 * `is_catalog_service` is false when the free-text `order_items.product_type`
 * has no match in the `services` catalog. Such rows are still real revenue;
 * the flag marks a naming cleanup, not a row to discard.
 */
export interface DoctorServiceProfitabilityRow {
    doctor_id: string;
    doctor_name: string;
    service_name: string;
    is_catalog_service: boolean;
    units: number;
    revenue: number;
    cost: number;
    gross_profit: number;
    /** null when revenue is zero — a margin on no revenue is undefined, not 0%. */
    margin_pct: number | null;
    /** Portion of `cost` that came from remake orders. A subset, never an addition. */
    redo_cost: number;
    redo_units: number;
}

export interface DoctorServiceProfitability {
    /** Which date column the period filter was applied to. Show this in the UI. */
    date_axis: string;
    includes_archived: boolean;
    rows: DoctorServiceProfitabilityRow[];
    totals: {
        units: number;
        revenue: number;
        cost: number;
        gross_profit: number;
        redo_cost: number;
        uncatalogued_rows: number;
        uncatalogued_revenue: number;
    };
}

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
     * Fetches issue counts from `order_issues`, the event log.
     *
     * Use this — not getSummary()'s status-derived counts — for anything that
     * reports problems or remakes. Archived orders are deliberately included:
     * archiving closes a file, it does not cancel the problem that happened.
     *
     * @param startDate  Optional ISO date string (YYYY-MM-DD)
     * @param endDate    Optional ISO date string (YYYY-MM-DD)
     */
    async getIssuesSummary(startDate?: string, endDate?: string): Promise<OrderIssuesSummary> {
        const { data, error } = await supabase.rpc('get_order_issues_summary', {
            p_start_date: startDate || null,
            p_end_date: endDate || null,
        });

        if (error) {
            console.error('Error fetching order issues summary:', error);
            throw error;
        }

        return data as unknown as OrderIssuesSummary;
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
     * Fetches doctor x service profitability for the period.
     *
     * Archived orders are included on purpose (rule 0-A): archiving closes a
     * file, it does not undo revenue earned or cost paid.
     */
    async getDoctorServiceProfitability(startDate?: string, endDate?: string): Promise<DoctorServiceProfitability> {
        const { data, error } = await supabase.rpc('get_doctor_service_profitability', {
            p_start_date: startDate || null,
            p_end_date: endDate || null,
        });

        if (error) {
            console.error('Error fetching doctor/service profitability:', error);
            throw error;
        }

        return data as unknown as DoctorServiceProfitability;
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
};
