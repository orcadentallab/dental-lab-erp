import { supabase } from '../lib/supabase';
import { type Order } from './db';

// Response types from RPC
export interface DashboardStats {
    active_count?: number;
    delayed_count?: number;
    unassigned_count?: number;
    rejected_count?: number;
    ready_today_count?: number;
    pending_count?: number;
    in_progress_count?: number;
    waiting_approval_count?: number;
    returned_count?: number;
}

export interface SupplierData {
    id: string;
    name: string;
    active_orders: any[]; // Raw DB structure
}

export interface DashboardData {
    role: 'lab' | 'designer' | 'admin' | 'representative' | 'accountant';
    stats: DashboardStats;
    active_orders: any[]; // Raw DB structure
    delayed_orders: any[]; // Raw DB structure
    unassigned_orders?: any[]; // Raw DB structure
    new_orders?: any[]; // Raw DB structure
    try_in_approved_orders?: any[]; // Raw DB structure
    orders?: any[]; // For Designer
    suppliers?: SupplierData[];
}

export const dashboardService = {
    async getDashboardData() {
        // console.log('Fetching dashboard data from RPC...');
        const { data, error } = await supabase.rpc('get_dashboard_data');

        if (error) {
            console.error('get_dashboard_data RPC error:', error);
            throw error;
        }

        // The RPC returns raw JSON. We may need to map orders to frontend structure if components expect full Order.
        // However, the RPC returns simplified objects.
        // Let's verify if we need to full dbToOrder or just pass raw data.
        // Dashboard uses: caseId, patientName, status, deliveryDate, items (serviceType), doctorId.
        // dbToOrder maps snake_case to camelCase. e.g. case_id -> caseId.
        // So we MUST map the raw data.

        const rawData = data as DashboardData;

        // Helper to map array of raw orders
        const mapOrders = (orders: any[]): Order[] => {
            if (!orders) return [];
            return orders.map((o: any) => ({
                id: o.id,
                caseId: o.case_id,
                patientName: o.patient_name,
                deliveryDate: o.delivery_date,
                status: o.status,
                doctorId: o.doctor_id,
                items: o.items ? (Array.isArray(o.items) ? o.items.map((i: any) => ({
                    serviceType: i.product_type || i.serviceType, // Handle both legacy and new
                    // Map other item fields if needed
                })) : []) : [],
                isUrgent: o.is_urgent,
                priority: o.priority,
                supplierId: o.supplier_id,
                technicianStatus: o.technician_status,
                // Add defaults for missing fields to satisfy Order interface
                created_at: '',
                updated_at: '',
                // ... other fields as partials or defaults
            } as any as Order));
            // Asserting as Order because we populated the fields mostly used by Dashboard.
            // Full mapping via dbToOrder is safer if we get all columns.
            // RPC gets subset.
        };

        // For Supplier list, we also need to map nested orders
        const mapSuppliers = (suppliers: any[]) => {
            if (!suppliers) return [];
            return suppliers.map(s => ({
                ...s,
                active_orders: mapOrders(s.active_orders)
            }));
        };

        return {
            role: rawData.role,
            stats: rawData.stats,
            activeOrders: mapOrders(rawData.active_orders),
            delayedOrders: mapOrders(rawData.delayed_orders),
            unassignedOrders: mapOrders(rawData.unassigned_orders || []),
            newOrders: mapOrders(rawData.new_orders || []),
            tryInApprovedOrders: mapOrders(rawData.try_in_approved_orders || []),
            designerOrders: mapOrders(rawData.orders || []), // For designer
            suppliers: mapSuppliers(rawData.suppliers || [])
        };
    }
};
