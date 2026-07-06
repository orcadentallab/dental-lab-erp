import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { doctorRetentionService, type DoctorActivityRow, type DoctorRetentionSettings, type DoctorFollowUpRow } from '../services/supabase/doctorRetention';
import { 
  Search, MessageSquare, AlertTriangle, Edit3, Calendar, 
  Settings, Users, TrendingDown, TrendingUp, AlertCircle, CheckCircle, 
  HelpCircle, RefreshCw, X, Filter, ArrowUpDown
} from 'lucide-react';
import clsx from 'clsx';

// SWR Cache to prevent reload spinners on tab/page switch
let cachedActivityData: DoctorActivityRow[] | null = null;
let cachedSettingsData: DoctorRetentionSettings | null = null;
let cachedFollowUpsData: DoctorFollowUpRow[] | null = null;

export default function DoctorRetention() {
  const { user } = useAuth();
  
  // State
  const [loading, setLoading] = useState(!cachedActivityData);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<DoctorActivityRow[]>(cachedActivityData || []);
  const [settings, setSettings] = useState<DoctorRetentionSettings>(cachedSettingsData || {
    oneCaseChurnDays: 14,
    newClientDays: 30,
    recentlyChurnedMinDays: 31,
    longTermChurnDays: 90,
    declineThresholdPct: 30,
    growthThresholdPct: 15,
    highRejectionRatePct: 20
  });
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSegments, setSelectedSegments] = useState<string[]>([]);
  const [minVal, setMinVal] = useState<string>('');
  const [maxVal, setMaxVal] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('days_idle'); // 'days_idle' | 'decline_pct' | 'value_at_risk'
  
  // Tab State: 'analytics' | 'todays-followups' | 'settings'
  const [activeTab, setActiveTab] = useState<'analytics' | 'todays-followups' | 'settings'>('analytics');
  
  // Modals
  const [showFollowUpModal, setShowFollowUpModal] = useState(false);
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorActivityRow | null>(null);
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [followUpStatus, setFollowUpStatus] = useState('promised_order');
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');
  const [isSubmittingFollowUp, setIsSubmittingFollowUp] = useState(false);
  
  // Todays follow ups
  const [todaysFollowUps, setTodaysFollowUps] = useState<DoctorFollowUpRow[]>(cachedFollowUpsData || []);
  
  // Save Settings State
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  
  // Load data
  const loadData = useCallback(async () => {
    if (!cachedActivityData) {
      setLoading(true);
    }
    try {
      const activityData = await doctorRetentionService.getDoctorActivity();
      cachedActivityData = activityData;
      setData(activityData);
      
      const settingsData = await doctorRetentionService.getSettings();
      cachedSettingsData = settingsData;
      setSettings(settingsData);
      
      const followUps = await doctorRetentionService.getTodaysFollowUps();
      cachedFollowUpsData = followUps;
      setTodaysFollowUps(followUps);
    } catch (err) {
      console.error('Error loading doctor retention data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle follow up submit
  const handleFollowUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoctor || !followUpNotes.trim()) return;
    
    setIsSubmittingFollowUp(true);
    try {
      await doctorRetentionService.logFollowUp({
        doctorId: selectedDoctor.doctorId,
        notes: followUpNotes,
        status: followUpStatus,
        nextFollowUpDate: nextFollowUpDate || undefined
      });
      
      setShowFollowUpModal(false);
      setSelectedDoctor(null);
      setFollowUpNotes('');
      setFollowUpStatus('promised_order');
      setNextFollowUpDate('');
      
      await loadData();
    } catch (err) {
      console.error('Error logging follow-up:', err);
      alert('فشل تسجيل المتابعة. يرجى المحاولة مرة أخرى.');
    } finally {
      setIsSubmittingFollowUp(false);
    }
  };

  // Handle settings update
  const handleSettingsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    setSettingsError(null);
    try {
      await doctorRetentionService.updateSettings(settings);
      alert('تم تحديث الإعدادات بنجاح.');
      await loadData();
    } catch (err) {
      console.error('Error updating settings:', err);
      setSettingsError('فشل حفظ الإعدادات. يرجى التأكد من الصلاحيات.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Segment metadata
  const segmentsMap: Record<string, { label: string, color: string, bg: string, border: string, icon: React.ComponentType<{ size?: number; className?: string }> }> = {
    needs_activation: { label: 'بحاجة لتفعيل', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', icon: HelpCircle },
    rejected_only: { label: 'مرفوض فقط', color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', icon: AlertCircle },
    one_case_churned: { label: 'حالة وتوقف', color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200', icon: AlertTriangle },
    long_term_churned: { label: 'متوقف تماماً', color: 'text-gray-500', bg: 'bg-gray-100', border: 'border-gray-300', icon: X },
    recently_churned: { label: 'متوقف مؤخراً', color: 'text-gray-700', bg: 'bg-gray-50', border: 'border-gray-200', icon: Calendar },
    new: { label: 'عميل جديد', color: 'text-sky-600', bg: 'bg-sky-50', border: 'border-sky-200', icon: CheckCircle },
    declining_confirmed: { label: 'تراجع مؤكد ⚠️', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', icon: TrendingDown },
    declining_early: { label: 'تراجع مبكر ⏳', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', icon: TrendingDown },
    growing: { label: 'متنامي', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200', icon: TrendingUp },
    stable: { label: 'مستقر', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', icon: CheckCircle }
  };

  const toggleSegmentFilter = (segmentKey: string) => {
    setSelectedSegments(prev => 
      prev.includes(segmentKey)
        ? prev.filter(k => k !== segmentKey)
        : [...prev, segmentKey]
    );
  };

  // Filter & Sort Logic
  const filteredData = data.filter(row => {
    const matchesSearch = 
      row.doctorName.toLowerCase().includes(searchTerm.toLowerCase()) || 
      row.doctorCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (row.parentName && row.parentName.toLowerCase().includes(searchTerm.toLowerCase()));
      
    const matchesSegment = selectedSegments.length === 0 || selectedSegments.includes(row.calculatedSegment);
    
    // Value range
    const val = row.averageMonthlyOrdersValue;
    const matchesMinVal = minVal === '' || val >= parseFloat(minVal);
    const matchesMaxVal = maxVal === '' || val <= parseFloat(maxVal);
    
    return matchesSearch && matchesSegment && matchesMinVal && matchesMaxVal;
  });

  const sortedData = [...filteredData].sort((a, b) => {
    if (sortBy === 'days_idle') {
      const valA = a.daysSinceLastOrder ?? -1;
      const valB = b.daysSinceLastOrder ?? -1;
      return valB - valA; // Longest idle days first
    }
    if (sortBy === 'decline_pct') {
      // Sort by the lowest (most negative) change percentage value
      return a.changePercentageValue - b.changePercentageValue;
    }
    if (sortBy === 'value_at_risk') {
      // Sort by highest average monthly orders value first
      return b.averageMonthlyOrdersValue - a.averageMonthlyOrdersValue;
    }
    return 0;
  });

  // Calculate KPIs
  const getSegmentCount = (segment: string) => data.filter(d => d.calculatedSegment === segment).length;

  // Doctors with high rejection rate
  const highRejectionCount = data.filter(d => d.rejectedRatioPct > settings.highRejectionRatePct).length;

  // Generate WhatsApp Message Template
  const getWhatsAppLink = (doctor: DoctorActivityRow) => {
    const phone = doctor.doctorPhone || doctor.doctorPhone2;
    if (!phone) return '';
    
    const formattedPhone = phone.replace(/\s+/g, '');
    const cleanPhone = formattedPhone.startsWith('0') ? '2' + formattedPhone : formattedPhone;
    
    const docName = doctor.doctorName;
    const patientName = doctor.lastCasePatient || 'حالة سابقة';
    const caseCode = doctor.lastCaseCode || '';
    
    let text = '';
    if (doctor.rejectedRatioPct > settings.highRejectionRatePct) {
      // Rejection reason query template
      text = `أهلاً دكتور ${docName}، معملنا يرحب بحضرتك. كنا حابين نستفسر ونطمن من حضرتك بخصوص الحالات الأخيرة التي لم تكتمل في المعمل (مثل حالة ${patientName} كود: ${caseCode})، حابين نعرف لو في أي ملاحظات فنية بخصوص المقاسات أو التحضير نقدر نساعد حضرتك فيها لتجنب تكرار المشكلة وتسهيل الشغل مستقبلاً؟`;
    } else {
      switch (doctor.calculatedSegment) {
        case 'needs_activation':
          text = `أهلاً دكتور ${docName}، معملنا يرحب بحضرتك ويسعد ببدء التعامل معك. حابين نعرف لو في أي حالة نقدر نساعد حضرتك فيها اليوم أو نرسل مندوبنا لاستلام الشغل؟`;
          break;
        case 'rejected_only':
          text = `أهلاً دكتور ${docName}، معملنا يرحب بحضرتك. لاحظنا أن الحالات المسجلة باسمك لم تكتمل، حابين نطمن على المشاكل اللي واجهتك وهل نقدر نساعد حضرتك في تلافيها في الحالات الجاية؟`;
          break;
        case 'one_case_churned':
          text = `دكتور ${docName} الغالي، كنا سعداء جداً بالتعامل مع حضرتك في حالة المريض (${patientName}) كود: ${caseCode}. حابين نطمن على رأي حضرتك في الشغل وهل في أي ملاحظات نقدر نطورها عشان نكمل سوا ونسلمك الشغل الجاي بأفضل جودة؟`;
          break;
        case 'declining_confirmed':
        case 'declining_early':
          text = `مساء الخير دكتور ${docName}، وحشنا شغلك المتميز معانا. لاحظنا إن معدل الحالات قل الفترة دي، حابين نطمن إن كل شيء تمام وهل في أي ملاحظات على الشغل الأخير نقدر نحسنها لحضرتك؟`;
          break;
        case 'recently_churned':
          text = `دكتور ${docName} العزيز، بقالنا حوالي ${doctor.daysSinceLastOrder || 30} يوم متشرفناش بالعمل مع حضرتك. حابين نطمن عليك وعلى العيادة، وفي عروض خاصة نود إطلاعك عليها للحالات القادمة...`;
          break;
        case 'long_term_churned':
          text = `دكتور ${docName} الغالي، وحشنا تعاملك الراقي معانا. حابين نطمن على صحتك وتفاصيل شغلك، حابين نعرض على حضرتك الخدمات والأسعار المحدثة ونعرف لو نقدر نرجع نشتغل مع بعض بخصومات مميز؟`;
          break;
        default:
          text = `مساء الخير دكتور ${docName}، معملنا يشكر حضرتك على ثقتك المستمرة ومعدل شغلك المتميز. حابين نطمن لو في أي ملاحظات أو طلبات خاصة حابب نراعيها في الحالات القادمة؟`;
      }
    }
    
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
  };

  return (
    <div className="space-y-6 text-right" dir="rtl">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl text-white shadow-lg shadow-indigo-100">
            <Users size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">متابعة وتنشيط الأطباء</h1>
            <p className="text-sm text-gray-400">تحليل ذكي لحجم أعمال الأطباء وتتبع نشاطهم وتسهيل تواصل المناديب معهم</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 transition-all disabled:opacity-50"
          >
            <RefreshCw size={15} className={clsx(refreshing && 'animate-spin')} />
            تحديث البيانات
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Alarm Rejections KPI */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex items-start gap-4">
          <div className="p-3 rounded-xl bg-purple-50 text-purple-600 border border-purple-100">
            <AlertTriangle size={22} />
          </div>
          <div className="flex-1">
            <p className="text-xs text-gray-400 font-medium">أطباء بنسبة رفض مقلقة</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{highRejectionCount}</p>
            <p className="text-xs text-red-500 font-medium mt-1">أعلى من حد الأمان ({settings.highRejectionRatePct}%)</p>
          </div>
        </div>

        {/* Churn & Decline Summary */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex items-start gap-4">
          <div className="p-3 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
            <TrendingDown size={22} />
          </div>
          <div className="flex-1">
            <p className="text-xs text-gray-400 font-medium">إجمالي الأطباء المعرضين للركود</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">
              {getSegmentCount('declining_confirmed') + getSegmentCount('declining_early') + getSegmentCount('recently_churned') + getSegmentCount('long_term_churned')}
            </p>
            <p className="text-xs text-gray-400 mt-1">متراجعون ومتوقفون</p>
          </div>
        </div>
      </div>

      {/* Segment counts widgets (10 Segments summary) */}
      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3">
        <h3 className="text-xs font-semibold text-gray-400 flex items-center gap-1">
          <Filter size={13} />
          حجم الأطباء موزعين على الـ 10 شرائح الكلية:
        </h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(segmentsMap).map(([key, info]) => {
            const count = getSegmentCount(key);
            const active = selectedSegments.includes(key);
            const IconComponent = info.icon;
            
            return (
              <button
                key={key}
                onClick={() => toggleSegmentFilter(key)}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border",
                  active 
                    ? `${info.bg} ${info.color} ${info.border} shadow-sm scale-105` 
                    : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                )}
              >
                <IconComponent size={12} />
                <span>{info.label}</span>
                <span className={clsx("px-1.5 py-0.5 rounded-full text-[10px]", active ? "bg-white" : "bg-gray-100 text-gray-600")}>{count}</span>
              </button>
            );
          })}
          
          {selectedSegments.length > 0 && (
            <button
              onClick={() => setSelectedSegments([])}
              className="text-xs text-red-500 hover:text-red-700 font-semibold px-2 py-1.5"
            >
              إعادة تعيين الفلتر
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-6 -mb-px">
          <button
            onClick={() => setActiveTab('analytics')}
            className={clsx(
              "pb-4 font-semibold text-sm transition-all border-b-2",
              activeTab === 'analytics' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            كل الأطباء ({filteredData.length})
          </button>
          <button
            onClick={() => setActiveTab('todays-followups')}
            className={clsx(
              "pb-4 font-semibold text-sm transition-all border-b-2 flex items-center gap-1.5",
              activeTab === 'todays-followups' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            متابعات اليوم
            {todaysFollowUps.length > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-red-100 text-red-600 font-bold rounded-full">{todaysFollowUps.length}</span>
            )}
          </button>
          {user?.role === 'admin' && (
            <button
              onClick={() => setActiveTab('settings')}
              className={clsx(
                "pb-4 font-semibold text-sm transition-all border-b-2 flex items-center gap-1.5",
                activeTab === 'settings' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              <Settings size={14} />
              إعدادات لوحة المتابعة
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-gray-100">
          <RefreshCw size={30} className="animate-spin text-indigo-600" />
          <p className="text-sm text-gray-400 mt-3 font-medium">جاري تحميل البيانات الذكية...</p>
        </div>
      ) : (
        <>
          {activeTab === 'analytics' && (
            <div className="space-y-4">
              
              {/* Detailed Filters & Sorting Panel */}
              <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                
                {/* Search */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-400">البحث بالاسم أو الكود</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 right-3 flex items-center text-gray-400">
                      <Search size={16} />
                    </span>
                    <input
                      type="text"
                      placeholder="ابحث باسم الطبيب أو الكود..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pr-10 pl-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 text-right bg-gray-50/50"
                    />
                  </div>
                </div>

                {/* Financial Range */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-400">نطاق القيمة المالية (المعدل الشهري)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="من"
                      value={minVal}
                      onChange={(e) => setMinVal(e.target.value)}
                      className="w-1/2 px-2 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 text-center bg-gray-50/50"
                    />
                    <input
                      type="number"
                      placeholder="إلى"
                      value={maxVal}
                      onChange={(e) => setMaxVal(e.target.value)}
                      className="w-1/2 px-2 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 text-center bg-gray-50/50"
                    />
                  </div>
                </div>

                {/* Sorting */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-400 flex items-center gap-1">
                    <ArrowUpDown size={13} />
                    ترتيب النتائج حسب
                  </label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 text-gray-600 bg-gray-50/50"
                  >
                    <option value="days_idle">أيام التوقف (الأطول غياباً)</option>
                    <option value="decline_pct">نسبة التراجع (الأعلى تراجعاً ماليّاً)</option>
                    <option value="value_at_risk">القيمة المهددة / الحجم الشهري الافتراضي</option>
                  </select>
                </div>
              </div>

              {/* Table */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-right border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 text-xs font-semibold">
                        <th className="p-4">اسم الطبيب وكوده</th>
                        <th className="p-4">الشريحة الحالية</th>
                        <th className="p-4">أول / آخر أوردر للعيادة</th>
                        <th className="p-4">المعدل الشهري الافتراضي</th>
                        <th className="p-4">نشاط آخر 30 / 60 يوماً</th>
                        <th className="p-4">معدل رفض الأوردرات</th>
                        <th className="p-4">حالة المتابعة والاتصال</th>
                        <th className="p-4 text-center">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                      {sortedData.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-gray-400">لا توجد بيانات مطابقة للفلاتر المحددة.</td>
                        </tr>
                      ) : (
                        sortedData.map(row => {
                          const segInfo = segmentsMap[row.calculatedSegment] || { label: row.calculatedSegment, color: 'text-gray-500', bg: 'bg-gray-50', border: 'border-gray-200', icon: HelpCircle };
                          const SegIcon = segInfo.icon;
                          const hasPhone = !!(row.doctorPhone || row.doctorPhone2);
                          const showWarning = row.rejectedRatioPct > settings.highRejectionRatePct;
                          const changePctCount = row.changePercentageCount;
                          const changePctValue = row.changePercentageValue;
                          
                          return (
                            <tr key={row.doctorId} className="hover:bg-gray-50/50 transition-colors">
                              <td className="p-4">
                                <div className="font-semibold text-gray-800">
                                  {row.parentName ? `${row.parentName} - ${row.doctorName}` : row.doctorName}
                                </div>
                                <div className="text-xs text-gray-400 mt-0.5">كود: {row.doctorCode}</div>
                              </td>

                              {/* Segment (calculatedSegment) */}
                              <td className="p-4">
                                <span className={clsx("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border", segInfo.bg, segInfo.color, segInfo.border)}>
                                  <SegIcon size={12} />
                                  {segInfo.label}
                                </span>
                              </td>

                              {/* Dates (firstOrderDate, lastOrderDate, daysSinceLastOrder) */}
                              <td className="p-4 text-xs">
                                {row.firstOrderDate ? (
                                  <>
                                    <div className="text-gray-400" title="تاريخ أول أوردر">أول: {new Date(row.firstOrderDate).toLocaleDateString('en-US')}</div>
                                    <div className="text-gray-700 font-medium mt-0.5" title="تاريخ آخر أوردر">آخر: {new Date(row.lastOrderDate!).toLocaleDateString('en-US')}</div>
                                    <div className="text-red-500 font-bold mt-1">توقف: {row.daysSinceLastOrder} يوم</div>
                                  </>
                                ) : (
                                  <span className="text-gray-400">بلا أوردرات صالحة</span>
                                )}
                              </td>

                              {/* History Avg (averageMonthlyOrdersCount, averageMonthlyOrdersValue, validOrdersCount) */}
                              <td className="p-4 text-xs">
                                <div className="text-gray-800 font-semibold">{row.averageMonthlyOrdersCount} حالة/شهر</div>
                                <div className="text-gray-500 mt-0.5">{row.averageMonthlyOrdersValue.toLocaleString('en-US')} ج.م</div>
                                <div className="text-[10px] text-gray-400 mt-0.5">إجمالي الصالح: {row.validOrdersCount}</div>
                              </td>

                              {/* Last 30/60 Days (ordersCountLast30Days, ordersValueLast30Days, ordersCountLast60Days, ordersValueLast60Days, changePercentageCount, changePercentageValue) */}
                              <td className="p-4 text-xs">
                                <div className="text-gray-700 font-medium">30ي: {row.ordersCountLast30Days} حالة ({row.ordersValueLast30Days.toLocaleString('en-US')} ج.م)</div>
                                <div className="text-gray-400 mt-0.5">60ي: {row.ordersCountLast60Days} حالة ({row.ordersValueLast60Days.toLocaleString('en-US')} ج.م)</div>
                                
                                {row.validOrdersCount > 0 && (
                                  <div className="flex items-center gap-1 text-[10px] mt-1">
                                    <span className={clsx("font-bold px-1 rounded", changePctCount < 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600')}>
                                      عددي: {changePctCount < 0 ? '↓' : '↑'}{Math.abs(changePctCount)}%
                                    </span>
                                    <span className={clsx("font-bold px-1 rounded", changePctValue < 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600')}>
                                      مالي: {changePctValue < 0 ? '↓' : '↑'}{Math.abs(changePctValue)}%
                                    </span>
                                  </div>
                                )}
                              </td>

                              {/* Rejections (totalOrdersCount, rejectedOrdersCount, rejectedOrdersValue, rejectedOrdersCount30, rejectedOrdersValue30, rejectedRatioPct) */}
                              <td className="p-4 text-xs">
                                <div className="flex items-center gap-1.5">
                                  <span className={clsx("font-bold px-1.5 py-0.5 rounded", showWarning ? "bg-red-100 text-red-700 font-extrabold animate-pulse" : "bg-gray-100 text-gray-700")}>
                                    {row.rejectedRatioPct}% رفض
                                  </span>
                                </div>
                                <div className="text-gray-400 mt-1">
                                  كلي: {row.rejectedOrdersCount} حالة ({row.rejectedOrdersValue.toLocaleString('en-US')} ج.م)
                                </div>
                                <div className="text-[10px] text-red-400 mt-0.5">
                                  30ي: {row.rejectedOrdersCount30} حالة ({row.rejectedOrdersValue30.toLocaleString('en-US')} ج.م)
                                </div>
                              </td>

                              {/* Last follow up (lastFollowUpDate, lastFollowUpNotes) */}
                              <td className="p-4 text-xs max-w-xs">
                                {row.lastFollowUpDate ? (
                                  <>
                                    <div className="text-gray-500 font-semibold">اتصال: {new Date(row.lastFollowUpDate).toLocaleDateString('en-US')}</div>
                                    <div className="text-gray-600 truncate mt-0.5" title={row.lastFollowUpNotes || ''}>{row.lastFollowUpNotes}</div>
                                  </>
                                ) : (
                                  <span className="text-gray-400">لا يوجد متابعة مسجلة</span>
                                )}
                              </td>

                              {/* Actions (WhatsApp template, Follow up log) */}
                              <td className="p-4">
                                <div className="flex items-center justify-center gap-2">
                                  
                                  {/* WhatsApp (doctorPhone, doctorPhone2, lastCasePatient, lastCaseCode) */}
                                  <a
                                    href={hasPhone ? getWhatsAppLink(row) : undefined}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => {
                                      if (!hasPhone) e.preventDefault();
                                    }}
                                    className={clsx(
                                      "p-2 rounded-xl text-white transition-all shadow-sm",
                                      hasPhone 
                                        ? "bg-green-500 hover:bg-green-600 shadow-green-100 hover:scale-105" 
                                        : "bg-gray-200 cursor-not-allowed text-gray-400 shadow-none"
                                    )}
                                    title={hasPhone ? `واتساب مخصص: ${row.doctorPhone || row.doctorPhone2}` : "لا يوجد هاتف مسجل"}
                                  >
                                    <MessageSquare size={15} />
                                  </a>
                                  
                                  {/* Record followup modal trigger */}
                                  <button
                                    onClick={() => {
                                      setSelectedDoctor(row);
                                      setShowFollowUpModal(true);
                                    }}
                                    className="p-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-xl transition-all shadow-sm shadow-indigo-50 hover:scale-105"
                                    title="تسجيل مكالمة / زيارة للعيادة"
                                  >
                                    <Edit3 size={15} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'todays-followups' && (
            <div className="space-y-4">
              <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
                <div className="p-3 bg-red-50 text-red-600 rounded-xl">
                  <Calendar size={22} />
                </div>
                <div>
                  <h3 className="font-bold text-gray-800 text-base">قائمة المتابعات المستحقة اليوم أو المتأخرة</h3>
                  <p className="text-sm text-gray-400">يرجى الاتصال بالعملاء المذكورين وتسجيل نتائج المكالمات فوراً لتنشيط حساباتهم.</p>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-right border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 text-xs font-semibold">
                        <th className="p-4">الطبيب</th>
                        <th className="p-4">المندوب</th>
                        <th className="p-4">تاريخ المتابعة المخطط</th>
                        <th className="p-4">الهاتف</th>
                        <th className="p-4 text-center">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                      {todaysFollowUps.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-gray-400">لا توجد أي متابعات مستحقة اليوم. عمل ممتاز!</td>
                        </tr>
                      ) : (
                        todaysFollowUps.map(f => (
                          <tr key={f.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="p-4 font-semibold text-gray-800">
                              {f.doctors?.parent_name ? `${f.doctors.parent_name} - ${f.doctors.name}` : f.doctors?.name}
                              <span className="text-xs text-gray-400 font-normal mr-2">({f.doctors?.doctor_code})</span>
                            </td>
                            <td className="p-4 text-xs text-gray-500">
                              {f.doctors?.representative_name || 'غير محدد'}
                            </td>
                            <td className="p-4 text-xs font-semibold text-red-500">
                              {f.next_follow_up_date ? new Date(f.next_follow_up_date).toLocaleDateString('en-US') : 'بلا تاريخ'}
                            </td>
                            <td className="p-4 text-xs font-medium text-gray-600">
                              {f.doctors?.phone || f.doctors?.phone2 || 'لا يوجد'}
                            </td>
                            <td className="p-4">
                              <div className="flex items-center justify-center gap-2">
                                <a
                                  href={(f.doctors?.phone || f.doctors?.phone2) ? `https://wa.me/${(f.doctors?.phone || f.doctors?.phone2 || '').replace(/\s+/g, '')}` : undefined}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => {
                                    if (!(f.doctors?.phone || f.doctors?.phone2)) e.preventDefault();
                                  }}
                                  className={clsx(
                                    "p-2 rounded-xl text-white transition-all shadow-sm",
                                    (f.doctors?.phone || f.doctors?.phone2)
                                      ? "bg-green-500 hover:bg-green-600 shadow-green-100"
                                      : "bg-gray-200 cursor-not-allowed text-gray-400"
                                  )}
                                >
                                  <MessageSquare size={14} />
                                </a>
                                <button
                                  onClick={() => {
                                    const mappedDoc: DoctorActivityRow = {
                                      doctorId: f.doctor_id,
                                      doctorName: f.doctors?.name || '',
                                      parentName: f.doctors?.parent_name || null,
                                      doctorPhone: f.doctors?.phone || '',
                                      doctorPhone2: f.doctors?.phone2 || null,
                                      doctorCode: f.doctors?.doctor_code || '',
                                      representativeName: f.doctors?.representative_name || '',
                                      representativeId: f.doctors?.representative_id || null,
                                      firstOrderDate: null,
                                      lastOrderDate: null,
                                      daysSinceLastOrder: null,
                                      totalOrdersCount: 0,
                                      validOrdersCount: 0,
                                      averageMonthlyOrdersCount: 0,
                                      averageMonthlyOrdersValue: 0,
                                      ordersCountLast30Days: 0,
                                      ordersValueLast30Days: 0,
                                      ordersCountLast60Days: 0,
                                      ordersValueLast60Days: 0,
                                      changePercentageCount: 0,
                                      changePercentageValue: 0,
                                      rejectedOrdersCount: 0,
                                      rejectedOrdersValue: 0,
                                      rejectedOrdersCount30: 0,
                                      rejectedOrdersValue30: 0,
                                      rejectedRatioPct: 0,
                                      lastCasePatient: null,
                                      lastCaseCode: null,
                                      calculatedSegment: 'stable',
                                      lastFollowUpDate: null,
                                      lastFollowUpNotes: null
                                    };
                                    setSelectedDoctor(mappedDoc);
                                    setShowFollowUpModal(true);
                                  }}
                                  className="p-2 bg-indigo-50 text-indigo-600 rounded-xl transition-all shadow-sm hover:bg-indigo-100"
                                >
                                  <Edit3 size={14} />
                                </button>
                              </div>
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

          {activeTab === 'settings' && user?.role === 'admin' && (
            <form onSubmit={handleSettingsSubmit} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-6 max-w-2xl">
              <h3 className="font-bold text-gray-800 text-lg border-b pb-3">إعدادات ونسب تنشيط الأطباء</h3>
              
              {settingsError && (
                <div className="p-3 bg-red-50 text-red-600 text-sm rounded-xl font-medium">
                  {settingsError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">عدد أيام غياب الحالة الواحدة (one_case_churn_days)</label>
                  <input
                    type="number"
                    value={settings.oneCaseChurnDays}
                    onChange={(e) => setSettings({ ...settings, oneCaseChurnDays: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 text-left"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">أيام تصنيف العميل كجديد (new_client_days)</label>
                  <input
                    type="number"
                    value={settings.newClientDays}
                    onChange={(e) => setSettings({ ...settings, newClientDays: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 text-left"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">الحد الأدنى لأيام التوقف المؤقت (recently_churned_min_days)</label>
                  <input
                    type="number"
                    value={settings.recentlyChurnedMinDays}
                    onChange={(e) => setSettings({ ...settings, recentlyChurnedMinDays: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 text-left"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">أيام التوقف الكامل للعميل (long_term_churn_days)</label>
                  <input
                    type="number"
                    value={settings.longTermChurnDays}
                    onChange={(e) => setSettings({ ...settings, longTermChurnDays: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 text-left"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">نسبة انخفاض الحالات لاعتباره متراجعاً %</label>
                  <input
                    type="number"
                    value={settings.declineThresholdPct}
                    onChange={(e) => setSettings({ ...settings, declineThresholdPct: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 text-left"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">نسبة زيادة الحالات لاعتباره نامياً %</label>
                  <input
                    type="number"
                    value={settings.growthThresholdPct}
                    onChange={(e) => setSettings({ ...settings, growthThresholdPct: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 text-left"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">حد تحذير المرفوضات المقلق للعيادة %</label>
                  <input
                    type="number"
                    value={settings.highRejectionRatePct}
                    onChange={(e) => setSettings({ ...settings, highRejectionRatePct: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 text-left"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t pt-4">
                <button
                  type="submit"
                  disabled={isSavingSettings}
                  className="px-5 py-2 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-all text-sm disabled:opacity-50"
                >
                  {isSavingSettings ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {/* Follow-up / Notes Modal */}
      {showFollowUpModal && selectedDoctor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            
            {/* Header */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 text-base">تسجيل متابعة للعميل</h3>
              <button 
                onClick={() => {
                  setShowFollowUpModal(false);
                  setSelectedDoctor(null);
                }}
                className="p-1 hover:bg-gray-100 rounded-lg text-gray-400"
              >
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleFollowUpSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">الطبيب</label>
                <div className="font-bold text-gray-800 text-sm">{selectedDoctor.doctorName} ({selectedDoctor.doctorCode})</div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">تفاصيل التواصل والملاحظات</label>
                <textarea
                  value={followUpNotes}
                  onChange={(e) => setFollowUpNotes(e.target.value)}
                  placeholder="اكتب ملاحظاتك عن مكالمة الطبيب أو الزيارة..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 text-sm text-right"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">حالة التواصل</label>
                <select
                  value={followUpStatus}
                  onChange={(e) => setFollowUpStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 text-sm bg-white"
                >
                  <option value="promised_order">وعد بإرسال حالة قريباً</option>
                  <option value="busy">مشغول / تواصل لاحقاً</option>
                  <option value="has_complaint">لديه شكوى وجاري فحصها</option>
                  <option value="no_response">لا يرد على الهاتف</option>
                  <option value="not_interested">غير مهتم حالياً</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">تاريخ المتابعة القادمة (اختياري)</label>
                <input
                  type="date"
                  value={nextFollowUpDate}
                  onChange={(e) => setNextFollowUpDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 text-sm text-left"
                />
              </div>

              <div className="flex justify-end gap-2 border-t pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowFollowUpModal(false);
                    setSelectedDoctor(null);
                  }}
                  className="px-4 py-2 border border-gray-200 rounded-xl text-gray-500 font-semibold hover:bg-gray-50 transition-all text-xs"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingFollowUp || !followUpNotes.trim()}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-all text-xs disabled:opacity-50"
                >
                  {isSubmittingFollowUp ? 'جاري التسجيل...' : 'تسجيل المتابعة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
