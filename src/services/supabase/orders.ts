import { supabase } from '../../lib/supabase';
import type { DbOrder, DbOrderInsert, DbOrderUpdate } from './types';
import type { Order } from '../db';
import { OrderCreateSchema, OrderUpdateSchema, formatValidationError } from '../../lib/validation';
import { ErrorHandler, ValidationError } from '../../lib/errorHandler';

// Transform database record to application format
function dbToOrder(dbOrder: DbOrder): Order {
    return {
        id: dbOrder.id,
        caseId: dbOrder.case_id,
        doctorId: dbOrder.doctor_id,
        patientName: dbOrder.patient_name,
        items: Array.isArray(dbOrder.items) ? dbOrder.items : [],
        discount: dbOrder.discount,
        totalPrice: dbOrder.total_price,
        shade: dbOrder.shade,
        status: dbOrder.status,
        deliveryDate: dbOrder.delivery_date,
        cost: dbOrder.cost,
        stlUrl: dbOrder.stl_url || undefined,
        imagesUrl: dbOrder.images_url || undefined,
        supplierId: dbOrder.supplier_id || undefined,
        createdAt: dbOrder.created_at,
        instructions: dbOrder.instructions || undefined,
        priority: dbOrder.priority,
        deliveryType: dbOrder.delivery_type || undefined,
        needsDesignReview: dbOrder.needs_design_review || undefined,
        technicianStatus: dbOrder.technician_status || undefined,
        isUrgent: dbOrder.is_urgent || false,
        comments: dbOrder.comments || undefined,
        representativeId: dbOrder.representative_id || undefined,
        isRegistered: dbOrder.is_registered || undefined,
        workflowType: dbOrder.workflow_type || undefined,
        designerId: dbOrder.designer_id || undefined,
        designStatus: dbOrder.design_status || undefined,
        designPrice: dbOrder.design_price || undefined,
        actualDeliveryDate: dbOrder.actual_delivery_date || undefined,
        feedback: dbOrder.feedback || undefined,
        isRedo: dbOrder.is_redo || undefined,
        originalOrderId: dbOrder.original_order_id || undefined,
        statusHistory: dbOrder.status_history || undefined,
    };
}

// Transform application format to database format
// Transform application format to database format
function orderToDb(order: Omit<Order, 'id' | 'createdAt'>): DbOrderInsert {
    return {
        case_id: order.caseId,
        doctor_id: order.doctorId,
        patient_name: order.patientName,
        items: order.items,
        discount: order.discount,
        total_price: order.totalPrice,
        shade: order.shade,
        status: order.status,
        delivery_date: order.deliveryDate,
        cost: order.cost,
        stl_url: order.stlUrl || null,
        images_url: order.imagesUrl || null,
        supplier_id: order.supplierId || null,
        instructions: order.instructions || null,
        priority: order.priority,
        delivery_type: order.deliveryType || null,
        needs_design_review: order.needsDesignReview || false,
        technician_status: order.technicianStatus || null,
        is_urgent: order.isUrgent || false,
        comments: order.comments || [],
        representative_id: order.representativeId || null,
        is_registered: order.isRegistered || false,
        workflow_type: order.workflowType || null,
        designer_id: order.designerId || null,
        design_status: order.designStatus || null,
        design_price: order.designPrice || null,
        actual_delivery_date: order.actualDeliveryDate || null,
        feedback: order.feedback || null,
        is_redo: order.isRedo || false,
        original_order_id: order.originalOrderId || null,
        status_history: order.statusHistory || [],
    };
}

export async function getOrders(): Promise<Order[]> {
    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        throw ErrorHandler.handle(error, 'getOrders');
    }

    return (data || []).map(dbToOrder);
}

export async function getOrder(id: string): Promise<Order | null> {
    // Validate UUID
    if (!id || typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new ValidationError('معرف الطلب غير صحيح');
    }

    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw ErrorHandler.handle(error, 'getOrder');
    }

    return data ? dbToOrder(data) : null;
}

export async function addOrder(order: Omit<Order, 'id' | 'createdAt'>): Promise<Order> {
    // Validate input
    try {
        OrderCreateSchema.parse(order);
    } catch (error: any) {
        throw new ValidationError(formatValidationError(error));
    }

    const dbOrder = orderToDb(order);

    const { data, error } = await supabase
        .from('orders')
        .insert(dbOrder)
        .select()
        .single();

    if (error) {
        throw ErrorHandler.handle(error, 'addOrder');
    }

    return dbToOrder(data);
}

export async function updateOrder(id: string, updates: Partial<Order>): Promise<Order | null> {
    // Validate UUID
    if (!id || typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new ValidationError('معرف الطلب غير صحيح');
    }

    // Validate updates if provided
    if (Object.keys(updates).length > 0) {
        try {
            OrderUpdateSchema.parse({ id, ...updates });
        } catch (error: any) {
            throw new ValidationError(formatValidationError(error));
        }
    }

    const dbUpdates: DbOrderUpdate = {};

    // Map all possible updates
    if (updates.caseId !== undefined) dbUpdates.case_id = updates.caseId;
    if (updates.doctorId !== undefined) dbUpdates.doctor_id = updates.doctorId;
    if (updates.patientName !== undefined) dbUpdates.patient_name = updates.patientName;
    if (updates.items !== undefined) dbUpdates.items = updates.items;
    if (updates.discount !== undefined) dbUpdates.discount = updates.discount;
    if (updates.totalPrice !== undefined) dbUpdates.total_price = updates.totalPrice;
    if (updates.shade !== undefined) dbUpdates.shade = updates.shade;
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.deliveryDate !== undefined) dbUpdates.delivery_date = updates.deliveryDate;
    if (updates.cost !== undefined) dbUpdates.cost = updates.cost;
    if (updates.stlUrl !== undefined) dbUpdates.stl_url = updates.stlUrl || null;
    if (updates.supplierId !== undefined) dbUpdates.supplier_id = updates.supplierId || null;
    if (updates.instructions !== undefined) dbUpdates.instructions = updates.instructions || null;
    if (updates.priority !== undefined) dbUpdates.priority = updates.priority;
    if (updates.deliveryType !== undefined) dbUpdates.delivery_type = updates.deliveryType || null;
    if (updates.needsDesignReview !== undefined) dbUpdates.needs_design_review = updates.needsDesignReview;
    if (updates.technicianStatus !== undefined) dbUpdates.technician_status = updates.technicianStatus || null;
    if (updates.comments !== undefined) dbUpdates.comments = updates.comments || [];
    if (updates.representativeId !== undefined) dbUpdates.representative_id = updates.representativeId || null;
    if (updates.isRegistered !== undefined) dbUpdates.is_registered = updates.isRegistered;
    if (updates.workflowType !== undefined) dbUpdates.workflow_type = updates.workflowType || null;
    if (updates.designerId !== undefined) dbUpdates.designer_id = updates.designerId || null;
    if (updates.designStatus !== undefined) dbUpdates.design_status = updates.designStatus || null;
    if (updates.designPrice !== undefined) dbUpdates.design_price = updates.designPrice || null;
    if (updates.actualDeliveryDate !== undefined) dbUpdates.actual_delivery_date = updates.actualDeliveryDate || null;
    if (updates.feedback !== undefined) dbUpdates.feedback = updates.feedback || null;
    if (updates.isRedo !== undefined) dbUpdates.is_redo = updates.isRedo;
    if (updates.originalOrderId !== undefined) dbUpdates.original_order_id = updates.originalOrderId;

    // --- TIME TRACKING LOGIC ---
    if (updates.status !== undefined) {
        // If status is changing, we need to update history
        const timestamp = new Date().toISOString();

        // fetch current order to get old status and history
        let currentOrder: Order | null = null;
        try {
            currentOrder = await getOrder(id);
        } catch (e) {
            console.error('Failed to fetch order for history update', e);
        }

        if (currentOrder && currentOrder.status !== updates.status) {
            let history = currentOrder.statusHistory || [];

            // 1. Close the previous status entry (if exists)
            // Ideally we find the last entry that matches oldStatus and has no exitedAt
            // But for simplicity, we can just find the last entry
            if (history.length > 0) {
                const lastEntry = history[history.length - 1];
                if (!lastEntry.exitedAt) {
                    lastEntry.exitedAt = timestamp;
                    // Calculate duration in minutes
                    const start = new Date(lastEntry.enteredAt).getTime();
                    const end = new Date(timestamp).getTime();
                    lastEntry.durationMinutes = Math.round((end - start) / (1000 * 60));
                }
            } else {
                // If no history, maybe add an initial entry for the creation?
                // For now, let's just assume we start tracking from now.
            }

            // 2. Add new entry
            history.push({
                status: updates.status,
                enteredAt: timestamp
            });

            dbUpdates.status_history = history;
        }
    }

    const { data, error } = await supabase
        .from('orders')
        .update(dbUpdates)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw ErrorHandler.handle(error, 'updateOrder');
    }

    return data ? dbToOrder(data) : null;
}

export async function deleteOrder(id: string): Promise<void> {
    // Validate UUID
    if (!id || typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new ValidationError('معرف الطلب غير صحيح');
    }

    const { error } = await supabase
        .from('orders')
        .delete()
        .eq('id', id);

    if (error) {
        throw ErrorHandler.handle(error, 'deleteOrder');
    }
}

export async function bulkUpsertOrders(orders: Order[]): Promise<number> {
    const dbOrders = orders.map(order => {
        const dbOrder = orderToDb(order);
        return {
            ...dbOrder,
            id: order.id, // Include ID for upsert
        };
    });

    const { data, error } = await supabase
        .from('orders')
        .upsert(dbOrders, { onConflict: 'id' })
        .select('id');

    if (error) {
        console.error('Error bulk upserting orders:', error);
        throw new Error(`Failed to bulk upsert orders: ${error.message}`);
    }

    return data?.length || 0;
}

export async function getOrderHistory(orderId: string): Promise<any[]> {
    const { data, error } = await supabase
        .from('order_history')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching history:', error);
        return [];
    }
    return data || [];
}
