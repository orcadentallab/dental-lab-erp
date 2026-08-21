/**
 * Production: the stage catalogue, the per-service route maps, the live
 * queues, and the two taps that move a case.
 *
 * Backed by 20260821001000 / 002000 / 006000. Every state change goes through
 * an RPC rather than a direct write, so the guards (idempotency, cause codes,
 * automatic advance, duration stamping) can never be bypassed by the UI.
 */
import { supabase } from '../../lib/supabase';
import { ErrorHandler } from '../../lib/errorHandler';

export type StageScope = 'global' | 'optional';
export type Execution = 'internal' | 'external';
export type AdvanceMode = 'auto' | 'manual' | 'qc_gate';
export type RouteStageMode = 'included' | 'excluded' | 'override';
export type BlockReason = 'machine_down' | 'material_out' | 'waiting_doctor' | 'other';

export type StageRunStatus =
    | 'pending' | 'ready' | 'in_progress' | 'waiting_external'
    | 'done' | 'failed' | 'skipped';

export interface ProductionStage {
    id: string;
    code: string;
    nameAr: string;
    sequence: number;
    scope: StageScope;
    defaultExecution: Execution;
    isQcGate: boolean;
    isBatchStage: boolean;
    defaultCondition: Record<string, unknown> | null;
    requiredFields: string[];
    isActive: boolean;
}

export interface ProductionRoute {
    id: string;
    nameAr: string;
    isFallback: boolean;
    ignoresGlobalStages: boolean;
    notes?: string | null;
    isActive: boolean;
}

/** One row of the effective chain, as get_effective_route_stages returns it. */
export interface EffectiveRouteStage {
    seq: number;
    stageId: string;
    stageCode: string;
    nameAr: string;
    execution: Execution;
    supplierId: string | null;
    isQcGate: boolean;
    isBatchStage: boolean;
    parallelGroup: number | null;
    advanceMode: AdvanceMode;
    onFailGotoStageId: string | null;
    standardMinutesPerUnit: number | null;
    standardCostPerUnit: number | null;
    requiredFields: string[];
    /** Non-null means the stage only applies to matching orders. */
    appliesWhen: Record<string, unknown> | null;
}

export interface RouteStageRule {
    id: string;
    routeId: string;
    stageId: string;
    mode: RouteStageMode;
    seqOverride: number | null;
    executionOverride: Execution | null;
    supplierOverride: string | null;
    advanceMode: AdvanceMode | null;
    onFailGotoStageId: string | null;
    condition: Record<string, unknown> | null;
}

/** A case sitting in a stage queue, with everything the card needs. */
export interface StageRunCard {
    id: string;
    jobId: string;
    orderId: string;
    caseId: string;
    doctorName: string;
    patientName: string;
    shade: string | null;
    instructions: string | null;
    designUrl: string | null;
    stlUrl: string | null;
    imagesUrl: string | null;
    deliveryDate: string | null;
    priority: string;
    stageId: string;
    stageCode: string;
    stageNameAr: string;
    seq: number;
    execution: Execution;
    advanceMode: AdvanceMode;
    status: StageRunStatus;
    blockedReason: BlockReason | null;
    queuedAt: string | null;
    startedAt: string | null;
    unitsIn: number;
    assigneeId: string | null;
    assigneeName: string | null;
    supplierId: string | null;
    supplierName: string | null;
    isRework: boolean;
    teeth: string[];
    services: string[];
}

// ─── Catalogue and routes ────────────────────────────────────────────────

export async function getStages(): Promise<ProductionStage[]> {
    const { data, error } = await supabase
        .from('production_stages')
        .select('*')
        .eq('is_active', true)
        .order('sequence', { ascending: true });

    if (error) throw ErrorHandler.handle(error, 'getStages');

    return (data || []).map((r) => ({
        id: r.id as string,
        code: r.code as string,
        nameAr: r.name_ar as string,
        sequence: r.sequence as number,
        scope: r.scope as StageScope,
        defaultExecution: r.default_execution as Execution,
        isQcGate: r.is_qc_gate as boolean,
        isBatchStage: r.is_batch_stage as boolean,
        defaultCondition: (r.default_condition as Record<string, unknown>) ?? null,
        requiredFields: (r.required_fields as string[]) ?? [],
        isActive: r.is_active as boolean,
    }));
}

export async function getRoutes(): Promise<ProductionRoute[]> {
    const { data, error } = await supabase
        .from('production_routes')
        .select('*')
        .eq('is_active', true)
        .order('is_fallback', { ascending: true })
        .order('name_ar', { ascending: true });

    if (error) throw ErrorHandler.handle(error, 'getRoutes');

    return (data || []).map((r) => ({
        id: r.id as string,
        nameAr: r.name_ar as string,
        isFallback: r.is_fallback as boolean,
        ignoresGlobalStages: r.ignores_global_stages as boolean,
        notes: (r.notes as string) ?? null,
        isActive: r.is_active as boolean,
    }));
}

export async function createRoute(nameAr: string, notes?: string): Promise<string> {
    const { data, error } = await supabase
        .from('production_routes')
        .insert({ name_ar: nameAr, notes: notes ?? null })
        .select('id')
        .single();

    if (error) throw ErrorHandler.handle(error, 'createRoute');
    return data.id as string;
}

export async function getRouteRules(routeId: string): Promise<RouteStageRule[]> {
    const { data, error } = await supabase
        .from('production_route_stages')
        .select('*')
        .eq('route_id', routeId);

    if (error) throw ErrorHandler.handle(error, 'getRouteRules');

    return (data || []).map((r) => ({
        id: r.id as string,
        routeId: r.route_id as string,
        stageId: r.stage_id as string,
        mode: r.mode as RouteStageMode,
        seqOverride: (r.seq_override as number) ?? null,
        executionOverride: (r.execution_override as Execution) ?? null,
        supplierOverride: (r.supplier_override as string) ?? null,
        advanceMode: (r.advance_mode as AdvanceMode) ?? null,
        onFailGotoStageId: (r.on_fail_goto_stage_id as string) ?? null,
        condition: (r.condition as Record<string, unknown>) ?? null,
    }));
}

/**
 * The live preview of what a case on this route will actually walk. The same
 * function the job materialiser uses, so the editor can never show a chain
 * that differs from the one production will build.
 */
export async function getEffectiveRouteStages(
    routeId: string,
    context: Record<string, unknown> = {},
): Promise<EffectiveRouteStage[]> {
    const { data, error } = await supabase.rpc('get_effective_route_stages', {
        p_route_id: routeId,
        p_context: context,
    });

    if (error) throw ErrorHandler.handle(error, 'getEffectiveRouteStages');

    return ((data || []) as Record<string, unknown>[]).map((r) => ({
        seq: r.seq as number,
        stageId: r.stage_id as string,
        stageCode: r.stage_code as string,
        nameAr: r.name_ar as string,
        execution: r.execution as Execution,
        supplierId: (r.supplier_id as string) ?? null,
        isQcGate: r.is_qc_gate as boolean,
        isBatchStage: r.is_batch_stage as boolean,
        parallelGroup: (r.parallel_group as number) ?? null,
        advanceMode: r.advance_mode as AdvanceMode,
        onFailGotoStageId: (r.on_fail_goto_stage_id as string) ?? null,
        standardMinutesPerUnit: (r.standard_minutes_per_unit as number) ?? null,
        standardCostPerUnit: (r.standard_cost_per_unit as number) ?? null,
        requiredFields: (r.required_fields as string[]) ?? [],
        appliesWhen: (r.applies_when as Record<string, unknown>) ?? null,
    }));
}

/**
 * Records one exception on a route. `included`/`excluded` toggle membership,
 * `override` keeps membership and changes how the stage behaves here.
 */
export async function setRouteStageRule(
    routeId: string,
    stageId: string,
    patch: Partial<Omit<RouteStageRule, 'id' | 'routeId' | 'stageId'>> & { mode: RouteStageMode },
): Promise<void> {
    const { error } = await supabase.from('production_route_stages').upsert(
        {
            route_id: routeId,
            stage_id: stageId,
            mode: patch.mode,
            seq_override: patch.seqOverride ?? null,
            execution_override: patch.executionOverride ?? null,
            supplier_override: patch.supplierOverride ?? null,
            advance_mode: patch.advanceMode ?? null,
            on_fail_goto_stage_id: patch.onFailGotoStageId ?? null,
            condition: patch.condition ?? null,
        },
        { onConflict: 'route_id,stage_id' },
    );
    if (error) throw ErrorHandler.handle(error, 'setRouteStageRule');
}

/** Removing the rule returns the stage to whatever the catalogue says. */
export async function clearRouteStageRule(routeId: string, stageId: string): Promise<void> {
    const { error } = await supabase
        .from('production_route_stages')
        .delete()
        .eq('route_id', routeId)
        .eq('stage_id', stageId);
    if (error) throw ErrorHandler.handle(error, 'clearRouteStageRule');
}

export async function setServiceRoute(serviceId: string, routeId: string | null): Promise<void> {
    const { error } = await supabase
        .from('services')
        .update({ route_id: routeId })
        .eq('id', serviceId);
    if (error) throw ErrorHandler.handle(error, 'setServiceRoute');
}

// ─── Live queues ─────────────────────────────────────────────────────────

const RUN_CARD_SELECT = `
    id, job_id, stage_id, seq, execution, advance_mode, status, blocked_reason,
    queued_at, started_at, units_in, assignee_id, supplier_id, rework_of,
    production_stages ( code, name_ar ),
    users:assignee_id ( name ),
    suppliers:supplier_id ( name ),
    production_jobs (
        order_id, priority, due_at,
        orders (
            case_id, patient_name, shade, instructions, design_url, stl_url,
            images_url, delivery_date,
            doctors ( name ),
            order_items ( product_type, teeth_numbers )
        )
    )
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function toCard(r: any): StageRunCard {
    const job = r.production_jobs || {};
    const order = job.orders || {};
    const items = (order.order_items || []) as { product_type: string; teeth_numbers: unknown }[];

    return {
        id: r.id,
        jobId: r.job_id,
        orderId: job.order_id,
        caseId: order.case_id ?? '—',
        doctorName: order.doctors?.name ?? '—',
        patientName: order.patient_name ?? '—',
        shade: order.shade ?? null,
        instructions: order.instructions ?? null,
        designUrl: order.design_url ?? null,
        stlUrl: order.stl_url ?? null,
        imagesUrl: order.images_url ?? null,
        deliveryDate: order.delivery_date ?? null,
        priority: job.priority ?? 'Normal',
        stageId: r.stage_id,
        stageCode: r.production_stages?.code ?? '',
        stageNameAr: r.production_stages?.name_ar ?? '',
        seq: r.seq,
        execution: r.execution,
        advanceMode: r.advance_mode,
        status: r.status,
        blockedReason: r.blocked_reason ?? null,
        queuedAt: r.queued_at ?? null,
        startedAt: r.started_at ?? null,
        unitsIn: r.units_in ?? 0,
        assigneeId: r.assignee_id ?? null,
        assigneeName: r.users?.name ?? null,
        supplierId: r.supplier_id ?? null,
        supplierName: r.suppliers?.name ?? null,
        isRework: Boolean(r.rework_of),
        teeth: items.flatMap((i) =>
            Array.isArray(i.teeth_numbers) ? (i.teeth_numbers as string[]) : []),
        services: items.map((i) => i.product_type).filter(Boolean),
    };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Everything currently on the floor, for the board. */
export async function getOpenStageRuns(): Promise<StageRunCard[]> {
    const { data, error } = await supabase
        .from('production_stage_runs')
        .select(RUN_CARD_SELECT)
        .in('status', ['ready', 'in_progress', 'waiting_external'])
        .order('seq', { ascending: true })
        .order('queued_at', { ascending: true });

    if (error) throw ErrorHandler.handle(error, 'getOpenStageRuns');
    return (data || []).map(toCard);
}

/**
 * The technician's queue. Pull, not push: deliberately NOT filtered by
 * assignee, because anyone qualified may take the next case. Work already in
 * this user's hands floats to the top so they finish it before starting more.
 *
 * The ordering IS the anti-cherry-picking rule (plan 7.6.1): urgent, then
 * nearest promise, then longest waiting. The UI marks the first card as the
 * recommended one.
 */
export async function getMyTasks(userId: string): Promise<StageRunCard[]> {
    const runs = await getOpenStageRuns();
    return runs
        .filter((r) => r.execution === 'internal')
        .sort((a, b) => {
            const mine = (r: StageRunCard) =>
                r.status === 'in_progress' && r.assigneeId === userId ? 0 : 1;
            if (mine(a) !== mine(b)) return mine(a) - mine(b);

            const urgent = (r: StageRunCard) => (r.priority === 'Urgent' ? 0 : 1);
            if (urgent(a) !== urgent(b)) return urgent(a) - urgent(b);

            const due = (r: StageRunCard) => r.deliveryDate ?? '9999-12-31';
            if (due(a) !== due(b)) return due(a) < due(b) ? -1 : 1;

            return (a.queuedAt ?? '') < (b.queuedAt ?? '') ? -1 : 1;
        });
}

// ─── The two taps ────────────────────────────────────────────────────────

export async function startStageRun(runId: string, machineId?: string) {
    const { data, error } = await supabase.rpc('start_stage_run', {
        p_run_id: runId,
        p_machine_id: machineId ?? null,
    });
    if (error) throw ErrorHandler.handle(error, 'startStageRun');
    return data;
}

export async function completeStageRun(
    runId: string,
    opts: {
        unitsPassed?: number;
        unitsFailed?: number;
        causeCode?: string;
        notes?: string;
        batchGroupId?: string;
    } = {},
) {
    const { data, error } = await supabase.rpc('complete_stage_run', {
        p_run_id: runId,
        p_units_passed: opts.unitsPassed ?? null,
        p_units_failed: opts.unitsFailed ?? 0,
        p_cause_code: opts.causeCode ?? null,
        p_notes: opts.notes ?? null,
        p_batch_group: opts.batchGroupId ?? null,
    });
    if (error) throw ErrorHandler.handle(error, 'completeStageRun');
    return data;
}

export async function blockStageRun(runId: string, reason: BlockReason, notes?: string) {
    const { data, error } = await supabase.rpc('block_stage_run', {
        p_run_id: runId,
        p_reason: reason,
        p_notes: notes ?? null,
    });
    if (error) throw ErrorHandler.handle(error, 'blockStageRun');
    return data;
}

export async function materializeJob(orderId: string, routeId?: string): Promise<string> {
    const { data, error } = await supabase.rpc('materialize_job_from_route', {
        p_order_id: orderId,
        p_route_id: routeId ?? null,
    });
    if (error) throw ErrorHandler.handle(error, 'materializeJob');
    return data as string;
}

// ─── External work orders ────────────────────────────────────────────────

export interface ExternalWorkOrderRow {
    id: string;
    stageRunId: string;
    supplierId: string;
    supplierName: string;
    caseId: string;
    doctorName: string;
    stageNameAr: string;
    units: number;
    sentAt: string | null;
    expectedReturnAt: string | null;
    returnedAt: string | null;
    agreedCost: number | null;
    invoiceRef: string | null;
    status: string;
}

export async function getExternalWorkOrders(onlyOpen = true): Promise<ExternalWorkOrderRow[]> {
    let query = supabase
        .from('external_work_orders')
        .select(`
            id, stage_run_id, supplier_id, units, sent_at, expected_return_at,
            returned_at, agreed_cost, invoice_ref, status,
            suppliers ( name ),
            production_stage_runs (
                production_stages ( name_ar ),
                production_jobs ( orders ( case_id, doctors ( name ) ) )
            )
        `)
        .order('sent_at', { ascending: false });

    if (onlyOpen) query = query.eq('status', 'sent');

    const { data, error } = await query;
    if (error) throw ErrorHandler.handle(error, 'getExternalWorkOrders');

    /* eslint-disable @typescript-eslint/no-explicit-any */
    return ((data || []) as any[]).map((r) => ({
        id: r.id,
        stageRunId: r.stage_run_id,
        supplierId: r.supplier_id,
        supplierName: r.suppliers?.name ?? '—',
        caseId: r.production_stage_runs?.production_jobs?.orders?.case_id ?? '—',
        doctorName: r.production_stage_runs?.production_jobs?.orders?.doctors?.name ?? '—',
        stageNameAr: r.production_stage_runs?.production_stages?.name_ar ?? '—',
        units: r.units,
        sentAt: r.sent_at,
        expectedReturnAt: r.expected_return_at,
        returnedAt: r.returned_at,
        agreedCost: r.agreed_cost,
        invoiceRef: r.invoice_ref,
        status: r.status,
    }));
    /* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function sendExternalWorkOrder(
    runId: string,
    opts: { supplierId?: string; expectedReturnAt?: string; agreedCost?: number; notes?: string } = {},
): Promise<string> {
    const { data, error } = await supabase.rpc('send_external_work_order', {
        p_run_id: runId,
        p_supplier_id: opts.supplierId ?? null,
        p_expected: opts.expectedReturnAt ?? null,
        p_agreed_cost: opts.agreedCost ?? null,
        p_notes: opts.notes ?? null,
    });
    if (error) throw ErrorHandler.handle(error, 'sendExternalWorkOrder');
    return data as string;
}

export async function receiveExternalWorkOrder(
    workOrderId: string,
    opts: { returnedAt?: string; agreedCost?: number; invoiceRef?: string; unitsOk?: number } = {},
) {
    const { data, error } = await supabase.rpc('receive_external_work_order', {
        p_wo_id: workOrderId,
        p_returned_at: opts.returnedAt ?? null,
        p_agreed_cost: opts.agreedCost ?? null,
        p_invoice_ref: opts.invoiceRef ?? null,
        p_units_ok: opts.unitsOk ?? null,
    });
    if (error) throw ErrorHandler.handle(error, 'receiveExternalWorkOrder');
    return data;
}

// ─── Shadow readiness ────────────────────────────────────────────────────

export interface ShadowRow {
    orderId: string;
    caseId: string;
    actualStatus: string | null;
    computedStatus: string | null;
    agrees: boolean;
}

export async function getShadowReport(): Promise<ShadowRow[]> {
    const { data, error } = await supabase.rpc('get_production_shadow_report');
    if (error) throw ErrorHandler.handle(error, 'getShadowReport');

    /* eslint-disable @typescript-eslint/no-explicit-any */
    return ((data || []) as any[]).map((r) => ({
        orderId: r.order_id,
        caseId: r.case_id,
        actualStatus: r.actual_status,
        computedStatus: r.computed_status,
        agrees: r.agrees,
    }));
    /* eslint-enable @typescript-eslint/no-explicit-any */
}
