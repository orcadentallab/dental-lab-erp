/**
 * AI Analytics Page
 * Admin-only page for AI-powered insights and chat
 */

/* eslint-disable @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback } from 'react';
import { Brain, RefreshCw, Clock, Shield, AlertTriangle, ChevronDown, FileText } from 'lucide-react';
import clsx from 'clsx';
import { db } from '../services/db';
import InsightCard, { InsightCardSkeleton } from '../components/ai/InsightCard';
import ChatInterface from '../components/ai/ChatInterface';
import {
    generateInsights,
    getInsights,
    saveInsight,
    type AnalyzeContext,
    type ChatContext,
    type Insight,
    type InsightReport
} from '../services/gemini';

// Interface for UI-ready insights (including createdAt for components)
interface UIInsight extends Insight {
    createdAt?: string;
    type?: 'positive' | 'negative' | 'neutral' | 'action'; // Legacy support
    icon?: string; // Legacy support
}

export default function AIAnalytics() {
    const [reports, setReports] = useState<InsightReport[]>([]);
    const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);

    const [insights, setInsights] = useState<UIInsight[]>([]);
    const [executiveSummary, setExecutiveSummary] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [analyzeContext, setAnalyzeContext] = useState<AnalyzeContext | null>(null);
    const [chatContext, setChatContext] = useState<ChatContext | null>(null);

    // Load Data Context (for generation and chat)
    const loadDataContext = useCallback(async () => {
        try {
            const [orders, transactions, doctors] = await Promise.all([
                db.getAllOrdersUnpaginated(),
                db.getTransactions(),
                db.getDoctors()
            ]);

            // Calculate stats for analysis context (including Delivered as completed)
            const completedOrders = orders.filter(o =>
                ['completed', 'delivered'].includes((o.status || '').toLowerCase())
            );
            const pendingOrders = orders.filter(o =>
                !['completed', 'delivered', 'rejected'].includes((o.status || '').toLowerCase())
            );

            const revenue = transactions
                .filter(t => t.type === 'income' && t.isApproved)
                .reduce((sum, t) => sum + t.amount, 0);

            let productionCosts = 0;
            let operatingExpenses = 0;

            transactions.filter(t => t.type === 'expense' && t.isApproved).forEach(t => {
                if (t.entityType === 'supplier' || t.entityType === 'designer') {
                    productionCosts += t.amount;
                } else {
                    operatingExpenses += t.amount;
                }
            });

            const profit = revenue - (productionCosts + operatingExpenses);
            const grossProfit = revenue - productionCosts;
            const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;
            const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

            // Top Doctors
            const doctorStats = doctors.map(d => {
                const doctorOrders = orders.filter(o => o.doctorId === d.id);
                const doctorRevenue = doctorOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
                return {
                    name: d.name,
                    orderCount: doctorOrders.length,
                    revenue: doctorRevenue
                };
            }).sort((a, b) => b.orderCount - a.orderCount); // All doctors, sorted by order count

            // Helper: count actual units from teethNumbers
            const getUnitCount = (teethNumbers: unknown): number => {
                if (Array.isArray(teethNumbers) && teethNumbers.length > 0) return teethNumbers.length;
                if (typeof teethNumbers === 'string' && teethNumbers.trim()) {
                    return teethNumbers.split(',').filter(s => s.trim()).length || 1;
                }
                return 1;
            };

            // Top Services - count teeth (units) from completed orders only
            const serviceStats: Record<string, { count: number; revenue: number }> = {};
            completedOrders.forEach(order => {
                order.items?.forEach((item: { serviceType: string; price: number; teethNumbers?: unknown }) => {
                    if (!serviceStats[item.serviceType]) {
                        serviceStats[item.serviceType] = { count: 0, revenue: 0 };
                    }
                    const unitCount = getUnitCount(item.teethNumbers);
                    serviceStats[item.serviceType].count += unitCount;
                    serviceStats[item.serviceType].revenue += (item.price || 0) * unitCount;
                });
            });
            const topServices = Object.entries(serviceStats)
                .map(([name, stats]) => ({ name, ...stats }))
                .sort((a, b) => b.count - a.count); // All services, sorted by usage

            // Orders by Status
            const statusCounts: Record<string, number> = {};
            orders.forEach(o => {
                statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
            });
            const ordersByStatus = Object.entries(statusCounts).map(([status, count]) => ({
                status,
                count
            }));

            // Collection Rate
            const totalInvoiced = orders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
            const totalPaid = transactions
                .filter(t => t.type === 'income' && t.isApproved)
                .reduce((sum, t) => sum + t.amount, 0);
            const collectionRate = totalInvoiced > 0 ? (totalPaid / totalInvoiced) * 100 : 0;
            const pendingPayments = totalInvoiced - totalPaid;

            // Set Chat Context
            setChatContext({
                orderCount: orders.length,
                revenue,
                productionCosts,
                operatingExpenses,
                expenses: productionCosts + operatingExpenses,
                profit,
                topDoctors: doctorStats.map(d => ({ name: d.name, orderCount: d.orderCount })),
                topServices: topServices.map(s => ({ name: s.name, count: s.count })),
                recentOrders: orders.slice(0, 10).map(o => ({
                    patientName: o.patientName,
                    status: o.status,
                    totalPrice: o.totalPrice || 0
                }))
            });

            // Set Analysis Context
            setAnalyzeContext({
                orderCount: orders.length,
                completedOrders: completedOrders.length,
                pendingOrders: pendingOrders.length,
                revenue,
                productionCosts,
                operatingExpenses,
                expenses: productionCosts + operatingExpenses,
                profit,
                profitMargin,
                grossMargin,
                topDoctors: doctorStats,
                topServices,
                ordersByStatus,
                revenueByMonth: [],
                collectionRate,
                pendingPayments
            });

        } catch (err) {
            console.error('Error loading data context:', err);
            setError('فشل تحميل بيانات المعمل');
        }
    }, []);

    // Load Reports List
    const loadReports = async () => {
        try {
            setIsLoading(true);
            const data = await getInsights(undefined, 20); // Fetch all types, limit 20

            if (data && data.length > 0) {
                setReports(data);
                // Select latest logic:
                if (!selectedReportId) {
                    const latest = data[0];
                    setSelectedReportId(latest.id);
                    parseAndSetInsights(latest);
                }
            } else {
                // Check if we need to generate one
                // Ensure context is loaded first!
                // We'll rely on the user clicking "Update" if it's empty, 
                // OR we can trigger it if needed, but context might not be ready.
                setReports([]);
            }
        } catch (err) {
            console.error('Error loading reports:', err);
            setError('فشل تحميل الأرشيف');
        } finally {
            setIsLoading(false);
        }
    };

    // Helper to parse content - handles both new (v2.0) and legacy formats
    const parseAndSetInsights = (report: InsightReport) => {
        try {
            let finalInsights: UIInsight[] = [];
            let summary: string | null = null;

            // Handle string content (standard) vs already parsed (rare)
            const content = typeof report.content === 'string'
                ? JSON.parse(report.content)
                : report.content;

            // Check if this is the new v2.0 format (has record_type: 'ai_analysis')
            if (content && content.record_type === 'ai_analysis') {
                // New format v2.0
                summary = content.executive_summary || null;
                finalInsights = (content.insights || []).map((insight: Record<string, unknown>) => ({
                    id: String(insight.id || report.id),
                    title: String(insight.title || ''),
                    content: String(insight.content || ''),
                    category: String(insight.category || 'performance'),
                    severity: String(insight.severity || 'neutral'),
                    createdAt: String(content.generated_at || report.created_at)
                }));
            } else if (Array.isArray(content)) {
                // Legacy format: direct array of insights
                finalInsights = content.map((i: Record<string, unknown>): UIInsight => ({
                    id: String(i.id || report.id),
                    title: String(i.title || ''),
                    content: String(i.content || ''),
                    createdAt: String(report.created_at),
                    // Map legacy 'type' to 'severity' for compatibility
                    severity: (String(i.severity || (i.type === 'action' ? 'neutral' : i.type) || 'neutral')) as UIInsight['severity'],
                    category: (String(i.category || 'performance')) as UIInsight['category'],
                    type: i.type as UIInsight['type'],
                    icon: i.icon as string | undefined,
                }));
            } else if (content && content.insights) {
                // Legacy format: object with insights array
                finalInsights = content.insights.map((i: Record<string, unknown>): UIInsight => ({
                    id: String(i.id || report.id),
                    title: String(i.title || ''),
                    content: String(i.content || ''),
                    createdAt: String(report.created_at),
                    severity: (String(i.severity || (i.type === 'action' ? 'neutral' : i.type) || 'neutral')) as UIInsight['severity'],
                    category: (String(i.category || 'performance')) as UIInsight['category'],
                }));
            } else {
                // Unknown format - treat as single insight
                const fallback: UIInsight = {
                    id: report.id,
                    title: 'تحليل نصي',
                    content: typeof report.content === 'string' ? report.content : JSON.stringify(report.content),
                    category: 'operations',
                    severity: 'neutral',
                    createdAt: report.created_at
                };
                finalInsights = [fallback];
            }

            setExecutiveSummary(summary);
            setInsights(finalInsights);
        } catch (e) {
            console.error('Error parsing report:', e);
            // Fallback: try to display raw content
            setExecutiveSummary(null);
            const fallback: UIInsight = {
                id: report.id || 'fallback',
                title: 'تحليل',
                content: String(report.content || '').substring(0, 500),
                category: 'operations',
                severity: 'neutral',
                createdAt: report.created_at
            };
            setInsights([fallback]);
        }
    };

    // Initialization
    useEffect(() => {
        loadDataContext();
        loadReports();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadDataContext]);

    // Handle Report Selection
    const handleReportSelect = (report: InsightReport) => {
        setSelectedReportId(report.id);
        parseAndSetInsights(report);
        setIsHistoryOpen(false);
    };

    // Handle Generation
    const handleGenerateInsights = async () => {
        if (!analyzeContext) return;

        setIsGenerating(true);
        setError(null);
        try {
            // Always generate 'on_demand' when manually triggered
            const response = await generateInsights(analyzeContext, 'on_demand');

            // Log debug info from Edge Function
            console.log('[AI Analytics] Generation response received');
            console.log('[AI Analytics] Analysis ID:', response.analysis_id);
            const responseWithDebug = response as unknown as { _debug?: { saved?: boolean; savedId?: string; saveError?: string } };
            const debugInfo = responseWithDebug._debug;
            let savedId = debugInfo?.savedId;
            let saveSucceeded = debugInfo?.saved === true;

            if (debugInfo) {
                console.log('[AI Analytics] Edge Function save status:', debugInfo.saved ? '✅ SAVED' : '❌ FAILED');
                if (debugInfo.savedId) console.log('[AI Analytics] Saved with DB ID:', debugInfo.savedId);
                if (debugInfo.saveError) console.error('[AI Analytics] Edge Function save error:', debugInfo.saveError);
            }

            // Fallback: If Edge Function didn't save, save from frontend
            if (!saveSucceeded) {
                console.log('[AI Analytics] Attempting fallback save from frontend...');
                try {
                    const responseContent = JSON.stringify(response);
                    savedId = await saveInsight(
                        'on_demand',
                        responseContent,
                        analyzeContext,
                        response.model_version || 'gemini-1.5-flash',
                        response.prompt_version || 'v2.0'
                    );
                    console.log('[AI Analytics] Fallback save SUCCESS with ID:', savedId);
                    saveSucceeded = true;
                } catch (saveErr: unknown) {
                    console.error('[AI Analytics] Fallback save FAILED:', saveErr);
                    const errorMessage = saveErr instanceof Error ? saveErr.message : String(saveErr);
                    // Show warning but don't block - user can still see the analysis
                    setError(`⚠️ التحليل ظهر لكن لم يتم حفظه في الأرشيف. السبب: ${errorMessage}`);
                }
            }

            // New format v2.0 response - use savedId if available
            const newReport: InsightReport = {
                id: savedId || response.analysis_id,
                created_at: response.generated_at,
                content: JSON.stringify(response),
                insight_type: response.analysis_scope,
                model_version: response.model_version || 'gemini-1.5-flash',
                prompt_version: response.prompt_version || 'v2.0',
                rating: null
            };

            // Set executive summary directly from response
            setExecutiveSummary(response.executive_summary);

            // Set insights directly from response
            setInsights(response.insights.map(insight => ({
                ...insight,
                created_at: response.generated_at
            })));

            // Prepend to list and select it (only if saved successfully)
            if (saveSucceeded) {
                setReports(prev => [newReport, ...prev]);
                setSelectedReportId(newReport.id);
            }

        } catch (err) {
            console.error('Error generating insights:', err);
            setError('حدث خطأ أثناء التحليل. حاول مرة أخرى.');
        } finally {
            setIsGenerating(false);
        }
    };

    const selectedReport = reports.find(r => r.id === selectedReportId);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-100px)]">
            {/* Left Panel: Insights */}
            <div className="lg:col-span-2 flex flex-col gap-6 overflow-hidden h-full">
                {/* Header */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex-shrink-0 relative z-20">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl text-white shadow-lg shadow-indigo-200">
                                <Brain size={24} />
                            </div>
                            <div>
                                <h2 className="text-2xl font-bold text-gray-800">التحليل الذكي</h2>
                                <p className="text-gray-500 text-sm">تحليلات وتوقعات أداء المعمل</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            {/* History Dropdown */}
                            <div className="relative">
                                <button
                                    onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                                    className="flex items-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-xl border border-gray-200 transition-colors text-sm font-medium"
                                >
                                    <Clock size={16} className="text-gray-500" />
                                    <span>
                                        {selectedReport
                                            ? new Date(selectedReport.created_at).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' })
                                            : 'الأرشيف'}
                                    </span>
                                    <ChevronDown size={16} className={clsx("transition-transform text-gray-400", isHistoryOpen && "rotate-180")} />
                                </button>

                                {isHistoryOpen && (
                                    <div className="absolute top-full right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-50 max-h-60 overflow-y-auto">
                                        {reports.length === 0 ? (
                                            <p className="p-4 text-center text-gray-400 text-sm">لا توجد تقارير سابقة</p>
                                        ) : (
                                            reports.map(report => (
                                                <button
                                                    key={report.id}
                                                    onClick={() => handleReportSelect(report)}
                                                    className={clsx(
                                                        "w-full text-right px-4 py-3 text-sm hover:bg-gray-50 transition-colors flex items-center justify-between group border-b border-gray-50 last:border-0",
                                                        selectedReportId === report.id ? "bg-indigo-50 text-indigo-700" : "text-gray-700"
                                                    )}
                                                >
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">
                                                            {new Date(report.created_at).toLocaleDateString('ar-EG')}
                                                        </span>
                                                        <span className="text-xs text-gray-400 mt-0.5">
                                                            {new Date(report.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                    {report.insight_type === 'on_demand' && (
                                                        <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded">فوري</span>
                                                    )}
                                                </button>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>

                            <button
                                onClick={handleGenerateInsights}
                                disabled={isGenerating || !analyzeContext}
                                className={clsx(
                                    "flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-medium shadow-md transition-all hover:shadow-lg active:scale-95",
                                    (isGenerating || !analyzeContext)
                                        ? "bg-gray-300 cursor-not-allowed"
                                        : "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
                                )}
                            >
                                <RefreshCw size={18} className={clsx(isGenerating && "animate-spin")} />
                                <span>{isGenerating ? 'جاري التحليل...' : 'تحديث التحليل'}</span>
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2 border border-red-100">
                            <AlertTriangle size={16} />
                            {error}
                        </div>
                    )}
                </div>

                {/* Insights Grid */}
                <div className="flex-1 overflow-y-auto pr-1 pb-4">
                    {/* Executive Summary Banner (new format) */}
                    {executiveSummary && (
                        <div className="mb-4 p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-100">
                            <div className="flex items-start gap-3">
                                <FileText size={20} className="text-indigo-600 mt-0.5 flex-shrink-0" />
                                <div>
                                    <h4 className="font-semibold text-indigo-900 mb-1">ملخص تنفيذي</h4>
                                    <p className="text-indigo-800 text-sm leading-relaxed">{executiveSummary}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {isLoading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {[1, 2, 3, 4].map(i => <InsightCardSkeleton key={i} />)}
                        </div>
                    ) : insights.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {insights.map((insight, index) => (
                                <InsightCard
                                    key={insight.id || index}
                                    {...insight}
                                    showRating={true}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-64 bg-white rounded-2xl border border-gray-200 border-dashed text-gray-400">
                            <Brain size={48} className="mb-4 opacity-50" />
                            <p>لا توجد تحليلات متاحة. اضغط على "تحديث التحليل" للبدء.</p>
                        </div>
                    )}

                    {/* Disclaimer */}
                    {insights.length > 0 && (
                        <div className="mt-6 flex items-start gap-3 p-4 bg-blue-50/50 rounded-xl border border-blue-100/50 text-xs text-blue-700/80 leading-relaxed">
                            <Shield size={16} className="mt-0.5 flex-shrink-0" />
                            <p>
                                هذا التحليل تم إنشاؤه بواسطة الذكاء الاصطناعي (Gemini 2.5) بناءً على البيانات المسجلة.
                                يرجى مراجعة الأرقام المالية قبل اتخاذ قرارات حاسمة.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Right Panel: Chat Interface */}
            <div className="h-full overflow-hidden top-24 sticky">
                {chatContext ? <ChatInterface context={chatContext} /> : (
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm h-full flex items-center justify-center">
                        <div className="animate-spin w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full" />
                    </div>
                )}
            </div>
        </div>
    );
}
