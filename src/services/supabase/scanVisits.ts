import { supabase } from '../../lib/supabase';

export interface ScanVisit {
    id: string;
    doctor_id: string;
    representative_id: string;
    scanner_id: string;
    branch: string | null;
    visited_at: string;
    visit_minutes: number;
    scan_minutes: number | null;
    case_count?: number | null;
    notes: string | null;
    fee: number;
}

export async function getScanVisits(): Promise<ScanVisit[]> {
    const visits: ScanVisit[] = [];
    const pageSize = 500;
    for (;;) {
        const { data, error } = await supabase.from('scan_visits').select('*')
            .order('visited_at', { ascending: false }).order('id', { ascending: false })
            .range(visits.length, visits.length + pageSize - 1);
        if (error) throw error;
        visits.push(...data);
        if (data.length < pageSize) return visits;
    }
}

export async function getScanVisitDevices(): Promise<{ id: string; name_ar: string; is_active: boolean }[]> {
    const { data, error } = await supabase.rpc('get_scan_visit_devices');
    if (error) throw error;
    return data ?? [];
}

export async function recordScanVisit(visit: Omit<ScanVisit, 'visited_at' | 'scan_minutes'>): Promise<void> {
    const { error } = await supabase.rpc('record_scan_visit_summary', {
        p_id: visit.id,
        p_doctor: visit.doctor_id,
        p_representative: visit.representative_id,
        p_scanner: visit.scanner_id,
        p_branch: visit.branch,
        p_visit_minutes: visit.visit_minutes,
        p_case_count: visit.case_count,
        p_notes: visit.notes,
        p_fee: visit.fee,
    });
    if (error) throw error;
}

export async function addDoctorShippingCharge(orderId: string, amount: number): Promise<void> {
    const { error } = await supabase.rpc('add_doctor_shipping_charge', { p_order: orderId, p_amount: amount });
    if (error) throw error;
}
