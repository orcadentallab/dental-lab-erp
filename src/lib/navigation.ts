/**
 * The one place that knows what this application contains.
 *
 * Before this file the sidebar was the inventory: every new page was
 * promoted to a permanent menu item, which put 28 peer destinations in
 * front of an admin. Routes still live in App.tsx and the route guards
 * are still the only authorization boundary -- this registry decides
 * where a destination *appears*, never whether it may be opened.
 *
 * Three layers, and nothing on screen shows more than three:
 *   1. sidebar   -- stable areas of the business
 *   2. workspace -- tabs within an area, driven by the URL
 *   3. hub       -- the reports catalogue, a page rather than a menu
 */
import type { User } from '../services/db';
import { getCapabilities, isOtherEmployeeOnly, type Capability } from './userRoles';

export type NavSection = 'top' | 'operations' | 'directory' | 'analysis' | 'system';

export interface Destination {
    /** Stable id. Favourites and analytics key off this, not the path. */
    id: string;
    labelAr: string;
    labelEn: string;
    path: string;
    capability: Capability;
    /**
     * Extra paths that should light this destination up. Patterns use
     * `:param` segments; matching is most-specific-wins, so `/employees`
     * and `/employees/:id` can both resolve without an exact-equality hack.
     */
    matches?: string[];
    /** Arabic and English aliases people actually type into search. */
    aliases?: string[];
}

export interface SidebarEntry extends Destination {
    section: NavSection;
    /** Present when this entry opens a tabbed workspace. */
    workspace?: string;
    badge?: BadgeKey;
    /**
     * A standalone entry for roles that do not get the named workspace.
     * The accountant has no production workspace but still needs External
     * Work; the admin gets it as a tab, so the duplicate is suppressed.
     */
    fallbackFor?: string;
}

export interface WorkspaceTab extends Destination {
    badge?: BadgeKey;
}

export type BadgeKey = 'unregisteredCases' | 'myOpenTasks';

/* ------------------------------------------------------------------ *
 * Workspaces -- layer 2
 * ------------------------------------------------------------------ */

export const WORKSPACES: Record<string, WorkspaceTab[]> = {
    production: [
        {
            id: 'production.board', labelAr: 'لوحة الإنتاج', labelEn: 'Production Board',
            path: '/production/board', capability: 'view_production',
            aliases: ['المراحل', 'الورشة', 'floor', 'stages', 'board'],
        },
        {
            id: 'production.myTasks', labelAr: 'مهامي', labelEn: 'My Tasks',
            path: '/production/my-tasks', capability: 'view_my_tasks',
            badge: 'myOpenTasks', aliases: ['شغلي', 'الطابور', 'queue', 'tasks'],
        },
        {
            id: 'production.inventory', labelAr: 'المخزن والخامات', labelEn: 'Inventory & Materials',
            path: '/inventory', capability: 'view_inventory',
            aliases: ['الخامات', 'المخزن', 'الديسكات', 'inventory', 'materials', 'stock'],
        },
        {
            id: 'production.shipments', labelAr: 'الشحن والتسليم', labelEn: 'Shipments',
            path: '/production/shipments', capability: 'view_shipments',
            aliases: ['الشحن', 'التسليم', 'الطرود', 'shipments', 'delivery', 'couriers'],
        },
        {
            id: 'production.external', labelAr: 'الشغل الخارجي', labelEn: 'External Work',
            path: '/production/external', capability: 'view_external_work',
            aliases: ['معمل خارجي', 'outsourced', 'external lab'],
        },
    ],
    finance: [
        {
            id: 'finance.overview', labelAr: 'نظرة عامة', labelEn: 'Overview',
            path: '/finance', capability: 'view_finance',
            aliases: ['المالية', 'الخزنة', 'المصروفات', 'finance', 'treasury'],
        },
        {
            id: 'finance.accounts', labelAr: 'كشف الحساب', labelEn: 'Accounts',
            path: '/accounts', capability: 'view_accounts',
            aliases: ['الحسابات', 'كشوف', 'statement', 'ledger'],
        },
        {
            id: 'finance.statements', labelAr: 'الفواتير', labelEn: 'Invoices',
            path: '/statements', capability: 'view_finance',
            aliases: ['فاتورة', 'invoice', 'billing'],
        },
        {
            id: 'finance.aging', labelAr: 'أعمار الديون', labelEn: 'Collections',
            path: '/aging-report', capability: 'view_finance',
            aliases: ['التحصيل', 'المتأخرات', 'aging', 'debt', 'collections'],
        },
        {
            id: 'finance.review', labelAr: 'المراجعة', labelEn: 'Review',
            path: '/financial-review', capability: 'view_finance',
            // Balance Snapshot was authorised but unreachable from the menu.
            // It is a sibling view of the review, so it rides the same tab.
            matches: ['/balance-snapshot'],
            aliases: ['المراجعة المالية', 'لقطة الأرصدة', 'الأرصدة', 'reconciliation', 'snapshot'],
        },
        {
            id: 'finance.caseRegistration', labelAr: 'الحالات غير المسجلة', labelEn: 'Unregistered Cases',
            path: '/case-registration', capability: 'view_finance',
            badge: 'unregisteredCases',
            aliases: ['تسجيل الحالات', 'غير مسجلة', 'unregistered', 'case registration'],
        },
    ],
    doctors: [
        {
            id: 'doctors.directory', labelAr: 'الدليل', labelEn: 'Directory',
            path: '/doctors', capability: 'view_doctors',
            aliases: ['الأطباء', 'العملاء', 'doctors', 'clients'],
        },
        {
            id: 'doctors.retention', labelAr: 'المتابعة والتنشيط', labelEn: 'Retention',
            path: '/doctors/retention', capability: 'view_doctor_retention',
            aliases: ['الاستبقاء', 'تنشيط الأطباء', 'retention', 'reactivation'],
        },
    ],
    // Services, Users, Routes and the calendar were four more permanent rows
    // in a section nobody opens weekly. As tabs they cost the admin one row
    // instead of five, and a role with only Settings simply gets no tab bar.
    // Settings stays first: it is the tab every role with this area can open,
    // so the entry always resolves to a page the user is allowed to see.
    system: [
        {
            id: 'system.settings', labelAr: 'الإعدادات', labelEn: 'Settings',
            path: '/settings', capability: 'view_settings',
            aliases: ['عام', 'نسخة احتياطية', 'settings', 'backup'],
        },
        {
            id: 'system.services', labelAr: 'الخدمات والأسعار', labelEn: 'Services & Pricing',
            path: '/services', capability: 'manage_services',
            aliases: ['الأسعار', 'قائمة الخدمات', 'services', 'pricing'],
        },
        {
            id: 'system.users', labelAr: 'المستخدمين', labelEn: 'Users',
            path: '/users', capability: 'manage_users',
            aliases: ['الصلاحيات', 'المستخدمون', 'users', 'permissions'],
        },
        {
            id: 'system.productionRoutes', labelAr: 'خرائط الإنتاج', labelEn: 'Production Routes',
            path: '/production/routes', capability: 'manage_production_routes',
            aliases: ['المسارات', 'خطوات التصنيع', 'routes', 'workflow'],
        },
        {
            id: 'system.workCalendar', labelAr: 'مواعيد العمل', labelEn: 'Work Calendar',
            path: '/settings/work-calendar', capability: 'manage_production_routes',
            aliases: ['التقويم', 'أيام العمل', 'الإجازات', 'calendar', 'shifts'],
        },
    ],
};

/* ------------------------------------------------------------------ *
 * Reports hub -- layer 3
 *
 * Seven reports used to sit in the sidebar as peers of Orders. They are
 * analytical, opened occasionally, and grow without limit, so they live
 * in a catalogue page instead.
 * ------------------------------------------------------------------ */

export interface ReportCategory {
    id: string;
    labelAr: string;
    labelEn: string;
    reports: Destination[];
}

export const REPORT_CATEGORIES: ReportCategory[] = [
    {
        id: 'financial', labelAr: 'مالي', labelEn: 'Financial',
        reports: [
            {
                id: 'report.profitability', labelAr: 'الربحية وتصنيف العملاء', labelEn: 'Profitability & Segmentation',
                path: '/reports/profitability', capability: 'view_reports',
                aliases: ['ربحية', 'شرائح العملاء', 'profit', 'margin', 'segmentation'],
            },
            {
                id: 'report.costing', labelAr: 'التكلفة الفعلية والإنتاجية', labelEn: 'Production Costing',
                path: '/reports/production-costing', capability: 'view_reports',
                aliases: ['تكلفة الكراون', 'الأوفرهيد', 'تكلفة الجودة', 'costing', 'overhead', 'cogs'],
            },
            {
                id: 'report.cashflow', labelAr: 'التدفق النقدي', labelEn: 'Cash Flow',
                path: '/reports/cashflow', capability: 'view_reports',
                aliases: ['السيولة', 'الكاش', 'cashflow', 'liquidity'],
            },
        ],
    },
    {
        id: 'operational', labelAr: 'تشغيلي وأداء', labelEn: 'Operations & Performance',
        reports: [
            {
                id: 'report.issues', labelAr: 'تقرير المشكلات', labelEn: 'Issues Report',
                path: '/issues-report', capability: 'view_reports',
                matches: ['/quality'],
                aliases: ['الجودة', 'المشاكل', 'الأخطاء', 'issues', 'quality', 'defects'],
            },
            {
                id: 'report.shadow', labelAr: 'تقرير الظل', labelEn: 'Shadow Report',
                path: '/production/shadow', capability: 'view_production',
                aliases: ['الظل', 'مقارنة الإنتاج', 'shadow'],
            },
            {
                id: 'report.designerStats', labelAr: 'إنتاجية الفريق', labelEn: 'Team Productivity',
                path: '/designer-stats', capability: 'view_reports',
                aliases: ['المصممين', 'الإنتاجية', 'productivity', 'designers'],
            },
        ],
    },
    {
        id: 'growth', labelAr: 'نمو ومتقدم', labelEn: 'Growth & Advanced',
        reports: [
            {
                id: 'report.marketing', labelAr: 'تحليلات التسويق', labelEn: 'Marketing Analytics',
                path: '/marketing-analytics', capability: 'view_reports',
                aliases: ['التسويق', 'الحملات', 'marketing', 'campaigns'],
            },
            {
                id: 'report.ai', labelAr: 'التحليلات الذكية', labelEn: 'AI Analytics',
                path: '/ai-analytics', capability: 'view_reports',
                aliases: ['الذكاء الاصطناعي', 'ai', 'insights'],
            },
        ],
    },
];

/* ------------------------------------------------------------------ *
 * Sidebar -- layer 1
 * ------------------------------------------------------------------ */

export const SIDEBAR: SidebarEntry[] = [
    {
        id: 'dashboard', labelAr: 'لوحة التحكم', labelEn: 'Dashboard',
        path: '/dashboard', capability: 'view_dashboard', section: 'top',
        aliases: ['الرئيسية', 'الملخص', 'home', 'overview'],
    },
    {
        id: 'orders', labelAr: 'الأوردرات', labelEn: 'Orders',
        path: '/orders', capability: 'view_orders', section: 'top',
        aliases: ['الطلبات', 'الحالات', 'orders', 'cases'],
    },
    {
        id: 'production', labelAr: 'الإنتاج', labelEn: 'Production',
        path: '/production/board', capability: 'view_my_tasks', section: 'operations',
        workspace: 'production', badge: 'myOpenTasks',
        aliases: ['المعمل', 'الورشة', 'المراحل', 'production', 'floor'],
    },
    {
        id: 'finance', labelAr: 'المالية', labelEn: 'Finance',
        path: '/finance', capability: 'view_finance', section: 'operations',
        workspace: 'finance', badge: 'unregisteredCases',
        aliases: ['الحسابات', 'الخزنة', 'finance', 'accounting'],
    },
    {
        // Roles without a finance workspace still need their statements, so
        // the same route surfaces as a top-level entry for them instead.
        id: 'accounts', labelAr: 'كشف الحساب', labelEn: 'Accounts',
        path: '/accounts', capability: 'view_accounts', section: 'operations',
        fallbackFor: 'finance',
        aliases: ['حسابي', 'كشوف', 'statement', 'ledger'],
    },
    {
        id: 'inventory', labelAr: 'المخزن والخامات', labelEn: 'Inventory',
        path: '/inventory', capability: 'view_inventory', section: 'operations',
        fallbackFor: 'production',
        aliases: ['المخزن', 'الخامات', 'inventory', 'stock'],
    },
    {
        id: 'shipments', labelAr: 'الشحن والتسليم', labelEn: 'Shipments',
        path: '/production/shipments', capability: 'view_shipments', section: 'operations',
        fallbackFor: 'production',
        aliases: ['الشحن', 'التسليم', 'الطرود', 'shipments'],
    },
    {
        id: 'externalWork', labelAr: 'الشغل الخارجي', labelEn: 'External Work',
        path: '/production/external', capability: 'view_external_work', section: 'operations',
        fallbackFor: 'production',
        aliases: ['معمل خارجي', 'outsourced'],
    },
    {
        id: 'doctors', labelAr: 'الأطباء', labelEn: 'Doctors',
        path: '/doctors', capability: 'view_doctors', section: 'directory',
        workspace: 'doctors',
        aliases: ['العملاء', 'doctors', 'clients'],
    },
    {
        id: 'employees', labelAr: 'الموظفين', labelEn: 'Staff',
        path: '/employees', capability: 'view_staff', section: 'directory',
        matches: ['/employees/:id', '/staff'],
        aliases: ['الفريق', 'شؤون العاملين', 'staff', 'employees', 'team'],
    },
    {
        id: 'suppliers', labelAr: 'الموردين', labelEn: 'Suppliers',
        path: '/suppliers', capability: 'view_suppliers', section: 'directory',
        aliases: ['الموردون', 'المعامل', 'suppliers', 'vendors'],
    },
    {
        id: 'reports', labelAr: 'التقارير', labelEn: 'Reports',
        path: '/analytics', capability: 'view_reports', section: 'analysis',
        aliases: ['التحليلات', 'الإحصائيات', 'reports', 'analytics'],
    },
    {
        id: 'system', labelAr: 'النظام', labelEn: 'System',
        path: '/settings', capability: 'view_settings', section: 'system',
        workspace: 'system',
        aliases: ['الضبط', 'الإعدادات', 'الإدارة', 'system', 'admin'],
    },
];

export const DOCTOR_PORTAL: SidebarEntry[] = [
    {
        id: 'doctor.orders', labelAr: 'أوردراتي', labelEn: 'My Orders',
        path: '/doctor/my-orders', capability: 'doctor_portal', section: 'top',
        aliases: ['طلباتي', 'my orders'],
    },
    {
        id: 'doctor.newRequest', labelAr: 'طلب جديد', labelEn: 'New Request',
        path: '/doctor/new-request', capability: 'doctor_portal', section: 'top',
        aliases: ['حالة جديدة', 'new request'],
    },
    {
        id: 'doctor.account', labelAr: 'حسابي', labelEn: 'My Account',
        path: '/doctor/account', capability: 'doctor_portal', section: 'top',
        aliases: ['رصيدي', 'my account'],
    },
];

export const SECTION_LABELS: Record<NavSection, string | null> = {
    top: null,
    operations: 'التشغيل',
    directory: 'الدليل',
    analysis: 'التحليل',
    // The System area is a single entry now, so a heading would just repeat
    // its label. The sidebar draws a divider for a labelless section instead.
    system: null,
};

export const SECTION_ORDER: NavSection[] = ['top', 'operations', 'directory', 'analysis', 'system'];

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

/** `/employees/:id` against `/employees/42`. Segment counts must agree. */
function patternMatches(pattern: string, pathname: string): boolean {
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);
    if (patternParts.length !== pathParts.length) return false;
    return patternParts.every((part, index) => part.startsWith(':') || part === pathParts[index]);
}

/** How specific a match is, so `/doctors/retention` beats `/doctors`. */
function matchScore(destination: Destination, pathname: string): number {
    const candidates = [destination.path, ...(destination.matches || [])];
    let best = -1;
    for (const candidate of candidates) {
        if (!patternMatches(candidate, pathname)) continue;
        const segments = candidate.split('/').filter(Boolean);
        // A literal segment is worth more than a `:param` one.
        const score = segments.reduce((total, part) => total + (part.startsWith(':') ? 1 : 2), 0);
        if (score > best) best = score;
    }
    return best;
}

function bestMatch<T extends Destination>(items: T[], pathname: string): T | null {
    let winner: T | null = null;
    let winningScore = -1;
    for (const item of items) {
        const score = matchScore(item, pathname);
        if (score > winningScore) {
            winningScore = score;
            winner = item;
        }
    }
    return winningScore >= 0 ? winner : null;
}

/** The sidebar entry that should read as active for a pathname. */
export function activeSidebarEntry(pathname: string): SidebarEntry | null {
    // A workspace tab activates its parent entry, so tabs are folded in.
    const withWorkspaceTabs = SIDEBAR.flatMap<SidebarEntry>(entry => {
        if (!entry.workspace) return [entry];
        const tabs = WORKSPACES[entry.workspace] || [];
        return [
            entry,
            ...tabs.map(tab => ({ ...entry, path: tab.path, matches: tab.matches })),
        ];
    });
    const match = bestMatch([...withWorkspaceTabs, ...DOCTOR_PORTAL], pathname);
    if (match) {
        return SIDEBAR.find(entry => entry.id === match.id)
            || DOCTOR_PORTAL.find(entry => entry.id === match.id)
            || null;
    }

    // Reports keep their own routes; they light up the Reports hub entry.
    const report = bestMatch(REPORT_CATEGORIES.flatMap(category => category.reports), pathname);
    if (report) return SIDEBAR.find(entry => entry.id === 'reports') || null;

    return null;
}

/** The workspace id and its active tab for a pathname, if any. */
export function activeWorkspace(pathname: string): { workspace: string; tab: WorkspaceTab } | null {
    for (const [workspace, tabs] of Object.entries(WORKSPACES)) {
        const tab = bestMatch(tabs, pathname);
        if (tab) return { workspace, tab };
    }
    return null;
}

export function isReportRoute(pathname: string): boolean {
    return Boolean(bestMatch(REPORT_CATEGORIES.flatMap(category => category.reports), pathname));
}

export function findDestination(id: string): Destination | null {
    return (
        SIDEBAR.find(entry => entry.id === id) ||
        DOCTOR_PORTAL.find(entry => entry.id === id) ||
        Object.values(WORKSPACES).flat().find(tab => tab.id === id) ||
        REPORT_CATEGORIES.flatMap(category => category.reports).find(report => report.id === id) ||
        null
    );
}

/**
 * The sidebar a given user actually sees, with each entry's link resolved.
 *
 * Two rules that the component must not re-derive:
 *   - A workspace entry is visible when ANY of its tabs is, and it links to
 *     the first tab that user can open. A designer's Production entry goes
 *     to My Tasks, because the board is a supervisory view they cannot open.
 *   - A `fallbackFor` entry is suppressed when its parent workspace is
 *     visible, so the admin does not get Accounts twice.
 */
export function visibleSidebarEntries(caps: Set<Capability>): SidebarEntry[] {
    if (caps.has('doctor_portal')) {
        return DOCTOR_PORTAL.filter(entry => caps.has(entry.capability));
    }

    const reachableTabs = (workspace: string) =>
        (WORKSPACES[workspace] || []).filter(tab => caps.has(tab.capability));

    // A workspace opens on its OWN capability, not on any tab's. The lab can
    // read /accounts, which is a Finance tab, but that must not hand the lab
    // a Finance area -- it gets the standalone Accounts entry instead.
    const openWorkspaces = new Set<string>();
    for (const entry of SIDEBAR) {
        if (entry.workspace && caps.has(entry.capability)) openWorkspaces.add(entry.workspace);
    }

    return SIDEBAR.flatMap<SidebarEntry>(entry => {
        if (entry.fallbackFor) {
            if (openWorkspaces.has(entry.fallbackFor)) return [];
            return caps.has(entry.capability) ? [entry] : [];
        }

        if (entry.workspace) {
            if (!caps.has(entry.capability)) return [];
            const tabs = reachableTabs(entry.workspace);
            // Link to the first tab the user can actually open: a designer's
            // Production entry goes to My Tasks, not the supervisory board.
            return [{ ...entry, path: tabs[0]?.path || entry.path }];
        }

        return caps.has(entry.capability) ? [entry] : [];
    });
}

/** Everything a user may reach, for search and for validating favourites. */
export function allDestinations(): Destination[] {
    return [
        ...SIDEBAR,
        ...DOCTOR_PORTAL,
        ...Object.values(WORKSPACES).flat(),
        ...REPORT_CATEGORIES.flatMap(category => category.reports),
    ];
}

/* ------------------------------------------------------------------ *
 * Landing routes
 *
 * Login used to send everyone except doctors to /dashboard. The
 * technician has no access to /dashboard, so a technician logging in
 * landed on "غير مصرح لك بدخول هذه الصفحة". A landing route is picked
 * from what the user actually does, and it is FIXED: badges say where
 * the urgency is, the ground does not move under the user.
 * ------------------------------------------------------------------ */


export function getLandingRoute(user: User | null | undefined): string {
    if (!user) return '/login';
    if (isOtherEmployeeOnly(user)) return `/employees/${user.id}`;

    const caps = getCapabilities(user);
    if (caps.has('doctor_portal')) return '/doctor/my-orders';

    switch (user.role) {
        // The floor is the technician's whole job, and the board is where
        // the lab reads the state of the floor.
        case 'technician':
        case 'lab':
            return '/production/board';
        case 'accountant':
            return '/finance';
        case 'designer':
            return '/orders';
        default:
            return caps.has('view_dashboard') ? '/dashboard' : '/orders';
    }
}

/* ------------------------------------------------------------------ *
 * Quick actions -- verbs, never destinations
 * ------------------------------------------------------------------ */

export interface QuickAction {
    id: string;
    labelAr: string;
    labelEn: string;
    /** Where the action starts. The page opens its own form from here. */
    path: string;
    capability: Capability;
    groupAr: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
    {
        // Orders.tsx reads ?modal=new and opens the form on mount. A
        // parameter invented for this menu would look like it worked and
        // quietly drop the user on a page with nothing open.
        id: 'action.newOrder', labelAr: 'أوردر جديد', labelEn: 'New Order',
        path: '/orders?modal=new', capability: 'view_orders', groupAr: 'الأوردرات',
    },
    {
        id: 'action.doctorRequest', labelAr: 'طلب جديد', labelEn: 'New Request',
        path: '/doctor/new-request', capability: 'doctor_portal', groupAr: 'الأوردرات',
    },
    {
        // Finance has no deep link that opens a payment form, so this stops
        // at the page rather than promising a form it cannot open.
        id: 'action.recordPayment', labelAr: 'تسجيل دفعة', labelEn: 'Record Payment',
        path: '/finance', capability: 'view_finance', groupAr: 'المالية',
    },
    {
        id: 'action.registerCase', labelAr: 'تسجيل حالة', labelEn: 'Register Case',
        path: '/case-registration', capability: 'view_finance', groupAr: 'المالية',
    },
    {
        id: 'action.startTask', labelAr: 'ابدأ مهمة', labelEn: 'Start a Task',
        path: '/production/my-tasks', capability: 'view_my_tasks', groupAr: 'الإنتاج',
    },
];

/* ------------------------------------------------------------------ *
 * Default favourites
 *
 * A pin list that starts empty never gets used, so each role is seeded
 * with the destinations that role opens every day. The user overwrites
 * these the first time they pin something.
 * ------------------------------------------------------------------ */

export const DEFAULT_FAVOURITES: Record<string, string[]> = {
    admin: ['orders', 'production', 'finance'],
    lab: ['production.board', 'orders'],
    technician: ['production.myTasks', 'production.board'],
    accountant: ['finance.caseRegistration', 'finance.aging', 'finance.accounts'],
    representative: ['orders', 'doctors'],
    designer: ['orders', 'production.myTasks'],
    doctor: [],
};

export const MAX_FAVOURITES = 4;
