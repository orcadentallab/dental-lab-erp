import { supabase } from '../../lib/supabase';

export interface DoctorActivityRow {
  doctorId: string;
  doctorName: string;
  parentName: string | null; // Center parent name
  doctorPhone: string;
  doctorPhone2: string | null;
  doctorCode: string;
  representativeName: string | null;
  representativeId: string | null;
  
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  daysSinceLastOrder: number | null;
  
  totalOrdersCount: number;
  validOrdersCount: number;
  averageMonthlyOrdersCount: number;
  averageMonthlyOrdersValue: number;
  ordersCountLast30Days: number;
  ordersValueLast30Days: number;
  ordersCountLast60Days: number;
  ordersValueLast60Days: number;
  
  changePercentageCount: number;
  changePercentageValue: number;
  
  rejectedOrdersCount: number;
  rejectedOrdersValue: number;
  rejectedOrdersCount30: number;
  rejectedOrdersValue30: number;
  rejectedRatioPct: number;
  
  lastCasePatient: string | null;
  lastCaseCode: string | null;
  calculatedSegment: 'needs_activation' | 'rejected_only' | 'one_case_churned' | 'long_term_churned' | 'recently_churned' | 'new' | 'declining_confirmed' | 'declining_early' | 'growing' | 'stable';
  lastFollowUpDate: string | null;
  lastFollowUpNotes: string | null;
}

interface DbDoctorActivityRow {
  doctor_id: string;
  doctor_name: string;
  parent_name: string | null;
  doctor_phone: string;
  doctor_phone2: string | null;
  doctor_code: string;
  representative_name: string;
  representative_id: string | null;
  first_order_date: string | null;
  last_order_date: string | null;
  days_since_last_order: number | null;
  total_orders_count: number;
  valid_orders_count: number;
  average_monthly_orders_count: number;
  average_monthly_orders_value: number;
  orders_count_last_30_days: number;
  orders_value_last_30_days: number;
  orders_count_last_60_days: number;
  orders_value_last_60_days: number;
  change_percentage_count: number;
  change_percentage_value: number;
  rejected_orders_count: number;
  rejected_orders_value: number;
  rejected_orders_count_30: number;
  rejected_orders_value_30: number;
  rejected_ratio_pct: number;
  last_case_patient: string | null;
  last_case_code: string | null;
  calculated_segment: DoctorActivityRow['calculatedSegment'];
  last_follow_up_date: string | null;
  last_follow_up_notes: string | null;
}

export interface DoctorRetentionSettings {
  oneCaseChurnDays: number;
  newClientDays: number;
  recentlyChurnedMinDays: number;
  longTermChurnDays: number;
  declineThresholdPct: number;
  growthThresholdPct: number;
  highRejectionRatePct: number;
}

export interface DoctorFollowUpRow {
  id: string;
  doctor_id: string;
  contacted_at: string;
  contacted_by: string | null;
  notes: string;
  status: string;
  next_follow_up_date: string | null;
  created_at: string;
  doctors: {
    name: string;
    parent_name?: string | null; // Added
    phone: string;
    phone2: string | null;
    doctor_code: string;
    representative_id: string | null;
    representative_name?: string;
  } | null;
}

export const doctorRetentionService = {
  async getDoctorActivity(representativeId?: string): Promise<DoctorActivityRow[]> {
    const { data, error } = await supabase.rpc('get_doctors_activity_analytics', {
      p_representative_id: representativeId || null
    });
    if (error) throw error;
    
    const rows = (data || []) as unknown as DbDoctorActivityRow[];
    return rows.map((row) => ({
      doctorId: row.doctor_id,
      doctorName: row.doctor_name,
      parentName: row.parent_name,
      doctorPhone: row.doctor_phone,
      doctorPhone2: row.doctor_phone2,
      doctorCode: row.doctor_code,
      representativeName: row.representative_name,
      representativeId: row.representative_id,
      firstOrderDate: row.first_order_date,
      lastOrderDate: row.last_order_date,
      daysSinceLastOrder: row.days_since_last_order,
      totalOrdersCount: row.total_orders_count,
      validOrdersCount: row.valid_orders_count,
      averageMonthlyOrdersCount: Number(row.average_monthly_orders_count || 0),
      averageMonthlyOrdersValue: Number(row.average_monthly_orders_value || 0),
      ordersCountLast30Days: row.orders_count_last_30_days || 0,
      ordersValueLast30Days: Number(row.orders_value_last_30_days || 0),
      ordersCountLast60Days: row.orders_count_last_60_days || 0,
      ordersValueLast60Days: Number(row.orders_value_last_60_days || 0),
      changePercentageCount: Number(row.change_percentage_count || 0),
      changePercentageValue: Number(row.change_percentage_value || 0),
      rejectedOrdersCount: row.rejected_orders_count || 0,
      rejectedOrdersValue: Number(row.rejected_orders_value || 0),
      rejectedOrdersCount30: row.rejected_orders_count_30 || 0,
      rejectedOrdersValue30: Number(row.rejected_orders_value_30 || 0),
      rejectedRatioPct: Number(row.rejected_ratio_pct || 0),
      lastCasePatient: row.last_case_patient,
      lastCaseCode: row.last_case_code,
      calculatedSegment: row.calculated_segment,
      lastFollowUpDate: row.last_follow_up_date,
      lastFollowUpNotes: row.last_follow_up_notes
    }));
  },

  async getSettings(): Promise<DoctorRetentionSettings> {
    const { data, error } = await supabase
      .from('doctor_retention_settings')
      .select('*')
      .eq('id', 1)
      .single();
    if (error) throw error;
    return {
      oneCaseChurnDays: data.one_case_churn_days,
      newClientDays: data.new_client_days,
      recentlyChurnedMinDays: data.recently_churned_min_days,
      longTermChurnDays: data.long_term_churn_days,
      declineThresholdPct: Number(data.decline_threshold_pct),
      growthThresholdPct: Number(data.growth_threshold_pct),
      highRejectionRatePct: Number(data.high_rejection_rate_pct)
    };
  },

  async updateSettings(settings: DoctorRetentionSettings): Promise<void> {
    const { error } = await supabase
      .from('doctor_retention_settings')
      .update({
        one_case_churn_days: settings.oneCaseChurnDays,
        new_client_days: settings.newClientDays,
        recently_churned_min_days: settings.recentlyChurnedMinDays,
        long_term_churn_days: settings.longTermChurnDays,
        decline_threshold_pct: settings.declineThresholdPct,
        growth_threshold_pct: settings.growthThresholdPct,
        high_rejection_rate_pct: settings.highRejectionRatePct
      })
      .eq('id', 1);
    if (error) throw error;
  },

  async logFollowUp(input: {
    doctorId: string;
    notes: string;
    status: string;
    nextFollowUpDate?: string;
  }): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    
    const { error: insertErr } = await supabase
      .from('doctor_follow_ups')
      .insert({
        doctor_id: input.doctorId,
        notes: input.notes,
        status: input.status,
        contacted_by: user.id,
        next_follow_up_date: input.nextFollowUpDate || null
      });
    if (insertErr) throw insertErr;

    const { error: updateErr } = await supabase
      .from('doctors')
      .update({
        last_follow_up_date: new Date().toISOString(),
        last_follow_up_notes: input.notes
      })
      .eq('id', input.doctorId);
    if (updateErr) throw updateErr;
  },

  async getTodaysFollowUps(): Promise<DoctorFollowUpRow[]> {
    const { data, error } = await supabase.rpc('get_todays_follow_ups');
    if (error) throw error;
    
    const rows = (data || []) as Array<{
      id: string;
      doctor_id: string;
      contacted_at: string;
      contacted_by: string | null;
      notes: string;
      status: string;
      next_follow_up_date: string | null;
      created_at: string;
      doctor_name: string;
      parent_name: string | null;
      doctor_phone: string;
      doctor_phone2: string | null;
      doctor_code: string;
      representative_id: string | null;
      representative_name: string | null;
    }>;

    return rows.map(row => ({
      id: row.id,
      doctor_id: row.doctor_id,
      contacted_at: row.contacted_at,
      contacted_by: row.contacted_by,
      notes: row.notes,
      status: row.status,
      next_follow_up_date: row.next_follow_up_date,
      created_at: row.created_at,
      doctors: {
        name: row.doctor_name,
        parent_name: row.parent_name,
        phone: row.doctor_phone,
        phone2: row.doctor_phone2,
        doctor_code: row.doctor_code,
        representative_id: row.representative_id,
        representative_name: row.representative_name || undefined
      }
    }));
  }
};
