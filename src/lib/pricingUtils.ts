import type { Doctor, Service } from '../services/db';

export function getPricingDoctor(doctor: Doctor | undefined | null, doctors: Doctor[]): Doctor | undefined {
    if (!doctor) return undefined;
    if (!doctor.parentId) return doctor;
    return doctors.find(d => d.id === doctor.parentId) || doctor;
}

export function getDoctorServicePrice(
    serviceName: string,
    service: Service | undefined,
    doctor: Doctor | undefined | null,
    doctors: Doctor[]
): number {
    const pricingDoctor = getPricingDoctor(doctor, doctors);
    return pricingDoctor?.customPrices?.[serviceName] ?? service?.sellingPrice ?? 0;
}

export interface PricedOrderItem {
    serviceType: string;
    teethNumbers: string[];
    price: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Rebuilds the unit prices of legacy order items that were persisted with
 * `price = 0` (orders created between 2026-01-31 and 2026-04-06, before the
 * create path started resolving a per-item unit price).
 *
 * Without this, reopening such an order finds no stored price and falls back to
 * TODAY's catalog price, so an order saved at 7,850 reads back as 8,100.
 *
 * The order's stored total is authoritative and is never changed: what is left
 * after the already-priced lines is split across the unpriced ones in
 * proportion to their relative catalog weight (unit price x teeth), so an
 * expensive service keeps a bigger share than a cheap one. The line with the
 * fewest teeth absorbs the rounding residual, which keeps
 * `SUM(price x teeth) - discount === storedTotal` exact to the piaster.
 *
 * Mirrors supabase/migrations/20260823004000_backfill_legacy_order_item_prices.sql
 * so the reconstructed prices are identical before and after that backfill runs.
 */
export function reconcileLegacyItemPrices<T extends PricedOrderItem>(
    items: T[],
    storedTotal: number,
    discount: number,
    catalogUnitPrice: (serviceType: string) => number
): T[] {
    const teethCount = (item: T): number => item.teethNumbers?.length ?? 0;
    const unpriced = items
        .map((_item, index) => index)
        .filter(index => !(items[index].price > 0) && teethCount(items[index]) > 0);
    if (unpriced.length === 0) return items;

    const knownTotal = items.reduce(
        (sum, item) => sum + (item.price > 0 ? item.price * teethCount(item) : 0),
        0
    );
    const target = round2(storedTotal + discount - knownTotal);
    if (!(target > 0)) return items;

    const catalogWeight = (index: number) => catalogUnitPrice(items[index].serviceType) * teethCount(items[index]);
    const hasCatalogWeights = unpriced.reduce((sum, index) => sum + catalogWeight(index), 0) > 0;
    const weight = (index: number) => (hasCatalogWeights ? catalogWeight(index) : teethCount(items[index]));
    const weightSum = unpriced.reduce((sum, index) => sum + weight(index), 0);
    if (!(weightSum > 0)) return items;

    const absorber = unpriced.reduce((best, index) => {
        if (teethCount(items[index]) < teethCount(items[best])) return index;
        if (teethCount(items[index]) === teethCount(items[best]) && weight(index) > weight(best)) return index;
        return best;
    }, unpriced[0]);

    const result = [...items];
    let allocated = 0;
    for (const index of unpriced) {
        if (index === absorber) continue;
        const unit = round2(target * weight(index) / weightSum / teethCount(items[index]));
        allocated = round2(allocated + unit * teethCount(items[index]));
        result[index] = { ...result[index], price: unit };
    }
    result[absorber] = {
        ...result[absorber],
        price: round2((target - allocated) / teethCount(items[absorber]))
    };
    return result;
}
