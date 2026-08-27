import React, { useState, useEffect, useCallback } from 'react';
import {
  DollarSign,
  Award,
  Search,
  Calendar,
  AlertTriangle,
  PieChart,
  RefreshCw,
  Plus,
  Trash2,
  Lock
} from 'lucide-react';
import {
  costingService,
  type OrderCostBreakdown,
  type CostOfQualityReport,
  type InternalVsExternalBenchmark,
  type TechnicianMaterialEfficiency,
  type LaborRate,
  type OverheadAllocationRun
} from '../../services/supabase/costingService';
import { CutoverComparisonNotice } from '../../components/reports/CutoverComparisonNotice';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../context/ToastContext';

export const ProductionCostingReport: React.FC = () => {
  const { success: toastSuccess, error: toastError } = useToast();

  // Active Tab
  const [activeTab, setActiveTab] = useState<'breakdown' | 'quality' | 'benchmark' | 'efficiency' | 'settings'>('breakdown');
  const [loading, setLoading] = useState(false);

  // Date Filters
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Tab 1: Order Cost Breakdown
  const [searchCaseId, setSearchCaseId] = useState('');
  const [searchedOrders, setSearchedOrders] = useState<Array<{ id: string; case_id: string; patient_name: string; total_price: number }>>([]);
  const [selectedOrderCost, setSelectedOrderCost] = useState<OrderCostBreakdown | null>(null);

  // Tab 2: Cost of Quality
  const [qualityReport, setQualityReport] = useState<CostOfQualityReport | null>(null);

  // Tab 3: Benchmark
  const [benchmarkReport, setBenchmarkReport] = useState<InternalVsExternalBenchmark | null>(null);

  // Tab 4: Material Efficiency
  const [efficiencyReport, setEfficiencyReport] = useState<TechnicianMaterialEfficiency | null>(null);

  // Tab 5: Settings (Labor Rates & Overhead)
  const [laborRates, setLaborRates] = useState<LaborRate[]>([]);
  const [overheadRuns, setOverheadRuns] = useState<OverheadAllocationRun[]>([]);
  const [stages, setStages] = useState<Array<{ id: string; name_ar: string }>>([]);

  // Modal: Add Labor Rate
  const [isRateModalOpen, setIsRateModalOpen] = useState(false);
  const [newStageId, setNewStageId] = useState('');
  const [newRate, setNewRate] = useState('');

  // Modal: Freeze Overhead
  const [isOverheadModalOpen, setIsOverheadModalOpen] = useState(false);
  const [overheadMonth, setOverheadMonth] = useState(() => new Date().toISOString().slice(0, 7) + '-01');
  const [totalOverhead, setTotalOverhead] = useState('');
  const [totalUnits, setTotalUnits] = useState('');
  const [overheadNotes, setOverheadNotes] = useState('');

  // Load Tab Data
  const loadTabData = useCallback(async () => {
    try {
      setLoading(true);
      if (activeTab === 'quality') {
        const res = await costingService.getCostOfQualityReport(startDate, endDate);
        setQualityReport(res);
      } else if (activeTab === 'benchmark') {
        const res = await costingService.getInternalVsExternalBenchmark(startDate, endDate);
        setBenchmarkReport(res);
      } else if (activeTab === 'efficiency') {
        const res = await costingService.getTechnicianMaterialEfficiency(startDate, endDate);
        setEfficiencyReport(res);
      } else if (activeTab === 'settings') {
        const [ratesRes, overheadRes, stagesRes] = await Promise.all([
          costingService.getLaborRates(),
          costingService.getOverheadRuns(),
          supabase.from('production_stages').select('id, name_ar').order('sequence')
        ]);
        setLaborRates(ratesRes);
        setOverheadRuns(overheadRes);
        setStages(stagesRes.data || []);
      }
    } catch (err: unknown) {
      console.error('Failed to load costing report data:', err);
      toastError('فشل تحميل بيانات التقرير');
    } finally {
      setLoading(false);
    }
  }, [activeTab, startDate, endDate, toastError]);

  useEffect(() => {
    loadTabData();
  }, [loadTabData]);

  // Order Search for Breakdown
  const handleSearchOrder = async (query: string) => {
    setSearchCaseId(query);
    if (!query.trim()) {
      setSearchedOrders([]);
      return;
    }

    try {
      const { data } = await supabase
        .from('orders')
        .select('id, case_id, patient_name, total_price')
        .ilike('case_id', `%${query.trim()}%`)
        .limit(5);

      setSearchedOrders(data || []);
    } catch (err: unknown) {
      console.error('Order search error:', err);
    }
  };

  const handleSelectOrder = async (orderId: string) => {
    try {
      setLoading(true);
      const breakdown = await costingService.getOrderCostBreakdown(orderId);
      setSelectedOrderCost(breakdown);
      setSearchedOrders([]);
    } catch (err: unknown) {
      console.error('Failed to get order cost breakdown:', err);
      toastError('فشل جلب تفاصيل تكلفة الأوردر');
    } finally {
      setLoading(false);
    }
  };

  // Submit Labor Rate
  const handleSaveLaborRate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStageId || !newRate) return;

    try {
      await costingService.setLaborRate(newStageId, parseFloat(newRate));
      toastSuccess('تم حفظ أجر المرحلة بنجاح');
      setIsRateModalOpen(false);
      setNewStageId('');
      setNewRate('');
      loadTabData();
    } catch (err: unknown) {
      console.error('Failed to save rate:', err);
      toastError('فشل حفظ الأجر');
    }
  };

  // Delete Labor Rate
  const handleDeleteRate = async (id: string) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا الأجر؟')) return;
    try {
      await costingService.deleteLaborRate(id);
      toastSuccess('تم الحذف');
      loadTabData();
    } catch (err: unknown) {
      console.error('Failed to delete rate:', err);
      toastError('فشل الحذف');
    }
  };

  // Submit Overhead Freeze
  const handleFreezeOverhead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overheadMonth || !totalOverhead || !totalUnits) return;

    try {
      await costingService.freezeOverhead(
        overheadMonth,
        parseFloat(totalOverhead),
        parseInt(totalUnits, 10),
        overheadNotes
      );
      toastSuccess('تم تجميد وتوزيع أوفرهيد الشهر بنجاح');
      setIsOverheadModalOpen(false);
      setTotalOverhead('');
      setTotalUnits('');
      setOverheadNotes('');
      loadTabData();
    } catch (err: unknown) {
      console.error('Failed to freeze overhead:', err);
      toastError('فشل تسجيل الأوفرهيد');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" dir="rtl">
      {/* Plan 5.2: a period spanning the cutover mixes two definitions of cost.
          Renders nothing until the cutover has actually happened. */}
      <CutoverComparisonNotice periodStart={startDate} periodEnd={endDate} />
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">تقارير التكلفة الفعلية والإنتاجية</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              تكلفة الكراون المباشرة، تكلفة الجودة، المقارنة المعيارية للداخلي والخارجي، وكفاءة استهلاك الديسكات
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadTabData}
            disabled={loading}
            className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transition"
            title="تحديث البيانات"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Notice Banner */}
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 p-4 rounded-xl flex items-start gap-3 text-xs text-amber-800 dark:text-amber-300">
        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-bold block">تنبيه تحليلي للتقارير المالية والإنتاجية:</span>
          <p>
            الحالات المنتجة داخلياً تحسب تكلفة الكراون المباشرة من: (الخامات المستهلكة + أجور المراحل + خطوات الشغل الخارجي + الأوفرهيد الموزع). الحالات الخارجية تعتمد على فاتورة المعمل الخارجي المسجلة.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveTab('breakdown')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
              activeTab === 'breakdown'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            تحليل تكلفة الكراون
          </button>
          <button
            onClick={() => setActiveTab('quality')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
              activeTab === 'quality'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            تكلفة الجودة (داخلي vs خارجي)
          </button>
          <button
            onClick={() => setActiveTab('benchmark')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
              activeTab === 'benchmark'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            المقارنة المعيارية للخدمات
          </button>
          <button
            onClick={() => setActiveTab('efficiency')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
              activeTab === 'efficiency'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            كفاءة استهلاك الخامات
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
              activeTab === 'settings'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            الأوفرهيد وأجور المراحل
          </button>
        </div>

        {/* Date Filter (for reports) */}
        {activeTab !== 'breakdown' && activeTab !== 'settings' && (
          <div className="flex items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 rounded-xl">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>من:</span>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="bg-transparent focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 rounded-xl">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>إلى:</span>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="bg-transparent focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* Tab 1: Crown Cost Breakdown */}
      {activeTab === 'breakdown' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Search className="w-4 h-4 text-emerald-600" />
              <span>بحث عن حالة لاستعراض تفكيك التكلفة الحقيقية</span>
            </h2>

            <div className="relative max-w-md">
              <input
                type="text"
                value={searchCaseId}
                onChange={e => handleSearchOrder(e.target.value)}
                placeholder="اكتب رقم الحالة (مثال: CASE-102)..."
                className="w-full pl-3 pr-9 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 font-mono"
              />
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />

              {searchedOrders.length > 0 && (
                <div className="absolute top-full right-0 left-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-lg z-20 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                  {searchedOrders.map(o => (
                    <button
                      key={o.id}
                      onClick={() => handleSelectOrder(o.id)}
                      className="w-full p-3 text-right hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between text-xs transition"
                    >
                      <div>
                        <span className="font-bold font-mono text-slate-900 dark:text-white">{o.case_id}</span>
                        <span className="mr-2 text-slate-500">{o.patient_name}</span>
                      </div>
                      <span className="font-semibold text-emerald-600">{o.total_price} ج.م</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {selectedOrderCost && (
            <div className="space-y-6">
              {/* Cost Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <div className="text-xs text-slate-500 mb-1">إجمالي تكلفة الكيس</div>
                  <div className="text-2xl font-bold text-slate-900 dark:text-white">
                    {selectedOrderCost.total_cost.toLocaleString()} <span className="text-sm font-normal">ج.م</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    تكلفة الوحدة: {selectedOrderCost.cost_per_unit.toLocaleString()} ج.م
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <div className="text-xs text-slate-500 mb-1">سعر البيع للطبيب</div>
                  <div className="text-2xl font-bold text-blue-600">
                    {selectedOrderCost.total_price.toLocaleString()} <span className="text-sm font-normal">ج.م</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    عدد الوحدات: {selectedOrderCost.total_units} وحدة
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <div className="text-xs text-slate-500 mb-1">مجمل الربح</div>
                  <div className="text-2xl font-bold text-emerald-600">
                    {selectedOrderCost.gross_profit.toLocaleString()} <span className="text-sm font-normal">ج.م</span>
                  </div>
                  <div className="text-xs text-emerald-600/80 mt-1">
                    هامش الربح: {selectedOrderCost.margin_percent}%
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <div className="text-xs text-slate-500 mb-1">نوع الإنتاج</div>
                  <div className="text-lg font-bold text-slate-900 dark:text-white mt-1">
                    {selectedOrderCost.is_internal_production ? (
                      <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 rounded-lg text-xs">
                        إنتاج معمل داخلي
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 rounded-lg text-xs">
                        معمل خارجي كامل
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Breakdown Details Table */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden p-6 space-y-6">
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <PieChart className="w-5 h-5 text-emerald-600" />
                  <span>تفكيك بنود التكلفة للحالة {selectedOrderCost.case_id}</span>
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Direct Materials */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                      <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">1. خامات مباشرة (مقاس/مقدّر)</span>
                      <span className="font-bold text-sm text-slate-900 dark:text-white">{selectedOrderCost.materials_cost} ج.م</span>
                    </div>
                    {selectedOrderCost.details.materials.length === 0 ? (
                      <div className="text-xs text-slate-400">لا توجد خامات منسوبة</div>
                    ) : (
                      selectedOrderCost.details.materials.map((m, i) => (
                        <div key={i} className="text-xs flex items-center justify-between">
                          <div>
                            <div className="font-medium text-slate-700 dark:text-slate-300">{m.material_name}</div>
                            <div className="text-[11px] text-slate-400 font-mono">لوط: {m.batch_code} ({m.is_estimated ? 'مقدّر' : 'فعلي'})</div>
                          </div>
                          <span className="font-semibold">{m.cost} ج.م</span>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Direct Labor */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                      <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">2. أجور عمالة مباشرة (بالقطعة)</span>
                      <span className="font-bold text-sm text-slate-900 dark:text-white">{selectedOrderCost.labor_cost} ج.م</span>
                    </div>
                    {selectedOrderCost.details.labor.length === 0 ? (
                      <div className="text-xs text-slate-400">لا توجد مراحل مسجلة</div>
                    ) : (
                      selectedOrderCost.details.labor.map((l, i) => (
                        <div key={i} className="text-xs flex items-center justify-between">
                          <div>
                            <div className="font-medium text-slate-700 dark:text-slate-300">{l.stage_name}</div>
                            <div className="text-[11px] text-slate-400">{l.units_passed} وحدة × {l.rate_per_unit} ج.م</div>
                          </div>
                          <span className="font-semibold">{l.cost} ج.م</span>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Overhead & Outsource */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                      <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">3. أوفرهيد وشغل خارجي</span>
                      <span className="font-bold text-sm text-slate-900 dark:text-white">
                        {selectedOrderCost.overhead_cost + selectedOrderCost.external_cost} ج.م
                      </span>
                    </div>
                    <div className="text-xs flex items-center justify-between">
                      <div>
                        <div className="font-medium text-slate-700 dark:text-slate-300">أوفرهيد موزّع للشهر</div>
                        <div className="text-[11px] text-slate-400">{selectedOrderCost.overhead_rate_applied} ج.م / وحدة</div>
                      </div>
                      <span className="font-semibold">{selectedOrderCost.overhead_cost} ج.م</span>
                    </div>
                    {selectedOrderCost.details.external.map((e, i) => (
                      <div key={i} className="text-xs flex items-center justify-between">
                        <div>
                          <div className="font-medium text-slate-700 dark:text-slate-300">{e.stage_name} (خارجي)</div>
                          <div className="text-[11px] text-slate-400">{e.supplier_name}</div>
                        </div>
                        <span className="font-semibold">{e.agreed_cost} ج.م</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Cost of Quality */}
      {activeTab === 'quality' && qualityReport && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Internal Quality Box */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">إعادة داخلية (تم رصدها بالـ QC قبل التسليم)</h3>
                  <p className="text-xs text-slate-500">حالات رسبت في الفحص الداخلي وتمت إعادتها دون علم الطبيب</p>
                </div>
                <span className="px-2.5 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 rounded-lg text-xs font-bold">
                  {qualityReport.internal_quality.summary.total_incidents} حالة
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-center">
                  <div className="text-xs text-slate-400">وحدات أعيد تشغيلها</div>
                  <div className="text-xl font-bold text-slate-900 dark:text-white">
                    {qualityReport.internal_quality.summary.total_units_failed}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-center">
                  <div className="text-xs text-slate-400">خسارة عمالة تقديرية</div>
                  <div className="text-xl font-bold text-rose-600">
                    {qualityReport.internal_quality.summary.total_estimated_labor_loss.toLocaleString()} ج.م
                  </div>
                </div>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {qualityReport.internal_quality.breakdown.length === 0 ? (
                  <div className="text-center py-6 text-slate-400">لا توجد إعادات داخلية مسجلة في هذه الفترة</div>
                ) : (
                  qualityReport.internal_quality.breakdown.map((item, i) => (
                    <div key={i} className="py-2.5 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {item.stage_name} — {item.cause_code}
                        </div>
                        <div className="text-[11px] text-slate-400">الفني: {item.technician_name}</div>
                      </div>
                      <div className="text-left font-semibold">
                        <div>{item.total_units_failed} وحدة</div>
                        <div className="text-rose-500 font-mono">{item.total_labor_loss} ج.م</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* External Quality Box */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">مشاكل خارجية (إعادات ورفض من الأطباء)</h3>
                  <p className="text-xs text-slate-500">حالات وصلت العيادة وعادت بتعديل أو رفض أو إعادة</p>
                </div>
                <span className="px-2.5 py-1 bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 rounded-lg text-xs font-bold">
                  {qualityReport.external_quality.summary.total_issues_count} مشكلة
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-center">
                  <div className="text-xs text-slate-400">إيراد متأثر بالمشاكل</div>
                  <div className="text-xl font-bold text-slate-900 dark:text-white">
                    {qualityReport.external_quality.summary.total_affected_revenue.toLocaleString()} ج.م
                  </div>
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-center">
                  <div className="text-xs text-slate-400">خسائر مالية مباشرة</div>
                  <div className="text-xl font-bold text-rose-600">
                    {qualityReport.external_quality.summary.total_financial_loss.toLocaleString()} ج.م
                  </div>
                </div>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {qualityReport.external_quality.breakdown.length === 0 ? (
                  <div className="text-center py-6 text-slate-400">لا توجد مشاكل أطباء مسجلة في هذه الفترة</div>
                ) : (
                  qualityReport.external_quality.breakdown.map((item, i) => (
                    <div key={i} className="py-2.5 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {item.issue_type} — {item.cause_code}
                        </div>
                        <div className="text-[11px] text-slate-400">عدد الحوادث: {item.incidents_count}</div>
                      </div>
                      <div className="text-left font-semibold">
                        <div className="text-slate-700 dark:text-slate-300">{item.affected_revenue} ج.م إيراد</div>
                        <div className="text-rose-500 font-mono">خسارة: {item.financial_loss} ج.م</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Benchmark (Internal vs External) */}
      {activeTab === 'benchmark' && benchmarkReport && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden p-6 space-y-4">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white">مقارنة أداء العائلات الخدمية: إنتاج داخلي مقابل معمل خارجي</h3>
            <p className="text-xs text-slate-500">مقارنة متوسط التكلفة، زمن التسليم بالأيام، ونسبة المشاكل لاتخاذ قرارات التوسع</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="p-3">عائلة الخدمة</th>
                  <th className="p-3">نوع الإنتاج</th>
                  <th className="p-3">عدد الحالات</th>
                  <th className="p-3">متوسط التكلفة</th>
                  <th className="p-3">متوسط سعر البيع</th>
                  <th className="p-3">متوسط زمن التسليم</th>
                  <th className="p-3">معدل المشاكل والإعادة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {benchmarkReport.comparison.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="p-3 font-semibold text-slate-900 dark:text-white">{row.family_name}</td>
                    <td className="p-3">
                      {row.production_type === 'internal' ? (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 rounded-md font-medium">
                          داخلي
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 rounded-md font-medium">
                          خارجي
                        </span>
                      )}
                    </td>
                    <td className="p-3 font-mono">{row.total_orders}</td>
                    <td className="p-3 font-mono">{row.avg_cost} ج.م</td>
                    <td className="p-3 font-mono text-emerald-600 font-semibold">{row.avg_price} ج.م</td>
                    <td className="p-3 font-mono">{row.avg_lead_days} يوم عمل</td>
                    <td className="p-3">
                      <span className={`font-mono font-medium ${row.issue_rate_pct > 5 ? 'text-rose-600' : 'text-slate-700 dark:text-slate-300'}`}>
                        {row.issue_rate_pct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Technician Material Efficiency */}
      {activeTab === 'efficiency' && efficiencyReport && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden p-6 space-y-4">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white">كفاءة استهلاك الفنيين والمصممين لخامات الديسكات</h3>
            <p className="text-xs text-slate-500">معدل الوحدات المستخرجة من كل ديسك ومعدل الهدر والفاقد</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="p-3">الفني / المشغل</th>
                  <th className="p-3">الخامة</th>
                  <th className="p-3">التصنيف</th>
                  <th className="p-3">المتوقع لكل ديسك</th>
                  <th className="p-3">الفعلي لكل ديسك</th>
                  <th className="p-3">إجمالي الوحدات المنتجة</th>
                  <th className="p-3">الفاقد (Scrap)</th>
                  <th className="p-3">نسبة الهدر</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {efficiencyReport.efficiency.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-slate-400">لا توجد بيانات استهلاك مسجلة في هذه الفترة</td>
                  </tr>
                ) : (
                  efficiencyReport.efficiency.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="p-3 font-semibold text-slate-900 dark:text-white">{row.technician_name}</td>
                      <td className="p-3">{row.material_name}</td>
                      <td className="p-3 text-slate-500">{row.material_category}</td>
                      <td className="p-3 font-mono">{row.expected_units_per_batch || '—'}</td>
                      <td className="p-3 font-mono font-bold text-emerald-600">{row.actual_units_per_batch}</td>
                      <td className="p-3 font-mono">{row.total_units_produced}</td>
                      <td className="p-3 font-mono text-rose-500">{row.total_units_scrapped}</td>
                      <td className="p-3">
                        <span className={`font-mono font-bold ${row.scrap_rate_pct > 10 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {row.scrap_rate_pct}%
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 5: Settings (Labor Rates & Overhead) */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          {/* Overhead Allocation Section */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Lock className="w-4 h-4 text-emerald-600" />
                  <span>توزيع الأوفرهيد الشهري المجمّد (Overhead Allocation)</span>
                </h3>
                <p className="text-xs text-slate-500">إدخال مصاريف التشغيل الشهرية لتوزيعها على الوحدات</p>
              </div>
              <button
                onClick={() => setIsOverheadModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>تجميد أوفرهيد شهر جديد</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
                  <tr>
                    <th className="p-3">الشهر</th>
                    <th className="p-3">إجمالي الأوفرهيد</th>
                    <th className="p-3">إجمالي الوحدات</th>
                    <th className="p-3">نصيب الوحدة (Rate)</th>
                    <th className="p-3">تاريخ التجميد</th>
                    <th className="p-3">ملاحظات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {overheadRuns.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-slate-400">لا توجد دورات أوفرهيد مسجلة</td>
                    </tr>
                  ) : (
                    overheadRuns.map(run => (
                      <tr key={run.id}>
                        <td className="p-3 font-bold font-mono text-slate-900 dark:text-white">{run.period_month}</td>
                        <td className="p-3 font-mono">{run.total_overhead.toLocaleString()} ج.م</td>
                        <td className="p-3 font-mono">{run.total_units.toLocaleString()}</td>
                        <td className="p-3 font-mono font-bold text-emerald-600">{run.rate_per_unit} ج.م / وحدة</td>
                        <td className="p-3 text-slate-400">{new Date(run.frozen_at).toLocaleDateString('ar-EG')}</td>
                        <td className="p-3 text-slate-500">{run.notes || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Piece Labor Rates Section */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Award className="w-4 h-4 text-blue-600" />
                  <span>جدول أجور المراحل للفنيين بالقطعة (Piece Rates)</span>
                </h3>
                <p className="text-xs text-slate-500">تحديد الأجر المستحق للفني أو المعيار الافتراضي لكل مرحلة</p>
              </div>
              <button
                onClick={() => setIsRateModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة أجر مرحلة</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
                  <tr>
                    <th className="p-3">المرحلة</th>
                    <th className="p-3">الفني (اختياري)</th>
                    <th className="p-3">الأجر للوحدة</th>
                    <th className="p-3">ساري من تاريخ</th>
                    <th className="p-3">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {laborRates.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-slate-400">لا توجد أجور مسجلة</td>
                    </tr>
                  ) : (
                    laborRates.map(rate => (
                      <tr key={rate.id}>
                        <td className="p-3 font-semibold text-slate-900 dark:text-white">{rate.stage?.name_ar || 'مرحلة'}</td>
                        <td className="p-3">{rate.employee?.name || 'الافتراضي لجميع الفنيين'}</td>
                        <td className="p-3 font-mono font-bold text-blue-600">{rate.rate_per_unit} ج.م</td>
                        <td className="p-3 text-slate-400">{rate.effective_from}</td>
                        <td className="p-3">
                          <button
                            onClick={() => handleDeleteRate(rate.id)}
                            className="p-1 text-rose-500 hover:bg-rose-50 rounded"
                            title="حذف"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Labor Rate */}
      {isRateModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="font-bold text-slate-900 dark:text-white">إضافة / تحديث أجر مرحلة</h3>
            <form onSubmit={handleSaveLaborRate} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">المرحلة</label>
                <select
                  value={newStageId}
                  onChange={e => setNewStageId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                  required
                >
                  <option value="">-- اختر المرحلة --</option>
                  {stages.map(st => (
                    <option key={st.id} value={st.id}>{st.name_ar}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">الأجر للوحدة الواحدة (ج.م)</label>
                <input
                  type="number"
                  step="0.5"
                  value={newRate}
                  onChange={e => setNewRate(e.target.value)}
                  placeholder="25.00"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsRateModalOpen(false)}
                  className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium"
                >
                  حفظ الأجر
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Freeze Overhead */}
      {isOverheadModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="font-bold text-slate-900 dark:text-white">تجميد أوفرهيد الشهر</h3>
            <form onSubmit={handleFreezeOverhead} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">الشهر</label>
                <input
                  type="date"
                  value={overheadMonth}
                  onChange={e => setOverheadMonth(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">إجمالي مصاريف الأوفرهيد (ج.م)</label>
                <input
                  type="number"
                  value={totalOverhead}
                  onChange={e => setTotalOverhead(e.target.value)}
                  placeholder="50000"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">إجمالي الوحدات المنتجة</label>
                <input
                  type="number"
                  value={totalUnits}
                  onChange={e => setTotalUnits(e.target.value)}
                  placeholder="1000"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">ملاحظات (اختياري)</label>
                <input
                  type="text"
                  value={overheadNotes}
                  onChange={e => setOverheadNotes(e.target.value)}
                  placeholder="إيجار + كهرباء + إهلاك الأجهزة..."
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsOverheadModalOpen(false)}
                  className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium"
                >
                  تجميد وتطبيق
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductionCostingReport;
