import { describe, expect, it } from 'vitest';
import { isDoctorStatementIncluded, getOfficialStatementDate } from '../../src/constants/orderLifecycle';
import { isDateInOpenRange } from '../../src/utils/dateRange';

describe('analytics overview and statement parity unification', () => {
    it('correctly includes orders whose actual delivery date fell in January even if scheduled in December', () => {
        const order = {
            id: 'ord-1',
            status: 'Delivered',
            productionStatus: 'final_delivered',
            deliveryDate: '2025-12-30',
            actualDeliveryDate: '2026-01-05',
            createdAt: '2025-12-20T10:00:00Z',
            isDeleted: false,
        };

        expect(isDoctorStatementIncluded(order)).toBe(true);
        const statementDate = getOfficialStatementDate(order);
        expect(statementDate).toBe('2026-01-05');
        expect(isDateInOpenRange(statementDate, { start: '2026-01-01', end: '2026-01-31' })).toBe(true);
    });

    it('excludes orders whose scheduled delivery was January but actual delivery was February', () => {
        const order = {
            id: 'ord-2',
            status: 'Delivered',
            productionStatus: 'final_delivered',
            deliveryDate: '2026-01-31',
            actualDeliveryDate: '2026-02-02',
            createdAt: '2026-01-25T10:00:00Z',
            isDeleted: false,
        };

        expect(isDoctorStatementIncluded(order)).toBe(true);
        const statementDate = getOfficialStatementDate(order);
        expect(statementDate).toBe('2026-02-02');
        expect(isDateInOpenRange(statementDate, { start: '2026-01-01', end: '2026-01-31' })).toBe(false);
    });

    it('correctly counts units from legacy JSON items array with teeth numbers array', () => {
        const orders = [
            {
                id: 'ord-1',
                status: 'Delivered',
                productionStatus: 'final_delivered',
                actualDeliveryDate: '2026-01-10',
                isDeleted: false,
                items: [
                    { serviceType: 'Zr Preshade', teethNumbers: ['11', '12', '13'], price: 700 }, // 3 units
                    { serviceType: 'PMMA Printed', teethNumbers: ['21'], price: 100 },             // 1 unit
                ],
                totalPrice: 2200,
            },
            {
                id: 'ord-2',
                status: 'Completed',
                productionStatus: 'final_delivered',
                actualDeliveryDate: '2026-01-15',
                isDeleted: false,
                items: [
                    { serviceType: 'Zircomax', teethNumbers: ['31', '32', '33', '34'], price: 900 }, // 4 units
                ],
                totalPrice: 3600,
            },
            {
                id: 'ord-3',
                status: 'Delivered',
                productionStatus: 'final_delivered',
                actualDeliveryDate: '2026-01-20',
                isDeleted: false,
                items: [], // Itemless order
                totalPrice: 1000,
            }
        ];

        const periodOrders = orders.filter(o => {
            if (!isDoctorStatementIncluded(o)) return false;
            const d = getOfficialStatementDate(o);
            return isDateInOpenRange(d, { start: '2026-01-01', end: '2026-01-31' });
        });

        expect(periodOrders.length).toBe(3);

        const totalUnits = periodOrders.reduce((sum, o) => {
            const items = o.items || [];
            if (items.length === 0) return sum;
            return sum + items.reduce((s, it) => s + (Array.isArray(it.teethNumbers) ? it.teethNumbers.length : 1), 0);
        }, 0);

        expect(totalUnits).toBe(8); // 3 + 1 + 4 = 8 units

        const totalRevenue = periodOrders.reduce((sum, o) => sum + o.totalPrice, 0);
        expect(totalRevenue).toBe(6800);

        const avgUnitPrice = Math.round(totalRevenue / totalUnits);
        expect(avgUnitPrice).toBe(850);
    });

    it('excludes cancelled and lab rejected orders from productive unit counts and prevents average price dilution', () => {
        // Reproducing the user's exact case:
        // Zr Preshade with 71 delivered units (49,300 EGP) and 1 cancelled order with 24 units (0 EGP)
        const orders = [
            {
                id: 'delivered-case',
                status: 'Delivered',
                productionStatus: 'final_delivered',
                actualDeliveryDate: '2026-08-10',
                isDeleted: false,
                items: [
                    { serviceType: 'Zr Preshade', teethNumbers: Array(71).fill('11'), price: 694.366 },
                ],
                totalPrice: 49300,
            },
            {
                id: 'cancelled-case-1008-260812-535',
                status: 'Cancelled',
                productionStatus: 'cancelled',
                deliveryDate: '2026-08-12',
                isDeleted: false,
                items: [
                    { serviceType: 'Zr Preshade', teethNumbers: Array(24).fill('11'), price: 0 },
                ],
                totalPrice: 0,
            },
            {
                id: 'lab-rejected-case',
                status: 'Lab Rejected',
                deliveryDate: '2026-08-15',
                isDeleted: false,
                items: [
                    { serviceType: 'Zr Preshade', teethNumbers: ['11', '12'], price: 0 },
                ],
                totalPrice: 0,
            }
        ];

        // All 3 appear in doctor statement audit trail
        const periodOrders = orders.filter(o => isDoctorStatementIncluded(o));
        expect(periodOrders.length).toBe(3);

        // Calculate units with isNonProductiveOrder exclusion
        const productiveUnits = periodOrders.reduce((sum, o) => {
            if (isDoctorStatementIncluded(o) && (o.status === 'Cancelled' || o.status === 'Lab Rejected')) {
                return sum;
            }
            const items = o.items || [];
            return sum + items.reduce((s, it) => s + (Array.isArray(it.teethNumbers) ? it.teethNumbers.length : 1), 0);
        }, 0);

        // Productive units must be 71, NOT 95 (71 + 24) or 97 (71 + 24 + 2)
        expect(productiveUnits).toBe(71);

        const totalRevenue = periodOrders.reduce((sum, o) => sum + (o.status === 'Cancelled' || o.status === 'Lab Rejected' ? 0 : o.totalPrice), 0);
        expect(totalRevenue).toBe(49300);

        // Average price should remain ~694 EGP, not diluted down to 519 EGP (49300 / 95)
        const avgSalePrice = Math.round(totalRevenue / productiveUnits);
        expect(avgSalePrice).toBe(694);
    });
});
