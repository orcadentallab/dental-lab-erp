import { supabase } from '../../lib/supabase';

export type ReconciliationFlagSeverity = 'warning' | 'error';
export type ReconciliationFlagStatus = 'open' | 'resolved';
// Mirrors BillingEntityType in src/constants/billingSettings.ts — a supplier is
// 'external_lab' throughout the financial schema.
export type ReconciliationEntityType = 'doctor' | 'external_lab' | 'designer';

export interface ReconciliationFlag {
    id: string;
    flagType: string;
    orderId: string | null;
    obligationId: string | null;
    entityType: ReconciliationEntityType | null;
    entityId: string | null;
    severity: ReconciliationFlagSeverity;
    message: string;
    metadata: Record<string, unknown>;
    status: ReconciliationFlagStatus;
    createdAt: string;
    resolvedAt: string | null;
    resolvedBy: string | null;
    resolutionNotes: string | null;
}

export interface DbReconciliationFlag {
    id: string;
    flag_type: string;
    order_id: string | null;
    obligation_id: string | null;
    entity_type: string | null;
    entity_id: string | null;
    severity: string;
    message: string;
    metadata: Record<string, unknown> | null;
    status: string;
    created_at: string;
    resolved_at: string | null;
    resolved_by: string | null;
    resolution_notes: string | null;
}

function mapDbToReconciliationFlag(row: DbReconciliationFlag): ReconciliationFlag {
    return {
        id: row.id,
        flagType: row.flag_type,
        orderId: row.order_id,
        obligationId: row.obligation_id,
        entityType: row.entity_type as ReconciliationEntityType | null,
        entityId: row.entity_id,
        severity: (row.severity as ReconciliationFlagSeverity) || 'error',
        message: row.message,
        metadata: row.metadata || {},
        status: (row.status as ReconciliationFlagStatus) || 'open',
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
        resolvedBy: row.resolved_by,
        resolutionNotes: row.resolution_notes,
    };
}

export interface FlagReconciliationIssueParams {
    flagType: string;
    orderId?: string | null;
    obligationId?: string | null;
    entityType?: ReconciliationEntityType | null;
    entityId?: string | null;
    severity?: ReconciliationFlagSeverity;
    message: string;
    metadata?: Record<string, unknown>;
}

export async function flagReconciliationIssue(params: FlagReconciliationIssueParams): Promise<ReconciliationFlag | null> {
    try {
        const { data, error } = await supabase
            .from('reconciliation_flags')
            .insert({
                flag_type: params.flagType,
                order_id: params.orderId || null,
                obligation_id: params.obligationId || null,
                entity_type: params.entityType || null,
                entity_id: params.entityId || null,
                severity: params.severity || 'error',
                message: params.message,
                metadata: params.metadata || {},
                status: 'open',
            })
            .select('*')
            .single();

        if (error) {
            console.error('Failed to insert reconciliation flag:', error);
            return null;
        }

        return data ? mapDbToReconciliationFlag(data) : null;
    } catch (err) {
        console.error('Error logging reconciliation flag:', err);
        return null;
    }
}

export async function listReconciliationFlags(statusFilter: 'open' | 'resolved' | 'all' = 'open'): Promise<ReconciliationFlag[]> {
    let query = supabase
        .from('reconciliation_flags')
        .select('*')
        .order('created_at', { ascending: false });

    if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;
    if (error) {
        console.error('Error fetching reconciliation flags:', error);
        throw error;
    }
    return (data || []).map(mapDbToReconciliationFlag);
}

export async function resolveReconciliationFlag(id: string, notes?: string, resolvedBy?: string | null): Promise<ReconciliationFlag> {
    const { data, error } = await supabase
        .from('reconciliation_flags')
        .update({
            status: 'resolved',
            resolved_at: new Date().toISOString(),
            resolved_by: resolvedBy || null,
            resolution_notes: notes || null,
        })
        .eq('id', id)
        .select('*')
        .single();

    if (error) {
        console.error('Error resolving reconciliation flag:', error);
        throw error;
    }
    return mapDbToReconciliationFlag(data);
}
