import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const ordersService = readFileSync('src/services/supabase/orders.ts', 'utf8');
const dashboard = readFileSync('src/pages/DashboardNew.tsx', 'utf8');

describe('dashboard and statement pagination guards', () => {
    test('does not reintroduce fixed row ceilings in dashboard or entity statements', () => {
        expect(ordersService).not.toContain('.range(0, 499)');
        expect(ordersService).not.toContain('.range(0, 999)');
        expect(ordersService).not.toContain('.range(0, 4999)');
        expect(ordersService).not.toContain('.range(0, 9999)');

        expect(ordersService).toContain('.range(from, from + pageSize - 1)');
        expect(ordersService).toContain('.range(orderFrom, orderFrom + pageSize - 1)');
        expect(ordersService).toContain('.range(txFrom, txFrom + pageSize - 1)');
    });

    test('treats every terminal state consistently across dashboard cards', () => {
        expect(dashboard).toContain("'Delivered'");
        expect(dashboard).toContain("'Completed'");
        expect(dashboard).toContain("'Doctor Rejected'");
        expect(dashboard).toContain("'Lab Rejected'");
        expect(dashboard).toContain("'Cancelled'");
        expect(dashboard).toContain("'Rejected'");
        expect(dashboard).toContain('const isDashboardTerminal');
        expect(dashboard).toContain('orders.filter(o => !isDashboardTerminal(o)).length');
        expect(dashboard).toContain('!o.supplierId && !isDashboardTerminal(o)');
    });
});
