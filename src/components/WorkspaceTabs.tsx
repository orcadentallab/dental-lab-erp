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
 */
import { Link, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { getCapabilities } from '../lib/userRoles';
import { WORKSPACES, activeWorkspace } from '../lib/navigation';
import { useNavBadges } from '../hooks/useNavBadges';

export default function WorkspaceTabs() {
    const { pathname } = useLocation();
    const { user } = useAuth();
    const caps = getCapabilities(user);
    const badges = useNavBadges(caps, user?.id);

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
                    return (
                        <Link
                            key={tab.id}
                            to={tab.path}
                            role="tab"
                            aria-selected={isActive}
                            className={clsx(
                                'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-4 py-2 text-[13px] transition-colors',
                                isActive
                                    ? 'border-cyan-500 font-bold text-cyan-800'
                                    : 'border-transparent font-medium text-slate-500 hover:border-teal-200 hover:text-cyan-700'
                            )}
                        >
                            {tab.labelAr}
                            {count ? (
                                <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                                    {count}
                                </span>
                            ) : null}
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
