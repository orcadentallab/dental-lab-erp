import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allDestinations, findDestination, QUICK_ACTIONS, DEFAULT_FAVOURITES } from '../../src/lib/navigation';
import { getEmployeeFinanceStats } from '../../src/utils/employeeFinance';
import type { Transaction, User } from '../../src/services/db';

describe('decision 80: retire external registration without retiring employee settlement', () => {
    it('removes menu/search, quick actions and saved favourite resolution', () => {
        expect(allDestinations().some(d => d.path === '/case-registration')).toBe(false);
        expect(QUICK_ACTIONS.some(d => d.path === '/case-registration')).toBe(false);
        expect(findDestination('finance.caseRegistration')).toBeNull();
        expect(Object.values(DEFAULT_FAVOURITES).flat()).not.toContain('finance.caseRegistration');
    });

    it('redirects the old direct route without mounting its query or mutation screen', () => {
        const app = readFileSync('src/App.tsx', 'utf8');
        expect(app).toContain('LEGACY_EXTERNAL_REGISTRATION_ENABLED ? <CaseRegistration /> : <Navigate to="/finance/ledgers" replace />');
    });

    it('disables obsolete badges, financial transfer buttons and dashboard actions', () => {
        for (const path of ['src/hooks/useNavBadges.ts', 'src/pages/Finance.tsx', 'src/components/dashboard/OrderListItem.tsx']) {
            expect(readFileSync(path, 'utf8'), path).toContain('LEGACY_EXTERNAL_REGISTRATION_ENABLED &&');
        }
        const orders = readFileSync('src/services/supabase/orders.ts', 'utf8');
        expect(orders).toContain('if (!LEGACY_EXTERNAL_REGISTRATION_ENABLED) return 0;');
        expect(orders).toContain('if (!LEGACY_EXTERNAL_REGISTRATION_ENABLED) return [];');
    });

    it('keeps approved unpaid employee expenses outstanding until explicitly settled', () => {
        const employee = { id: 'employee', baseSalary: 0, isActive: true } as User;
        const expense = { id: 'claim', entityId: employee.id, type: 'expense', category: 'transport', amount: 125,
            status: 'approved', isApproved: true, isRegistered: false, date: '2026-11-02' } as Transaction;
        const stats = (tx: Transaction) => getEmployeeFinanceStats(employee, '2026-11', [], [], [], [tx]);
        expect(stats(expense).approvedExpenses).toBe(125);
        expect(stats({ ...expense, isRegistered: true, status: 'settled' }).approvedExpenses).toBe(0);
        expect(stats({ ...expense, status: 'pending', isApproved: false }).approvedExpenses).toBe(0);
    });
});
