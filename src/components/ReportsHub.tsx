/**
 * Layer 3: the reports catalogue.
 *
 * Seven reports used to sit in the sidebar as peers of Orders -- opened
 * occasionally, growing without limit, and pushing an admin's menu past
 * the point where it could be scanned. They are a catalogue now, which
 * costs the same two interactions as the old collapsed accordion group
 * and stops the sidebar growing every time a report is added.
 *
 * Each report keeps its own route and its own permission; nothing here
 * is an authorization boundary.
 */
import { Link } from 'react-router-dom';
import React, { useState } from 'react';
import { 
    Search, 
    Star, 
    ChevronDown, 
    ChevronUp, 
    PieChart, 
    Landmark, 
    AlertTriangle, 
    Layers, 
    Users, 
    TrendingUp, 
    Sparkles, 
    LayoutGrid, 
    ArrowUpRight 
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { getCapabilities } from '../lib/userRoles';
import { REPORT_CATEGORIES } from '../lib/navigation';
import { searchDestinations } from '../lib/smartSearch';
import { useFavourites } from '../hooks/useFavourites';

const REPORT_META: Record<string, { icon: React.ElementType; color: string; bg: string; border: string; desc: string }> = {
    'report.profitability': { 
        icon: PieChart, 
        color: 'text-emerald-600', 
        bg: 'bg-emerald-50 hover:bg-emerald-100/70', 
        border: 'border-emerald-200/80', 
        desc: 'متابعة ربحية العملاء وشرائح الأطباء' 
    },
    'report.cashflow': { 
        icon: Landmark, 
        color: 'text-blue-600', 
        bg: 'bg-blue-50 hover:bg-blue-100/70', 
        border: 'border-blue-200/80', 
        desc: 'تحليل التدفقات النقدية والسيولة' 
    },
    'report.issues': { 
        icon: AlertTriangle, 
        color: 'text-rose-600', 
        bg: 'bg-rose-50 hover:bg-rose-100/70', 
        border: 'border-rose-200/80', 
        desc: 'سجل مشاكل الإنتاج وحالات الإعادة والرفض' 
    },
    'report.shadow': { 
        icon: Layers, 
        color: 'text-purple-600', 
        bg: 'bg-purple-50 hover:bg-purple-100/70', 
        border: 'border-purple-200/80', 
        desc: 'مقارنة سجل الإنتاج التنفيذي والفعلي' 
    },
    'report.designerStats': { 
        icon: Users, 
        color: 'text-cyan-600', 
        bg: 'bg-cyan-50 hover:bg-cyan-100/70', 
        border: 'border-cyan-200/80', 
        desc: 'إنتاجية ومعدلات أداء الفريق والفنيين' 
    },
    'report.marketing': { 
        icon: TrendingUp, 
        color: 'text-amber-600', 
        bg: 'bg-amber-50 hover:bg-amber-100/70', 
        border: 'border-amber-200/80', 
        desc: 'عائد الاستثمار وحملات جذب الأطباء' 
    },
    'report.ai': { 
        icon: Sparkles, 
        color: 'text-indigo-600', 
        bg: 'bg-indigo-50 hover:bg-indigo-100/70', 
        border: 'border-indigo-200/80', 
        desc: 'التنبؤات الذكية والتحليل المتقدم' 
    },
};

export default function ReportsHub() {
    const { user } = useAuth();
    const caps = getCapabilities(user);
    const { toggle, isPinned } = useFavourites(user?.id, user?.role, caps);
    const [query, setQuery] = useState('');
    const [isExpanded, setIsExpanded] = useState(false);

    const categories = REPORT_CATEGORIES
        .map(category => ({
            ...category,
            reports: category.reports.filter(report => caps.has(report.capability)),
        }))
        .filter(category => category.reports.length > 0);

    if (categories.length === 0) return null;

    const trimmed = query.trim();
    const matchedIds = trimmed
        ? new Set(
            searchDestinations(trimmed, categories.flatMap(category => category.reports))
                .map(match => match.destination.id)
        )
        : null;

    const visible = categories
        .map(category => ({
            ...category,
            reports: matchedIds ? category.reports.filter(report => matchedIds.has(report.id)) : category.reports,
        }))
        .filter(category => category.reports.length > 0);

    const allReports = categories.flatMap(c => c.reports);

    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-xs transition-all duration-300 overflow-hidden" dir="rtl">
            {/* Header Bar */}
            <div className="p-4 sm:px-6 bg-slate-50/80 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-teal-100/80 text-teal-700 rounded-xl">
                        <LayoutGrid size={18} />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                            فهرس التقارير المتقدمة
                            <span className="bg-slate-200/80 text-slate-700 text-[11px] font-bold px-2 py-0.5 rounded-full">
                                {allReports.length} تقارير
                            </span>
                        </h2>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                            وصول سريع لجميع التقارير التفصيلية والتحليلات المتخصصة
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                    {/* Search bar when expanded */}
                    {isExpanded && (
                        <div className="relative w-full sm:w-56 animate-in fade-in duration-200">
                            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                                placeholder="بحث في التقارير..."
                                aria-label="بحث في التقارير"
                                className="h-9 w-full rounded-xl border border-slate-200 bg-white pr-8 pl-3 text-xs text-slate-800 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                            />
                        </div>
                    )}

                    <button
                        onClick={() => setIsExpanded(prev => !prev)}
                        className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer whitespace-nowrap"
                    >
                        {isExpanded ? (
                            <>
                                <span>طي الفهرس</span>
                                <ChevronUp size={14} />
                            </>
                        ) : (
                            <>
                                <span>عرض كل التقارير</span>
                                <ChevronDown size={14} />
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Collapsed Pill-Bar Preview */}
            {!isExpanded && (
                <div className="p-3 sm:px-6 flex items-center gap-2 overflow-x-auto scrollbar-none bg-white">
                    <span className="text-[11px] font-bold text-slate-400 shrink-0 ml-1">روابط سريعة:</span>
                    {allReports.map(report => {
                        const meta = REPORT_META[report.id] || { icon: LayoutGrid, color: 'text-slate-600', bg: 'bg-slate-50 hover:bg-slate-100', border: 'border-slate-200', desc: '' };
                        const Icon = meta.icon;
                        return (
                            <Link
                                key={report.id}
                                to={report.path}
                                className={clsx(
                                    "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold whitespace-nowrap transition-all duration-200 hover:shadow-2xs",
                                    meta.bg, meta.border
                                )}
                            >
                                <Icon size={14} className={meta.color} />
                                <span className="text-slate-700">{report.labelAr}</span>
                                <ArrowUpRight size={12} className="text-slate-400 opacity-60" />
                            </Link>
                        );
                    })}
                </div>
            )}

            {/* Expanded Full Grid Catalogue */}
            {isExpanded && (
                <div className="p-4 sm:p-6 bg-slate-50/40 animate-in fade-in slide-in-from-top-1 duration-200 space-y-6">
                    {visible.length === 0 && (
                        <p className="py-8 text-center text-xs font-medium text-slate-500">لا يوجد تقرير مطابق للبحث.</p>
                    )}

                    {visible.map(category => (
                        <div key={category.id} className="space-y-3">
                            <h3 className="text-xs font-bold text-slate-500 flex items-center gap-2 px-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-teal-500 inline-block" />
                                {category.labelAr}
                            </h3>

                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {category.reports.map(report => {
                                    const meta = REPORT_META[report.id] || { 
                                        icon: LayoutGrid, 
                                        color: 'text-slate-600', 
                                        bg: 'bg-white hover:bg-slate-50', 
                                        border: 'border-slate-200', 
                                        desc: '' 
                                    };
                                    const Icon = meta.icon;

                                    return (
                                        <div key={report.id} className="group relative">
                                            <Link
                                                to={report.path}
                                                className={clsx(
                                                    "flex items-start gap-3.5 p-3.5 rounded-2xl border bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
                                                    meta.border
                                                )}
                                            >
                                                <div className={clsx("p-2.5 rounded-xl shrink-0 transition-transform group-hover:scale-105", meta.bg)}>
                                                    <Icon size={20} className={meta.color} />
                                                </div>

                                                <div className="min-w-0 flex-1 pl-6">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="font-bold text-xs text-slate-800 group-hover:text-teal-700 transition-colors truncate">
                                                            {report.labelAr}
                                                        </span>
                                                        <ArrowUpRight size={12} className="text-slate-300 group-hover:text-teal-600 transition-colors shrink-0" />
                                                    </div>
                                                    <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">{report.labelEn}</p>
                                                    <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                                                        {meta.desc}
                                                    </p>
                                                </div>
                                            </Link>

                                            <button
                                                type="button"
                                                onClick={() => toggle(report.id)}
                                                className={clsx(
                                                    'absolute left-3 top-3 rounded-lg p-1.5 transition-all opacity-80 hover:opacity-100 cursor-pointer',
                                                    isPinned(report.id)
                                                        ? 'text-amber-400 hover:text-amber-500 bg-amber-50'
                                                        : 'text-slate-300 hover:text-amber-400 hover:bg-slate-100'
                                                )}
                                                aria-label={isPinned(report.id) ? `إزالة ${report.labelAr} من المفضلة` : `تثبيت ${report.labelAr} في المفضلة`}
                                                aria-pressed={isPinned(report.id)}
                                                title={isPinned(report.id) ? 'مثبت في شغلي' : 'تثبيت في شغلي'}
                                            >
                                                <Star size={14} className={isPinned(report.id) ? 'fill-amber-400' : undefined} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
