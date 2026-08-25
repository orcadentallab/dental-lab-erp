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
export type BlockReason = 'machine_down' | 'material_out' | 'waiting_doctor' | 'other';

export type StageRunStatus =
    | 'pending' | 'ready' | 'in_progress' | 'waiting_external'
    | 'done' | 'failed' | 'skipped';

/**
 * The one screen that advances a stage. Plan rule 4: a stage movable from two
 * places is a stage counted twice.
 */
export type DrivenBy = 'my_tasks' | 'designer_dashboard' | 'external_wo';

export interface ProductionStage {
    id: string;
    code: string;
    nameAr: string;
    /** One line explaining what physically happens, shown in the editor. */
    descriptionAr: string | null;
    sequence: number;
    scope: StageScope;
    defaultExecution: Execution;
    drivenBy: DrivenBy;
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
    /** Already resolved: the route's own name if it set one, else the catalogue's. */
    nameAr: string;
    /** The raw override, so the editor can show an empty box instead of the default. */
    nameOverride: string | null;
    /** What this pass is for — "واكس" / "بروفة" / "كاست". Same printer, different resin. */
    variantLabel: string | null;
    /** Job types allowed to work this step. Empty means anyone on production. */
    allowedRoles: string[];
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

/**
 * One step of a route, as the editor holds it.
 *
 * A route IS its ordered step list (20260823002000), and a stage may appear on
 * it more than once -- the try-in visits QC, packaging and shipping twice. So
 * the editor's unit of work is a step, not a stage: `key` identifies the row in
 * the list, `stageId` says which stage it performs, and position comes from
 * array order alone. Nothing here carries a step number, because a number the
 * user has to keep consistent is a number that will drift.
 */
export interface RouteStep {
    /** Stable only within one editing session; the saved list is positional. */
    key: string;
    stageId: string;
    /** This route's own name for the step. Null shows the catalogue name. */
    nameOverride: string | null;
    /** "واكس" / "بروفة" / "كاست" — printed on the technician's card. */
    variantLabel: string | null;
    /** Job types allowed to work it. Empty means anyone on production. */
    allowedRoles: string[];
    /** The step applies only to orders matching this, by JSONB containment. */
    condition: Record<string, unknown> | null;
    executionOverride: Execution | null;
    supplierOverride: string | null;
    advanceMode: AdvanceMode | null;
    onFailGotoStageId: string | null;
    parallelGroup: number | null;
    standardMinutesPerUnit: number | null;
    standardCostPerUnit: number | null;
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
    /** The route's name for this step if it set one, else the catalogue's. */
    stageNameAr: string;
    /**
     * Which pass of the stage this is — "واكس" / "كاست". Frozen from the route
     * at materialisation so the technician loads the right resin.
     */
    variantLabel: string | null;
    /** Frozen from the route step. Empty means anyone on production. */
    allowedRoles: string[];
    /** The screen that may advance this run. */
    drivenBy: DrivenBy;
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
        descriptionAr: (r.description_ar as string) ?? null,
        sequence: r.sequence as number,
        scope: r.scope as StageScope,
        defaultExecution: r.default_execution as Execution,
        drivenBy: (r.driven_by as DrivenBy) ?? 'my_tasks',
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

export async function renameRoute(routeId: string, nameAr: string, notes?: string | null): Promise<void> {
    const { error } = await supabase
        .from('production_routes')
        .update({ name_ar: nameAr, ...(notes === undefined ? {} : { notes }) })
        .eq('id', routeId);

    if (error) throw ErrorHandler.handle(error, 'renameRoute');
}

/**
 * Adds a stage to the catalogue. The code is generated server-side rather than
 * typed: a hand-picked code colliding with RESPONSIBLE_STAGE in
 * src/constants/issueCauses.ts would silently attach historical issue records
 * to a stage created this morning.
 */
export async function createStage(input: {
    nameAr: string;
    descriptionAr?: string | null;
    execution?: Execution;
    drivenBy?: DrivenBy;
    isQcGate?: boolean;
    isBatchStage?: boolean;
}): Promise<string> {
    const { data, error } = await supabase.rpc('create_production_stage', {
        p_name_ar: input.nameAr,
        p_description_ar: input.descriptionAr ?? null,
        p_execution: input.execution ?? 'internal',
        p_driven_by: input.drivenBy ?? 'my_tasks',
        p_is_qc_gate: input.isQcGate ?? false,
        p_is_batch_stage: input.isBatchStage ?? false,
    });

    if (error) throw ErrorHandler.handle(error, 'createStage');
    return data as string;
}

/**
 * The route's step list, in order, for the editor to hold and rewrite.
 *
 * Only 'included' rows are steps. 'excluded' and 'override' rows are leftovers
 * of the composition model that preceded 20260823002000; none exist in
 * production, and `legacyRuleCount` says so out loud rather than letting a save
 * drop rows the editor never showed.
 */
export async function getRouteSteps(
    routeId: string,
): Promise<{ steps: RouteStep[]; legacyRuleCount: number }> {
    const { data, error } = await supabase
        .from('production_route_stages')
        .select('*')
        .eq('route_id', routeId)
        .order('step_no', { ascending: true, nullsFirst: false });

    if (error) throw ErrorHandler.handle(error, 'getRouteSteps');

    const rows = data || [];

    return {
        steps: rows
            .filter((r) => r.mode === 'included')
            .map((r) => ({
                key: r.id as string,
                stageId: r.stage_id as string,
                nameOverride: (r.name_override as string) ?? null,
                variantLabel: (r.variant_label as string) ?? null,
                allowedRoles: (r.allowed_roles as string[]) ?? [],
                condition: (r.condition as Record<string, unknown>) ?? null,
                executionOverride: (r.execution_override as Execution) ?? null,
                supplierOverride: (r.supplier_override as string) ?? null,
                advanceMode: (r.advance_mode as AdvanceMode) ?? null,
                onFailGotoStageId: (r.on_fail_goto_stage_id as string) ?? null,
                parallelGroup: (r.parallel_group as number) ?? null,
                standardMinutesPerUnit: (r.standard_minutes_per_unit as number) ?? null,
                standardCostPerUnit: (r.standard_cost_per_unit as number) ?? null,
            })),
        legacyRuleCount: rows.filter((r) => r.mode !== 'included').length,
    };
}

/**
 * Writes the whole list in one transaction, positions taken from array order.
 *
 * Not a row-by-row save: UNIQUE(route_id, step_no) is not deferrable, so
 * reordering from the client would have to pass through colliding positions,
 * and a route left half-written builds the wrong chain for every case started
 * afterwards. The RPC also refuses an empty list -- a route with no steps
 * silently falls back to the entire global chain.
 */
export async function saveRouteSteps(routeId: string, steps: RouteStep[]): Promise<number> {
    const { data, error } = await supabase.rpc('save_route_steps', {
        p_route_id: routeId,
        p_steps: steps.map((s) => ({
            stage_id: s.stageId,
            name_override: s.nameOverride,
            variant_label: s.variantLabel,
            allowed_roles: s.allowedRoles,
            condition: s.condition,
            execution: s.executionOverride,
            supplier_id: s.supplierOverride,
            advance_mode: s.advanceMode,
            on_fail_goto_stage_id: s.onFailGotoStageId,
            parallel_group: s.parallelGroup,
            standard_minutes_per_unit: s.standardMinutesPerUnit,
            standard_cost_per_unit: s.standardCostPerUnit,
        })),
    });

    if (error) throw ErrorHandler.handle(error, 'saveRouteSteps');
    return data as number;
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
        nameOverride: (r.name_override as string) ?? null,
        variantLabel: (r.variant_label as string) ?? null,
        allowedRoles: (r.allowed_roles as string[]) ?? [],
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

export interface ServiceRouteLink {
    id: string;
    name: string;
    routeId: string | null;
    familyId: string | null;
    familyName: string | null;
    familyRouteId: string | null;
}

/** Every service and which route it is mapped to, for the linking panel. */
export async function getServicesForRouting(): Promise<ServiceRouteLink[]> {
    const { data, error } = await supabase
        .from('services')
        .select(`
            id,
            name,
            route_id,
            family_id,
            service_families:family_id (
                id,
                name_ar,
                default_route_id
            )
        `)
        .order('name', { ascending: true });

    if (error) throw ErrorHandler.handle(error, 'getServicesForRouting');

    interface ServiceRoutingRow {
        id: string;
        name: string;
        route_id: string | null;
        family_id: string | null;
        service_families: {
            id: string;
            name_ar: string;
            default_route_id: string | null;
        } | null;
    }

    const rows = (data || []) as unknown as ServiceRoutingRow[];
    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        routeId: r.route_id ?? null,
        familyId: r.family_id ?? null,
        familyName: r.service_families ? r.service_families.name_ar : null,
        familyRouteId: r.service_families ? (r.service_families.default_route_id ?? null) : null,
    }));
}

export async function setServiceRoute(serviceId: string, routeId: string | null): Promise<void> {
    const { error } = await supabase
        .from('services')
        .update({ route_id: routeId })
        .eq('id', serviceId);
    if (error) throw ErrorHandler.handle(error, 'setServiceRoute');
}

export async function setFamilyRoute(familyId: string, routeId: string | null): Promise<void> {
    const { error } = await supabase
        .from('service_families')
        .update({ default_route_id: routeId })
        .eq('id', familyId);
    if (error) throw ErrorHandler.handle(error, 'setFamilyRoute');
}

// ─── Live queues ─────────────────────────────────────────────────────────

/**
 * production_stage_runs has TWO foreign keys into production_stages --
 * stage_id and on_fail_goto_stage_id -- so the embed must name the column it
 * means. Left implicit, PostgREST refuses the whole query with "more than one
 * relationship was found", which is what emptied the board and My Tasks.
 *
 * This is a PostgREST select string, not SQL: no comments allowed inside it.
 */
const RUN_CARD_SELECT = `
    id, job_id, stage_id, seq, execution, advance_mode, status, blocked_reason,
    queued_at, started_at, units_in, assignee_id, supplier_id, rework_of,
    variant_label, name_override, allowed_roles,
    production_stages:stage_id ( code, name_ar, driven_by ),
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
        // The route's name for the step wins, so "الطباعة" can read
        // "طباعة الواكس" on the route that prints wax.
        stageNameAr: r.name_override || (r.production_stages?.name_ar ?? ''),
        variantLabel: r.variant_label ?? null,
        allowedRoles: (r.allowed_roles as string[]) ?? [],
        drivenBy: (r.production_stages?.driven_by as DrivenBy) ?? 'my_tasks',
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
 * THREE FILTERS, AND EACH IS A RULE, NOT A PREFERENCE:
 *
 *   execution = 'internal'    an external run is worked on the vendor screen.
 *
 *   drivenBy = 'my_tasks'     plan rule 4 -- every stage has exactly one screen
 *                             that advances it. Design is driven by the
 *                             designer's own dashboard, which already starts
 *                             and completes the run; showing it here too would
 *                             be double entry against the same run.
 *
 *   allowedRoles             the route's own answer to "who does this step".
 *                             Empty means anyone on production, which is the
 *                             default and stays the common case.
 *
 * The role comes from the users row rather than a parameter so the nav badge
 * and this list can never disagree about what is in the queue -- a badge that
 * counts eight while the screen shows three is how people stop trusting the
 * menu.
 */
export async function getMyTasks(userId: string): Promise<StageRunCard[]> {
    const [runs, { data: me }] = await Promise.all([
        getOpenStageRuns(),
        supabase.from('users').select('role').eq('id', userId).maybeSingle(),
    ]);

    const myRole = (me?.role as string) ?? '';

    return runs
        .filter((r) => r.execution === 'internal')
        .filter((r) => r.drivenBy === 'my_tasks')
        .filter((r) => r.allowedRoles.length === 0 || r.allowedRoles.includes(myRole))
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
                production_stages:stage_id ( name_ar ),
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

export interface ShadowSummary {
    total: number;
    agreeing: number;
    disagreeing: number;
    /** NULL when nothing has been compared yet — never a flattering 100%. */
    agreementPct: number | null;
    flagEnabled: boolean;
}

export async function getShadowSummary(): Promise<ShadowSummary> {
    const { data, error } = await supabase.rpc('get_production_shadow_summary');
    if (error) throw ErrorHandler.handle(error, 'getShadowSummary');
    return data as ShadowSummary;
}

/**
 * Puts a case into the new pipeline. Splits it into one job per route, so an
 * order carrying two different services becomes two chains. Idempotent.
 */
export async function startProduction(orderId: string) {
    const { data, error } = await supabase.rpc('start_production_for_order', {
        p_order_id: orderId,
    });
    if (error) throw ErrorHandler.handle(error, 'startProduction');
    return data as {
        orderId: string; jobIds: string[]; jobCount?: number; alreadyStarted?: boolean;
    };
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
