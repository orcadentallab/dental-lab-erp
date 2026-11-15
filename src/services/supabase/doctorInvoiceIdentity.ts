import { supabase } from '../../lib/supabase';

export interface DoctorInvoiceIdentity {
    invoiceNumber: string;
    doctorCode: string;
    issuedOn: string;
}

export async function getDoctorInvoiceIdentity(
    request: { orderId: string } | { doctorId: string; start: string; end: string; monthly?: boolean }
): Promise<DoctorInvoiceIdentity> {
    const args = 'orderId' in request
        ? { p_order: request.orderId }
        : { p_doctor: request.doctorId, p_from: request.start || '-infinity', p_to: request.end || 'infinity', p_monthly: request.monthly ?? false };
    const { data, error } = await supabase.rpc('get_or_issue_doctor_invoice_identity', args);
    if (error) throw new Error(error.message);
    return data as DoctorInvoiceIdentity;
}
