import { describe, expect, it } from 'vitest';
import type { User } from '../../src/services/db';
import { getCapabilities } from '../../src/lib/userRoles';
import { getLandingRoute, reachableDestinations, visibleSidebarEntries } from '../../src/lib/navigation';
const user = (role: User['role'], customPermissions = {}) => ({ id: 'test', name: 'Test', username: role, role, customPermissions } as User);
describe('designer workspace access', () => {
    it('uses the dashboard and excludes orders from menus and search even with edit permission', () => {
        const designer = user('designer', { edit_orders: true });
        const caps = getCapabilities(designer);
        expect(getLandingRoute(designer)).toBe('/dashboard');
        expect(caps.has('view_dashboard')).toBe(true);
        expect(caps.has('view_orders')).toBe(false);
        expect(caps.has('view_my_tasks')).toBe(false);
        expect(visibleSidebarEntries(caps).some(entry => entry.id === 'production')).toBe(false);
        expect(reachableDestinations(caps).some(entry => entry.path.startsWith('/production/'))).toBe(false);
        expect(visibleSidebarEntries(caps).some(entry => entry.id === 'orders')).toBe(false);
        expect(reachableDestinations(caps).some(entry => entry.path === '/orders')).toBe(false);
    });
    it.each(['admin', 'representative', 'coordinator', 'accountant', 'lab', 'technician', 'production_manager'] as const)('keeps orders available to %s', role => {
        expect(getCapabilities(user(role)).has('view_orders')).toBe(true);
    });
    it('preserves the primary role of employees who also design', () => {
        expect(getCapabilities(user('representative', { secondary_designer: true })).has('view_orders')).toBe(true);
    });
});
