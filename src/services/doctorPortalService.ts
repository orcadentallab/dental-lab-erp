import { supabase } from '../lib/supabase';
import type { DoctorBranch, OrderItem, Service } from './db';
export interface PortalContext { doctor_id: string; name: string; is_center: boolean; clinic_name: string; contact_phone: string; address: string; branches: DoctorBranch[]; members: { id: string; name: string; phone: string; doctor_code: string; has_account: boolean }[] }
export interface PortalMonth { month: string; is_center: boolean; charges: number; payments: number; adjustments: number; difference: number; cases: { case_id: string; patient_name: string; doctor_name: string; date: string; amount: number }[]; by_doctor: { id: string; name: string; amount: number; paid: number }[] }
export interface PortalMessage { id: string; body: string; reply?: string; created_at: string; case_id?: string; doctor_name?: string }
export interface PortalPickup { id: string; status: string; address: string; branch_name?: string; doctor_name: string; case_id: string; contact_phone: string; pickup_timing?: string; trays_details?: string; coordination_note?: string }
export const PICKUP_LABELS: Record<string, string> = { requested: 'بانتظار تنسيق الاستلام', scheduled: 'تم تنسيق الاستلام', collected: 'تم استلام المقاس من العيادة', received: 'وصل المقاس للمعمل', cancelled: 'تم إلغاء طلب الاستلام' };
async function rpc<T>(name: string, args = {}): Promise<T> { const { data, error } = await supabase.rpc(name, args); if (error) throw new Error(error.message); return data as T; }
export const doctorPortalService = {
    context: () => rpc<PortalContext>('get_doctor_portal_context'),
    catalog: () => rpc<Pick<Service, 'id' | 'name' | 'familyId'>[]>('get_doctor_portal_catalog'),
    month: (previous = false) => rpc<PortalMonth>('get_my_doctor_month', { p_previous: previous }),
    messages: () => rpc<PortalMessage[]>('get_my_doctor_messages'),
    send: (body: string, orderId?: string) => rpc<string>('send_doctor_portal_message', { p_body: body, p_order_id: orderId || null }),
    inbox: () => rpc<{ messages: PortalMessage[]; pickups: PortalPickup[] }>('get_doctor_portal_staff_inbox'),
    reply: (id: string, reply: string) => rpc<void>('reply_doctor_portal_message', { p_id: id, p_reply: reply }),
    pickup: (item: PortalPickup, status: string, note: string) => rpc<void>('coordinate_doctor_pickup', { p_id: item.id, p_status: status, p_expected_status: item.status, p_note: note }),
    submit: (key: string, input: { doctor_id: string; patient_name: string; intake_type: string; delivery_address: string; branch_id: string; contact_phone: string; items: OrderItem[]; shade: string; instructions: string; stl_url: string; images_url: string; pickup_timing: string; trays_details: string; has_bite_record: boolean }) => rpc<string>('submit_doctor_portal_case', { p_request_key: key, p_payload: input }),
};
