import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getOfficialStatementDate } from '../../src/constants/orderLifecycle';
import { isDateInOpenRange } from '../../src/utils/dateRange';

describe('supplier statement delivery dates', () => {
    it('places the reported August case in September using its actual delivery', () => {
        const date = getOfficialStatementDate({
            status: 'Delivered', productionStatus: 'final_delivered',
            createdAt: '2026-08-05', deliveryDate: '2026-08-09', actualDeliveryDate: '2026-09-12',
        });
        expect(date).toBe('2026-09-12');
        expect(isDateInOpenRange(date, { start: '2026-08-01', end: '2026-08-31' })).toBe(false);
        expect(isDateInOpenRange(date, { start: '2026-09-01', end: '2026-09-30' })).toBe(true);
    });

    it.each(['src/pages/Accounts.tsx', 'src/pages/Statements.tsx'])(
        '%s uses the official date for every supplier order path', path => {
            const source = readFileSync(path, 'utf8');
            const supplierPaths = source.split(/(?:if|else if) \(activeTab === 'suppliers'\) \{/).slice(1)
                .map(section => section.split(/(?:if|else if) \(activeTab === 'designers'\) \{/)[0]).filter(section => section.includes('getSupplierStatementAmount'));
            expect(supplierPaths.length).toBeGreaterThan(0);
            for (const section of supplierPaths) {
                expect(section).toContain('getOfficialStatementDate(o)');
                expect(section).not.toContain('getOperationalOrderDate(o)');
                expect(section).not.toContain('o.deliveryDate || o.createdAt');
            }
        },
    );
});
