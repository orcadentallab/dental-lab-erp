
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
}

export interface Service {
    id: string;
    name: string;
    sellingPrice: number;
    costPrice: number;
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
    unitRate?: number;
    // Link to Supabase Auth (required)
    auth_id?: string;
    // Custom permissions override (set by Super Admin)
    customPermissions?: Record<string, boolean>;
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
    patientName: string;
    items: OrderItem[];
    discount: number;
    totalPrice: number;
    shade: string;
    status: 'Pending' | 'In Progress' | 'Completed' | 'Delivered' | 'New Case' | 'Under Design' | 'Waiting Dr Approval' | 'Under Production' | 'Try In' | 'Try In Approved' | 'Ready' | 'Returned for Adjustments' | 'Rejected' | 'Cancelled' | 'Pending Review';
    deliveryDate: string;
    cost: number;
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
    designUrl?: string; // Design Link (STL/Zip)

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
    originalOrderId?: string; // If this is a redo of another order

    // Status History for Time Tracking
    statusHistory?: {
        status: string;
        enteredAt: string; // ISO timestamp
        exitedAt?: string; // ISO timestamp
        durationMinutes?: number;
    }[];
    rejectedLabCost?: number;
}

export interface OrderHistoryEntry {
    id: string;
    user_name: string;
    action_type: string;
    details: string;
    created_at: string;
    changes?: Record<string, { old: unknown; new: unknown }> | null;
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

    async getOrder(id: string): Promise<Order | null> {
        const { getOrder } = await import('./supabase/orders');
        return getOrder(id);
    }

    async addOrder(order: Omit<Order, 'id' | 'createdAt'>): Promise<Order> {
        const { addOrder } = await import('./supabase/orders');
        return addOrder(order);
    }

    async updateOrder(id: string, updates: Partial<Order>): Promise<Order | null> {
        const { updateOrder } = await import('./supabase/orders');
        return updateOrder(id, updates);
    }

    /**
     * CENTRALIZED STATUS UPDATE - Use this for all status changes.
     * Ensures status/designStatus synchronization for Split Workflows.
     */
    async updateOrderStatus(
        orderId: string,
        newStatus: Order['status'],
        context?: { designUrl?: string; comment?: string; userId?: string; userName?: string; rejectedLabCost?: number }
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

    // --- BACKUP ---
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
