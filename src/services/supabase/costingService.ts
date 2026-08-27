import { supabase } from '../../lib/supabase';

export interface LaborRate {
  id: string;
  employee_id: string | null;
  stage_id: string;
  rate_per_unit: number;
  effective_from: string;
  created_at: string;
  stage?: {
    id: string;
    code: string;
    name_ar: string;
  };
  employee?: {
    id: string;
    name: string;
    username: string;
  };
}

export interface OverheadAllocationRun {
  id: string;
  period_month: string;
  total_overhead: number;
  total_units: number;
  rate_per_unit: number;
  frozen_at: string;
  notes?: string;
  created_at: string;
}

export interface OrderCostBreakdown {
  order_id: string;
  case_id: string;
  is_internal_production: boolean;
  /** false for cancelled / lab-rejected cases: zero cost AND zero revenue. */
  is_billable: boolean;
  zero_reason?: 'cancelled_or_lab_rejected';
  /** 'allocated' | 'not_allocated' (month never frozen) | 'not_applicable' (outsourced). */
  overhead_status: 'allocated' | 'not_allocated' | 'not_applicable';
  /** true while any contributing disc is still open -- the material cost is an estimate. */
  materials_are_estimated: boolean;
  total_units: number;
  total_price: number;
  materials_cost: number;
  labor_cost: number;
  external_cost: number;
  overhead_cost: number;
  overhead_rate_applied: number;
  total_cost: number;
  cost_per_unit: number;
  gross_profit: number;
  margin_percent: number;
  details: {
    materials: Array<{
      material_name: string;
      batch_code: string;
      units_attributed: number;
      is_estimated: boolean;
      cost: number;
    }>;
    labor: Array<{
      stage_name: string;
      assignee_id: string | null;
      units_passed: number;
      rate_per_unit: number;
      cost: number;
    }>;
    external: Array<{
      stage_name: string;
      supplier_name: string;
      agreed_cost: number;
      status: string;
    }>;
  };
}

export interface CostOfQualityReport {
  period: { start_date: string; end_date: string };
  internal_quality: {
    summary: {
      total_incidents: number;
      total_units_failed: number;
      total_estimated_labor_loss: number;
    };
    breakdown: Array<{
      stage_name: string;
      cause_code: string;
      technician_name: string;
      incidents_count: number;
      total_units_failed: number;
      total_labor_loss: number;
    }>;
  };
  external_quality: {
    summary: {
      total_issues_count: number;
      total_affected_revenue: number;
      total_financial_loss: number;
    };
    breakdown: Array<{
      issue_type: string;
      cause_code: string;
      incidents_count: number;
      affected_revenue: number;
      financial_loss: number;
    }>;
  };
}

export interface InternalVsExternalBenchmark {
  period: { start_date: string; end_date: string };
  comparison: Array<{
    family_name: string;
    production_type: 'internal' | 'external';
    total_orders: number;
    avg_cost: number;
    avg_price: number;
    avg_lead_days: number;
    issue_rate_pct: number;
  }>;
}

export interface TechnicianMaterialEfficiency {
  period: { start_date: string; end_date: string };
  efficiency: Array<{
    technician_name: string;
    material_name: string;
    material_category: string;
    expected_units_per_batch: number;
    distinct_batches_used: number;
    total_units_produced: number;
    total_units_scrapped: number;
    actual_units_per_batch: number;
    scrap_rate_pct: number;
  }>;
}

export const costingService = {
  // Labor Rates
  async getLaborRates(): Promise<LaborRate[]> {
    const { data, error } = await supabase
      .from('labor_rates')
      .select(`
        id,
        employee_id,
        stage_id,
        rate_per_unit,
        effective_from,
        created_at,
        stage:production_stages(id, code, name_ar),
        employee:users(id, name, username)
      `)
      .order('effective_from', { ascending: false });

    if (error) throw error;
    return (data || []) as unknown as LaborRate[];
  },

  async setLaborRate(stageId: string, ratePerUnit: number, employeeId?: string | null, effectiveFrom?: string): Promise<void> {
    const { error } = await supabase
      .from('labor_rates')
      .upsert({
        stage_id: stageId,
        employee_id: employeeId || null,
        rate_per_unit: ratePerUnit,
        effective_from: effectiveFrom || new Date().toISOString().split('T')[0]
      });

    if (error) throw error;
  },

  async deleteLaborRate(id: string): Promise<void> {
    const { error } = await supabase
      .from('labor_rates')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },

  // Overhead Allocation Runs
  async getOverheadRuns(): Promise<OverheadAllocationRun[]> {
    const { data, error } = await supabase
      .from('overhead_allocation_runs')
      .select('*')
      .order('period_month', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  /**
   * Freeze a month's overhead pool.
   *
   * A month that is already frozen is refused unless `refreeze` is passed:
   * re-freezing silently restates every cost report that already used that
   * month's rate, so it has to be an explicit decision, not a repeat click.
   */
  async freezeOverhead(
    periodMonth: string,
    totalOverhead: number,
    totalUnits: number,
    notes?: string,
    refreeze = false
  ): Promise<OverheadAllocationRun> {
    const { data, error } = await supabase.rpc('freeze_overhead_allocation', {
      p_period_month: periodMonth,
      p_total_overhead: totalOverhead,
      p_total_units: totalUnits,
      p_notes: notes || null,
      p_refreeze: refreeze
    });

    if (error) throw error;
    return data as unknown as OverheadAllocationRun;
  },

  // Order Cost Breakdown
  async getOrderCostBreakdown(orderId: string): Promise<OrderCostBreakdown> {
    const { data, error } = await supabase.rpc('get_order_cost_breakdown', {
      p_order_id: orderId
    });

    if (error) throw error;
    return data as unknown as OrderCostBreakdown;
  },

  // Cost of Quality Report
  async getCostOfQualityReport(startDate?: string, endDate?: string): Promise<CostOfQualityReport> {
    const { data, error } = await supabase.rpc('get_cost_of_quality_report', {
      p_start_date: startDate || null,
      p_end_date: endDate || null
    });

    if (error) throw error;
    return data as unknown as CostOfQualityReport;
  },

  // Internal vs External Benchmark
  async getInternalVsExternalBenchmark(startDate?: string, endDate?: string): Promise<InternalVsExternalBenchmark> {
    const { data, error } = await supabase.rpc('get_internal_vs_external_benchmark', {
      p_start_date: startDate || null,
      p_end_date: endDate || null
    });

    if (error) throw error;
    return data as unknown as InternalVsExternalBenchmark;
  },

  // Technician Material Efficiency
  async getTechnicianMaterialEfficiency(startDate?: string, endDate?: string): Promise<TechnicianMaterialEfficiency> {
    const { data, error } = await supabase.rpc('get_technician_material_efficiency', {
      p_start_date: startDate || null,
      p_end_date: endDate || null
    });

    if (error) throw error;
    return data as unknown as TechnicianMaterialEfficiency;
  }
};
