import { supabase } from '../../lib/supabase';
import type { Adjustment } from '../financeService';
import type { ReportIssue } from '../reports/monthlyReportModel';
import { reportDay } from '../reports/monthlyReportModel';

/** Stable pagination prevents silently dropping rows above Supabase's row limit. */
export async function fetchMonthlyReportAdjustments(): Promise<Adjustment[]> {
    const rows: Adjustment[] = [];
    const size = 1000;
    for (let offset = 0; ; offset += size) {
        const { data, error } = await supabase.from('adjustments').select('*').eq('entity_type', 'doctor').order('date').order('id').range(offset, offset + size - 1);
        if (error) throw error;
        const page = (data || []) as Adjustment[];
        rows.push(...page);
        if (page.length < size) return rows;
    }
}

export async function fetchMonthlyReportIssues(): Promise<ReportIssue[]> {
    const rows: ReportIssue[] = [];
    const size = 1000;
    for (let offset = 0; ; offset += size) {
        const { data, error } = await supabase.from('order_issues').select('id, order_id, issue_type, cause_category, created_at, is_voided').order('created_at').order('id').range(offset, offset + size - 1);
        if (error) throw error;
        const page = data || [];
        rows.push(...page.map(row => ({ id: row.id, orderId: row.order_id, type: row.issue_type, cause: row.cause_category || 'unknown', date: reportDay(row.created_at), isVoided: !!row.is_voided })));
        if (page.length < size) return rows;
    }
}
