import { Outlet, useLocation, Link } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import GlobalSearch from '../components/GlobalSearch';
import QuickActions from '../components/QuickActions';
import WorkspaceTabs from '../components/WorkspaceTabs';
import { useAuth } from '../context/AuthContext';
import { getCapabilities } from '../lib/userRoles';
import { getLandingRoute, activeSidebarEntry, visibleSidebarEntries } from '../lib/navigation';

export default function DashboardLayout() {
    const { pathname } = useLocation();
    const { user } = useAuth();
    const caps = getCapabilities(user);

    // Search and "+ جديد" used to appear only on /dashboard, which meant a
    // user deep in a page had no way to start a task without navigating
    // first. The header is now on every page.
    const active = activeSidebarEntry(pathname);
    const home = getLandingRoute(user);

    // The header names the area you are in, so it has to GO there. It used
    // to link to the landing route regardless: the header read "التقارير"
    // and dropped you on the dashboard. The path comes from the registry
    // rather than from the entry's own default, so a role that cannot open
    // an area's first tab lands on the first tab it can.
    const areaPath = active
        ? visibleSidebarEntries(caps).find(entry => entry.id === active.id)?.path
        : undefined;
    const headerTarget = areaPath || home;

    // The "other" employee gets a page, not an ERP shell.
    const isSingleDestination = caps.has('self_profile_only');

    return (
        <div className="flex h-screen overflow-hidden bg-surface-50 font-sans selection:bg-primary-500/30 selection:text-primary-900 dark:bg-surface-950">
            {/* Ambient Background */}
            <div className="pointer-events-none fixed inset-0 z-0">
                <div className="absolute left-[-10%] top-[-10%] h-[40%] w-[40%] animate-pulse-slow rounded-full bg-primary-200/30 blur-[120px] mix-blend-multiply dark:bg-primary-900/10 dark:mix-blend-overlay" />
                <div className="absolute bottom-[-10%] right-[-10%] h-[30%] w-[30%] animate-pulse-slow rounded-full bg-blue-200/30 blur-[100px] mix-blend-multiply [animation-delay:1s] dark:bg-blue-900/10 dark:mix-blend-overlay" />
            </div>

            <div className="relative z-10 flex h-full w-full">
                <Sidebar />
                <div className="flex flex-1 flex-col overflow-hidden">

                    <header className="relative z-20 flex shrink-0 items-center gap-3 border-b border-teal-100/70 bg-white/70 px-4 py-2.5 backdrop-blur lg:px-8 print:hidden">
                        {isSingleDestination ? (
                            <h1 className="flex-1 text-sm font-bold text-teal-900">ملفي المالي</h1>
                        ) : (
                            <>
                                <Link
                                    to={headerTarget}
                                    className="hidden shrink-0 text-[13px] font-bold text-teal-900 transition-colors hover:text-cyan-700 lg:block"
                                    aria-label={areaPath ? undefined : 'الصفحة الرئيسية'}
                                >
                                    {active?.labelAr || 'ORCA Lab'}
                                </Link>
                                <div className="ms-auto flex flex-1 items-center gap-2 lg:justify-end">
                                    {/* The mobile menu button is fixed at the start
                                        edge, so the search box is inset past it. */}
                                    <div className="ms-11 min-w-0 flex-1 lg:ms-0 lg:max-w-md">
                                        <GlobalSearch />
                                    </div>
                                    <QuickActions />
                                </div>
                            </>
                        )}
                    </header>

                    <main
                        id="dashboard-main"
                        className="scrollbar-thin scrollbar-thumb-surface-300 dark:scrollbar-thumb-surface-700 flex-1 overflow-y-auto overflow-x-hidden overscroll-none p-4 lg:p-8"
                    >
                        <div className="mx-auto max-w-7xl space-y-6">
                            <WorkspaceTabs />
                            <Outlet />
                        </div>
                    </main>
                </div>
            </div>
        </div>
    );
}
