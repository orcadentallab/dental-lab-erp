/**
 * Layer 2: the tabs inside a business area.
 *
 * This renders in the layout rather than inside each page, which is the
 * whole reason the change is cheap: Finance, Accounts, Statements, Aging,
 * Review, Balance Snapshot and Case Registration keep their own routes
 * and their own files, and none of them had to learn about tabs.
 *
 * The URL is the selected state, so back, refresh, bookmarks and shared
 * links all keep working exactly as before.
 *
 * Each tab carries its own pin. A tab is a real destination -- كشف الحساب
 * is where an accountant lives all day -- and before this the only things
 * that could be pinned were sidebar rows and reports, so the pages people
 * actually use most were the ones they could not put in شغلي.
 */
import { Link, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { Star } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getCapabilities } from '../lib/userRoles';
import { WORKSPACES, activeWorkspace } from '../lib/navigation';
import { useNavBadges } from '../hooks/useNavBadges';
import { useFavourites } from '../hooks/useFavourites';

export default function WorkspaceTabs() {
    const { pathname } = useLocation();
    const { user } = useAuth();
    const caps = getCapabilities(user);
    const badges = useNavBadges(caps, user?.id);
    const { toggle, isPinned } = useFavourites(user?.id, user?.role, caps);

    const current = activeWorkspace(pathname);
    if (!current) return null;

    const tabs = (WORKSPACES[current.workspace] || [])
        .filter(tab => caps.has(tab.capability));

    // One authorised tab is not a tab bar. The accountant sees exactly this
    // in the settings workspace, for instance.
    if (tabs.length < 2) return null;

    return (
        <div className="relative print:hidden" dir="rtl">
            {/* Six finance tabs do not fit 360px. The fade on the logical end
                edge is the only thing telling a phone user there is more. */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-l from-surface-50 to-transparent sm:hidden dark:from-surface-950"
            />
            <div
                role="tablist"
                aria-label="أقسام مساحة العمل"
                className="scrollbar-thin -mx-1 flex gap-1 overflow-x-auto border-b border-teal-100 px-1 pb-px"
            >
                {tabs.map(tab => {
                    const isActive = tab.id === current.tab.id;
                    const count = tab.badge ? badges[tab.badge] : undefined;
                    const pinned = isPinned(tab.id);
                    return (
                        <span
                            key={tab.id}
                            role="presentation"
                            className={clsx(
                                'group/tab inline-flex min-h-11 shrink-0 items-center rounded-t-lg border-b-2 transition-colors',
                                isActive ? 'border-cyan-500' : 'border-transparent hover:border-teal-200'
                            )}
                        >
                            <Link
                                to={tab.path}
                                role="tab"
                                aria-selected={isActive}
                                className={clsx(
                                    // The star holds its width whether or not it
                                    // is showing, so nothing shifts on hover.
                                    'inline-flex min-h-11 items-center gap-2 py-2 pr-4 pl-1 text-[13px] transition-colors',
                                    isActive
                                        ? 'font-bold text-cyan-800'
                                        : 'font-medium text-slate-500 hover:text-cyan-700'
                                )}
                            >
                                {tab.labelAr}
                                {count ? (
                                    <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                                        {count}
                                    </span>
                                ) : null}
                            </Link>
                            {/* A pinned tab keeps its star visible; an unpinned
                                one shows it on hover or focus, so the bar does
                                not turn into a row of grey stars. Touch has no
                                hover, so the active tab always shows its own. */}
                            <button
                                type="button"
                                onClick={() => toggle(tab.id)}
                                className={clsx(
                                    'ml-0.5 mr-1 grid h-8 w-5 place-items-center rounded transition-colors focus:opacity-100',
                                    pinned
                                        ? 'text-amber-400 hover:text-amber-500'
                                        : clsx(
                                            'text-slate-300 hover:text-amber-400',
                                            isActive ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100'
                                        )
                                )}
                                aria-label={pinned
                                    ? `إزالة ${tab.labelAr} من شغلي`
                                    : `تثبيت ${tab.labelAr} في شغلي`}
                                aria-pressed={pinned}
                                title={pinned ? 'مثبت في شغلي' : 'تثبيت في شغلي'}
                            >
                                <Star size={13} className={pinned ? 'fill-amber-400' : undefined} />
                            </button>
                        </span>
                    );
                })}
            </div>
        </div>
    );
}
