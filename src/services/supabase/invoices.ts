import { ErrorHandler } from '../../lib/errorHandler';
import type { BillingEntityType } from '../../constants/billingSettings';
import {
    BILLING_MODES,
    calculateMonthlyCycleDueDate,
} from '../../constants/billingSettings';
import { OBLIGATION_STATUSES } from '../../constants/financialObligations';
import { getEntityBillingSettings } from './billingSettings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InvoiceLineItem {
    obligationId: string;
    orderId: string;
    caseId?: string | null;
    patientName?: string | null;
    triggerDate: string;
    dueDate: string;
    grossAmount: number;
    adjustmentAmount: number;
    netAmount: number;
    allocatedAmount: number;
    remainingAmount: number;
}

export interface Invoice {
    /** Entity that owes us money (doctor) or that we owe (designer / external_lab) */
    entityType: BillingEntityType;
    entityId: string;
    entityName?: string | null;
    direction: 'receivable' | 'payable';
    billingMode: 'per_order' | 'monthly_cycle';
    /** ISO date — start of the billing period */
    periodStart: string;
    /** ISO date — end of the billing period */
    periodEnd: string;
    /** ISO date — when payment is due */
    dueDate: string;
    lineItems: InvoiceLineItem[];
    totalGross: number;
    totalAdjustment: number;
    totalNet: number;
    totalAllocated: number;
    totalRemaining: number;
    generatedAt: string;
}

export interface GenerateInvoicesParams {
    entityType: BillingEntityType;
    entityId: string;
    direction?: 'receivable' | 'payable';
    /** For monthly billing: which cycle month to invoice (YYYY-MM). Defaults to current month. */
    cycleMonth?: string;
    /** For per-order: include obligations with dueDate up to this date. Defaults to today. */
    asOfDate?: string;
    /** Include obligations that are not yet due */
    includeNotDue?: boolean;
}

export interface GenerateInvoicesResult {
    invoices: Invoice[];
    entityType: BillingEntityType;
    entityId: string;
    generatedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getSupabaseClient() {
    const { supabase } = await import('../../lib/supabase');
    return supabase;
}

function todayDateString(): string {
    return new Date().toISOString().split('T')[0];
}

/** Returns YYYY-MM for current month */
function currentYearMonth(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Returns the first and last day of a YYYY-MM period */
function monthBoundaries(ym: string): { start: string; end: string } {
    const [y, m] = ym.split('-').map(Number);
    const start = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const end = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
}

// ---------------------------------------------------------------------------
// Main service
// ---------------------------------------------------------------------------

/**
 * Generates invoice(s) for an entity based on their billing settings and open
 * financial obligations.
 *
 * - **per_order** billing: one invoice per open/partially-paid obligation that
 *   is due on or before `asOfDate`.
 * - **monthly_cycle** billing: a single aggregated invoice covering all
 *   obligations whose `trigger_date` falls within the billing cycle month.
 */
export async function generateInvoices(
    params: GenerateInvoicesParams
): Promise<GenerateInvoicesResult> {
    const supabase = await getSupabaseClient();
    const now = new Date().toISOString();
    const asOfDate = params.asOfDate || todayDateString();
    const direction = params.direction || 'receivable';

    const settings = await getEntityBillingSettings(params.entityType, params.entityId);

    // Build base query for open obligations
    let query = supabase
        .from('financial_obligations')
        .select('*, orders(case_id, patient_name)')
        .eq('entity_type', params.entityType)
        .eq('entity_id', params.entityId)
        .eq('direction', direction)
        .in('status', [OBLIGATION_STATUSES.unpaid, OBLIGATION_STATUSES.partiallyPaid]);

    if (settings.billingMode === BILLING_MODES.perOrder) {
        if (!params.includeNotDue) {
            query = query.lte('due_date', asOfDate);
        }
    } else {
        // monthly_cycle: filter by trigger_date within the cycle month
        const ym = params.cycleMonth || currentYearMonth();
        const { start, end } = monthBoundaries(ym);
        query = query.gte('trigger_date', start).lte('trigger_date', end);
    }

    query = query.order('due_date', { ascending: true });

    const { data, error } = await query;
    if (error) {
        throw ErrorHandler.handle(error, 'generateInvoices.fetchObligations');
    }

    interface ObligationRow {
        id: string;
        order_id: string;
        trigger_date: string;
        due_date: string;
        gross_amount: number;
        adjustment_amount: number;
        net_amount: number;
        allocated_amount: number;
        remaining_amount: number;
        orders?: { case_id: string | null; patient_name: string | null } | null;
    }

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const rows = (data || []) as unknown as ObligationRow[];

    if (rows.length === 0) {
        return { invoices: [], entityType: params.entityType, entityId: params.entityId, generatedAt: now };
    }

    const invoices: Invoice[] = [];

    if (settings.billingMode === BILLING_MODES.perOrder) {
        // One invoice per obligation
        for (const row of rows) {
            const lineItem: InvoiceLineItem = {
                obligationId: row.id,
                orderId: row.order_id,
                caseId: row.orders?.case_id ?? null,
                patientName: row.orders?.patient_name ?? null,
                triggerDate: row.trigger_date,
                dueDate: row.due_date,
                grossAmount: Number(row.gross_amount),
                adjustmentAmount: Number(row.adjustment_amount),
                netAmount: Number(row.net_amount),
                allocatedAmount: Number(row.allocated_amount),
                remainingAmount: Number(row.remaining_amount),
            };

            invoices.push({
                entityType: params.entityType,
                entityId: params.entityId,
                direction,
                billingMode: 'per_order',
                periodStart: row.trigger_date,
                periodEnd: row.trigger_date,
                dueDate: row.due_date,
                lineItems: [lineItem],
                totalGross: lineItem.grossAmount,
                totalAdjustment: lineItem.adjustmentAmount,
                totalNet: lineItem.netAmount,
                totalAllocated: lineItem.allocatedAmount,
                totalRemaining: lineItem.remainingAmount,
                generatedAt: now,
            });
        }
    } else {
        // Monthly cycle: aggregate all into a single invoice
        const ym = params.cycleMonth || currentYearMonth();
        const { start, end } = monthBoundaries(ym);
        const billingDay = settings.billingDay ?? 25;
        const dueDate = calculateMonthlyCycleDueDate(start, billingDay);

        const lineItems: InvoiceLineItem[] = rows.map(row => ({
            obligationId: row.id,
            orderId: row.order_id,
            caseId: row.orders?.case_id ?? null,
            patientName: row.orders?.patient_name ?? null,
            triggerDate: row.trigger_date,
            dueDate: row.due_date,
            grossAmount: Number(row.gross_amount),
            adjustmentAmount: Number(row.adjustment_amount),
            netAmount: Number(row.net_amount),
            allocatedAmount: Number(row.allocated_amount),
            remainingAmount: Number(row.remaining_amount),
        }));

        const totalGross = lineItems.reduce((s, i) => s + i.grossAmount, 0);
        const totalAdjustment = lineItems.reduce((s, i) => s + i.adjustmentAmount, 0);
        const totalNet = lineItems.reduce((s, i) => s + i.netAmount, 0);
        const totalAllocated = lineItems.reduce((s, i) => s + i.allocatedAmount, 0);
        const totalRemaining = lineItems.reduce((s, i) => s + i.remainingAmount, 0);

        invoices.push({
            entityType: params.entityType,
            entityId: params.entityId,
            direction,
            billingMode: 'monthly_cycle',
            periodStart: start,
            periodEnd: end,
            dueDate,
            lineItems,
            totalGross,
            totalAdjustment,
            totalNet,
            totalAllocated,
            totalRemaining,
            generatedAt: now,
        });
    }

    return { invoices, entityType: params.entityType, entityId: params.entityId, generatedAt: now };
}

/**
 * Returns a list of all entities that have overdue invoiceable obligations,
 * along with the total overdue amount.
 */
export async function getEntitiesWithOverdueObligations(params: {
    entityType?: BillingEntityType;
    direction?: 'receivable' | 'payable';
    asOfDate?: string;
}): Promise<Array<{ entityType: BillingEntityType; entityId: string; overdueAmount: number; overdueCount: number }>> {
    const supabase = await getSupabaseClient();
    const asOfDate = params.asOfDate || todayDateString();
    const direction = params.direction || 'receivable';

    let query = supabase
        .from('financial_obligations')
        .select('entity_type, entity_id, remaining_amount')
        .eq('direction', direction)
        .in('status', [OBLIGATION_STATUSES.unpaid, OBLIGATION_STATUSES.partiallyPaid])
        .lt('due_date', asOfDate);

    if (params.entityType) {
        query = query.eq('entity_type', params.entityType);
    }

    const { data, error } = await query;
    if (error) {
        throw ErrorHandler.handle(error, 'getEntitiesWithOverdueObligations');
    }

    const map = new Map<string, { entityType: BillingEntityType; entityId: string; overdueAmount: number; overdueCount: number }>();

    interface OverdueRow { entity_type: string; entity_id: string; remaining_amount: number; }

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    for (const row of (data || []) as unknown as OverdueRow[]) {
        const key = `${row.entity_type}:${row.entity_id}`;
        const existing = map.get(key);
        if (existing) {
            existing.overdueAmount += Number(row.remaining_amount);
            existing.overdueCount += 1;
        } else {
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            const entityType = row.entity_type as BillingEntityType;
            map.set(key, {
                entityType,
                entityId: row.entity_id,
                overdueAmount: Number(row.remaining_amount),
                overdueCount: 1,
            });
        }
    }

    return Array.from(map.values()).sort((a, b) => b.overdueAmount - a.overdueAmount);
}
