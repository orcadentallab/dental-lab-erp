import { describe, expect, it } from 'vitest';
import { reconcileLegacyItemPrices } from '../../src/lib/pricingUtils';

const CATALOG: Record<string, number> = {
    'Emax Press Ivoclar Ant': 1200,
    'Zircomax': 1000,
    'Custom Abutment Ti': 1100,
    'Zr Preshade': 750,
    'Framework Ni-Cr Printed': 250,
};

const catalogUnitPrice = (serviceType: string) => CATALOG[serviceType] ?? 0;

const subtotal = (items: { teethNumbers: string[]; price: number }[]) =>
    items.reduce((sum, item) => sum + item.price * item.teethNumbers.length, 0);

describe('reconcileLegacyItemPrices', () => {
    it('leaves an order alone when every item already carries a price', () => {
        const items = [
            { serviceType: 'Zircomax', teethNumbers: ['11'], price: 950 },
        ];
        expect(reconcileLegacyItemPrices(items, 950, 0, catalogUnitPrice)).toBe(items);
    });

    it('rebuilds the unit price of a single-item legacy order exactly', () => {
        const items = [
            { serviceType: 'Zircomax', teethNumbers: ['11', '12'], price: 0 },
        ];
        const result = reconcileLegacyItemPrices(items, 1800, 0, catalogUnitPrice);
        expect(result[0].price).toBe(900);
        expect(subtotal(result)).toBe(1800);
    });

    it('reconstructs the pre-discount price, so the stored total still nets out', () => {
        const items = [
            { serviceType: 'Zircomax', teethNumbers: ['11'], price: 0 },
        ];
        const result = reconcileLegacyItemPrices(items, 900, 100, catalogUnitPrice);
        expect(result[0].price).toBe(1000);
        expect(subtotal(result) - 100).toBe(900);
    });

    it('splits a multi-item order in proportion to the catalog prices, never evenly', () => {
        // 24 x Zr Preshade (750 today) + 24 x Framework (250 today) sold for 26,400:
        // both lines scale by the same factor instead of being flattened together.
        const items = [
            { serviceType: 'Zr Preshade', teethNumbers: Array(24).fill('11'), price: 0 },
            { serviceType: 'Framework Ni-Cr Printed', teethNumbers: Array(24).fill('11'), price: 0 },
        ];
        const result = reconcileLegacyItemPrices(items, 26400, 0, catalogUnitPrice);
        expect(result[0].price).toBe(825);
        expect(result[1].price).toBe(275);
        expect(result[0].price / result[1].price).toBe(CATALOG['Zr Preshade'] / CATALOG['Framework Ni-Cr Printed']);
        expect(subtotal(result)).toBe(26400);
    });

    it('reconciles to the stored total to the piaster when the split does not divide evenly', () => {
        const items = [
            { serviceType: 'Emax Press Ivoclar Ant', teethNumbers: ['13', '12', '21', '22', '23'], price: 0 },
            { serviceType: 'Zircomax', teethNumbers: ['11'], price: 0 },
            { serviceType: 'Custom Abutment Ti', teethNumbers: ['11'], price: 0 },
        ];
        const result = reconcileLegacyItemPrices(items, 7850, 0, catalogUnitPrice);
        expect(subtotal(result)).toBe(7850);
        // every line stays below its current catalog price, in proportion
        expect(result[0].price).toBeLessThan(CATALOG['Emax Press Ivoclar Ant']);
        expect(result[1].price).toBeLessThan(CATALOG['Zircomax']);
        expect(result[2].price).toBeLessThan(CATALOG['Custom Abutment Ti']);
    });

    it('only distributes what the already-priced lines left behind', () => {
        const items = [
            { serviceType: 'Emax Press Ivoclar Ant', teethNumbers: ['13', '12', '21', '22', '23', '11'], price: 1150 },
            { serviceType: 'Zircomax', teethNumbers: ['21'], price: 0 },
        ];
        const result = reconcileLegacyItemPrices(items, 7900, 0, catalogUnitPrice);
        expect(result[0].price).toBe(1150);
        expect(result[1].price).toBe(1000);
        expect(subtotal(result)).toBe(7900);
    });

    it('falls back to an even per-tooth split when no catalog price is known', () => {
        const items = [
            { serviceType: 'Retired Service A', teethNumbers: ['11', '12'], price: 0 },
            { serviceType: 'Retired Service B', teethNumbers: ['21'], price: 0 },
        ];
        const result = reconcileLegacyItemPrices(items, 900, 0, catalogUnitPrice);
        expect(result[0].price).toBe(300);
        expect(result[1].price).toBe(300);
        expect(subtotal(result)).toBe(900);
    });

    it('leaves a genuinely zero-priced order at zero instead of inventing revenue', () => {
        const items = [
            { serviceType: 'Zircomax', teethNumbers: ['11'], price: 0 },
        ];
        const result = reconcileLegacyItemPrices(items, 0, 0, catalogUnitPrice);
        expect(result[0].price).toBe(0);
        expect(subtotal(result)).toBe(0);
    });
});
