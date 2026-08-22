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

    // Cash-basis transaction metrics — dated by `date` (when the money
    // actually moved), net of system transfer fees and employee claims, so
    // they agree with the treasury page. The accrual fields above stay the
    // source for the P&L.
    cash_total_income: number;
    cash_doctor_collections: number;
    cash_total_expenses: number;
    cash_supplier_payments: number;
    cash_designer_payments: number;
    cash_other_expenses: number;

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

/**
 * Volume and problem-rate facts for one doctor (billing group).
 *
 * `orders_with_issues` counts DISTINCT orders carrying at least one
 * non-voided `order_issues` row — not issue rows — so a single order with
 * several logged problems cannot push a remake rate above 100%.
 */
export interface DoctorSegmentationInput {
    doctor_id: string;
    doctor_name: string;
    order_count: number;
    orders_with_issues: number;
    first_registered_at: string | null;
    days_since_first_registered: number | null;
}

/**
 * One external lab (or the in-house/unassigned bucket) over the period.
 *
 * Sourced from `order_issues`, not `orders.status` — a lab that had problems
 * and fixed them must still show them, which a status-derived count cannot do.
 *
 * Split into severity tiers by owner decision (2026-08-17): not every
 * issue_type costs the same. `doctor_rejected`/`redo` mean a produced piece
 * was actually lost, and only THAT tier drives `severe_issue_rate_pct` — the
 * number that should worry you about a lab. `returned` costs some doctor
 * trust but no product was lost, so it is counted on its own
 * (`returned_orders`/`returned_rate_pct`). `cancelled`/`lab_rejected` mean we
 * simply chose not to continue — nothing was ever produced and lost — so
 * `minor_issue_orders` is visible but never feeds a rate.
 *
 * `share_of_all_severe_issues_pct` is this lab's slice of every SEVERE case
 * across all labs in the period, not of every issue — a lab can carry a lot
 * of minor/returned volume without that inflating this figure.
 */
export interface SupplierIssuePerformanceRow {
    supplier_id: string | null;
    supplier_name: string;
    total_orders: number;
    severe_issue_orders: number;
    severe_issue_rate_pct: number | null;
    share_of_all_severe_issues_pct: number | null;
    returned_orders: number;
    returned_rate_pct: number | null;
    minor_issue_orders: number;
    rejection_cost: number;
    by_type: Record<string, number>;
}

export interface SupplierIssuePerformance {
    /** Which date column the period filter was applied to. Show this in the UI. */
    date_axis: string;
    includes_archived: boolean;
    total_orders: number;
    total_severe_issue_orders: number;
    rows: SupplierIssuePerformanceRow[];
}

/**
 * Acquisition facts for the period.
 *
 * `expense_by_category` is intentionally UNFILTERED and keyed by the raw
 * category string: the canonical mapping (aliases + Arabic normalization)
 * lives in `normalizeExpenseCategory`, and duplicating it server-side would
 * create a second classifier that drifts. Callers must normalize.
 */
export interface MarketingAcquisition {
    new_doctors: number;
    /** Of the new doctors, how many actually sent at least one order. */
    activated_doctors: number;
    first_90_day_revenue: number;
    expense_by_category: { category: string; total: number }[];
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
     * Fetches acquisition inputs for CAC. Ad spend must be derived by the
     * caller from `expense_by_category` via `normalizeExpenseCategory` — see
     * the interface note for why the RPC does not pre-filter it.
     */
    async getMarketingAcquisition(startDate?: string, endDate?: string): Promise<MarketingAcquisition> {
        const { data, error } = await supabase.rpc('get_marketing_acquisition', {
            p_start_date: startDate || null,
            p_end_date: endDate || null,
        });

        if (error) {
            console.error('Error fetching marketing acquisition:', error);
            throw error;
        }

        return data as unknown as MarketingAcquisition;
    },

    /**
     * Fetches per-lab problem performance.
     *
     * Both the numerator and the denominator use the ORDER's statement date,
     * unlike the issues list which filters on when the issue was logged.
     * Show `date_axis` next to the table so the two are not read as one.
     */
    async getSupplierIssuePerformance(startDate?: string, endDate?: string): Promise<SupplierIssuePerformance> {
        const { data, error } = await supabase.rpc('get_supplier_issue_performance', {
            p_start_date: startDate || null,
            p_end_date: endDate || null,
        });

        if (error) {
            console.error('Error fetching supplier issue performance:', error);
            throw error;
        }

        return data as unknown as SupplierIssuePerformance;
    },

    /**
     * Fetches the order-volume and problem-rate inputs the A/B/C/D grading
     * needs. Profit comes from getDoctorServiceProfitability and aging from
     * getDoctorReceivablesBreakdown — all three key on the same billing
     * doctor (COALESCE(parent_id, id)), so they join directly.
     */
    async getDoctorSegmentationInputs(startDate?: string, endDate?: string): Promise<DoctorSegmentationInput[]> {
        const { data, error } = await supabase.rpc('get_doctor_segmentation_inputs', {
            p_start_date: startDate || null,
            p_end_date: endDate || null,
        });

        if (error) {
            console.error('Error fetching doctor segmentation inputs:', error);
            throw error;
        }

        return (data || []) as unknown as DoctorSegmentationInput[];
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
