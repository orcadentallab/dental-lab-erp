/**
 * MarketingAnalytics.tsx
 * Admin-only Marketing Analytics Dashboard
 * Displays conversion events tracked from the public Marketing Landing Page
 */

import { useState, useEffect } from 'react';
import { TrendingUp, MousePointerClick, Smartphone, Monitor, RefreshCw, AlertTriangle, BarChart2, MessageSquare, PhoneCall } from 'lucide-react';
import clsx from 'clsx';
import { marketingService, type MarketingSummary, type DailyTrendPoint } from '../services/supabase/marketingService';
import { contactService, type ContactInquiry } from '../services/contactService';

// ─── Mini SVG Line Chart (no external deps) ─────────────────────

interface LineChartProps {
    data: DailyTrendPoint[];
}

function MiniLineChart({ data }: LineChartProps) {
    if (!data || data.length === 0) return (
        <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
            لا توجد بيانات كافية لعرض الرسم البياني
        </div>
    );

    const sorted = [...data].sort((a, b) => a.day.localeCompare(b.day)).slice(-14);
    const maxVal = Math.max(...sorted.map(d => Math.max(d.whatsapp_clicks, d.pricing_clicks)), 1);
    const W = 560;
    const H = 120;
    const PAD = { top: 10, bottom: 24, left: 8, right: 8 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    const toX = (i: number) => PAD.left + (i / (sorted.length - 1 || 1)) * plotW;
    const toY = (v: number) => PAD.top + plotH - (v / maxVal) * plotH;

    const buildPath = (key: 'whatsapp_clicks' | 'pricing_clicks') =>
        sorted.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(d[key])}`).join(' ');

    return (
        <div className="w-full overflow-x-auto">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40">
                {/* Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
                    <line
                        key={frac}
                        x1={PAD.left} y1={PAD.top + plotH * (1 - frac)}
                        x2={W - PAD.right} y2={PAD.top + plotH * (1 - frac)}
                        stroke="#f3f4f6" strokeWidth="1"
                    />
                ))}

                {/* WhatsApp line */}
                <path d={buildPath('whatsapp_clicks')} fill="none" stroke="#25D366" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                {/* Pricing line */}
                <path d={buildPath('pricing_clicks')} fill="none" stroke="#2a70ab" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 2" />

                {/* Dots */}
                {sorted.map((d, i) => (
                    <g key={d.day}>
                        <circle cx={toX(i)} cy={toY(d.whatsapp_clicks)} r="3" fill="#25D366" />
                        <circle cx={toX(i)} cy={toY(d.pricing_clicks)} r="3" fill="#2a70ab" />
                    </g>
                ))}

                {/* X-axis labels (every other) */}
                {sorted.map((d, i) => i % 2 === 0 && (
                    <text key={d.day} x={toX(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#9ca3af">
                        {new Date(d.day).toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' })}
                    </text>
                ))}
            </svg>

            <div className="flex items-center gap-6 mt-2 justify-center text-xs text-gray-500">
                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-[#25D366] inline-block rounded" /> واتساب</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 border-t-2 border-dashed border-[#2a70ab] inline-block" /> Pricing CTA</span>
            </div>
        </div>
    );
}

// ─── Stat Card ───────────────────────────────────────────────────

interface StatCardProps {
    label: string;
    value: string | number;
    subLabel?: string;
    icon: React.ReactNode;
    color: string;
}

function StatCard({ label, value, subLabel, icon, color }: StatCardProps) {
    return (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex items-start gap-4">
            <div className={clsx('p-3 rounded-xl', color)}>
                {icon}
            </div>
            <div>
                <p className="text-sm text-gray-500 font-medium">{label}</p>
                <p className="text-2xl font-bold text-gray-800 mt-0.5">{value}</p>
                {subLabel && <p className="text-xs text-gray-400 mt-0.5">{subLabel}</p>}
            </div>
        </div>
    );
}

// ─── Device Bar ──────────────────────────────────────────────────

interface DeviceBarProps {
    mobile: number;
    desktop: number;
    totalEvents: number;
}

function DeviceBar({ mobile, desktop, totalEvents }: DeviceBarProps) {
    const mPct = mobile || 0;
    const dPct = desktop || 0;
    const mCount = Math.round(totalEvents * mPct / 100);
    const dCount = totalEvents - mCount;

    return (
        <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                <span className="flex items-center gap-1"><Smartphone size={12} /> موبايل {mCount} ({mPct}%)</span>
                <span className="flex items-center gap-1">ديسكتوب {dCount} ({dPct}%) <Monitor size={12} /></span>
            </div>
            <div className="h-3 rounded-full bg-gray-100 overflow-hidden flex" role="progressbar" aria-label="Device breakdown">
                <div
                    className="bg-sky-500 h-full transition-all duration-500 rounded-l-full"
                    style={{ width: `${mPct}%` }}
                    aria-label={`Mobile ${mPct}%`}
                />
                <div
                    className="bg-blue-600 h-full transition-all duration-500 rounded-r-full"
                    style={{ width: `${dPct}%` }}
                    aria-label={`Desktop ${dPct}%`}
                />
            </div>
            <p className="text-xs text-gray-400 mt-1">
                إجمالي الأحداث: {totalEvents}
            </p>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────

export default function MarketingAnalytics() {
    const [summary, setSummary] = useState<MarketingSummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [range, setRange] = useState<'1h' | '1d' | '7d'>('1d');
    const [inquiries, setInquiries] = useState<ContactInquiry[]>([]);
    const [inquiryFilter, setInquiryFilter] = useState<'all' | 'new' | 'contacted' | 'closed'>('all');

    const load = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const hoursMap = { '1h': 1, '1d': 24, '7d': 168 };
            const hours = hoursMap[range];
            const end = new Date().toISOString();
            const start = new Date(Date.now() - hours * 3600000).toISOString();
            const data = await marketingService.getSummary(start, end);
            setSummary(data);
        } catch {
            setError('فشل تحميل بيانات التسويق. تأكد من تنفيذ migration.sql أولاً.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { load(); }, [range]);

    useEffect(() => {
        contactService.getInquiries(inquiryFilter).then(setInquiries).catch(() => setInquiries([]));
    }, [inquiryFilter]);

    const clicks = summary?.total_clicks || {};
    const waClicks = clicks['whatsapp_click'] || 0;
    const pricingClicks = clicks['pricing_cta_click'] || 0;
    const engagedSessions = clicks['engaged_session'] || 0;
    const conversionRate = summary?.conversion_rate || 0;
    const deviceBreakdown = summary?.device_breakdown || {};
    const mobile = deviceBreakdown['mobile'] || 0;
    const desktop = deviceBreakdown['desktop'] || 0;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-gradient-to-br from-sky-500 to-blue-600 rounded-xl text-white shadow-lg shadow-blue-200">
                        <BarChart2 size={22} />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-gray-800">تحليلات التسويق</h1>
                        <p className="text-sm text-gray-400">أداء الصفحة التسويقية — بيانات حقيقية من الزوار</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Range selector */}
                    <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm">
                        {([['1h', 'ساعة'], ['1d', 'يوم'], ['7d', 'أسبوع']] as const).map(([r, label]) => (
                            <button
                                key={r}
                                onClick={() => setRange(r)}
                                className={clsx(
                                    'px-4 py-2 font-medium transition-colors',
                                    range === r
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-white text-gray-600 hover:bg-gray-50'
                                )}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={load}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-xl border border-gray-200 transition-colors text-sm font-medium"
                    >
                        <RefreshCw size={15} className={clsx(isLoading && 'animate-spin')} />
                        تحديث
                    </button>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="p-4 bg-red-50 text-red-600 text-sm rounded-xl flex items-start gap-2 border border-red-100">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    {error}
                </div>
            )}

            {/* Stat Cards */}
            {isLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 animate-pulse h-24" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard
                        label="واتساب كليكس"
                        value={waClicks}
                        subLabel={range === '1h' ? '\u0622\u062e\u0631 \u0633\u0627\u0639\u0629' : range === '1d' ? '\u0622\u062e\u0631 \u064a\u0648\u0645' : '\u0622\u062e\u0631 \u0623\u0633\u0628\u0648\u0639'}
                        icon={<MousePointerClick size={20} className="text-green-600" />}
                        color="bg-green-50"
                    />
                    <StatCard
                        label="Pricing CTA كليكس"
                        value={pricingClicks}
                        subLabel="طلبات قائمة الأسعار"
                        icon={<TrendingUp size={20} className="text-blue-600" />}
                        color="bg-blue-50"
                    />
                    <StatCard
                        label="معدل التحويل"
                        value={`${conversionRate}%`}
                        subLabel="واتساب ÷ Pricing"
                        icon={<BarChart2 size={20} className="text-sky-600" />}
                        color="bg-sky-50"
                    />
                    <StatCard
                        label="جلسات مشاركة"
                        value={engagedSessions}
                        subLabel="سكرول 50% أو 30 ثانية"
                        icon={<MousePointerClick size={20} className="text-amber-600" />}
                        color="bg-amber-50"
                    />
                </div>
            )}

            {/* Bottom Row: Trend + Device */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Line Chart: 30-day trend */}
                <div className="lg:col-span-2 bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                    <h3 className="text-base font-semibold text-gray-700 mb-4">الترند اليومي</h3>
                    {isLoading ? (
                        <div className="h-40 animate-pulse bg-gray-50 rounded-xl" />
                    ) : (
                        <MiniLineChart data={summary?.daily_trend || []} />
                    )}
                </div>

                {/* Device Breakdown */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                    <h3 className="text-base font-semibold text-gray-700 mb-4">توزيع الأجهزة</h3>
                    {isLoading ? (
                        <div className="h-20 animate-pulse bg-gray-50 rounded-xl" />
                    ) : (
                        <DeviceBar mobile={mobile} desktop={desktop} totalEvents={waClicks + pricingClicks + engagedSessions} />
                    )}

                    {/* Event breakdown list */}
                    {!isLoading && (
                        <div className="mt-6 space-y-3">
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">تفصيل الأحداث</p>
                            {Object.entries(clicks).map(([name, count]) => (
                                <div key={name} className="flex justify-between items-center text-sm">
                                    <span className="text-gray-600 font-mono text-xs bg-gray-50 px-2 py-0.5 rounded">{name}</span>
                                    <span className="font-bold text-gray-800">{count}</span>
                                </div>
                            ))}
                            {Object.keys(clicks).length === 0 && (
                                <p className="text-xs text-gray-400 text-center py-4">لا توجد أحداث مسجلة بعد</p>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* ─── Contact Inquiries History ─────────────────────── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-teal-50 rounded-lg">
                            <MessageSquare size={18} className="text-teal-600" />
                        </div>
                        <div>
                            <h3 className="text-base font-semibold text-gray-700">{"\u0631\u0633\u0627\u0626\u0644 \u0635\u0641\u062d\u0629 \u0627\u0644\u062a\u0633\u0648\u064a\u0642"}</h3>
                            <p className="text-xs text-gray-400">{"\u0643\u0644 \u0627\u0644\u0631\u0633\u0627\u0626\u0644 \u0627\u0644\u0644\u064a \u0648\u0635\u0644\u062a \u0645\u0646 \u0627\u0644\u0641\u0648\u0631\u0645"}</p>
                        </div>
                    </div>
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
                        {(['all', 'new', 'contacted', 'closed'] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => setInquiryFilter(f)}
                                className={clsx(
                                    'px-3 py-1.5 font-medium transition-colors',
                                    inquiryFilter === f ? 'bg-teal-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                                )}
                            >
                                {f === 'all' ? '\u0627\u0644\u0643\u0644' : f === 'new' ? '\u062c\u062f\u064a\u062f' : f === 'contacted' ? '\u062a\u0645 \u0627\u0644\u062a\u0648\u0627\u0635\u0644' : '\u0645\u063a\u0644\u0642'}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-right">
                        <thead className="bg-gray-50 text-gray-500 text-xs">
                            <tr>
                                <th className="p-3 font-medium">{"\u0627\u0644\u0637\u0628\u064a\u0628"}</th>
                                <th className="p-3 font-medium">{"\u0627\u0644\u0639\u064a\u0627\u062f\u0629"}</th>
                                <th className="p-3 font-medium">{"\u0627\u0644\u0647\u0627\u062a\u0641"}</th>
                                <th className="p-3 font-medium">{"\u0627\u0644\u0631\u0633\u0627\u0644\u0629"}</th>
                                <th className="p-3 font-medium">{"\u0627\u0644\u062d\u0627\u0644\u0629"}</th>
                                <th className="p-3 font-medium">{"\u0627\u0644\u062a\u0627\u0631\u064a\u062e"}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {inquiries.map(inq => (
                                <tr key={inq.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="p-3 font-bold text-gray-800">{inq.doctor_name}</td>
                                    <td className="p-3 text-gray-600">{inq.clinic_name || '—'}</td>
                                    <td className="p-3">
                                        <a href={`https://wa.me/${inq.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-teal-600 font-medium hover:underline">
                                            <PhoneCall size={12} />
                                            {inq.phone}
                                        </a>
                                    </td>
                                    <td className="p-3 text-gray-500 max-w-[200px] truncate">{inq.message || '—'}</td>
                                    <td className="p-3">
                                        <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-bold',
                                            inq.status === 'new' ? 'bg-teal-100 text-teal-700' :
                                                inq.status === 'contacted' ? 'bg-blue-100 text-blue-700' :
                                                    'bg-gray-100 text-gray-600'
                                        )}>
                                            {inq.status === 'new' ? '\u062c\u062f\u064a\u062f' : inq.status === 'contacted' ? `\u062a\u0645 \u0627\u0644\u062a\u0648\u0627\u0635\u0644 (${inq.responded_by || ''})` : '\u0645\u063a\u0644\u0642'}
                                        </span>
                                    </td>
                                    <td className="p-3 text-xs text-gray-400 font-mono ltr">{new Date(inq.created_at).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                                </tr>
                            ))}
                            {inquiries.length === 0 && (
                                <tr><td colSpan={6} className="p-8 text-center text-gray-400">{"\u0644\u0627 \u062a\u0648\u062c\u062f \u0631\u0633\u0627\u0626\u0644"}</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Note */}
            <div className="text-xs text-gray-400 bg-gray-50 rounded-xl p-4 border border-gray-100">
                ⚙️ البيانات تأتي من Google Tag Manager عبر <code className="bg-white px-1 py-0.5 rounded text-gray-600">marketing_events</code> table.
                لبدء التسجيل: نفّذ <code className="bg-white px-1 py-0.5 rounded text-gray-600">supabase/migrations/marketing_events.sql</code> في Supabase SQL Editor,
                ثم استبدل <code className="bg-white px-1 py-0.5 rounded text-gray-600">GTM-XXXXXXX</code> بـ ID معمل ORCA.
            </div>
        </div>
    );
}
