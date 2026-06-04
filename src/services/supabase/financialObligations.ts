import { calculateDueDate } from '../../constants/billingSettings';
import {
    OBLIGATION_DIRECTIONS,
    OBLIGATION_SOURCES,
    OBLIGATION_STATUSES,
    OBLIGATION_TRIGGER_TYPES,
    buildExternalLabPayableCandidate,
    buildDoctorReceivableCandidate,
    buildDesignerPayableCandidate,
    calculateNetAmount,
    validateFinancialObligationAmounts,
    type FinancialObligationCandidate,
    type ObligationDirection,
    type ObligationSource,
    type ObligationStatus,
    type ObligationTriggerType,
} from '../../constants/financialObligations';
import type { BillingEntityType } from '../../constants/billingSettings';
import { ErrorHandler, ValidationError } from '../../lib/errorHandler';
import type { FinancialObligation, Order } from '../db';
import { getEntityBillingSettings } from './billingSettings';

type FinancialObligationRow = {
    id: string;
    order_id: string;
    entity_type: BillingEntityType;
    entity_id: string;
    direction: ObligationDirection;
    trigger_type: ObligationTriggerType;
    trigger_status: string | null;
    trigger_date: string;
    due_date: string;
    gross_amount: number;
    adjustment_amount: number;
    net_amount: number;
    allocated_amount: number;
    remaining_amount: number;
    status: ObligationStatus;
    source: ObligationSource;
    notes: string | null;
    metadata: Record<string, unknown>;
    created_by: string | null;
    created_at: string;
    updated_at: string;
};

type FinancialObligationReviewRow = FinancialObligationRow & {
    orders?: {
        case_id: string | null;
        patient_name: string | null;
    } | null;
};

export interface FinancialObligationsReviewParams {
    page?: number;
    pageSize?: number;
    entityType?: 'all' | BillingEntityType;
    direction?: 'all' | ObligationDirection;
    status?: 'all' | ObligationStatus;
    triggerType?: 'all' | ObligationTriggerType;
    createdFrom?: string;
    createdTo?: string;
    search?: string;
}

export interface FinancialObligationReviewItem extends FinancialObligation {
    caseId?: string | null;
    patientName?: string | null;
    entityName?: string | null;
}

export interface FinancialObligationsReviewResult {
    data: FinancialObligationReviewItem[];
    count: number;
    page: number;
    pageSize: number;
}

const EMPTY_UUID = '00000000-0000-0000-0000-000000000000';
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export interface FinancialObligationInput extends FinancialObligationCandidate {
    dueDate: string;
    allocatedAmount?: number;
    status?: ObligationStatus;
    createdBy?: string | null;
}

export interface ExistingObligationQuery {
    orderId: string;
    entityType: BillingEntityType;
    entityId: string;
    direction: ObligationDirection;
    triggerType: ObligationTriggerType;
    source: ObligationSource;
}

async function getSupabaseClient() {
    const { supabase } = await import('../../lib/supabase');
    return supabase;
}

function dbToFinancialObligation(row: FinancialObligationRow): FinancialObligation {
    return {
        id: row.id,
        orderId: row.order_id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        direction: row.direction,
        triggerType: row.trigger_type,
        triggerStatus: row.trigger_status,
        triggerDate: row.trigger_date,
        dueDate: row.due_date,
        grossAmount: row.gross_amount,
        adjustmentAmount: row.adjustment_amount,
        netAmount: row.net_amount,
        allocatedAmount: row.allocated_amount,
        remainingAmount: row.remaining_amount,
        status: row.status,
        source: row.source,
        notes: row.notes,
        metadata: row.metadata || {},
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

async function resolveReviewEntityNames(rows: FinancialObligationReviewItem[]): Promise<Map<string, string>> {
    const supabase = await getSupabaseClient();
    const doctorIds = Array.from(new Set(rows.filter(row => row.entityType === 'doctor').map(row => row.entityId)));
    const supplierIds = Array.from(new Set(rows.filter(row => row.entityType === 'external_lab').map(row => row.entityId)));
    const names = new Map<string, string>();

    if (doctorIds.length > 0) {
        const { data, error } = await supabase
            .from('doctors')
            .select('id, name')
            .in('id', doctorIds);

        if (error) {
            console.error('Failed to resolve financial obligation doctor names', error);
        } else {
            (data || []).forEach(row => names.set(`doctor:${row.id}`, row.name));
        }
    }

    if (supplierIds.length > 0) {
        const { data, error } = await supabase
            .from('suppliers')
            .select('id, name')
            .in('id', supplierIds);

        if (error) {
            console.error('Failed to resolve financial obligation supplier names', error);
        } else {
            (data || []).forEach(row => names.set(`external_lab:${row.id}`, row.name));
        }
    }

    const designerIds = Array.from(new Set(rows.filter(row => row.entityType === 'designer').map(row => row.entityId)));
    if (designerIds.length > 0) {
        const { data, error } = await supabase
            .from('users')
            .select('id, name')
            .in('id', designerIds);

        if (error) {
            console.error('Failed to resolve financial obligation designer names', error);
        } else {
            (data || []).forEach(row => names.set(`designer:${row.id}`, row.name));
        }
    }

    return names;
}

function validateObligationInput(input: FinancialObligationInput): void {
    if (!input.orderId) throw new ValidationError('معرف الطلب مطلوب لإنشاء الاستحقاق');
    if (!input.entityId) throw new ValidationError('معرف الجهة مطلوب لإنشاء الاستحقاق');
    if (!input.triggerDate) throw new ValidationError('تاريخ الاستحقاق مطلوب');
    if (!input.dueDate) throw new ValidationError('تاريخ السداد مطلوب');

    validateFinancialObligationAmounts({
        grossAmount: input.grossAmount,
        adjustmentAmount: input.adjustmentAmount,
        allocatedAmount: input.allocatedAmount,
    });
}

function inputToDb(input: FinancialObligationInput) {
    const adjustmentAmount = input.adjustmentAmount ?? 0;
    const allocatedAmount = input.allocatedAmount ?? 0;
    const netAmount = calculateNetAmount(input.grossAmount, adjustmentAmount);

    return {
        order_id: input.orderId,
        entity_type: input.entityType,
        entity_id: input.entityId,
        direction: input.direction,
        trigger_type: input.triggerType,
        trigger_status: input.triggerStatus || null,
        trigger_date: input.triggerDate,
        due_date: input.dueDate,
        gross_amount: input.grossAmount,
        adjustment_amount: adjustmentAmount,
        net_amount: netAmount,
        allocated_amount: allocatedAmount,
        status: input.status || OBLIGATION_STATUSES.unpaid,
        source: input.source,
        notes: input.notes || null,
        metadata: input.metadata || {},
        created_by: input.createdBy || null,
    };
}

export async function calculateObligationDueDate(candidate: FinancialObligationCandidate): Promise<string> {
    const settings = await getEntityBillingSettings(candidate.entityType, candidate.entityId);
    return calculateDueDate({
        billingMode: settings.billingMode,
        billingDay: settings.billingDay,
        triggerDate: candidate.triggerDate,
        perOrderDueDays: settings.perOrderDueDays,
    });
}

export async function findExistingObligation(query: ExistingObligationQuery): Promise<FinancialObligation | null> {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
        .from('financial_obligations')
        .select('*')
        .eq('order_id', query.orderId)
        .eq('entity_type', query.entityType)
        .eq('entity_id', query.entityId)
        .eq('direction', query.direction)
        .eq('trigger_type', query.triggerType)
        .eq('source', query.source)
        .neq('status', OBLIGATION_STATUSES.void)
        .maybeSingle();

    if (error) {
        throw ErrorHandler.handle(error, 'findExistingObligation');
    }

    return data ? dbToFinancialObligation(data as FinancialObligationRow) : null;
}

export async function createFinancialObligation(input: FinancialObligationInput): Promise<FinancialObligation> {
    validateObligationInput(input);

    const existing = await findExistingObligation({
        orderId: input.orderId,
        entityType: input.entityType,
        entityId: input.entityId,
        direction: input.direction,
        triggerType: input.triggerType,
        source: input.source,
    });

    if (existing) return existing;

    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
        .from('financial_obligations')
        .insert(inputToDb(input))
        .select('*')
        .single();

    if (error) {
        throw ErrorHandler.handle(error, 'createFinancialObligation');
    }

    return dbToFinancialObligation(data as FinancialObligationRow);
}

export async function createDoctorReceivableObligationForOrder(
    order: Partial<Order>,
    context: { createdBy?: string | null; metadata?: Record<string, unknown> } = {}
): Promise<FinancialObligation | null> {
    const candidate = buildDoctorReceivableCandidate(order);
    if (!candidate) return null;

    const dueDate = await calculateObligationDueDate(candidate);

    return createFinancialObligation({
        ...candidate,
        dueDate,
        createdBy: context.createdBy || null,
        metadata: {
            ...candidate.metadata,
            ...(context.metadata || {}),
            shadowMode: true,
            trackingOnly: true,
        },
    });
}

export async function createExternalLabPayableObligationForOrder(
    order: Partial<Order>,
    context: {
        createdBy?: string | null;
        impliedFinalReady?: boolean;
        triggerDate?: string;
        metadata?: Record<string, unknown>;
    } = {}
): Promise<FinancialObligation | null> {
    const supabase = await getSupabaseClient();
    let isSalariedDesigner = false;
    if (order.designerId) {
        const { data: userData } = await supabase
            .from('users')
            .select('custom_permissions')
            .eq('id', order.designerId)
            .maybeSingle();
        if (userData?.custom_permissions?.['designer_fixed_salary']) {
            isSalariedDesigner = true;
        }
    }

    const candidate = buildExternalLabPayableCandidate(
        order,
        {
            impliedFinalReady: context.impliedFinalReady,
            triggerDate: context.triggerDate,
        },
        isSalariedDesigner
    );
    if (!candidate) return null;

    const dueDate = await calculateObligationDueDate(candidate);

    return createFinancialObligation({
        ...candidate,
        dueDate,
        createdBy: context.createdBy || null,
        metadata: {
            ...candidate.metadata,
            ...(context.metadata || {}),
            shadowMode: true,
            trackingOnly: true,
            normalExternalLabPayable: true,
        },
    });
}

export async function createDesignerPayableObligationForOrder(
    order: Partial<Order>,
    context: {
        createdBy?: string | null;
        triggerDate?: string;
        metadata?: Record<string, unknown>;
    } = {}
): Promise<FinancialObligation | null> {
    const supabase = await getSupabaseClient();
    let isSalariedDesigner = false;
    if (order.designerId) {
        const { data: userData } = await supabase
            .from('users')
            .select('custom_permissions')
            .eq('id', order.designerId)
            .maybeSingle();
        if (userData?.custom_permissions?.['designer_fixed_salary']) {
            isSalariedDesigner = true;
        }
    }

    const candidate = buildDesignerPayableCandidate(
        order,
        {
            triggerDate: context.triggerDate,
        },
        isSalariedDesigner
    );
    if (!candidate) return null;

    const dueDate = await calculateObligationDueDate(candidate);

    return createFinancialObligation({
        ...candidate,
        dueDate,
        createdBy: context.createdBy || null,
        metadata: {
            ...candidate.metadata,
            ...(context.metadata || {}),
            shadowMode: true,
            trackingOnly: true,
        },
    });
}

export async function getFinancialObligationsForOrder(orderId: string): Promise<FinancialObligation[]> {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
        .from('financial_obligations')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });

    if (error) {
        throw ErrorHandler.handle(error, 'getFinancialObligationsForOrder');
    }

    return ((data || []) as FinancialObligationRow[]).map(dbToFinancialObligation);
}

export async function getFinancialObligationsForEntity(
    entityType: BillingEntityType,
    entityId: string
): Promise<FinancialObligation[]> {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
        .from('financial_obligations')
        .select('*')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .order('due_date', { ascending: true });

    if (error) {
        throw ErrorHandler.handle(error, 'getFinancialObligationsForEntity');
    }

    return ((data || []) as FinancialObligationRow[]).map(dbToFinancialObligation);
}

export async function getFinancialObligationsReview(
    params: FinancialObligationsReviewParams = {}
): Promise<FinancialObligationsReviewResult> {
    const supabase = await getSupabaseClient();
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.max(1, Math.min(params.pageSize || 25, 100));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
        .from('financial_obligations')
        .select('*, orders(case_id, patient_name)', { count: 'exact' });

    if (params.entityType && params.entityType !== 'all') {
        query = query.eq('entity_type', params.entityType);
    }

    if (params.direction && params.direction !== 'all') {
        query = query.eq('direction', params.direction);
    }

    if (params.status && params.status !== 'all') {
        query = query.eq('status', params.status);
    }

    if (params.triggerType && params.triggerType !== 'all') {
        query = query.eq('trigger_type', params.triggerType);
    }

    if (params.createdFrom) {
        query = query.gte('created_at', `${params.createdFrom}T00:00:00`);
    }

    if (params.createdTo) {
        query = query.lte('created_at', `${params.createdTo}T23:59:59`);
    }

    const search = params.search?.trim();
    if (search) {
        const matchingOrderIds = new Set<string>();

        if (isUuid(search)) {
            matchingOrderIds.add(search);
        }

        const { data: matchingOrders, error: matchingOrdersError } = await supabase
            .from('orders')
            .select('id')
            .ilike('case_id', `%${search}%`)
            .limit(100);

        if (matchingOrdersError) {
            throw ErrorHandler.handle(matchingOrdersError, 'getFinancialObligationsReview.searchOrders');
        }

        (matchingOrders || []).forEach(order => matchingOrderIds.add(order.id));
        query = query.in('order_id', matchingOrderIds.size > 0 ? Array.from(matchingOrderIds) : [EMPTY_UUID]);
    }

    const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(from, to);

    if (error) {
        throw ErrorHandler.handle(error, 'getFinancialObligationsReview');
    }

    const rows = ((data || []) as FinancialObligationReviewRow[]).map(row => ({
        ...dbToFinancialObligation(row),
        caseId: row.orders?.case_id || null,
        patientName: row.orders?.patient_name || null,
        entityName: null,
    }));
    const entityNames = await resolveReviewEntityNames(rows);

    return {
        data: rows.map(row => ({
            ...row,
            entityName: entityNames.get(`${row.entityType}:${row.entityId}`) || null,
        })),
        count: count || 0,
        page,
        pageSize,
    };
}

export async function findActiveDoctorDeliveredObligationForOrder(
    orderId: string,
    entityId?: string | null
): Promise<FinancialObligation | null> {
    const supabase = await getSupabaseClient();
    let query = supabase
        .from('financial_obligations')
        .select('*')
        .eq('order_id', orderId)
        .eq('entity_type', 'doctor')
        .eq('direction', OBLIGATION_DIRECTIONS.receivable)
        .eq('trigger_type', OBLIGATION_TRIGGER_TYPES.doctorDelivered)
        .eq('source', OBLIGATION_SOURCES.order)
        .neq('status', OBLIGATION_STATUSES.void);

    if (entityId) {
        query = query.eq('entity_id', entityId);
    }

    const { data, error } = await query
        .limit(1)
        .maybeSingle();

    if (error) {
        throw ErrorHandler.handle(error, 'findActiveDoctorDeliveredObligationForOrder');
    }

    return data ? dbToFinancialObligation(data as FinancialObligationRow) : null;
}

export async function findActiveExternalLabReadyObligationForOrder(
    orderId: string,
    entityId?: string | null
): Promise<FinancialObligation | null> {
    const supabase = await getSupabaseClient();
    let query = supabase
        .from('financial_obligations')
        .select('*')
        .eq('order_id', orderId)
        .eq('entity_type', 'external_lab')
        .eq('direction', OBLIGATION_DIRECTIONS.payable)
        .eq('trigger_type', OBLIGATION_TRIGGER_TYPES.externalLabReady)
        .eq('source', OBLIGATION_SOURCES.order)
        .neq('status', OBLIGATION_STATUSES.void);

    if (entityId) {
        query = query.eq('entity_id', entityId);
    }

    const { data, error } = await query
        .limit(1)
        .maybeSingle();

    if (error) {
        throw ErrorHandler.handle(error, 'findActiveExternalLabReadyObligationForOrder');
    }

    return data ? dbToFinancialObligation(data as FinancialObligationRow) : null;
}

export async function findActiveDesignerApprovedObligationForOrder(
    orderId: string,
    entityId?: string | null
): Promise<FinancialObligation | null> {
    const supabase = await getSupabaseClient();
    let query = supabase
        .from('financial_obligations')
        .select('*')
        .eq('order_id', orderId)
        .eq('entity_type', 'designer')
        .eq('direction', OBLIGATION_DIRECTIONS.payable)
        .eq('trigger_type', OBLIGATION_TRIGGER_TYPES.designerApproved)
        .eq('source', OBLIGATION_SOURCES.order)
        .neq('status', OBLIGATION_STATUSES.void);

    if (entityId) {
        query = query.eq('entity_id', entityId);
    }

    const { data, error } = await query
        .limit(1)
        .maybeSingle();

    if (error) {
        throw ErrorHandler.handle(error, 'findActiveDesignerApprovedObligationForOrder');
    }

    return data ? dbToFinancialObligation(data as FinancialObligationRow) : null;
}

export async function voidFinancialObligation(
    id: string,
    notes?: string,
    metadataPatch: Record<string, unknown> = {}
): Promise<FinancialObligation | null> {
    const supabase = await getSupabaseClient();
    const { data: existingData, error: existingError } = await supabase
        .from('financial_obligations')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (existingError) {
        throw ErrorHandler.handle(existingError, 'voidFinancialObligation.findExisting');
    }

    const existing = existingData ? dbToFinancialObligation(existingData as FinancialObligationRow) : null;
    if (!existing) return null;

    const { data, error } = await supabase
        .from('financial_obligations')
        .update({
            status: OBLIGATION_STATUSES.void,
            notes: notes || null,
            metadata: {
                ...existing.metadata,
                ...metadataPatch,
            },
        })
        .eq('id', id)
        .select('*')
        .single();

    if (error) {
        throw ErrorHandler.handle(error, 'voidFinancialObligation');
    }

    return data ? dbToFinancialObligation(data as FinancialObligationRow) : null;
}

export async function reallocatePaymentsAfterObligationVoid(
    voidedObligationId: string,
    newObligationId: string | null,
    changedBy: string | null
): Promise<void> {
    const supabase = await getSupabaseClient();

    // 1. Fetch active allocations for the voided obligation
    const { data: allocations, error: allocError } = await supabase
        .from('payment_allocations')
        .select('*')
        .eq('obligation_id', voidedObligationId)
        .eq('status', 'active');

    if (allocError) {
        throw ErrorHandler.handle(allocError, 'reallocatePaymentsAfterObligationVoid.fetchAllocations');
    }

    if (!allocations || allocations.length === 0) {
        return; // No active allocations to reallocate
    }

    // 2. Fetch the voided obligation to get entity details and current allocated_amount
    const { data: voidedData, error: obligError } = await supabase
        .from('financial_obligations')
        .select('*')
        .eq('id', voidedObligationId)
        .single();

    if (obligError) {
        throw ErrorHandler.handle(obligError, 'reallocatePaymentsAfterObligationVoid.fetchVoidedObligation');
    }
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const voidedOblig = voidedData as FinancialObligationRow;


    // 3. If newObligationId is provided, fetch it
    let newOblig: FinancialObligationRow | null = null;
    if (newObligationId) {
        const { data, error } = await supabase
            .from('financial_obligations')
            .select('*')
            .eq('id', newObligationId)
            .single();
        if (error) {
            throw ErrorHandler.handle(error, 'reallocatePaymentsAfterObligationVoid.fetchNewObligation');
        }
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        newOblig = data as FinancialObligationRow;
    }

    for (const alloc of allocations) {
        const val = Number(alloc.allocated_amount);
        if (val <= 0) continue;

        // A. Reverse the old allocation
        const { error: revAllocError } = await supabase
            .from('payment_allocations')
            .update({
                status: 'reversed',
                reversed_by: changedBy || null,
                reversed_at: new Date().toISOString(),
                reversal_reason: 'obligation_voided',
            })
            .eq('id', alloc.id);

        if (revAllocError) {
            throw ErrorHandler.handle(revAllocError, 'reallocatePaymentsAfterObligationVoid.reverseAlloc');
        }

        // B. Decrement allocated_amount on the voided obligation
        const newVoidedAllocated = Math.max(0, Number(voidedOblig.allocated_amount || 0) - val);
        voidedOblig.allocated_amount = newVoidedAllocated;

        const { error: decError } = await supabase
            .from('financial_obligations')
            .update({
                allocated_amount: newVoidedAllocated,
            })
            .eq('id', voidedObligationId);

        if (decError) {
            console.error('Failed to decrement allocated_amount on voided obligation', decError);
        }

        let excess = val;

        // C. Allocate to new obligation if available
        if (newOblig) {
            // Re-fetch new obligation in case allocated_amount changed in this loop
            const { data: currentNewOblig, error: refreshError } = await supabase
                .from('financial_obligations')
                .select('*')
                .eq('id', newObligationId)
                .single();

            if (refreshError) {
                throw ErrorHandler.handle(refreshError, 'reallocatePaymentsAfterObligationVoid.refreshNewOblig');
            }
            newOblig = currentNewOblig;

            if (!newOblig) continue;

            const remaining = Number(newOblig.net_amount || 0) - Number(newOblig.allocated_amount || 0);

            if (remaining > 0) {
                const amountToAllocate = Math.min(excess, remaining);
                excess -= amountToAllocate;

                // Create new allocation
                const { data: newAllocData, error: insAllocError } = await supabase
                    .from('payment_allocations')
                    .insert({
                        payment_transaction_id: alloc.payment_transaction_id,
                        obligation_id: newObligationId,
                        entity_type: voidedOblig.entity_type,
                        entity_id: voidedOblig.entity_id,
                        direction: voidedOblig.direction,
                        allocated_amount: amountToAllocate,
                        allocation_method: 'fifo',
                        status: 'active',
                        allocated_by: changedBy || null,
                        metadata: {
                            reallocatedFrom: voidedObligationId,
                            reallocatedFromAllocationId: alloc.id,
                        },
                    })
                    .select('*')
                    .single();

                if (insAllocError) {
                    throw ErrorHandler.handle(insAllocError, 'reallocatePaymentsAfterObligationVoid.insertNewAlloc');
                }
                // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                const newAllocId = (newAllocData as FinancialObligationRow & { id: string })?.id ?? '';

                // Increment allocated_amount on the new obligation
                const newAllocated = Number(newOblig.allocated_amount || 0) + amountToAllocate;
                const newStatus = newAllocated >= Number(newOblig.net_amount) ? 'paid' : 'partially_paid';

                const { error: incError } = await supabase
                    .from('financial_obligations')
                    .update({
                        allocated_amount: newAllocated,
                        status: newStatus,
                    })
                    .eq('id', newObligationId);

                if (incError) {
                    throw ErrorHandler.handle(incError, 'reallocatePaymentsAfterObligationVoid.incrementNewOblig');
                }

                // Create allocation event
                await supabase.from('allocation_events').insert({
                    event_type: 'allocation_created',
                    allocation_id: newAllocId,
                    transaction_id: alloc.payment_transaction_id,
                    obligation_id: newObligationId,
                    entity_type: voidedOblig.entity_type,
                    entity_id: voidedOblig.entity_id,
                    amount: amountToAllocate,
                    reason: 'reallocated after obligation void',
                    changed_by: changedBy || null,
                    metadata: {
                        voidedObligationId,
                        voidedAllocationId: alloc.id,
                    },
                });
            }
        }

        // D. Convert remaining excess to account credit
        if (excess > 0) {
            const { data: newCreditData, error: insCreditError } = await supabase
                .from('account_credits')
                .insert({
                    entity_type: voidedOblig.entity_type,
                    entity_id: voidedOblig.entity_id,
                    amount: excess,
                    remaining_amount: excess,
                    source: 'correction_excess',
                    source_transaction_id: alloc.payment_transaction_id,
                    source_allocation_id: alloc.id,
                    source_obligation_id: voidedObligationId,
                    status: 'active',
                    created_by: changedBy || null,
                    metadata: {
                        voidedObligationId,
                        newObligationId: newObligationId || null,
                    },
                })
                .select('*')
                .single();

            if (insCreditError) {
                throw ErrorHandler.handle(insCreditError, 'reallocatePaymentsAfterObligationVoid.insertCredit');
            }
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            const newCreditId = (newCreditData as FinancialObligationRow & { id: string })?.id ?? '';

            // Create credit creation event
            await supabase.from('allocation_events').insert({
                event_type: 'credit_created',
                credit_id: newCreditId,
                transaction_id: alloc.payment_transaction_id,
                obligation_id: voidedObligationId,
                entity_type: voidedOblig.entity_type,
                entity_id: voidedOblig.entity_id,
                amount: excess,
                reason: 'excess from voided obligation reallocation',
                changed_by: changedBy || null,
                metadata: {
                    voidedAllocationId: alloc.id,
                },
            });
        }
    }
}

