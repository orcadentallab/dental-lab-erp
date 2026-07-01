export interface DoctorBranch {
    id: string;
    name: string;
    address: string;
    phone: string;
}

export interface Doctor {
    id: string;
    name: string;
    phone: string;
    phone2?: string;
    address: string;
    doctorCode: string; // e.g., 'DR01'
    representativeName: string;
    representativeId?: string; // Link to User.id
    customPrices?: Record<string, number>; // serviceName -> special sellingPrice
    isCenter?: boolean; // True if Medical Center
    parentId?: string; // Link to parent Medical Center
    hasBranches?: boolean; // True if doctor/center has branches
    branches?: DoctorBranch[];
}

export interface Service {
    id: string;
    name: string;
    sellingPrice: number;
    costPrice: number;
    designerPrice?: number; // Default designer cost per unit (0 = not billed to designer)
    millingPrice?: number; // Default milling price (can be overridden per supplier)
    sortOrder?: number; // Manual display order
}

export interface Transaction {
    id: string;
    type: 'income' | 'expense';
    amount: number;
    category: string;
    date: string;
    description: string;
    entityId?: string; // Doctor or Supplier ID
    entityType?: 'doctor' | 'supplier' | 'general' | 'designer' | 'representative';
    isRegistered?: boolean; // Flag for Accountant (Bibocad)
    isApproved?: boolean; // Flag for individual expense approval (DEPRECATED: Use status)
    status?: 'pending' | 'approved' | 'rejected' | 'settled'; // New Status Field
    effectiveDate?: string;
    createdAt?: string;
}

export interface Supplier {
    id: string;
    name: string;
    supplierCode?: string;
    username: string; // for login
    phone: string;
    isActive?: boolean;
    customPrices?: Record<string, number>; // serviceName -> costPrice
    millingPrices?: Record<string, number>; // serviceName -> millingOnlyPrice
    redoCostPercentage?: number; // 0 to 100 (Percentage of cost covered by us during redo)
}

export interface User {
    id: string;
    username: string;
    email?: string;
    // password removed - using Supabase Auth only
    role: 'admin' | 'lab' | 'representative' | 'accountant' | 'designer' | 'doctor';
    name: string;
    entityId?: string;
    // Payroll Info (for Representatives)
    baseSalary?: number;
    // For Designers
    unitRate?: number; // Global fallback rate per unit
    designerServicePrices?: Record<string, number>; // Per-service price override (serviceName -> price per unit)
    // Link to Supabase Auth (required)
    auth_id?: string;
    // Custom permissions override (set by Super Admin)
    customPermissions?: Record<string, boolean>;
    isActive?: boolean;
    deactivatedAt?: string;
}

export interface Expense {
    id: string;
    userId: string; // Link to Representative
    amount: number;
    description: string;
    date: string;
    status: 'Pending' | 'Approved' | 'Rejected';
    notes?: string; // Admin notes
    category?: string; // New: To match general finance categories
    isSettled?: boolean; // New: To track if it has been paid out
}

export interface OrderItem {
    serviceType: string;
    teethNumbers: string[];
    price: number;
    shade?: string;
}

export interface Order {
    id: string; // Internal ID
    caseId: string; // Generated ID
    doctorId: string;
    branchName?: string; // Selected branch for this order
    patientName: string;
    items: OrderItem[];
    discount: number;
    totalPrice: number;
    shade: string;
    status: 'Pending' | 'In Progress' | 'Completed' | 'Delivered' | 'New Case' | 'Under Design' | 'Waiting Dr Approval' | 'Under Production' | 'Try In' | 'Try In Approved' | 'Ready' | 'Returned for Adjustments' | 'Rejected' | 'Doctor Rejected' | 'Lab Rejected' | 'Cancelled' | 'Pending Review';
    deliveryDate: string;
    cost: number;
    manualCost?: number | null;
    stlUrl?: string; // stlUrl / scanUrl
    imagesUrl?: string; // Photos URL
    supplierId?: string; // Optional: Assigned External Lab
    createdAt: string;

    // External Lab Fields
    external_lab_status?: string;
    external_lab_notes?: string;

    // New Fields
    instructions?: string;
    priority: 'Normal' | 'Urgent';
    deliveryType?: 'Final' | 'TryIn';
    needsDesignReview?: boolean;
    technicianStatus?: 'Pending' | 'Approved' | 'Rejected' | 'NeedDetails' | 'PMMA_First';
    comments?: {
        id: string;
        text: string;
        userId: string;
        userName: string;
        createdAt: string;
    }[];
    representativeId?: string; // Linked Representative
    isRegistered?: boolean; // Flag for Accountant (Bibocad)

    // Split Workflow Fields
    workflowType?: 'full' | 'split';
    millingOnly?: boolean; // True if order is milling only
    designerId?: string;
    designStatus?: 'pending' | 'accepted' | 'in_progress' | 'waiting_approval' | 'completed' | 'returned';
    designPrice?: number; // Snapshot of cost
    manualDesignPrice?: number | null; // Admin override for designPrice
    designUrl?: string | null; // Design Link (STL/Zip)

    // QA & Delivery Tracking
    actualDeliveryDate?: string; // When status becomes Delivered
    feedback?: {
        rating: number; // 1-5
        issues: string[]; // ['Shade', 'Fitting', 'Bite', 'Material', 'Late', 'Other']
        rootCause?: 'Lab' | 'Doctor' | 'Scan' | 'Communication';
        notes?: string;
        createdAt: string;
    };
    isUrgent?: boolean;
    isRedo?: boolean;
    isArchived?: boolean;
    isDeleted?: boolean;
    originalOrderId?: string; // If this is a redo of another order

    // Status History for Time Tracking
    statusHistory?: {
        status: string;
        enteredAt: string; // ISO timestamp
        exitedAt?: string; // ISO timestamp
        durationMinutes?: number;
    }[];
    rejectedLabCost?: number;
    // WF-1: shadow workflow columns. Optional for backwards-compat with all
    // existing call sites; finance helpers do not depend on these yet.
    productionStatus?: 'not_started' | 'designing' | 'in_production' | 'try_in_ready' | 'waiting_doctor' | 'finalization' | 'final_ready' | 'final_delivered';
    issueState?: 'none' | 'returned' | 'rejected' | 'cancelled' | 'on_hold' | 'redo' | 'doctor_rejected' | 'lab_rejected';
}

export interface OrderHistoryEntry {
    id: string;
    order_id: string;
    user_id?: string | null;
    user_name: string;
    action_type: string;
    details: string;
    created_at: string;
    changes?: Record<string, { old: unknown; new: unknown }> | null;
}

export interface OrderEvent {
    id: string;
    orderId: string;
    eventType: string;
    oldValue?: string | null;
    newValue?: string | null;
    changedBy?: string | null;
    actorRole?: string | null;
    changedAt: string;
    reason?: string | null;
    notes?: string | null;
    severity: 'info' | 'warning' | 'critical';
    responsibilityParty?: string | null;
    approvalStatus: 'none' | 'pending' | 'approved' | 'rejected';
    approvedBy?: string | null;
    approvedAt?: string | null;
    financialImpact?: number | null;
    relatedTransactionId?: string | null;
    relatedAdjustmentId?: string | null;
    relatedAllocationId?: string | null;
    relatedIssueId?: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
}

export interface OrderIssue {
    id: string;
    orderId: string;
    issueType: 'returned' | 'rejected' | 'cancelled' | 'redo' | 'doctor_rejected' | 'lab_rejected';
    causeCategory: 'lab' | 'doctor' | 'scan' | 'design' | 'communication' | 'other';
    notes?: string;
    reporterId?: string;
    reporterName?: string;
    resolvedAt?: string;
    resolutionNotes?: string;
    createdAt: string;
    order?: Order;
}

export interface EntityBillingSettings {
    id?: string;
    entityType: 'doctor' | 'external_lab' | 'designer';
    entityId: string;
    billingMode: 'per_order' | 'monthly_cycle';
    billingDay?: number | null;
    perOrderDueDays: number;
    paymentTermsNotes?: string | null;
    autoApplyCredit: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface FinancialObligation {
    id: string;
    orderId: string;
    entityType: 'doctor' | 'external_lab' | 'designer';
    entityId: string;
    direction: 'receivable' | 'payable';
    triggerType: 'doctor_delivered' | 'external_lab_ready' | 'external_lab_issue_settlement' | 'designer_approved' | 'manual_adjustment';
    triggerStatus?: string | null;
    triggerDate: string;
    dueDate: string;
    grossAmount: number;
    adjustmentAmount: number;
    netAmount: number;
    allocatedAmount: number;
    remainingAmount: number;
    status: 'unpaid' | 'partially_paid' | 'paid' | 'void' | 'written_off';
    source: 'order' | 'remake' | 'adjustment' | 'backfill';
    notes?: string | null;
    metadata: Record<string, unknown>;
    createdBy?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface FinancialObligationsReviewParams {
    page?: number;
    pageSize?: number;
    entityType?: 'all' | FinancialObligation['entityType'];
    direction?: 'all' | FinancialObligation['direction'];
    status?: 'all' | FinancialObligation['status'];
    triggerType?: 'all' | FinancialObligation['triggerType'];
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

export interface AllocationPreviewParams {
    entityType: 'doctor' | 'external_lab';
    entityId: string;
    direction: 'receivable' | 'payable';
    amount: number;
    paymentDate?: string;
    mode?: 'fifo';
    includeNotDue?: boolean;
    transactionId?: string;
}

export interface AllocationPreviewItem {
    obligationId: string;
    orderId: string;
    caseId?: string | null;
    patientName?: string | null;
    triggerType: FinancialObligation['triggerType'];
    dueDate: string;
    triggerDate: string;
    netAmount: number;
    alreadyAllocatedAmount: number;
    currentRemainingAmount: number;
    previewAllocatedAmount: number;
    previewRemainingAmountAfter: number;
}

export interface AllocationPreviewResult {
    entityType: AllocationPreviewParams['entityType'];
    entityId: string;
    direction: AllocationPreviewParams['direction'];
    amount: number;
    mode: 'fifo';
    transactionId?: string | null;
    allocationPlan: AllocationPreviewItem[];
    totalAllocated: number;
    unallocatedAmount: number;
    creditPreviewAmount: number;
    warnings: string[];
}

export interface HistoricalObligationsPreviewParams {
    entityType?: 'all' | 'doctor' | 'external_lab';
    rowType?: 'all' | 'missing_obligation' | 'missing_data_warning';
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    page?: number;
    pageSize?: number;
}

export interface HistoricalObligationPreviewRow {
    rowType: 'missing_obligation' | 'missing_data_warning';
    entityType: 'doctor' | 'external_lab' | 'designer' | null;
    reason:
        | 'missing_doctor_receivable'
        | 'missing_external_lab_payable'
        | 'missing_external_lab_issue_settlement'
        | 'doctor_receivable_missing_doctor'
        | 'doctor_receivable_zero_or_missing_amount'
        | 'external_lab_payable_missing_supplier'
        | 'external_lab_payable_zero_or_missing_cost'
        | 'try_in_ready_excluded'
        | 'issue_settlement_missing_admin_amount'
        | 'issue_settlement_missing_supplier'
        | 'issue_status_excluded';
    orderId: string;
    caseId: string;
    patientName: string;
    status: string;
    deliveryType?: string | null;
    doctorId?: string | null;
    doctorName?: string | null;
    supplierId?: string | null;
    supplierName?: string | null;
    amount: number;
    cost?: number | null;
    manualCost?: number | null;
    defaultCost?: number | null;
    costSource?: 'manual' | 'default' | 'legacy_manual_inferred' | 'unknown';
    date: string;
    dateBasis: 'actualDeliveryDate' | 'deliveryDate' | 'createdAt';
}

export interface HistoricalObligationsPreviewResult {
    rows: HistoricalObligationPreviewRow[];
    counts: {
        missingDoctorReceivables: number;
        missingExternalLabPayables: number;
        missingIssueSettlementPayables: number;
        warnings: number;
        total: number;
    };
    page: number;
    pageSize: number;
    limitation: string;
}

export interface HistoricalObligationsBackfillBatchParams extends HistoricalObligationsPreviewParams {
    reason?: 'all' | 'missing_doctor_receivable' | 'missing_external_lab_payable' | 'missing_external_lab_issue_settlement';
    dryRun?: boolean;
    actorRole?: string | null;
    createdBy?: string | null;
}

export interface HistoricalObligationsBackfillActionRow {
    orderId: string;
    caseId: string;
    patientName: string;
    reason: HistoricalObligationPreviewRow['reason'];
    action: 'would_create' | 'created' | 'skipped_duplicate' | 'warning' | 'error';
    obligationId?: string;
    amount?: number;
    entityType?: HistoricalObligationPreviewRow['entityType'];
    entityId?: string | null;
    triggerType?: FinancialObligation['triggerType'];
    error?: string;
}

export interface HistoricalObligationsBackfillBatchResult {
    processed: number;
    createdDoctorReceivables: { count: number; total: number };
    createdExternalLabPayables: { count: number; total: number };
    createdIssueSettlementPayables: { count: number; total: number };
    skippedDuplicate: number;
    warnings: number;
    errors: HistoricalObligationsBackfillActionRow[];
    hasMore: boolean;
    nextPage: number | null;
    rows: HistoricalObligationsBackfillActionRow[];
}

export interface FinancialReconciliationPreviewParams {
    entityType?: 'all' | 'doctor' | 'external_lab';
    search?: string;
    page?: number;
    pageSize?: number;
    dateFrom?: string;
    dateTo?: string;
}

export interface FinancialReconciliationPreviewRow {
    entityType: 'doctor' | 'external_lab';
    entityId: string;
    entityName: string;
    officialBalance: number;
    obligationTotal: number;
    transactionPaymentTotal: number;
    obligationBasedBalance: number;
    difference: number;
    flags: (
        | 'difference_zero'
        | 'difference_nonzero'
        | 'missing_transactions'
        | 'obligations_without_transactions'
        | 'payments_without_obligations'
        | 'issue_settlement_present'
        | 'possible_date_range_mismatch'
        | 'data_missing'
        | 'account_closing_or_dispute_settlement_needed'
        | 'stale_doctor_receivable_after_rejection'
        | 'doctor_payment_missing'
        | 'obligations_include_item_not_in_official_logic'
    )[];
    notes: string[];
    totalDoctorReceivableObligations?: number;
    totalExternalLabReadyPayables?: number;
    totalExternalLabIssueSettlementPayables?: number;
}

export interface FinancialReconciliationPreviewResult {
    rows: FinancialReconciliationPreviewRow[];
    summary: {
        doctorCount: number;
        supplierCount: number;
        totalOfficialBalance: number;
        totalObligationBasedBalance: number;
        totalDifference: number;
        entitiesWithDifference: number;
    };
    page: number;
    pageSize: number;
}

export interface AgingBuckets {
    current: number;
    days1to30: number;
    days31to60: number;
    over60Days: number;
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
    entityType: 'doctor' | 'external_lab' | 'designer';
    entityId: string;
    entityName?: string | null;
    aging: AgingBuckets;
    obligations: AgingObligationDetail[];
    asOfDate: string;
    generatedAt: string;
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

export interface AgingReportParams {
    entityType?: 'doctor' | 'external_lab' | 'designer';
    entityId?: string;
    direction?: 'receivable' | 'payable';
    asOfDate?: string;
    minRemainingAmount?: number;
    page?: number;
    pageSize?: number;
}

class MockDB {
    constructor() {
        console.log('Database service initialized with Supabase backend.');
    }

    // --- USERS ---
    async getUsers(): Promise<User[]> {
        const { getUsers } = await import('./supabase/users');
        return getUsers();
    }
    async addUser(user: User): Promise<void> {
        const { addUser } = await import('./supabase/users');
        return addUser(user);
    }
    async updateUser(user: User): Promise<void> {
        const { updateUser } = await import('./supabase/users');
        return updateUser(user);
    }
    async deleteUser(id: string): Promise<void> {
        const { deleteUser } = await import('./supabase/users');
        return deleteUser(id);
    }
    async resetUserPassword(userId: string, newPassword: string): Promise<void> {
        const { resetUserPassword } = await import('./supabase/users');
        return resetUserPassword(userId, newPassword);
    }

    // --- HISTORY ---
    async getOrderHistory(orderId: string): Promise<OrderHistoryEntry[]> {
        const { getOrderHistory } = await import('./supabase/orders');
        return getOrderHistory(orderId);
    }

    async getRecentOrderHistory(limit: number = 200): Promise<OrderHistoryEntry[]> {
        const { getRecentOrderHistory } = await import('./supabase/orders');
        return getRecentOrderHistory(limit);
    }

    async getOrderTimeline(orderId: string): Promise<OrderEvent[]> {
        const { getOrderTimeline } = await import('./supabase/orderEvents');
        return getOrderTimeline(orderId);
    }

    async getEntityBillingSettings(
        entityType: EntityBillingSettings['entityType'],
        entityId: string
    ): Promise<EntityBillingSettings> {
        const { getEntityBillingSettings } = await import('./supabase/billingSettings');
        return getEntityBillingSettings(entityType, entityId);
    }

    async upsertEntityBillingSettings(
        settings: Omit<EntityBillingSettings, 'id' | 'createdAt' | 'updatedAt'>
    ): Promise<EntityBillingSettings> {
        const { upsertEntityBillingSettings } = await import('./supabase/billingSettings');
        return upsertEntityBillingSettings(settings);
    }

    async createFinancialObligation(
        input: Omit<FinancialObligation, 'id' | 'netAmount' | 'remainingAmount' | 'createdAt' | 'updatedAt'> & { dueDate: string }
    ): Promise<FinancialObligation> {
        const { createFinancialObligation } = await import('./supabase/financialObligations');
        return createFinancialObligation(input);
    }

    async getFinancialObligationsForOrder(orderId: string): Promise<FinancialObligation[]> {
        const { getFinancialObligationsForOrder } = await import('./supabase/financialObligations');
        return getFinancialObligationsForOrder(orderId);
    }

    async getFinancialObligationsForEntity(
        entityType: FinancialObligation['entityType'],
        entityId: string
    ): Promise<FinancialObligation[]> {
        const { getFinancialObligationsForEntity } = await import('./supabase/financialObligations');
        return getFinancialObligationsForEntity(entityType, entityId);
    }

    async getFinancialObligationsReview(
        params: FinancialObligationsReviewParams = {}
    ): Promise<FinancialObligationsReviewResult> {
        const { getFinancialObligationsReview } = await import('./supabase/financialObligations');
        return getFinancialObligationsReview(params);
    }

    async previewPaymentAllocation(params: AllocationPreviewParams): Promise<AllocationPreviewResult> {
        const { previewPaymentAllocation } = await import('./supabase/allocationPreview');
        return previewPaymentAllocation(params);
    }

    async previewHistoricalObligationsBackfill(
        params: HistoricalObligationsPreviewParams = {}
    ): Promise<HistoricalObligationsPreviewResult> {
        const { previewHistoricalObligationsBackfill } = await import('./supabase/historicalObligationsPreview');
        return previewHistoricalObligationsBackfill(params);
    }

    async createHistoricalObligationsBackfillBatch(
        params: HistoricalObligationsBackfillBatchParams = {}
    ): Promise<HistoricalObligationsBackfillBatchResult> {
        const { createHistoricalObligationsBackfillBatch } = await import('./supabase/historicalObligationsBackfill');
        return createHistoricalObligationsBackfillBatch(params);
    }

    async previewFinancialReconciliation(
        params: FinancialReconciliationPreviewParams = {}
    ): Promise<FinancialReconciliationPreviewResult> {
        const { previewFinancialReconciliation } = await import('./supabase/financialReconciliationPreview');
        return previewFinancialReconciliation(params);
    }

    async voidFinancialObligation(id: string, notes?: string): Promise<FinancialObligation | null> {
        const { voidFinancialObligation } = await import('./supabase/financialObligations');
        return voidFinancialObligation(id, notes);
    }

    // --- DOCTORS ---
    async getDoctors(search?: string): Promise<Doctor[]> {
        const { getDoctors } = await import('./supabase/doctors');
        return getDoctors(search);
    }

    async getDoctor(id: string): Promise<Doctor | null> {
        const { getDoctor } = await import('./supabase/doctors');
        return getDoctor(id);
    }

    async addDoctor(doc: Omit<Doctor, 'id'>): Promise<Doctor> {
        const { addDoctor } = await import('./supabase/doctors');
        return addDoctor(doc);
    }

    async updateDoctor(id: string, updates: Partial<Doctor>): Promise<Doctor | null> {
        const { updateDoctor } = await import('./supabase/doctors');
        return updateDoctor(id, updates);
    }

    // --- ORDERS ---
    async getOrders(
        page: number = 1,
        limit: number = 50,
        filters: {
            status?: string;
            startDate?: string;
            endDate?: string;
            doctorId?: string;
            representativeId?: string;
            supplierId?: string;
            designerId?: string;
            search?: string;
            hideDelivered?: boolean;
            hideRejected?: boolean;
            showArchived?: boolean;
            includeArchived?: boolean;
        } = {}
    ): Promise<{ data: Order[]; count: number }> {
        const { getOrders } = await import('./supabase/orders');
        return getOrders(page, limit, filters);
    }

    /**
     * @deprecated Use getOrders() with pagination instead.
     * Only use for exports or legacy code that needs all orders.
     */
    /**
     * @deprecated Use getOrders() with pagination instead.
     * Only use for exports or legacy code that needs all orders.
     */
    async getAllOrdersUnpaginated(): Promise<Order[]> {
        const { getAllOrdersUnpaginated } = await import('./supabase/orders');
        return getAllOrdersUnpaginated();
    }

    /**
     * Dedicated heavy fetch for Full Exports.
     * Fetches virtually unlimited orders (up to 20,000 safety limit).
     */
    async fetchAllOrdersForExport(): Promise<Order[]> {
        const { fetchAllOrdersForExport } = await import('./supabase/orders');
        return fetchAllOrdersForExport();
    }

    /**
     * LIGHTWEIGHT fetch for Finance Summary (Accounts Page)
     */
    async getOrdersForFinanceSummary(): Promise<Partial<Order>[]> {
        const { getOrdersForFinanceSummary } = await import('./supabase/orders');
        return getOrdersForFinanceSummary();
    }

    /**
     * Dedicated fetch for Individual Account Statements.
     * Fetches all orders for a specific entity ID without truncation.
     */
    async fetchFullEntityStatement(entityId: string, entityType: 'doctor' | 'supplier' | 'designer'): Promise<{ orders: Order[], transactions: Transaction[] }> {
        const { fetchFullEntityStatement } = await import('./supabase/orders');
        return fetchFullEntityStatement(entityId, entityType);
    }

    async getDashboardActiveOrders(): Promise<Order[]> {
        const { getDashboardActiveOrders } = await import('./supabase/orders');
        return getDashboardActiveOrders();
    }

    async getOrdersWithComments(): Promise<Order[]> {
        const { getOrdersWithComments } = await import('./supabase/orders');
        return getOrdersWithComments();
    }

    async getDesignerDashboardOrders(designerId?: string): Promise<Order[]> {
        const { getDesignerDashboardOrders } = await import('./supabase/orders');
        return getDesignerDashboardOrders(designerId);
    }

    async getOrder(id: string): Promise<Order | null> {
        const { getOrder } = await import('./supabase/orders');
        return getOrder(id);
    }

    async addOrder(order: Omit<Order, 'id' | 'createdAt'>, context?: { userId?: string; actorRole?: string }): Promise<Order> {
        const { addOrder } = await import('./supabase/orders');
        return addOrder(order, context);
    }

    async updateOrder(id: string, updates: Partial<Order>, context?: {
        userId?: string;
        actorRole?: string;
        deliveryDateChangeReason?: string | null;
        deliveryDateChangeReasonCode?: string | null;
        deliveryDateChangeNotes?: string | null;
        deliveryDateResponsibilityParty?: 'doctor' | 'internal' | 'external_lab' | 'designer' | 'unknown';
        deliveryDateChangeSource?: string | null;
        skipDeliveryDateEvent?: boolean;
    }): Promise<Order | null> {
        const { updateOrder } = await import('./supabase/orders');
        return updateOrder(id, updates, context);
    }

    /**
     * WF-1: Audit-gated representative edit pathway. The single entry point for
     * all rep mutations once `app.workflow_strict_rep` is flipped on. Backed by
     * the `rep_update_order_fields_with_audit` SECURITY DEFINER RPC.
     *
     * Reason code is required; reason note is required when reasonCode === 'other'.
     * See docs/orders-field-permissions.md §5 for the allow-list and state guards.
     */
    async repUpdateOrderWithAudit(
        orderId: string,
        changes: Partial<Order>,
        reasonCode: string,
        reasonNote?: string | null
    ): Promise<Order | null> {
        const { repUpdateOrderWithAudit } = await import('./supabase/orderWorkflow');
        return repUpdateOrderWithAudit(orderId, changes, reasonCode, reasonNote);
    }

    async adminReviewOrderEdit(
        eventId: string,
        action: 'approve' | 'reject',
        adminNotes?: string | null
    ): Promise<void> {
        const { adminReviewOrderEdit } = await import('./supabase/orderWorkflow');
        return adminReviewOrderEdit(eventId, action, adminNotes);
    }

    /**
     * CENTRALIZED STATUS UPDATE - Use this for all status changes.
     * Ensures status/designStatus synchronization for Split Workflows.
     */
    async updateOrderStatus(
        orderId: string,
        newStatus: Order['status'],
        context?: { designUrl?: string | null; comment?: string; userId?: string; userName?: string; actorRole?: string; rejectedLabCost?: number }
    ): Promise<Order | null> {
        const { updateOrderStatus } = await import('./supabase/orders');
        return updateOrderStatus(orderId, newStatus, context);
    }

    /**
     * Designer convenience function for submitting designs.
     */
    async submitDesignForApproval(
        orderId: string,
        designUrl: string,
        userId: string,
        userName: string
    ): Promise<Order | null> {
        const { submitDesignForApproval } = await import('./supabase/orders');
        return submitDesignForApproval(orderId, designUrl, userId, userName);
    }

    async deleteOrder(id: string): Promise<void> {
        const { deleteOrder } = await import('./supabase/orders');
        return deleteOrder(id);
    }

    async bulkUpsertOrders(newOrders: Order[]): Promise<number> {
        const { bulkUpsertOrders } = await import('./supabase/orders');
        return bulkUpsertOrders(newOrders);
    }

    // --- SERVICES ---
    async getServices(): Promise<Service[]> {
        const { getServices } = await import('./supabase/services');
        return getServices();
    }
    async addService(service: Omit<Service, 'id'>): Promise<Service> {
        const { addService } = await import('./supabase/services');
        return addService(service);
    }
    async updateService(id: string, updates: Partial<Omit<Service, 'id'>>): Promise<Service | null> {
        const { updateService } = await import('./supabase/services');
        return updateService(id, updates);
    }
    async deleteService(id: string): Promise<void> {
        const { deleteService } = await import('./supabase/services');
        return deleteService(id);
    }
    async reorderServices(orderedIds: string[]): Promise<void> {
        const { reorderServices } = await import('./supabase/services');
        return reorderServices(orderedIds);
    }

    // --- TRANSACTIONS ---
    async getTransactions(): Promise<Transaction[]> {
        const { getTransactions } = await import('./supabase/transactions');
        return getTransactions();
    }

    async getTransactionsForFinanceSummary(): Promise<Partial<Transaction>[]> {
        const { getTransactionsForFinanceSummary } = await import('./supabase/transactions');
        return getTransactionsForFinanceSummary();
    }

    async addTransaction(tx: Omit<Transaction, 'id'>): Promise<Transaction> {
        const { addTransaction } = await import('./supabase/transactions');
        return addTransaction(tx);
    }

    async updateTransaction(id: string, updates: Partial<Transaction>): Promise<Transaction | null> {
        const { updateTransaction } = await import('./supabase/transactions');
        return updateTransaction(id, updates);
    }

    async deleteTransaction(id: string): Promise<void> {
        const { deleteTransaction } = await import('./supabase/transactions');
        return deleteTransaction(id);
    }

    async bulkUpsertTransactions(newTxs: Transaction[]): Promise<number> {
        const { bulkUpsertTransactions } = await import('./supabase/transactions');
        return bulkUpsertTransactions(newTxs);
    }

    async bulkUpsertDoctors(doctors: Doctor[]): Promise<number> {
        const { bulkUpsertDoctors } = await import('./supabase/doctors');
        return bulkUpsertDoctors(doctors);
    }

    async bulkUpsertServices(services: Service[]): Promise<number> {
        const { bulkUpsertServices } = await import('./supabase/services');
        return bulkUpsertServices(services);
    }

    async getDoctorTotalCost(doctorId: string): Promise<number> {
        const { getDoctorTotalCost } = await import('./supabase/orders');
        return getDoctorTotalCost(doctorId);
    }

    // --- SUPPLIERS ---
    async getSuppliers(): Promise<Supplier[]> {
        const { getSuppliers } = await import('./supabase/suppliers');
        return getSuppliers();
    }
    async addSupplier(sup: Omit<Supplier, 'id'>): Promise<Supplier> {
        const { addSupplier } = await import('./supabase/suppliers');
        return addSupplier(sup);
    }
    async updateSupplier(id: string, updates: Partial<Supplier>): Promise<Supplier | null> {
        const { updateSupplier } = await import('./supabase/suppliers');
        return updateSupplier(id, updates);
    }

    async getOrderIssues(filters?: { issueType?: string; startDate?: string; endDate?: string }): Promise<OrderIssue[]> {
        const { getOrderIssues } = await import('./supabase/orders');
        return getOrderIssues(filters);
    }

    async getPendingOrderEditProposals(): Promise<OrderEvent[]> {
        const { supabase } = await import('../lib/supabase');
        const { dbToOrderEvent } = await import('./supabase/orderEvents');
        const { data, error } = await supabase
            .from('order_events')
            .select('*')
            .eq('event_type', 'order_edit_proposed')
            .eq('approval_status', 'pending')
            .order('created_at', { ascending: false });
        if (error) throw error;
        type RowType = Parameters<typeof dbToOrderEvent>[0];
        return (data || []).map((row: RowType) => dbToOrderEvent(row));
    }

    async getAppliedOrderEdits(): Promise<OrderEvent[]> {
        const { supabase } = await import('../lib/supabase');
        const { dbToOrderEvent } = await import('./supabase/orderEvents');
        const { data, error } = await supabase
            .from('order_events')
            .select('*')
            .in('event_type', ['order_edit_applied', 'order_edit_proposed'])
            .neq('approval_status', 'pending')
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) throw error;
        type RowType = Parameters<typeof dbToOrderEvent>[0];
        return (data || []).map((row: RowType) => dbToOrderEvent(row));
    }

    async computeAgingReport(params?: AgingReportParams): Promise<AgingReportResult> {
        const { computeAgingReport } = await import('./supabase/collections');
        return computeAgingReport(params);
    }

    async getEntityAgingSummary(
        entityType: 'doctor' | 'external_lab' | 'designer',
        entityId: string,
        direction?: 'receivable' | 'payable',
        asOfDate?: string
    ): Promise<AgingBuckets> {
        const { getEntityAgingSummary } = await import('./supabase/collections');
        return getEntityAgingSummary(entityType, entityId, direction, asOfDate);
    }

    exportData() { return '{}'; }
    async importData(jsonString: string): Promise<{ success: boolean; error?: string }> {
        try {
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            const data = JSON.parse(jsonString) as { orders?: Order[]; transactions?: Transaction[] };

            // Import Orders
            if (data.orders && Array.isArray(data.orders)) {
                await this.bulkUpsertOrders(data.orders);
            }

            // Import Transactions
            if (data.transactions && Array.isArray(data.transactions)) {
                await this.bulkUpsertTransactions(data.transactions);
            }

            // Note: Doctors and Suppliers might be created via specific migration logic if needed,
            // but usually they are small enough to re-enter or bulk insert manually.
            // For now, we support the bulk bulkUpsert of main transaction data.

            return { success: true };
        } catch (e: unknown) {
            console.error("Import failed:", e);
            const errorMessage = e instanceof Error ? e.message : 'Legacy import failed';
            return { success: false, error: errorMessage };
        }
    }
}

export const db = new MockDB();
