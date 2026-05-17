import {
    ALLOCATION_MODES,
    buildFifoAllocationPreview,
    validateAllocationPreviewParams,
    type AllocationPreviewObligation,
    type AllocationPreviewParams,
    type AllocationPreviewResult,
} from '../../constants/allocationEngine';
import {
    OBLIGATION_STATUSES,
    type ObligationDirection,
    type ObligationStatus,
    type ObligationTriggerType,
} from '../../constants/financialObligations';
import type { AllocationPreviewEntityType } from '../../constants/allocationEngine';
import { ErrorHandler, ValidationError } from '../../lib/errorHandler';

type FinancialObligationPreviewRow = {
    id: string;
    order_id: string;
    entity_type: AllocationPreviewEntityType;
    entity_id: string;
    direction: ObligationDirection;
    trigger_type: ObligationTriggerType;
    trigger_date: string;
    due_date: string;
    net_amount: number;
    allocated_amount: number;
    remaining_amount: number;
    status: ObligationStatus;
    created_at: string;
    orders?: {
        case_id: string | null;
        patient_name: string | null;
    } | null;
};

async function getSupabaseClient() {
    const { supabase } = await import('../../lib/supabase');
    return supabase;
}

function rowToPreviewObligation(row: FinancialObligationPreviewRow): AllocationPreviewObligation {
    return {
        id: row.id,
        orderId: row.order_id,
        caseId: row.orders?.case_id || null,
        patientName: row.orders?.patient_name || null,
        triggerType: row.trigger_type,
        dueDate: row.due_date,
        triggerDate: row.trigger_date,
        netAmount: row.net_amount,
        allocatedAmount: row.allocated_amount,
        remainingAmount: row.remaining_amount,
        status: row.status,
        createdAt: row.created_at,
    };
}

export async function previewPaymentAllocation(params: AllocationPreviewParams): Promise<AllocationPreviewResult> {
    try {
        validateAllocationPreviewParams(params);
    } catch (error: unknown) {
        throw new ValidationError(error instanceof Error ? error.message : 'Invalid allocation preview input');
    }

    const supabase = await getSupabaseClient();
    const includeNotDue = params.includeNotDue ?? true;
    const paymentDate = (params.paymentDate || new Date().toISOString()).split('T')[0];

    let query = supabase
        .from('financial_obligations')
        .select('id, order_id, entity_type, entity_id, direction, trigger_type, trigger_date, due_date, net_amount, allocated_amount, remaining_amount, status, created_at, orders(case_id, patient_name)')
        .eq('entity_type', params.entityType)
        .eq('entity_id', params.entityId)
        .eq('direction', params.direction)
        .in('status', [OBLIGATION_STATUSES.unpaid, OBLIGATION_STATUSES.partiallyPaid])
        .gt('remaining_amount', 0)
        .order('due_date', { ascending: true })
        .order('trigger_date', { ascending: true })
        .order('created_at', { ascending: true });

    if (!includeNotDue) {
        query = query.lte('due_date', paymentDate);
    }

    const { data, error } = await query;

    if (error) {
        throw ErrorHandler.handle(error, 'previewPaymentAllocation');
    }

    return buildFifoAllocationPreview(
        {
            ...params,
            mode: params.mode || ALLOCATION_MODES.fifo,
            includeNotDue,
        },
        (((data || []) as unknown) as FinancialObligationPreviewRow[]).map(rowToPreviewObligation)
    );
}
