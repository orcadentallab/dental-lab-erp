/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { supabase } from '../../lib/supabase';
import type { DbOrder, DbOrderInsert, DbOrderUpdate, DbOrderItemRow, DbOrderCommentRow } from './types';
import type { Order, OrderHistoryEntry, Transaction } from '../db';
import { OrderCreateSchema, OrderUpdateSchema, formatValidationError } from '../../lib/validation';
import { ErrorHandler, ValidationError } from '../../lib/errorHandler';
import { generateArabicSearchPattern } from '../../lib/searchUtils';

// Helper to handle joined data which isn't in DbOrder type
interface DbOrderWithRelations extends DbOrder {
    order_items?: DbOrderItemRow[];
    order_comments?: DbOrderCommentRow[];
}

// Transform database record to application format
function dbToOrder(dbOrder: DbOrderWithRelations): Order {
    // 1. Map Items (Prefer joined table, fallback to legacy JSON)
    let items: Order['items'] = [];
    if (dbOrder.order_items && dbOrder.order_items.length > 0) {
        items = dbOrder.order_items.map(i => ({
            serviceType: i.product_type,
            teethNumbers: i.teeth_numbers,
            price: i.price,
            shade: i.shade || undefined
        }));
    } else if (Array.isArray(dbOrder.items) && dbOrder.items.length > 0) {
        items = dbOrder.items;
    }

    // 2. Map Comments (Prefer joined table, fallback to legacy JSON)
    let comments: Order['comments'] = [];
    if (dbOrder.order_comments && dbOrder.order_comments.length > 0) {
        comments = dbOrder.order_comments.map(c => ({
            id: c.id,
            text: c.content,
            userId: c.user_id || 'system',
            userName: c.user_name || 'System',
            createdAt: c.created_at
        }));
    } else if (Array.isArray(dbOrder.comments) && dbOrder.comments.length > 0) {
        comments = dbOrder.comments;
    }

    return {
        id: dbOrder.id,
        caseId: dbOrder.case_id,
        doctorId: dbOrder.doctor_id,
        patientName: dbOrder.patient_name,
        items: items,
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
        comments: comments,
        representativeId: dbOrder.representative_id || undefined,
        isRegistered: dbOrder.is_registered || undefined,
        workflowType: dbOrder.workflow_type || undefined,
        designerId: dbOrder.designer_id || undefined,
        designUrl: dbOrder.design_url || undefined,
        designStatus: dbOrder.design_status || undefined,
        designPrice: dbOrder.design_price || undefined,
        actualDeliveryDate: dbOrder.actual_delivery_date || undefined,
        feedback: dbOrder.feedback || undefined,
        isRedo: dbOrder.is_redo || undefined,
        originalOrderId: dbOrder.original_order_id || undefined,
        statusHistory: dbOrder.status_history || undefined,
        isArchived: dbOrder.is_archived || false,
        rejectedLabCost: dbOrder.rejected_lab_cost || undefined,
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
        design_url: order.designUrl || null,
        design_status: order.designStatus || null,
        design_price: order.designPrice || null,
        actual_delivery_date: order.actualDeliveryDate || null,
        feedback: order.feedback || null,
        is_redo: order.isRedo || false,
        original_order_id: order.originalOrderId || null,
        status_history: order.statusHistory || [],
        is_archived: order.isArchived || false,
        rejected_lab_cost: order.rejectedLabCost || null,
    };
}

// Filter options for getOrders
export interface OrderFilters {
    status?: string;
    startDate?: string; // YYYY-MM-DD
    endDate?: string;   // YYYY-MM-DD
    doctorId?: string;
    representativeId?: string;
    supplierId?: string;
    designerId?: string;
    search?: string; // Searches case_id, patient_name
    hideDelivered?: boolean;

    // hideRejected replaced by showArchived
    showArchived?: boolean;
}

export interface PaginatedOrdersResult {
    data: Order[];
    count: number;
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * Fetches orders with mandatory pagination and server-side filtering.
 * NO unbounded queries allowed.
 */
export async function getOrders(
    page: number = 1,
    limit: number = DEFAULT_PAGE_SIZE,
    filters: OrderFilters = {}
): Promise<PaginatedOrdersResult> {
    // Calculate range for pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Start building query with count
    let query = supabase
        .from('orders')
        .select('*, order_items(*), order_comments(*)', { count: 'exact' });

    // Apply filters
    if (filters.status) {
        query = query.eq('status', filters.status);
    }

    if (filters.startDate) {
        query = query.gte('created_at', `${filters.startDate}T00:00:00`);
    }

    if (filters.endDate) {
        query = query.lte('created_at', `${filters.endDate}T23:59:59`);
    }

    if (filters.doctorId) {
        query = query.eq('doctor_id', filters.doctorId);
    }

    if (filters.representativeId) {
        query = query.eq('representative_id', filters.representativeId);
    }

    if (filters.supplierId) {
        if (filters.supplierId === 'internal') {
            query = query.is('supplier_id', null);
        } else {
            query = query.eq('supplier_id', filters.supplierId);
        }
    }

    if (filters.designerId) {
        query = query.eq('designer_id', filters.designerId);
    }

    if (filters.hideDelivered) {
        query = query.neq('status', 'Delivered');
    }

    // Archive Filter
    if (filters.showArchived) {
        query = query.eq('is_archived', true);
    } else {
        // Default: Show active orders (false OR null)
        // Fix: Explicitly include NULLs because 'not.eq.true' excludes them in SQL
        query = query.or('is_archived.eq.false,is_archived.is.null');
    }



    // Legacy filter: We don't need hideRejected anymore if using Archive workflow
    // But keeping it for backward compatibility if needed, though UI will use showArchived
    // if (filters.hideRejected) { ... }

    // Search filter: case_id OR patient_name OR doctor_name OR doctor_code
    if (filters.search && filters.search.trim()) {
        const regexBuilder = generateArabicSearchPattern(filters.search.trim());
        const regex = `"${regexBuilder}"`; // Wrap in quotes for PostgREST to handle meaningful characters

        // 1. Find matching doctors first
        const { data: matchingDoctors } = await supabase
            .from('doctors')
            .select('id')
            .or(`name.imatch.${regex},doctor_code.imatch.${regex}`);

        const doctorIds = matchingDoctors?.map(d => d.id) || [];

        // 2. Build OR query
        let orQuery = `case_id.imatch.${regex},patient_name.imatch.${regex}`;

        if (doctorIds.length > 0) {
            // Postgres syntax for IN in OR filter is a bit tricky with Supabase JS
            // Simpler: doctor_id.in.(${id1,id2})
            orQuery += `,doctor_id.in.(${doctorIds.join(',')})`;
        }

        query = query.or(orQuery);
    }

    // Apply ordering and pagination
    query = query
        .order('created_at', { ascending: false })
        .range(from, to);

    const { data, error, count } = await query;

    if (error) {
        throw ErrorHandler.handle(error, 'getOrders');
    }

    return {
        data: (data || []).map(d => dbToOrder(d as unknown as DbOrderWithRelations)),
        count: count || 0
    };
}

/**
 * Optimized fetch for Dashboard.
 * FILTERS AT DATABASE LEVEL to reduce RLS overhead.
 * Returns: Active Orders (excludes Delivered, Cancelled, completed older than 7 days)
 */
export async function getDashboardActiveOrders(): Promise<Order[]> {
    // Calculate date 7 days ago for limiting returned orders
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateLimit = sevenDaysAgo.toISOString();

    // Optimized query: Filter at database level
    const { data, error } = await supabase
        .from('orders')
        .select('*, order_items(*), order_comments(*)')  // Include relations
        // Fix: Use single OR to get (Active) OR (Recent)
        // Previous chained .not().or() resulted in (Active) AND (Recent), hiding old active orders
        .or(`status.not.in.("Delivered","Cancelled"),created_at.gte.${dateLimit}`)
        // Fix: Exclude archived orders explicitly (keeping NULLs visible)
        .or('is_archived.eq.false,is_archived.is.null')
        .order('created_at', { ascending: false })
        .range(0, 499); // Limit to 500 orders max for dashboard

    if (error) {
        throw ErrorHandler.handle(error, 'getDashboardActiveOrders');
    }

    // Map to Order objects (dbToOrder handles missing relations gracefully)
    return (data || []).map(d => dbToOrder(d as unknown as DbOrderWithRelations));
}

/**
 * @deprecated Use getOrders(page, limit, filters) instead.
 * This function fetches ALL orders and should only be used for exports or legacy code.
 */
export async function getAllOrdersUnpaginated(): Promise<Order[]> {
    // console.warn('getAllOrdersUnpaginated: This function fetches all orders. Use getOrders() with pagination for normal use.');
    const { data, error } = await supabase
        .from('orders')
        .select('*, order_items(*), order_comments(*)')
        .order('created_at', { ascending: false })
        .range(0, 4999); // Fetch up to 5000 orders (Safe limit for single request)

    if (error) {
        throw ErrorHandler.handle(error, 'getAllOrdersUnpaginated');
    }

    return (data || []).map(d => dbToOrder(d as unknown as DbOrderWithRelations));
}

/**
 * Heavy-duty fetch for Exports. Range up to 20,000.
 */
export async function fetchAllOrdersForExport(): Promise<Order[]> {
    const { data, error } = await supabase
        .from('orders')
        .select('*, order_items(*), order_comments(*)')
        .order('created_at', { ascending: false })
        .range(0, 19999);

    if (error) throw ErrorHandler.handle(error, 'fetchAllOrdersForExport');
    return (data || []).map(d => dbToOrder(d as unknown as DbOrderWithRelations));
}

/**
 * LIGHTWEIGHT fetch for Finance Summary (Accounts Page)
 * Fetches only ID, Status, Prices, Dates to calculate totals.
 * Range: 0-9999 (Should be enough for summary, or we can paginate later)
 */
export async function getOrdersForFinanceSummary(): Promise<Partial<Order>[]> {
    const { data, error } = await supabase
        .from('orders')
        .select('id, doctor_id, supplier_id, designer_id, status, total_price, cost, design_price, workflow_type, created_at, delivery_date, is_archived, rejected_lab_cost')
        .order('created_at', { ascending: false })
        .range(0, 9999);

    if (error) throw ErrorHandler.handle(error, 'getOrdersForFinanceSummary');

    // Map to Partial<Order> - manually to avoid heavy dbToOrder overhead
    return (data || []).map(d => ({
        id: d.id,
        doctorId: d.doctor_id,
        supplierId: d.supplier_id || undefined,
        designerId: d.designer_id || undefined,
        status: d.status,
        totalPrice: d.total_price,
        cost: d.cost,
        designPrice: d.design_price || undefined,
        workflowType: d.workflow_type || undefined,
        createdAt: d.created_at,
        deliveryDate: d.delivery_date,
        isArchived: d.is_archived || undefined,
        rejectedLabCost: d.rejected_lab_cost || undefined
    }));
}

/**
 * Fetch all data for a single entity statement.
 * FIXED: Now fetches transactions by entity_id only at DB level,
 * then filters by entity_type in JS to handle legacy records where
 * entity_type might be null or different.
 */
export async function fetchFullEntityStatement(
    entityId: string,
    entityType: 'doctor' | 'supplier' | 'designer'
): Promise<{ orders: Order[], transactions: Transaction[] }> {

    // 1. Fetch Orders for this Entity
    let orderQuery = supabase
        .from('orders')
        .select('*, order_items(*), order_comments(*)')
        .order('created_at', { ascending: false });

    if (entityType === 'doctor') orderQuery = orderQuery.eq('doctor_id', entityId);
    else if (entityType === 'supplier') orderQuery = orderQuery.eq('supplier_id', entityId);
    else if (entityType === 'designer') orderQuery = orderQuery.eq('designer_id', entityId);

    // Fetch up to 10,000 orders for a single entity (plenty)
    const { data: ordersData, error: orderError } = await orderQuery.range(0, 9999);
    if (orderError) throw ErrorHandler.handle(orderError, 'fetchFullEntityStatement_Orders');

    // 2. Fetch Transactions for this Entity
    // FIXED: Only filter by entity_id at DB level to catch all transactions
    // including legacy ones that might have null/different entity_type
    const { data: txData, error: txError } = await supabase
        .from('transactions')
        .select('*')
        .eq('entity_id', entityId)
        .order('date', { ascending: false })
        .range(0, 4999);

    if (txError) throw ErrorHandler.handle(txError, 'fetchFullEntityStatement_Tx');

    // Filter transactions in JS to match expected entity_type OR handle nulls
    const filteredTransactions = (txData || []).filter(t => {
        const tx = t as unknown as { entity_type?: string | null };
        return tx.entity_type === entityType || tx.entity_type === null || tx.entity_type === undefined;
    });

    // CRITICAL FIX: Map DB format (snake_case) to app format (camelCase)
    // Without this, the transactions have wrong field names!
    const mappedTransactions: Transaction[] = filteredTransactions.map(t => {
        const tx = t as unknown as Record<string, unknown>;
        return {
            id: tx['id'] as string,
            type: tx['type'] as Transaction['type'],
            amount: tx['amount'] as number,
            category: tx['category'] as string,
            date: tx['date'] as string,
            description: (tx['description'] as string | undefined) ?? '',
            entityId: (tx['entity_id'] as string | undefined) || undefined,
            entityType: (tx['entity_type'] as Transaction['entityType'] | undefined) || undefined,
            isRegistered: (tx['is_registered'] as boolean | undefined) || undefined,
            isApproved: (tx['is_approved'] as boolean | undefined) || undefined,
            createdAt: tx['created_at'] as string,
        };
    });

    return {
        orders: (ordersData || []).map(d => dbToOrder(d as unknown as DbOrderWithRelations)),
        transactions: mappedTransactions
    };
}

export async function getOrder(id: string): Promise<Order | null> {
    // Validate UUID
    if (!id || typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new ValidationError('معرف الطلب غير صحيح');
    }

    const { data, error } = await supabase
        .from('orders')
        .select('*, order_items(*), order_comments(*)')
        .eq('id', id)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw ErrorHandler.handle(error, 'getOrder');
    }

    return data ? dbToOrder(data as unknown as DbOrderWithRelations) : null;
}

export async function addOrder(order: Omit<Order, 'id' | 'createdAt'>): Promise<Order> {
    // Validate input
    try {
        OrderCreateSchema.parse(order);
    } catch (error: unknown) {
        throw new ValidationError(formatValidationError(error));
    }

    const dbOrder = orderToDb(order);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { items: _items, comments: _comments, ...orderRow } = dbOrder; // Separate items/comments

    // 1. Insert Order
    const { data: insertedOrder, error } = await supabase
        .from('orders')
        .insert(orderRow)
        .select()
        .single();

    if (error) {
        throw ErrorHandler.handle(error, 'addOrder');
    }

    const newOrderId = insertedOrder.id;

    // 2. Insert Items
    if (order.items && order.items.length > 0) {
        const itemRows = order.items.map(i => ({
            order_id: newOrderId,
            product_type: i.serviceType,
            teeth_numbers: i.teethNumbers,
            price: i.price,
            shade: i.shade,
            count: i.teethNumbers.length || 1
        }));

        const { error: itemsError } = await supabase.from('order_items').insert(itemRows);
        if (itemsError) console.error('Failed to insert items:', itemsError);
    }

    // 3. Insert Comments
    if (order.comments && order.comments.length > 0) {
        const commentRows = order.comments.map(c => ({
            order_id: newOrderId,
            content: c.text,
            user_id: c.userId === 'system' ? null : c.userId, // Validate UUID?
            user_name: c.userName,
            created_at: c.createdAt
        }));

        const { error: commentsError } = await supabase.from('order_comments').insert(commentRows);
        if (commentsError) console.error('Failed to insert comments:', commentsError);
    }

    // Re-fetch formatted order with relations
    return getOrder(newOrderId) as Promise<Order>;
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
        } catch (error: unknown) {
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
    if (updates.imagesUrl !== undefined) dbUpdates.images_url = updates.imagesUrl || null;
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
    if (updates.designUrl !== undefined) dbUpdates.design_url = updates.designUrl || null;
    if (updates.designStatus !== undefined) dbUpdates.design_status = updates.designStatus || null;
    if (updates.designPrice !== undefined) dbUpdates.design_price = updates.designPrice || null;
    if (updates.actualDeliveryDate !== undefined) dbUpdates.actual_delivery_date = updates.actualDeliveryDate || null;
    if (updates.feedback !== undefined) dbUpdates.feedback = updates.feedback || null;
    if (updates.isRedo !== undefined) dbUpdates.is_redo = updates.isRedo;

    if (updates.originalOrderId !== undefined) dbUpdates.original_order_id = updates.originalOrderId;
    if (updates.isArchived !== undefined) dbUpdates.is_archived = updates.isArchived;
    if (updates.rejectedLabCost !== undefined) dbUpdates.rejected_lab_cost = updates.rejectedLabCost || null;

    // --- SENSITIVE CHANGE DETECTION ---
    // If a sensitive financial or identity field changes, we reset registration status
    // so the accountant can review and re-register if necessary.
    const sensitiveFields: (keyof Order)[] = ['totalPrice', 'cost', 'doctorId', 'items', 'patientName', 'supplierId', 'isRedo', 'rejectedLabCost'];
    const hasSensitiveUpdate = sensitiveFields.some(field => updates[field] !== undefined);

    if (hasSensitiveUpdate && updates.isRegistered === undefined) {
        dbUpdates.is_registered = false;
    }

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
            const history = currentOrder.statusHistory || [];

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

    // dbUpdates might contain items/comments from legacy mapping
    // We should remove them before updating orders table typings
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { items: _items, comments: _comments, ...cleanUpdates } = dbUpdates as unknown as Record<string, unknown>;

    try {
        const { error } = await supabase.rpc('update_order_atomic', {
            p_order_id: id,
            p_updates: cleanUpdates,
            p_items: updates.items ? updates.items.map(i => ({
                product_type: i.serviceType,
                teeth_numbers: i.teethNumbers,
                price: i.price,
                shade: i.shade,
                count: i.teethNumbers.length || 1
            })) : null,
            p_comments: updates.comments ? updates.comments.map(c => ({
                text: c.text,
                userId: c.userId === 'system' ? null : c.userId,
                userName: c.userName,
                createdAt: c.createdAt
            })) : null
        });

        if (error) {
            console.error('update_order_atomic RPC failed:', error);
            throw ErrorHandler.handle(error, 'updateOrder');
        }
    } catch (error) {
        throw ErrorHandler.handle(error, 'updateOrder');
    }

    return getOrder(id);
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

export async function getOrderHistory(orderId: string): Promise<OrderHistoryEntry[]> {
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

// ============================================================================
// CENTRALIZED STATUS UPDATE FUNCTION
// All status changes MUST go through this function to ensure consistency.
// ============================================================================

export interface StatusUpdateContext {
    designUrl?: string;      // When designer uploads a design
    comment?: string;        // Optional comment to add
    userId?: string;         // User making the change
    userName?: string;       // User name for comment attribution
    rejectedLabCost?: number; // Cost to lab when rejected
}

/**
 * STATUS SYNCHRONIZATION MAP
 * Defines which designStatus should accompany each main status for Split Workflows.
 */
const STATUS_TO_DESIGN_STATUS: Record<string, Order['designStatus'] | undefined> = {
    'New Case': 'pending',
    'Under Design': 'in_progress',
    'Waiting Dr Approval': 'waiting_approval',
    'Under Production': 'completed',
    'Try In': 'completed',
    'Try In Approved': 'completed',
    'Ready': 'completed',
    'Delivered': 'completed',
    'Returned for Adjustments': 'returned',
    'Rejected': undefined, // Designer not involved
};

/**
 * Centralized function for updating order status.
 * ENFORCES:
 * - Status/designStatus synchronization for Split Workflows
 * - Status history tracking
 * - Optional side-effects (design URL, comments)
 * 
 * UI MUST NOT update status or designStatus directly. Use this function only.
 */
export async function updateOrderStatus(
    orderId: string,
    newStatus: Order['status'],
    context: StatusUpdateContext = {}
): Promise<Order | null> {
    // Validate UUID
    if (!orderId || typeof orderId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
        throw new ValidationError('معرف الطلب غير صحيح');
    }

    // Fetch current order to determine if it's a Split Workflow
    const currentOrder = await getOrder(orderId);
    if (!currentOrder) {
        throw new ValidationError('الطلب غير موجود');
    }

    // Build updates object
    const updates: Partial<Order> = {
        status: newStatus,
    };

    // CRITICAL: Sync designStatus for Split Workflows
    if (currentOrder.workflowType === 'split') {
        const syncedDesignStatus = STATUS_TO_DESIGN_STATUS[newStatus];
        if (syncedDesignStatus !== undefined) {
            updates.designStatus = syncedDesignStatus;
        }
    }

    // Handle design URL if provided
    if (context.designUrl) {
        updates.designUrl = context.designUrl;
    }

    // Handle comments if provided
    if (context.comment && context.userId && context.userName) {
        const newComment = {
            id: Math.random().toString(36).substr(2, 9),
            text: context.comment,
            userId: context.userId,
            userName: context.userName,
            createdAt: new Date().toISOString()
        };
        updates.comments = [...(currentOrder.comments || []), newComment];
    }

    if (context.rejectedLabCost !== undefined) {
        updates.rejectedLabCost = context.rejectedLabCost;
    }

    // Use existing updateOrder for the actual update (handles history tracking)
    return updateOrder(orderId, updates);
}

/**
 * Convenience function for designers uploading design links.
 * Updates status to 'Waiting Dr Approval' and adds a system comment.
 */
export async function submitDesignForApproval(
    orderId: string,
    designUrl: string,
    userId: string,
    userName: string
): Promise<Order | null> {
    return updateOrderStatus(orderId, 'Waiting Dr Approval', {
        designUrl,
        comment: `🔗 تم إضافة/تحديث رابط التصميم:\n${designUrl}`,
        userId,
        userName
    });
}


/**
 * Calculates total cost of all non-rejected orders for a specific doctor.
 */
export async function getDoctorTotalCost(doctorId: string): Promise<number> {
    const { data, error } = await supabase
        .from('orders')
        .select('cost')
        .eq('doctor_id', doctorId)
        .neq('status', 'Rejected')
        .neq('status', 'Cancelled');

    if (error) {
        console.error('Error fetching doctor total cost:', error);
        return 0;
    }

    return (data || []).reduce((sum, order) => sum + (order.cost || 0), 0);
}
