// Database types matching Supabase schema (snake_case)
// These represent the actual database column names

export interface DbDoctor {
    id: string;
    name: string;
    phone: string;
    phone2?: string | null;
    address: string;
    doctor_code: string;
    representative_name: string;
    representative_id?: string | null;
    custom_prices?: Record<string, number> | null; // JSONB
    is_center?: boolean;
    parent_id?: string | null;
    created_at: string;
    updated_at: string;
}

export interface DbOrderItem {
    serviceType: string;
    teethNumbers: string[];
    price: number;
    shade?: string;
}

export interface DbOrderComment {
    id: string;
    text: string;
    userId: string;
    userName: string;
    createdAt: string;
}

export interface DbOrderFeedback {
    rating: number;
    issues: string[];
    rootCause?: 'Lab' | 'Doctor' | 'Scan' | 'Communication';
    notes?: string;
    createdAt: string;
}

export interface DbOrder {
    id: string;
    case_id: string;
    doctor_id: string;
    patient_name: string;
    items: DbOrderItem[];
    discount: number;
    total_price: number;
    shade: string;
    status: 'Pending' | 'In Progress' | 'Completed' | 'Delivered' | 'New Case' | 'Under Design' | 'Waiting Dr Approval' | 'Under Production' | 'Try In' | 'Try In Approved' | 'Ready' | 'Returned for Adjustments' | 'Rejected' | 'Doctor Rejected' | 'Lab Rejected' | 'Cancelled' | 'Pending Review';
    delivery_date: string;
    cost: number;
    manual_cost?: number | null;
    stl_url?: string | null;
    images_url?: string | null;
    supplier_id?: string | null;
    instructions?: string | null;
    priority: 'Normal' | 'Urgent';
    delivery_type?: 'Final' | 'TryIn' | null;
    needs_design_review: boolean;
    technician_status?: 'Pending' | 'Approved' | 'Rejected' | 'NeedDetails' | 'PMMA_First' | null;
    is_urgent?: boolean;
    comments: DbOrderComment[];
    representative_id?: string | null;
    is_registered: boolean;
    workflow_type?: 'full' | 'split' | null;
    designer_id?: string | null;
    design_url?: string | null;
    design_status?: 'pending' | 'accepted' | 'in_progress' | 'waiting_approval' | 'completed' | 'returned' | null;
    design_price?: number | null;
    manual_design_price?: number | null;
    actual_delivery_date?: string | null;
    feedback?: DbOrderFeedback | null;
    is_redo: boolean;
    original_order_id?: string | null;
    status_history?: {
        status: string;
        enteredAt: string;
        exitedAt?: string;
        durationMinutes?: number;
    }[] | null;
    created_at: string;
    updated_at: string;
    is_archived?: boolean;
    rejected_lab_cost?: number | null;
    // WF-1: shadow workflow columns (added by migration 086).
    production_status?: 'not_started' | 'designing' | 'in_production' | 'try_in_ready' | 'waiting_doctor' | 'finalization' | 'final_ready' | 'final_delivered';
    issue_state?: 'none' | 'returned' | 'rejected' | 'cancelled' | 'on_hold' | 'redo' | 'doctor_rejected' | 'lab_rejected';
}

export interface DbTransaction {
    id: string;
    type: 'income' | 'expense';
    amount: number;
    category: string;
    date: string;
    description: string;
    entity_id?: string | null;
    entity_type?: 'doctor' | 'supplier' | 'general' | 'designer' | 'representative' | null;
    is_registered: boolean;
    is_approved?: boolean;
    status?: 'pending' | 'approved' | 'rejected' | 'settled';
    effective_date?: string | null;
    created_at: string;
    updated_at: string;
}

// Insert types (without generated fields)
export type DbDoctorInsert = Omit<DbDoctor, 'id' | 'created_at' | 'updated_at'>;
export type DbOrderInsert = Omit<DbOrder, 'id' | 'created_at' | 'updated_at'>;
export type DbTransactionInsert = Omit<DbTransaction, 'id' | 'created_at' | 'updated_at'>;

// Update types (all fields optional except id)
export type DbDoctorUpdate = Partial<Omit<DbDoctor, 'id' | 'created_at' | 'updated_at'>>;
export type DbOrderUpdate = Partial<Omit<DbOrder, 'id' | 'created_at' | 'updated_at'>>;
export type DbTransactionUpdate = Partial<Omit<DbTransaction, 'id' | 'created_at' | 'updated_at'>>;

export interface DbService {
    id: string;
    name: string;
    selling_price: number;
    cost_price: number;
    designer_price?: number | null; // Default designer cost per unit (0 = not billed to designer)
    milling_price?: number | null;
    created_at: string;
    updated_at: string;
}

export interface DbSupplier {
    id: string;
    name: string;
    supplier_code?: string | null;
    username?: string | null;
    phone: string;
    is_active?: boolean | null;
    custom_prices?: Record<string, number> | null; // JSONB
    milling_prices?: Record<string, number> | null; // JSONB
    redo_cost_percentage?: number | null;
    created_at: string;
    updated_at: string;
}

export interface DbUser {
    id: string;
    auth_id?: string | null;
    username: string;
    email: string | null;
    // password removed - using Supabase Auth only
    role: 'admin' | 'lab' | 'representative' | 'accountant' | 'designer' | 'doctor';
    name: string;
    entity_id?: string | null;
    base_salary?: number | null;
    unit_rate?: number | null;
    designer_service_prices?: Record<string, number> | null; // JSONB: serviceName -> price per unit override
    custom_permissions?: Record<string, boolean> | null; // JSONB
    is_active?: boolean | null;
    deactivated_at?: string | null;
    created_at: string;
    updated_at: string;
}

export type DbServiceInsert = Omit<DbService, 'id' | 'created_at' | 'updated_at'>;
export type DbServiceUpdate = Partial<Omit<DbService, 'id' | 'created_at' | 'updated_at'>>;

export type DbSupplierInsert = Omit<DbSupplier, 'id' | 'created_at' | 'updated_at'>;
export type DbSupplierUpdate = Partial<Omit<DbSupplier, 'id' | 'created_at' | 'updated_at'>>;

// Normalized Tables
export interface DbOrderItemRow {
    id: string;
    order_id: string;
    product_type: string;
    teeth_numbers: string[]; // JSONB in DB
    shade?: string | null;
    price: number;
    count: number;
    created_at: string;
}

export interface DbOrderCommentRow {
    id: string;
    order_id: string;
    user_id?: string | null;
    user_name?: string | null;
    content: string;
    created_at: string;
}

export type DbOrderItemRowInsert = Omit<DbOrderItemRow, 'id' | 'created_at'>;
export type DbOrderCommentRowInsert = Omit<DbOrderCommentRow, 'id' | 'created_at'>;

export type DbUserInsert = Omit<DbUser, 'id' | 'created_at' | 'updated_at'>;
export type DbUserUpdate = Partial<Omit<DbUser, 'id' | 'created_at' | 'updated_at'>>;
