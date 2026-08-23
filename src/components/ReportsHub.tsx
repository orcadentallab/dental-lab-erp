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
import { useState } from 'react';
import { Search, Star } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { getCapabilities } from '../lib/userRoles';
import { REPORT_CATEGORIES } from '../lib/navigation';
import { searchDestinations } from '../lib/smartSearch';
import { useFavourites } from '../hooks/useFavourites';

export default function ReportsHub() {
    const { user } = useAuth();
    const caps = getCapabilities(user);
    const { toggle, isPinned } = useFavourites(user?.id, user?.role, caps);
    const [query, setQuery] = useState('');

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

    return (
        <section className="rounded-2xl border border-teal-100 bg-white/80 p-4 shadow-sm sm:p-6" dir="rtl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-bold text-teal-900">كل التقارير</h2>
                <div className="relative w-full sm:w-64">
                    <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder="ابحث في التقارير..."
                        aria-label="ابحث في التقارير"
                        className="h-10 w-full rounded-xl border border-teal-100 bg-white pr-9 text-sm text-slate-800 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                    />
                </div>
            </div>

            {visible.length === 0 && (
                <p className="py-6 text-center text-sm text-slate-500">لا يوجد تقرير مطابق.</p>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visible.map(category => (
                    <div key={category.id}>
                        <h3 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            {category.labelAr}
                        </h3>
                        <div className="space-y-1.5">
                            {category.reports.map(report => (
                                <div key={report.id} className="group/card relative">
                                    <Link
                                        to={report.path}
                                        className="flex min-h-11 items-center rounded-xl border border-teal-100 bg-white px-3 py-2.5 pl-10 transition-all hover:border-cyan-300 hover:shadow-sm"
                                    >
                                        <span className="min-w-0">
                                            <span className="block truncate text-[13px] font-semibold text-slate-700 group-hover/card:text-cyan-800">
                                                {report.labelAr}
                                            </span>
                                            <span className="block truncate text-[10px] text-slate-400">{report.labelEn}</span>
                                        </span>
                                    </Link>
                                    <button
                                        type="button"
                                        onClick={() => toggle(report.id)}
                                        className={clsx(
                                            'absolute left-2 top-1/2 -translate-y-1/2 rounded p-1.5 transition-colors',
                                            isPinned(report.id)
                                                ? 'text-amber-400 hover:text-amber-500'
                                                : 'text-slate-300 hover:text-amber-400'
                                        )}
                                        aria-label={isPinned(report.id) ? `إزالة ${report.labelAr} من شغلي` : `تثبيت ${report.labelAr} في شغلي`}
                                        aria-pressed={isPinned(report.id)}
                                    >
                                        <Star size={14} className={isPinned(report.id) ? 'fill-amber-400' : undefined} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
