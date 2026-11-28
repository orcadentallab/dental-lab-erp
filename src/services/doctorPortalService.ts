import { supabase } from '../lib/supabase';
import type { DoctorBranch, OrderItem, Service } from './db';
export interface PortalContext { doctor_id: string; name: string; is_center: boolean; clinic_name: string; contact_phone: string; address: string; branches: DoctorBranch[]; members: { id: string; name: string; phone: string; doctor_code: string; has_account: boolean }[] }
export interface PortalMonth { month: string; is_center: boolean; charges: number; payments: number; adjustments: number; difference: number; cases: { case_id: string; patient_name: string; doctor_name: string; date: string; amount: number }[]; by_doctor: { id: string; name: string; amount: number; paid: number }[] }
export interface PortalMessage { id: string; body: string; reply?: string; replied_at?: string | null; created_at: string; case_id?: string; doctor_name?: string }
export interface SupportThread {
    id: string;
    order_id: string | null;
    case_id: string | null;
    doctor_id: string;
    doctor_name: string;
    subject: string | null;
    closed_at: string | null;
    posts: { id: string; body: string; from_lab: boolean; created_at: string }[];
}
export interface LabSupportRecipient { id: string; name: string; doctor_code: string }
export interface LabSupportCase { id: string; case_id: string; patient_name: string }
export interface PortalDesignReview {
    order_id: string;
    revision_id: string;
    state: 'pending' | 'approved' | 'changes' | 'preview_only';
    note: string;
    preview_path: string | null;
}
export interface PortalTryInRequest {
    order_id: string;
    order_version: string;
}
async function rpc<T>(name: string, args = {}): Promise<T> { const { data, error } = await supabase.rpc(name, args); if (error) throw new Error(error.message); return data as T; }
export const doctorPortalService = {
    context: () => rpc<PortalContext>('get_doctor_portal_context'),
    catalog: () => rpc<Pick<Service, 'id' | 'name' | 'familyId'>[]>('get_doctor_portal_catalog'),
    month: (previous = false) => rpc<PortalMonth>('get_my_doctor_month', { p_previous: previous }),
    messages: () => rpc<PortalMessage[]>('get_my_doctor_messages'),
    threads: () => rpc<SupportThread[]>('get_doctor_support_threads'),
    labRecipients: () => rpc<LabSupportRecipient[]>('get_lab_support_recipients'),
    labCases: (doctorId: string) => rpc<LabSupportCase[]>('get_lab_support_cases', { p_doctor: doctorId }),
    startLabConversation: (doctorId: string, orderId: string, subject: string, body: string) =>
        rpc<string>('start_lab_doctor_support', {
            p_doctor: doctorId, p_order: orderId || null, p_subject: subject, p_body: body,
        }),
    designReviews: () => rpc<PortalDesignReview[]>('get_my_doctor_design_reviews'),
    tryInRequests: () => rpc<PortalTryInRequest[]>('get_my_doctor_try_in_requests'),
    respondToTryIn: (request: PortalTryInRequest, action: 'approve' | 'changes', note: string) =>
        rpc<void>('respond_to_doctor_try_in', {
            p_order: request.order_id, p_order_version: request.order_version, p_action: action, p_note: note,
        }),
    decideDesign: (revisionId: string, action: 'approved' | 'changes', note: string) =>
        rpc<void>('decide_doctor_design_review', { p_revision: revisionId, p_action: action, p_note: note }),
    writeThread: (action: 'start' | 'reply' | 'close', input: { threadId?: string; orderId?: string; body?: string }) =>
        rpc<string>('write_doctor_support_thread', {
            p_action: action, p_thread_id: input.threadId ?? null, p_order_id: input.orderId || null, p_body: input.body ?? null,
        }),
    submit: (key: string, input: { doctor_id: string; patient_name: string; intake_type: string; delivery_address: string; branch_id: string; contact_phone: string; items: OrderItem[]; shade: string; instructions: string; stl_url: string; images_url: string; pickup_timing: string; trays_details: string; has_bite_record: boolean }) => rpc<string>('submit_doctor_portal_case', { p_request_key: key, p_payload: input }),
};
