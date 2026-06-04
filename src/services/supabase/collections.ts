import { ErrorHandler } from '../../lib/errorHandler';
import type { BillingEntityType } from '../../constants/billingSettings';
import { OBLIGATION_STATUSES } from '../../constants/financialObligations';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Standard aging buckets (days past due date) */
export interface AgingBuckets {
    /** Not yet overdue — remaining amount within the grace period */
    current: number;
    /** 1-30 days past due */
    days1to30: number;
    /** 31-60 days past due */
    days31to60: number;
    /** More than 60 days past due */
    over60Days: number;
    /** Total outstanding */
    total: number;
}

export interface AgingObligationDetail {
    obligationId: string;
    orderId: string;
    caseId?: string | null;
    patientName?: string | null;
    triggerDate: string;
    dueDate: string;
    remainingAmount: number;
    daysPastDue: number;
    bucket: 'current' | '1_30' | '31_60' | 'over_60';
}

export interface EntityAgingReport {
    entityType: BillingEntityType;
    entityId: string;
    entityName?: string | null;
    aging: AgingBuckets;
    obligations: AgingObligationDetail[];
    asOfDate: string;
    generatedAt: string;
}

export interface AgingReportParams {
    entityType?: BillingEntityType;
    entityId?: string;
    direction?: 'receivable' | 'payable';
    /** ISO date to compute aging from. Defaults to today */
    asOfDate?: string;
    /** Minimum remaining amount to include (filters noise) */
    minRemainingAmount?: number;
    page?: number;
    pageSize?: number;
}

export interface AgingReportResult {
    rows: EntityAgingReport[];
    summary: {
        totalEntities: number;
        totalCurrent: number;
        total1to30: number;
        total31to60: number;
        totalOver60: number;
        grandTotal: number;
    };
    asOfDate: string;
    generatedAt: string;
    page: number;
    pageSize: number;
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

function daysBetween(from: string, to: string): number {
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    return Math.floor((toMs - fromMs) / (1000 * 60 * 60 * 24));
}

function classifyBucket(daysPastDue: number): AgingObligationDetail['bucket'] {
    if (daysPastDue <= 0) return 'current';
    if (daysPastDue <= 30) return '1_30';
    if (daysPastDue <= 60) return '31_60';
    return 'over_60';
}

// ---------------------------------------------------------------------------
// Core aging report builder
// ---------------------------------------------------------------------------

async function resolveEntityNames(
    rows: { entityType: BillingEntityType; entityId: string }[]
): Promise<Map<string, string>> {
    const supabase = await getSupabaseClient();
    const names = new Map<string, string>();

    const doctorIds = [...new Set(rows.filter(r => r.entityType === 'doctor').map(r => r.entityId))];
    const supplierIds = [...new Set(rows.filter(r => r.entityType === 'external_lab').map(r => r.entityId))];
    const designerIds = [...new Set(rows.filter(r => r.entityType === 'designer').map(r => r.entityId))];

    if (doctorIds.length) {
        const { data } = await supabase.from('doctors').select('id, name').in('id', doctorIds);
        (data || []).forEach(d => names.set(`doctor:${d.id}`, d.name));
    }
    if (supplierIds.length) {
        const { data } = await supabase.from('suppliers').select('id, name').in('id', supplierIds);
        (data || []).forEach(d => names.set(`external_lab:${d.id}`, d.name));
    }
    if (designerIds.length) {
        const { data } = await supabase.from('users').select('id, name').in('id', designerIds);
        (data || []).forEach(d => names.set(`designer:${d.id}`, d.name));
    }

    return names;
}

/**
 * Computes a debt aging report for one or all entities.
 *
 * Each open/partially-paid obligation is bucketed relative to its `due_date`
 * compared to `asOfDate`:
 *  - current    → due_date >= asOfDate
 *  - 1–30 days  → 1-30 days past due_date
 *  - 31–60 days → 31-60 days past due_date
 *  - > 60 days  → more than 60 days past due_date
 */
export async function computeAgingReport(
    params: AgingReportParams = {}
): Promise<AgingReportResult> {
    const supabase = await getSupabaseClient();
    const asOfDate = params.asOfDate || todayDateString();
    const direction = params.direction || 'receivable';
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 50));
    const minAmount = params.minRemainingAmount ?? 0;
    const now = new Date().toISOString();

    let query = supabase
        .from('financial_obligations')
        .select('id, order_id, entity_type, entity_id, due_date, trigger_date, remaining_amount, orders(case_id, patient_name)')
        .eq('direction', direction)
        .in('status', [OBLIGATION_STATUSES.unpaid, OBLIGATION_STATUSES.partiallyPaid])
        .gt('remaining_amount', minAmount);

    if (params.entityType) query = query.eq('entity_type', params.entityType);
    if (params.entityId) query = query.eq('entity_id', params.entityId);

    query = query.order('entity_id').order('due_date', { ascending: true });

    const { data, error } = await query;
    if (error) throw ErrorHandler.handle(error, 'computeAgingReport');

    // Group obligations by entity
    type RawRow = {
        id: string;
        order_id: string;
        entity_type: string;
        entity_id: string;
        due_date: string;
        trigger_date: string;
        remaining_amount: number;
        orders?: { case_id: string | null; patient_name: string | null } | null;
    };

    const entityMap = new Map<string, { entityType: BillingEntityType; entityId: string; obligations: RawRow[] }>();

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    for (const row of (data || []) as unknown as RawRow[]) {
        const key = `${row.entity_type}:${row.entity_id}`;
        if (!entityMap.has(key)) {
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            const entityType = row.entity_type as BillingEntityType;
            entityMap.set(key, {
                entityType,
                entityId: row.entity_id,
                obligations: [],
            });
        }
        entityMap.get(key)!.obligations.push(row);
    }

    const allEntities = Array.from(entityMap.values());
    const totalEntities = allEntities.length;

    // Paginate
    const pageEntities = allEntities.slice((page - 1) * pageSize, page * pageSize);

    // Resolve names for paged entities
    const nameMap = await resolveEntityNames(pageEntities);

    const rows: EntityAgingReport[] = pageEntities.map(entity => {
        const aging: AgingBuckets = { current: 0, days1to30: 0, days31to60: 0, over60Days: 0, total: 0 };
        const obligations: AgingObligationDetail[] = [];

        for (const ob of entity.obligations) {
            const remaining = Number(ob.remaining_amount);
            const daysPastDue = daysBetween(ob.due_date, asOfDate);
            const bucket = classifyBucket(daysPastDue);

            obligations.push({
                obligationId: ob.id,
                orderId: ob.order_id,
                caseId: ob.orders?.case_id ?? null,
                patientName: ob.orders?.patient_name ?? null,
                triggerDate: ob.trigger_date,
                dueDate: ob.due_date,
                remainingAmount: remaining,
                daysPastDue,
                bucket,
            });

            aging.total += remaining;
            if (bucket === 'current') aging.current += remaining;
            else if (bucket === '1_30') aging.days1to30 += remaining;
            else if (bucket === '31_60') aging.days31to60 += remaining;
            else aging.over60Days += remaining;
        }

        return {
            entityType: entity.entityType,
            entityId: entity.entityId,
            entityName: nameMap.get(`${entity.entityType}:${entity.entityId}`) || null,
            aging,
            obligations,
            asOfDate,
            generatedAt: now,
        };
    });

    // Summary across ALL entities (not just paged)
    const summary = {
        totalEntities,
        totalCurrent: 0,
        total1to30: 0,
        total31to60: 0,
        totalOver60: 0,
        grandTotal: 0,
    };

    for (const entity of allEntities) {
        for (const ob of entity.obligations) {
            const remaining = Number(ob.remaining_amount);
            const daysPastDue = daysBetween(ob.due_date, asOfDate);
            const bucket = classifyBucket(daysPastDue);
            summary.grandTotal += remaining;
            if (bucket === 'current') summary.totalCurrent += remaining;
            else if (bucket === '1_30') summary.total1to30 += remaining;
            else if (bucket === '31_60') summary.total31to60 += remaining;
            else summary.totalOver60 += remaining;
        }
    }

    return { rows, summary, asOfDate, generatedAt: now, page, pageSize };
}

/**
 * Quick summary aging report for a single entity. Useful for showing aging
 * buckets on a doctor/supplier detail screen.
 */
export async function getEntityAgingSummary(
    entityType: BillingEntityType,
    entityId: string,
    direction: 'receivable' | 'payable' = 'receivable',
    asOfDate?: string
): Promise<AgingBuckets> {
    const result = await computeAgingReport({ entityType, entityId, direction, asOfDate, pageSize: 1 });
    return result.rows[0]?.aging ?? { current: 0, days1to30: 0, days31to60: 0, over60Days: 0, total: 0 };
}
