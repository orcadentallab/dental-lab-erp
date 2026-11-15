import { supabase } from '../../lib/supabase';

export interface ShipmentOrder {
  id: string;
  shipment_id: string;
  order_id: string;
  notes: string | null;
  created_at: string;
  stage?: { name_override: string | null } | null;
  order?: {
    id: string;
    case_id: string;
    patient_name: string;
    total_price: number;
    status: string;
    production_status?: string;
    route_override_id?: string | null;
    shade?: string;
  };
}

export interface Shipment {
  retry_of?: string | null;
  attempt_outcome_reason?: string | null;
  hub_leg?: boolean;
  cash_carrier?: 'middle_east' | 'scooter' | null;
  previous_shipping_leg?: string | null;
  intake_patient_name?: string | null;
  direction?: 'to_doctor' | 'to_lab';
  shipping_area?: string | null;
  scooter_payment_pending?: boolean;
  immediate_expense_id?: string | null;
  base_shipping_cost?: number | null;
  id: string;
  shipment_code: string;
  courier_id: string | null;
  doctor_id: string | null;
  tracking_ref: string | null;
  status: 'packing' | 'ready_for_pickup' | 'dispatched' | 'delivered' | 'failed' | 'returned' | 'cancelled';
  packed_by: string | null;
  packed_at: string | null;
  packing_proof_urls: string[];
  requested_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  delivery_proof_url: string | null;
  cost_amount: number | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  delivery_address: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  courier?: {
    id: string;
    name: string;
    phone?: string;
  } | null;
  doctor?: {
    id: string;
    name: string;
    phone?: string;
    address?: string;
  } | null;
  orders?: ShipmentOrder[];
}

interface ShippingClinic {
  name: string;
  phone: string | null;
  address: string | null;
  shipping_area?: string | null;
  branches?: Array<{ name: string; phone?: string; address?: string; shippingArea?: string }> | null;
}

export interface ReadyToPackOrder {
  id: string;
  case_id: string;
  doctor_id: string;
  patient_name: string;
  total_price: number;
  status: string;
  production_status: string;
  route_override_id?: string | null;
  shade: string | null;
  delivery_date: string | null;
  branch_name: string | null;
  doctor?: ShippingClinic & {
    id: string;
    parent?: ShippingClinic | null;
  } | null;
}

export const ACTIVE_SHIPMENT_STATUSES: Shipment['status'][] = ['packing', 'ready_for_pickup', 'dispatched'];
const READY_TO_PACK_STATUSES = ['final_ready', 'try_in_ready'];

async function getActiveShipmentOrderIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('shipment_orders')
    .select('order_id, shipments!inner(status,direction,hub_leg)')
    .in('shipments.status', ACTIVE_SHIPMENT_STATUSES)
    .or('direction.eq.to_doctor,hub_leg.eq.true', { referencedTable: 'shipments' });
  if (error) throw error;
  return [...new Set((data ?? []).map(link => link.order_id))];
}

export const shippingService = {
  async getOpenCaseCount(): Promise<number> {
    const activeOrderIds = await getActiveShipmentOrderIds();
    let query = supabase.from('orders').select('id', { count: 'exact', head: true })
      .in('production_status', READY_TO_PACK_STATUSES)
      .eq('is_deleted', false);
    if (activeOrderIds.length) query = query.not('id', 'in', `(${activeOrderIds.join(',')})`);
    const { count, error } = await query;
    if (error) throw error;
    return activeOrderIds.length + (count ?? 0);
  },

  /**
   * Get orders that are ready to be packed and shipped
   * (e.g. final_ready or ready status, not in an active shipment)
   */
  async getReadyToPackOrders(): Promise<ReadyToPackOrder[]> {
    const activeOrderIds = await getActiveShipmentOrderIds();

    // 2. Query ready orders
    let query = supabase
      .from('orders')
      .select(`
        id,
        case_id,
        doctor_id,
        patient_name,
        total_price,
        status,
        production_status,
        route_override_id,
        shade,
        delivery_date,
        branch_name,
        doctor:doctors(id, name, phone, address, shipping_area, branches, parent:doctors!parent_id(name, phone, address, shipping_area, branches))
      `)
      .in('production_status', READY_TO_PACK_STATUSES)
      .eq('is_deleted', false)
      .order('delivery_date', { ascending: true });

    if (activeOrderIds.length > 0) {
      // Exclude orders in active shipments
      query = query.not('id', 'in', `(${activeOrderIds.join(',')})`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as unknown as ReadyToPackOrder[];
  },

  /**
   * Get list of shipments with filters
   */
  async getShipments(filters?: {
    status?: string;
    courierId?: string;
    doctorId?: string;
    search?: string;
  }): Promise<Shipment[]> {
    let query = supabase
      .from('shipments')
      .select(`
        *,
        courier:suppliers(id, name, phone),
        doctor:doctors(id, name, phone, address),
        orders:shipment_orders(
          id,
          shipment_id,
          order_id,
          notes,
          created_at,
          stage:production_stage_runs!production_stage_run_id(name_override),
          order:orders(
            id,
            case_id,
            patient_name,
            total_price,
            status,
            production_status,
            route_override_id,
            shade
          )
        )
      `)
      .order('created_at', { ascending: false });

    if (filters?.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }
    if (filters?.courierId && filters.courierId !== 'all') {
      query = query.eq('courier_id', filters.courierId);
    }
    if (filters?.doctorId && filters.doctorId !== 'all') {
      query = query.eq('doctor_id', filters.doctorId);
    }
    if (filters?.search) {
      const s = `%${filters.search.trim()}%`;
      query = query.or(`shipment_code.ilike.${s},tracking_ref.ilike.${s},recipient_name.ilike.${s}`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as unknown as Shipment[];
  },

  /**
   * Create a new shipment (aggregating 1 or more orders)
   */
  async createShipment(payload: {
    requestId: string;
    carrier?: 'middle_east' | 'scooter';
    hub?: boolean;
    area?: string;
    direction?: 'to_lab' | 'to_doctor';
    expenseId?: string;
    pendingExpense?: boolean;
    patient?: string;
    branch?: string;
    courierId?: string | null;
    doctorId?: string | null;
    trackingRef?: string;
    orderIds: string[];
    packingProofUrls?: string[];
    recipientName?: string;
    recipientPhone?: string;
    deliveryAddress?: string;
    notes?: string;
  }): Promise<{ success: boolean; shipment_id: string; shipment_code: string; order_count: number }> {
    const { data, error } = await supabase.rpc('create_routed_shipping_request', {
      p_carrier: payload.carrier || null, p_hub: payload.hub ?? false,
      p_id: payload.requestId, p_area: payload.area || null, p_direction: payload.direction ?? 'to_doctor',
      p_expense: payload.expenseId || null, p_scooter_pending: payload.pendingExpense ?? false,
      p_patient: payload.patient || null, p_branch: payload.branch || null,
      p_courier: payload.courierId || null, p_doctor: payload.doctorId || null,
      p_tracking: payload.trackingRef || null, p_orders: payload.orderIds, p_photos: payload.packingProofUrls || [],
      p_recipient: payload.recipientName || null, p_phone: payload.recipientPhone || null,
      p_address: payload.deliveryAddress || null, p_notes: payload.notes || null,
    });

    if (error) throw error;
    return data;
  },

  /**
   * Mark shipment as dispatched (handed over to courier)
   */
  async dispatchShipment(
    shipmentId: string,
    trackingRef?: string,
    notes?: string
  ): Promise<{ success: boolean; shipment_id: string; status: string }> {
    const { data, error } = await supabase.rpc('dispatch_shipment', {
      p_shipment_id: shipmentId,
      p_tracking_ref: trackingRef || null,
      p_notes: notes || null,
    });

    if (error) throw error;
    return data;
  },

  /**
   * Confirm delivery of a shipment.
   *
   * This bills the doctor: every order travels record_order_final_delivery_v2,
   * the same path the order-level delivery button uses, which sets
   * first_delivered_at and raises the doctor_delivered obligation. Orders with
   * an open issue, or already delivered, come back in `orders_skipped` -- show
   * them, because those cases were NOT billed.
   *
   * Admin and lab only, matching the underlying delivery RPC.
   */
  async confirmDelivery(
    shipmentId: string,
    deliveryProofUrl?: string,
    deliveredAt?: string,
    notes?: string,
    amount?: number,
    cashbox?: string
  ): Promise<{
    success: boolean;
    shipment_id: string;
    status: string;
    orders_in_shipment: number;
    orders_delivered: number;
    orders_trial_received?: number;
    orders_skipped: Array<{ order_id: string; case_id: string; reason: 'already_delivered' | 'open_issue' }>;
    delivered_at: string;
  }> {
    const { data, error } = await supabase.rpc('confirm_shipping_request', {
      p_id: shipmentId,
      p_photo: deliveryProofUrl || null,
      p_at: deliveredAt || null,
      p_amount: amount ?? null, p_cashbox: cashbox ?? null,
      p_notes: notes || null,
    });

    if (error) throw error;
    return data;
  },

  /**
   * Cancel shipment
   */
  async closeAttempt(id: string, outcome: 'failed' | 'returned' | 'cancelled', reason: string, amount?: number, cashbox?: string) {
    const { error } = await supabase.rpc('close_shipping_attempt', {
      p_id: id, p_outcome: outcome, p_reason: reason, p_amount: amount ?? null, p_cashbox: cashbox ?? null,
    });
    if (error) throw new Error(error.message);
  },

  async retryAttempt(id: string) {
    const { error } = await supabase.rpc('retry_shipping_attempt', { p_id: id });
    if (error) throw new Error(error.message);
  },

  async cancelShipment(shipmentId: string, notes?: string): Promise<{ success: boolean }> {
    const { data, error } = await supabase.rpc('cancel_shipment', {
      p_shipment_id: shipmentId,
      p_notes: notes || null,
    });

    if (error) throw error;
    return data;
  },

  /**
   * Get active couriers list
   */
  async getCouriers(): Promise<Array<{ id: string; name: string; phone?: string }>> {
    const { data, error } = await supabase
      .from('suppliers')
      .select('id, name, phone')
      .eq('supplier_type', 'courier')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    return data || [];
  },

  /**
   * Upload packing proof or delivery proof image to case-files bucket
   */
  async uploadProofImage(file: File, shipmentCode: string, proofType: 'packing' | 'delivery'): Promise<string> {
    const fileExt = file.name.split('.').pop();
    const fileName = `shipments/${shipmentCode}/${proofType}_${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from('case-files')
      .upload(fileName, file, { upsert: true });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from('case-files').getPublicUrl(fileName);
    return data.publicUrl;
  },
};
