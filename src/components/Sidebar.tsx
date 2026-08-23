/**
 * The sidebar.
 *
 * It used to be the application's route inventory: every page became a
 * permanent menu item, grouped into collapsing accordions, and an admin
 * faced 28 peer destinations behind two clicks each. It now renders one
 * flat list from the navigation registry -- reports live in a hub, and
 * workspace pages live in tabs, so what is left is the set of business
 * areas rather than the set of routes.
 *
 * Section headings are headings, not buttons. With a list this short,
 * collapsing costs a click and buys nothing.
 */
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
    LayoutDashboard, ShoppingBag, Users, DollarSign, LogOut, Menu, X, Factory,
    FileText, Settings as SettingsIcon, BarChart3, Briefcase, Layers,
    Truck, Star, History, PanelRightClose, PanelRightOpen,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { getUserRoleDisplay, getCapabilities } from '../lib/userRoles';
import {
    SECTION_ORDER, SECTION_LABELS, visibleSidebarEntries,
    activeSidebarEntry, type SidebarEntry,
} from '../lib/navigation';
import { useNavBadges, type BadgeCounts } from '../hooks/useNavBadges';
import { useFavourites, useRecents } from '../hooks/useFavourites';
import type { LucideIcon } from 'lucide-react';

/** Icons live here rather than in the registry so it stays render-free. */
const ICONS: Record<string, LucideIcon> = {
    dashboard: LayoutDashboard,
    orders: ShoppingBag,
    production: Factory,
    finance: DollarSign,
    accounts: FileText,
    externalWork: Truck,
    doctors: Users,
    employees: Briefcase,
    suppliers: Factory,
    reports: BarChart3,
    system: SettingsIcon,
    'doctor.orders': ShoppingBag,
    'doctor.newRequest': ShoppingBag,
    'doctor.account': DollarSign,
};

const COLLAPSE_KEY = 'nav:sidebarCollapsed';

export default function Sidebar() {
    const { user, logout } = useAuth();
    const location = useLocation();
    const [isOpen, setIsOpen] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(
        () => localStorage.getItem(COLLAPSE_KEY) === '1'
    );
    const menuButtonRef = useRef<HTMLButtonElement>(null);

    const caps = getCapabilities(user);
    const badges = useNavBadges(caps, user?.id);
    const { favourites, toggle, isPinned } = useFavourites(user?.id, user?.role, caps);
    const recents = useRecents(user?.id, location.pathname, caps, favourites.map(f => f.id));

    // Which entries appear, and where each one links, is the registry's
    // decision -- see visibleSidebarEntries for the workspace and fallback
    // rules this component deliberately does not re-derive.
    const entries: SidebarEntry[] = visibleSidebarEntries(caps);

    const active = activeSidebarEntry(location.pathname);

    // Close the mobile drawer whenever the route changes, including on
    // browser back. Derived during render rather than in an effect so the
    // drawer never paints once over the new page.
    const [lastPath, setLastPath] = useState(location.pathname);
    if (lastPath !== location.pathname) {
        setLastPath(location.pathname);
        if (isOpen) setIsOpen(false);
    }

    useEffect(() => {
        if (!isOpen) return;
        const mainContent = document.getElementById('dashboard-main');
        const previousOverflow = mainContent?.style.overflow;
        if (mainContent) mainContent.style.overflow = 'hidden';

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
                menuButtonRef.current?.focus();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            if (mainContent) mainContent.style.overflow = previousOverflow || '';
        };
    }, [isOpen]);

    const toggleCollapsed = () => {
        setIsCollapsed(previous => {
            localStorage.setItem(COLLAPSE_KEY, previous ? '0' : '1');
            return !previous;
        });
    };

    // A user with a single destination gets no sidebar at all -- the "other"
    // employee, today. A one-item menu is noise around the only page.
    if (entries.length <= 1) return null;

    const sections = SECTION_ORDER
        .map(section => ({
            section,
            label: SECTION_LABELS[section],
            items: entries.filter(entry => entry.section === section),
        }))
        .filter(group => group.items.length > 0);

    return (
        <>
            {/* Mobile Menu Button */}
            <button
                ref={menuButtonRef}
                onClick={() => setIsOpen(!isOpen)}
                className={clsx(
                    'fixed right-4 top-[max(1rem,env(safe-area-inset-top))] grid h-11 w-11 place-items-center rounded-xl border border-cyan-500/50 bg-cyan-600/90 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-cyan-700 lg:hidden print:hidden',
                    isOpen ? 'z-[70]' : 'z-50'
                )}
                aria-label={isOpen ? 'إغلاق القائمة الرئيسية' : 'فتح القائمة الرئيسية'}
                aria-expanded={isOpen}
                aria-controls="dashboard-sidebar"
            >
                {isOpen ? <X size={22} /> : <Menu size={22} />}
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-40 bg-teal-900/40 backdrop-blur-sm lg:hidden print:hidden"
                        onClick={() => setIsOpen(false)}
                        aria-hidden="true"
                    />
                )}
            </AnimatePresence>

            <aside
                id="dashboard-sidebar"
                aria-label="القائمة الرئيسية"
                className={clsx(
                    'fixed inset-y-0 right-0 w-[min(280px,calc(100vw-3rem))] transform border-l border-teal-100 bg-gradient-to-b from-teal-50 via-white to-teal-50/50 shadow-2xl transition-all duration-300 ease-in-out lg:static lg:h-screen lg:translate-x-0 lg:shadow-xl lg:shadow-teal-100/50 print:hidden',
                    isCollapsed ? 'lg:w-[76px]' : 'lg:w-[248px]',
                    isOpen ? 'z-[60] translate-x-0' : 'z-40 translate-x-full'
                )}
            >
                <div className="flex h-full flex-col">

                    {/* Header / Logo */}
                    <div className="flex items-center gap-3 border-b border-teal-100/80 bg-white/50 px-4 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] backdrop-blur-sm">
                        <img
                            src="/orca-logo.png"
                            alt="ORCA Dental Lab"
                            className="h-10 w-10 flex-shrink-0 rounded-xl object-cover shadow-md ring-1 ring-cyan-100"
                        />
                        {!isCollapsed && (
                            <div className="min-w-0 flex-1">
                                <h1 className="truncate text-[15px] font-bold leading-tight tracking-tight text-teal-900">ORCA Lab</h1>
                                <p className="text-[10px] font-medium uppercase tracking-wide text-cyan-600">Dental ERP v1.3</p>
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={toggleCollapsed}
                            className="hidden h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-teal-50 hover:text-cyan-600 lg:grid"
                            aria-label={isCollapsed ? 'توسيع القائمة' : 'طي القائمة'}
                        >
                            {isCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
                        </button>
                    </div>

                    {/* Favourites -- "my work". Chips, not rows: the whole point
                        is that they cost one line, not four. */}
                    {favourites.length > 0 && !isCollapsed && (
                        <div className="border-b border-teal-100/60 px-4 py-3">
                            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                                <Star size={11} className="fill-amber-400 text-amber-400" />
                                شغلي
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {favourites.map(destination => (
                                    <Link
                                        key={destination.id}
                                        to={destination.path}
                                        onClick={() => setIsOpen(false)}
                                        className="inline-flex items-center gap-1 rounded-lg border border-teal-100 bg-white px-2 py-1 text-[11px] font-semibold text-teal-800 shadow-sm transition-colors hover:border-cyan-300 hover:text-cyan-700"
                                    >
                                        {destination.labelAr}
                                        <Badge count={badgeFor(destination.id, badges)} small />
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Recents. Nothing to configure -- this is what carries a
                        user through the first week, before anyone has pinned
                        anything. */}
                    {recents.length > 0 && !isCollapsed && (
                        <div className="border-b border-teal-100/60 px-4 py-2.5">
                            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                                <History size={11} />
                                الأخيرة
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {recents.map(destination => (
                                    <Link
                                        key={destination.id}
                                        to={destination.path}
                                        onClick={() => setIsOpen(false)}
                                        className="inline-flex items-center rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-cyan-700"
                                    >
                                        {destination.labelAr}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Navigation */}
                    <nav className="sidebar-scroll flex-1 space-y-3 overflow-y-auto px-3 py-3">
                        {sections.map((group, index) => (
                            <div key={group.section}>
                                {/* A named section gets a heading; an unnamed one
                                    still gets a rule, so it reads as its own group
                                    rather than trailing off the list above it. */}
                                {group.label && !isCollapsed ? (
                                    <h3 className={clsx(
                                        'px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider',
                                        group.section === 'system' ? 'text-slate-300' : 'text-slate-400'
                                    )}>
                                        {group.label}
                                    </h3>
                                ) : (
                                    index > 0 && <div className="mx-3 mb-2 border-t border-teal-100/70" aria-hidden="true" />
                                )}
                                <div className="space-y-0.5">
                                    {group.items.map(entry => (
                                        <NavRow
                                            key={entry.id}
                                            entry={entry}
                                            isActive={active?.id === entry.id}
                                            isCollapsed={isCollapsed}
                                            isMuted={group.section === 'system'}
                                            count={entry.badge ? badges[entry.badge] : undefined}
                                            pinned={isPinned(entry.id)}
                                            onPin={() => toggle(entry.id)}
                                            onNavigate={() => setIsOpen(false)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </nav>

                    {/* Footer */}
                    <div className="border-t border-teal-100 bg-white/30 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                        <div className={clsx(
                            'mb-2 flex items-center gap-3 rounded-xl border border-teal-100 bg-white shadow-sm',
                            isCollapsed ? 'justify-center p-2' : 'px-3 py-2.5'
                        )}>
                            <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-gradient-to-br from-cyan-500 to-teal-600 text-xs font-bold uppercase text-white ring-2 ring-white">
                                {(user?.name || user?.username || 'U').substring(0, 2)}
                            </div>
                            {!isCollapsed && (
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-bold text-slate-800">{user?.name || user?.username}</p>
                                    <p className="truncate text-[11px] font-medium text-slate-500">{getUserRoleDisplay(user) || 'مستخدم'}</p>
                                </div>
                            )}
                        </div>
                        <button
                            onClick={() => logout()}
                            className="group flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-2.5 text-slate-500 transition-all duration-200 hover:border-red-100 hover:bg-red-50 hover:text-red-600"
                            aria-label="تسجيل الخروج"
                        >
                            <LogOut size={16} className="transition-transform group-hover:-translate-x-1" />
                            {!isCollapsed && <span className="text-xs font-semibold">تسجيل الخروج</span>}
                        </button>
                    </div>
                </div>
            </aside>
        </>
    );
}

/** Favourite chips carry their destination's badge, so the count follows. */
function badgeFor(id: string, badges: BadgeCounts): number | undefined {
    if (id === 'finance' || id === 'finance.caseRegistration') return badges.unregisteredCases;
    if (id === 'production' || id === 'production.myTasks') return badges.myOpenTasks;
    return undefined;
}

function Badge({ count, small = false }: { count?: number; small?: boolean }) {
    if (!count) return null;
    return (
        <span className={clsx(
            'inline-flex items-center justify-center rounded-full bg-red-500 font-bold text-white shadow-sm',
            small ? 'h-4 min-w-[16px] px-1 text-[9px]' : 'h-5 min-w-[20px] px-1.5 text-[10px]'
        )}>
            {count}
        </span>
    );
}

interface NavRowProps {
    entry: SidebarEntry;
    isActive: boolean;
    isCollapsed: boolean;
    isMuted: boolean;
    count?: number;
    pinned: boolean;
    onPin: () => void;
    onNavigate: () => void;
}

function NavRow({ entry, isActive, isCollapsed, isMuted, count, pinned, onPin, onNavigate }: NavRowProps) {
    const Icon = ICONS[entry.id] || Layers;

    return (
        <div className="group/row relative">
            <Link
                to={entry.path}
                onClick={onNavigate}
                title={isCollapsed ? entry.labelAr : undefined}
                aria-current={isActive ? 'page' : undefined}
                className={clsx(
                    'relative flex min-h-11 items-center rounded-lg px-3 py-2 transition-colors duration-200',
                    isCollapsed ? 'justify-center' : 'justify-between gap-3',
                    isActive
                        ? 'bg-gradient-to-l from-cyan-50 to-transparent font-semibold text-cyan-900 shadow-sm ring-1 ring-inset ring-cyan-100'
                        : isMuted
                            ? 'text-slate-400 hover:bg-slate-50 hover:text-cyan-700'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-cyan-700'
                )}
            >
                {isActive && !isCollapsed && (
                    <span className="absolute inset-y-1 right-0 w-[3px] rounded-full bg-cyan-500" aria-hidden="true" />
                )}
                <span className="flex min-w-0 items-center gap-3">
                    <Icon size={17} className={clsx('flex-shrink-0', isActive ? 'text-cyan-600' : 'text-slate-400')} />
                    {!isCollapsed && <span className="truncate text-[13px]">{entry.labelAr}</span>}
                </span>
                {!isCollapsed && <Badge count={count} />}
                {isCollapsed && count ? (
                    <span className="absolute -left-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" aria-hidden="true" />
                ) : null}
            </Link>

            {!isCollapsed && (
                <button
                    type="button"
                    onClick={onPin}
                    className={clsx(
                        'absolute left-1 top-1/2 hidden -translate-y-1/2 rounded p-1 transition-colors lg:block',
                        pinned
                            ? 'text-amber-400 hover:text-amber-500'
                            : 'text-slate-300 opacity-0 hover:text-amber-400 focus:opacity-100 group-hover/row:opacity-100'
                    )}
                    aria-label={pinned ? `إزالة ${entry.labelAr} من شغلي` : `تثبيت ${entry.labelAr} في شغلي`}
                    aria-pressed={pinned}
                >
                    <Star size={13} className={pinned ? 'fill-amber-400' : undefined} />
                </button>
            )}
        </div>
    );
}
