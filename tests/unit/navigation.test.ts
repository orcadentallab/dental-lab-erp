/**
 * The navigation registry is only safe if it agrees with App.tsx.
 *
 * The failures this guards against are the ones that actually happened:
 * a destination authorised by a route but missing from the menu
 * (/balance-snapshot), a destination in the menu but hidden from a role
 * the route allows, a destination in the menu for a role the route now
 * refuses (/doctors/retention), an active state that used exact equality
 * and so lost /employees/:id, and a role with no landing page
 * that logged straight into "غير مصرح لك".
 */
import { describe, it, expect } from 'vitest';
import type { User } from '../../src/services/db';
import { getCapabilities, isOtherEmployeeOnly } from '../../src/lib/userRoles';
import {
    SIDEBAR, WORKSPACES, REPORT_CATEGORIES, DOCTOR_PORTAL, DEFAULT_FAVOURITES,
    QUICK_ACTIONS, allDestinations, activeSidebarEntry, activeWorkspace,
    findDestination, getLandingRoute, visibleSidebarEntries,
} from '../../src/lib/navigation';

type Role = User['role'];

function makeUser(role: Role, overrides: Partial<User> = {}): User {
    return {
        id: `u-${role}`,
        username: role === 'admin' ? 'admin' : `${role}1`,
        role,
        name: `${role} user`,
        ...overrides,
    };
}

/**
 * The route table transcribed from src/App.tsx. If a guard changes there
 * and not here, the mismatch tests below are the ones that fail.
 */
const ROUTE_ROLES: Record<string, Role[]> = {
    '/dashboard': ['admin', 'lab', 'technician', 'representative', 'accountant', 'designer'],
    '/orders': ['admin', 'lab', 'technician', 'representative', 'accountant', 'designer'],
    '/doctors': ['admin', 'representative'],
    '/doctors/retention': ['admin'],
    '/production/my-tasks': ['admin', 'lab', 'technician', 'designer'],
    '/production/board': ['admin', 'lab', 'technician'],
    '/production/shadow': ['admin', 'lab', 'technician'],
    '/production/external': ['admin', 'lab', 'technician', 'accountant'],
    '/production/routes': ['admin'],
    '/settings/work-calendar': ['admin'],
    '/accounts': ['admin', 'accountant', 'lab', 'technician', 'representative', 'designer'],
    '/settings': ['admin', 'accountant', 'lab', 'technician', 'representative'],
    '/employees': ['admin', 'accountant', 'representative'],
    '/finance': ['admin', 'accountant'],
    '/suppliers': ['admin', 'accountant'],
    '/case-registration': ['admin', 'accountant'],
    '/balance-snapshot': ['admin', 'accountant'],
    '/financial-review': ['admin', 'accountant'],
    '/statements': ['admin', 'accountant'],
    '/aging-report': ['admin', 'accountant'],
    '/analytics': ['admin'],
    '/ai-analytics': ['admin'],
    '/users': ['admin'],
    '/services': ['admin'],
    '/issues-report': ['admin'],
    '/marketing-analytics': ['admin'],
    '/designer-stats': ['admin'],
    '/reports/profitability': ['admin'],
    '/reports/cashflow': ['admin'],
    '/doctor/my-orders': ['doctor'],
    '/doctor/new-request': ['doctor'],
    '/doctor/account': ['doctor'],
};

const ERP_ROLES: Role[] = ['admin', 'lab', 'technician', 'representative', 'accountant', 'designer'];

describe('navigation registry covers the routes', () => {
    it('every guarded route is reachable from the registry', () => {
        const known = new Set(
            allDestinations().flatMap(destination => [destination.path, ...(destination.matches || [])])
        );
        const missing = Object.keys(ROUTE_ROLES).filter(path => !known.has(path));
        expect(missing).toEqual([]);
    });

    it('no destination points at a route that does not exist', () => {
        const routes = new Set([...Object.keys(ROUTE_ROLES), '/quality', '/staff', '/employees/:id']);
        const orphans = allDestinations()
            .map(destination => destination.path)
            .filter(path => !routes.has(path));
        expect(orphans).toEqual([]);
    });

    it('destination ids are unique', () => {
        const ids = allDestinations().map(destination => destination.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('visibility never disagrees with authorization', () => {
    for (const role of ERP_ROLES) {
        it(`${role}: sees nothing it cannot open, and nothing it can open is hidden`, () => {
            const caps = getCapabilities(makeUser(role));

            // A workspace entry's own `path` is only a default: the resolver
            // rewrites it to the first tab the user can open. Those are
            // checked below via their resolved link instead.
            const resolved = allDestinations().filter(destination =>
                !SIDEBAR.some(entry => entry.id === destination.id && entry.workspace));

            for (const destination of resolved) {
                const allowed = ROUTE_ROLES[destination.path];
                if (!allowed) continue;
                const visible = caps.has(destination.capability);
                const authorised = allowed.includes(role);
                expect(
                    { path: destination.path, visible },
                    `${role} @ ${destination.path}`
                ).toEqual({ path: destination.path, visible: authorised });
            }
        });
    }

    for (const role of ERP_ROLES) {
        it(`${role}: every sidebar link lands on a route it may open`, () => {
            const caps = getCapabilities(makeUser(role));
            for (const entry of visibleSidebarEntries(caps)) {
                const allowed = ROUTE_ROLES[entry.path];
                expect(allowed, `${role} -> ${entry.path}`).toBeDefined();
                expect(allowed, `${role} -> ${entry.path}`).toContain(role);
            }
        });
    }

    it('a designer Production entry goes to My Tasks, not the board', () => {
        const caps = getCapabilities(makeUser('designer'));
        const production = visibleSidebarEntries(caps).find(entry => entry.id === 'production');
        expect(production?.path).toBe('/production/my-tasks');
    });

    it('a workspace owner does not also get the standalone fallback entry', () => {
        const adminIds = visibleSidebarEntries(getCapabilities(makeUser('admin'))).map(e => e.id);
        expect(adminIds).not.toContain('accounts');
        expect(adminIds).not.toContain('externalWork');

        // The lab has no finance workspace, so Accounts stays a real entry.
        const labIds = visibleSidebarEntries(getCapabilities(makeUser('lab'))).map(e => e.id);
        expect(labIds).toContain('accounts');

        // The accountant has no production workspace but does need External Work.
        const accountantIds = visibleSidebarEntries(getCapabilities(makeUser('accountant'))).map(e => e.id);
        expect(accountantIds).toContain('externalWork');
        expect(accountantIds).not.toContain('accounts');
    });

    it('balance snapshot is reachable -- it used to be authorised but hidden', () => {
        const caps = getCapabilities(makeUser('accountant'));
        const review = WORKSPACES.finance.find(tab => tab.id === 'finance.review');
        expect(review?.matches).toContain('/balance-snapshot');
        expect(caps.has(review!.capability)).toBe(true);
    });

    it('doctor retention is admin-only, and the rep keeps the directory', () => {
        const retention = WORKSPACES.doctors.find(tab => tab.id === 'doctors.retention');
        const rep = getCapabilities(makeUser('representative'));
        expect(rep.has(retention!.capability)).toBe(false);
        expect(rep.has('view_doctors')).toBe(true);
        expect(getCapabilities(makeUser('admin')).has(retention!.capability)).toBe(true);
    });

    it('a rep with one doctors tab gets no tab bar, and the entry still opens', () => {
        const caps = getCapabilities(makeUser('representative'));
        const open = WORKSPACES.doctors.filter(tab => caps.has(tab.capability));
        expect(open.map(tab => tab.id)).toEqual(['doctors.directory']);
        const doctors = visibleSidebarEntries(caps).find(entry => entry.id === 'doctors');
        expect(doctors?.path).toBe('/doctors');
    });
});

describe('active state', () => {
    it('an employee detail page keeps Staff selected', () => {
        expect(activeSidebarEntry('/employees/42')?.id).toBe('employees');
        expect(activeSidebarEntry('/employees')?.id).toBe('employees');
    });

    it('the more specific pattern wins', () => {
        expect(activeWorkspace('/doctors/retention')?.tab.id).toBe('doctors.retention');
        expect(activeWorkspace('/doctors')?.tab.id).toBe('doctors.directory');
    });

    it('a workspace tab lights up its parent sidebar entry', () => {
        expect(activeSidebarEntry('/aging-report')?.id).toBe('finance');
        expect(activeSidebarEntry('/balance-snapshot')?.id).toBe('finance');
        expect(activeSidebarEntry('/production/my-tasks')?.id).toBe('production');
        expect(activeSidebarEntry('/settings/work-calendar')?.id).toBe('system');
        expect(activeSidebarEntry('/users')?.id).toBe('system');
        expect(activeSidebarEntry('/services')?.id).toBe('system');
        expect(activeSidebarEntry('/production/routes')?.id).toBe('system');
    });

    it('a report lights up the Reports hub', () => {
        expect(activeSidebarEntry('/reports/cashflow')?.id).toBe('reports');
        expect(activeSidebarEntry('/issues-report')?.id).toBe('reports');
        expect(activeSidebarEntry('/quality')?.id).toBe('reports');
    });

    it('an unknown path selects nothing rather than guessing', () => {
        expect(activeSidebarEntry('/nope')).toBeNull();
        expect(activeWorkspace('/orders')).toBeNull();
    });
});

describe('landing routes', () => {
    it('every role lands somewhere it is authorised to be', () => {
        for (const role of ERP_ROLES) {
            const landing = getLandingRoute(makeUser(role));
            const allowed = ROUTE_ROLES[landing];
            expect(allowed, `${role} lands on ${landing}`).toBeDefined();
            expect(allowed, `${role} lands on ${landing}`).toContain(role);
        }
    });

    it('the technician lands on the floor, not on a locked dashboard', () => {
        expect(getLandingRoute(makeUser('technician'))).toBe('/production/board');
    });

    it('the doctor and the profile-only employee keep their own landings', () => {
        expect(getLandingRoute(makeUser('doctor'))).toBe('/doctor/my-orders');
        const other = makeUser('accountant', { id: 'u-7', employeeType: 'other' });
        expect(getLandingRoute(other)).toBe('/employees/u-7');
    });
});

describe('capabilities', () => {
    it('the technician mirrors the lab', () => {
        const lab = getCapabilities(makeUser('lab'));
        const technician = getCapabilities(makeUser('technician'));
        expect(Array.from(technician).sort()).toEqual(Array.from(lab).sort());
    });

    it('a profile-only employee has no ERP navigation', () => {
        const other = makeUser('accountant', { employeeType: 'other' });
        expect(isOtherEmployeeOnly(other)).toBe(true);
        const caps = getCapabilities(other);
        expect(caps.has('self_profile_only')).toBe(true);
        expect(caps.has('view_finance')).toBe(false);
        expect(visibleSidebarEntries(caps)).toHaveLength(1);
    });

    it('a technician is never treated as a profile-only employee', () => {
        expect(isOtherEmployeeOnly(makeUser('technician', { employeeType: 'other' }))).toBe(false);
    });

    it('the secondary_designer permission grants designer navigation', () => {
        const dualRole = makeUser('accountant', { customPermissions: { secondary_designer: true } });
        expect(getCapabilities(dualRole).has('view_my_tasks')).toBe(true);
        // ...but not the supervisory board, which its route also denies.
        expect(getCapabilities(dualRole).has('view_production')).toBe(false);
    });

    it('the doctor portal is a portal, not a reduced ERP', () => {
        const caps = getCapabilities(makeUser('doctor'));
        expect(visibleSidebarEntries(caps)).toHaveLength(3);
        expect(visibleSidebarEntries(caps).map(entry => entry.id))
            .toEqual(DOCTOR_PORTAL.map(entry => entry.id));
    });
});

describe('the sidebar stays small', () => {
    it('an admin sees at most 9 entries, down from 28', () => {
        const caps = getCapabilities(makeUser('admin'));
        expect(visibleSidebarEntries(caps).length).toBeLessThanOrEqual(9);
    });

    it('the System area is one entry, not one per admin page', () => {
        const caps = getCapabilities(makeUser('admin'));
        const ids = visibleSidebarEntries(caps).map(entry => entry.id);
        expect(ids).toContain('system');
        for (const gone of ['services', 'users', 'productionRoutes', 'settings']) {
            expect(ids).not.toContain(gone);
        }
        // ...and every one of those pages is still reachable as a tab.
        expect(WORKSPACES.system.filter(tab => caps.has(tab.capability))).toHaveLength(5);
    });

    it('a role with only Settings gets the area but no tab bar', () => {
        for (const role of ['lab', 'technician', 'accountant', 'representative'] as Role[]) {
            const caps = getCapabilities(makeUser(role));
            const system = visibleSidebarEntries(caps).find(entry => entry.id === 'system');
            expect(system?.path, role).toBe('/settings');
            expect(WORKSPACES.system.filter(tab => caps.has(tab.capability)), role).toHaveLength(1);
        }
    });

    it('no role has to scroll a menu', () => {
        for (const role of ERP_ROLES) {
            const caps = getCapabilities(makeUser(role));
            expect(visibleSidebarEntries(caps).length,
                `${role} menu length`).toBeLessThanOrEqual(9);
        }
    });

    it('no report is also a permanent sidebar entry', () => {
        const sidebarPaths = new Set(SIDEBAR.map(entry => entry.path));
        for (const category of REPORT_CATEGORIES) {
            for (const report of category.reports) {
                expect(sidebarPaths.has(report.path), report.path).toBe(false);
            }
        }
    });
});

describe('favourites and quick actions', () => {
    it('every seeded favourite resolves and is reachable by that role', () => {
        for (const [role, ids] of Object.entries(DEFAULT_FAVOURITES)) {
            const caps = getCapabilities(makeUser(role as Role));
            for (const id of ids) {
                const destination = findDestination(id);
                expect(destination, `${role} -> ${id}`).not.toBeNull();
                expect(caps.has(destination!.capability), `${role} -> ${id}`).toBe(true);
            }
        }
    });

    it('quick actions are verbs the role may actually perform', () => {
        const accountant = getCapabilities(makeUser('accountant'));
        const visible = QUICK_ACTIONS.filter(action => accountant.has(action.capability));
        expect(visible.map(action => action.id)).toEqual([
            'action.newOrder', 'action.recordPayment', 'action.registerCase',
        ]);
    });

    it('every quick action lands on a real, authorised route', () => {
        // Caught a fabricated `?new=1` that Orders.tsx never read: the menu
        // item worked, navigated, and opened nothing.
        for (const action of QUICK_ACTIONS) {
            const [path] = action.path.split('?');
            const allowed = ROUTE_ROLES[path];
            expect(allowed, `${action.id} -> ${path}`).toBeDefined();

            for (const role of [...ERP_ROLES, 'doctor' as Role]) {
                if (!getCapabilities(makeUser(role)).has(action.capability)) continue;
                expect(allowed, `${role} performing ${action.id}`).toContain(role);
            }
        }
    });

    it('the doctor gets only the doctor request action', () => {
        const caps = getCapabilities(makeUser('doctor'));
        expect(QUICK_ACTIONS.filter(action => caps.has(action.capability)).map(a => a.id))
            .toEqual(['action.doctorRequest']);
    });
});
