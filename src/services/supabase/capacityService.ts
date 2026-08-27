import { supabase } from '../../lib/supabase';

export interface StageCapacityMetric {
  stage_id: string;
  stage_code: string;
  stage_name: string;
  sequence: number;
  active_wip_units: number;
  active_runs_count: number;
  completed_runs_count: number;
  avg_wait_minutes: number;
  avg_touch_minutes: number;
  avg_stage_minutes: number;
  first_pass_rate_pct: number;
  rework_rate_pct: number;
  machine_downtime_hours: number;
  bottleneck_score: number;
}

export interface ProductionCapacityReport {
  period: { start_date: string; end_date: string };
  total_active_wip: number;
  top_bottleneck_stage: string;
  stages: StageCapacityMetric[];
}

export interface SupplierLeadTimeMetric {
  supplier_id: string;
  supplier_name: string;
  total_sample_count: number;
  is_low_sample: boolean;
  avg_lead_days: number;
  p50_lead_days: number;
  p80_lead_days: number;
  has_anomaly_warning: boolean;
  on_time_rate_pct: number;
}

export interface SupplierLeadTimeReport {
  period: { start_date: string; end_date: string };
  suppliers: SupplierLeadTimeMetric[];
}

export interface DeliveryEstimate {
  service_id: string;
  units: number;
  total_working_minutes: number;
  total_working_hours: number;
  /** null when no work calendar is configured -- render as "غير محسوب", never as today. */
  estimated_calendar_days: number | null;
  estimated_delivery_date: string | null;
  estimated_delivery_at: string | null;
  confidence_level: 'high' | 'moderate' | 'default_estimate';
  /** Smallest per-stage sample on the route, not the sum across stages. */
  sample_size: number;
  /** Stages with no history at all; any of these forces default_estimate. */
  stages_without_history: number;
  stages_breakdown: Array<{
    stage_name: string;
    stage_code: string;
    execution: string;
    p80_minutes_per_unit: number;
    p80_minutes: number;
    samples_count: number;
    is_estimated: boolean;
  }>;
}

export interface TeamMemberProductivity {
  user_id: string;
  user_name: string;
  user_role: string;
  total_runs_completed: number;
  total_units_passed: number;
  total_units_failed: number;
  total_reworks_done: number;
  total_touch_hours: number;
  units_per_hour: number;
  error_rate_pct: number;
  stages_operated: string[];
}

export interface TeamProductivityReport {
  period: { start_date: string; end_date: string };
  team_productivity: TeamMemberProductivity[];
}

export const capacityService = {
  async getCapacityAndBottlenecks(startDate?: string, endDate?: string): Promise<ProductionCapacityReport> {
    const { data, error } = await supabase.rpc('get_production_capacity_and_bottlenecks', {
      p_start_date: startDate || null,
      p_end_date: endDate || null
    });

    if (error) throw error;
    return data as unknown as ProductionCapacityReport;
  },

  async getSupplierLeadTimes(startDate?: string, endDate?: string): Promise<SupplierLeadTimeReport> {
    const { data, error } = await supabase.rpc('get_supplier_lead_time_analytics', {
      p_start_date: startDate || null,
      p_end_date: endDate || null
    });

    if (error) throw error;
    return data as unknown as SupplierLeadTimeReport;
  },

  async estimateDeliveryTime(serviceId: string, units: number = 1): Promise<DeliveryEstimate> {
    const { data, error } = await supabase.rpc('estimate_order_delivery_time', {
      p_service_id: serviceId,
      p_units: units
    });

    if (error) throw error;
    return data as unknown as DeliveryEstimate;
  },

  async getTeamProductivity(startDate?: string, endDate?: string): Promise<TeamProductivityReport> {
    const { data, error } = await supabase.rpc('get_team_throughput_and_productivity', {
      p_start_date: startDate || null,
      p_end_date: endDate || null
    });

    if (error) throw error;
    return data as unknown as TeamProductivityReport;
  }
};
