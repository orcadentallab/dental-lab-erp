import { supabase } from '../../lib/supabase';
import { ErrorHandler } from '../../lib/errorHandler';

export type MachineStatus = 'running' | 'down' | 'maintenance' | 'retired';
export type DowntimeReason = 'breakdown' | 'maintenance' | 'power' | 'other';

export interface Machine {
    id: string;
    code: string;
    nameAr: string;
    stageId: string | null;
    stageNameAr?: string | null;
    stageCode?: string | null;
    fixedAssetId: string | null;
    status: MachineStatus;
    capacityUnitsPerRun: number | null;
    purchaseDate: string | null;
    warrantyUntil: string | null;
    notes: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface MachineDowntime {
    id: string;
    machineId: string;
    machineNameAr?: string;
    machineCode?: string;
    startedAt: string;
    endedAt: string | null;
    reason: DowntimeReason;
    notes: string | null;
    reportedBy: string | null;
    costAmount: number | null;
    createdAt: string;
    updatedAt: string;
}

export const DOWNTIME_REASONS: { code: DowntimeReason; label: string }[] = [
    { code: 'breakdown', label: 'عطل فني مفاجئ' },
    { code: 'maintenance', label: 'صيانة دورية / وقائية' },
    { code: 'power', label: 'انقطاع كهرباء / طاقة' },
    { code: 'other', label: 'أخرى' },
];

export async function getMachines(): Promise<Machine[]> {
    const { data, error } = await supabase
        .from('machines')
        .select(`
            id, code, name_ar, stage_id, fixed_asset_id, status,
            capacity_units_per_run, purchase_date, warranty_until, notes,
            is_active, created_at, updated_at,
            production_stages:stage_id ( id, code, name_ar )
        `)
        .eq('is_active', true)
        .order('name_ar');

    if (error) throw ErrorHandler.handle(error, 'getMachines');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data || []).map((r: any) => ({
        id: r.id,
        code: r.code,
        nameAr: r.name_ar,
        stageId: r.stage_id,
        stageNameAr: r.production_stages?.name_ar ?? null,
        stageCode: r.production_stages?.code ?? null,
        fixedAssetId: r.fixed_asset_id,
        status: r.status as MachineStatus,
        capacityUnitsPerRun: r.capacity_units_per_run,
        purchaseDate: r.purchase_date,
        warrantyUntil: r.warranty_until,
        notes: r.notes,
        isActive: r.is_active,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    }));
}

export async function createMachine(input: {
    code: string;
    nameAr: string;
    stageId?: string | null;
    capacityUnitsPerRun?: number | null;
    purchaseDate?: string | null;
    warrantyUntil?: string | null;
    notes?: string | null;
}): Promise<Machine> {
    const { data, error } = await supabase
        .from('machines')
        .insert({
            code: input.code.trim().toUpperCase(),
            name_ar: input.nameAr.trim(),
            stage_id: input.stageId || null,
            capacity_units_per_run: input.capacityUnitsPerRun || null,
            purchase_date: input.purchaseDate || null,
            warranty_until: input.warrantyUntil || null,
            notes: input.notes?.trim() || null,
            status: 'running',
            is_active: true,
        })
        .select(`
            id, code, name_ar, stage_id, fixed_asset_id, status,
            capacity_units_per_run, purchase_date, warranty_until, notes,
            is_active, created_at, updated_at,
            production_stages:stage_id ( id, code, name_ar )
        `)
        .single();

    if (error) throw ErrorHandler.handle(error, 'createMachine');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = data as any;
    return {
        id: r.id,
        code: r.code,
        nameAr: r.name_ar,
        stageId: r.stage_id,
        stageNameAr: r.production_stages?.name_ar ?? null,
        stageCode: r.production_stages?.code ?? null,
        fixedAssetId: r.fixed_asset_id,
        status: r.status as MachineStatus,
        capacityUnitsPerRun: r.capacity_units_per_run,
        purchaseDate: r.purchase_date,
        warrantyUntil: r.warranty_until,
        notes: r.notes,
        isActive: r.is_active,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

export async function updateMachine(
    id: string,
    updates: Partial<{
        code: string;
        nameAr: string;
        stageId: string | null;
        status: MachineStatus;
        capacityUnitsPerRun: number | null;
        purchaseDate: string | null;
        warrantyUntil: string | null;
        notes: string | null;
        isActive: boolean;
    }>
): Promise<void> {
    const dbPayload: Record<string, unknown> = {};
    if (updates.code !== undefined) dbPayload.code = updates.code.trim().toUpperCase();
    if (updates.nameAr !== undefined) dbPayload.name_ar = updates.nameAr.trim();
    if (updates.stageId !== undefined) dbPayload.stage_id = updates.stageId || null;
    if (updates.status !== undefined) dbPayload.status = updates.status;
    if (updates.capacityUnitsPerRun !== undefined) dbPayload.capacity_units_per_run = updates.capacityUnitsPerRun || null;
    if (updates.purchaseDate !== undefined) dbPayload.purchase_date = updates.purchaseDate || null;
    if (updates.warrantyUntil !== undefined) dbPayload.warranty_until = updates.warrantyUntil || null;
    if (updates.notes !== undefined) dbPayload.notes = updates.notes?.trim() || null;
    if (updates.isActive !== undefined) dbPayload.is_active = updates.isActive;

    const { error } = await supabase.from('machines').update(dbPayload).eq('id', id);
    if (error) throw ErrorHandler.handle(error, 'updateMachine');
}

export async function deleteMachine(id: string): Promise<void> {
    // Soft-delete to preserve references from past runs
    const { error } = await supabase
        .from('machines')
        .update({ is_active: false, status: 'retired' })
        .eq('id', id);

    if (error) throw ErrorHandler.handle(error, 'deleteMachine');
}

export async function getMachineDowntime(machineId?: string): Promise<MachineDowntime[]> {
    let query = supabase
        .from('machine_downtime')
        .select(`
            id, machine_id, started_at, ended_at, reason, notes,
            reported_by, cost_amount, created_at, updated_at,
            machines:machine_id ( code, name_ar )
        `)
        .order('started_at', { ascending: false });

    if (machineId) {
        query = query.eq('machine_id', machineId);
    }

    const { data, error } = await query;
    if (error) throw ErrorHandler.handle(error, 'getMachineDowntime');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data || []).map((r: any) => ({
        id: r.id,
        machineId: r.machine_id,
        machineNameAr: r.machines?.name_ar,
        machineCode: r.machines?.code,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        reason: r.reason as DowntimeReason,
        notes: r.notes,
        reportedBy: r.reported_by,
        costAmount: r.cost_amount,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    }));
}

/** Record a machine down event and update machine status to 'down' */
export async function reportMachineDown(
    machineId: string,
    reason: DowntimeReason,
    notes?: string,
    costAmount?: number
): Promise<void> {
    const { error: dtError } = await supabase.from('machine_downtime').insert({
        machine_id: machineId,
        started_at: new Date().toISOString(),
        ended_at: null,
        reason,
        notes: notes?.trim() || null,
        cost_amount: costAmount || null,
    });

    if (dtError) throw ErrorHandler.handle(dtError, 'reportMachineDown:downtime');

    const { error: mError } = await supabase
        .from('machines')
        .update({ status: 'down' })
        .eq('id', machineId);

    if (mError) throw ErrorHandler.handle(mError, 'reportMachineDown:machine');
}

/** Close active downtime for a machine and restore machine status to 'running' */
export async function restoreMachine(machineId: string): Promise<void> {
    const now = new Date().toISOString();

    const { error: dtError } = await supabase
        .from('machine_downtime')
        .update({ ended_at: now })
        .eq('machine_id', machineId)
        .is('ended_at', null);

    if (dtError) throw ErrorHandler.handle(dtError, 'restoreMachine:downtime');

    const { error: mError } = await supabase
        .from('machines')
        .update({ status: 'running' })
        .eq('id', machineId);

    if (mError) throw ErrorHandler.handle(mError, 'restoreMachine:machine');
}
