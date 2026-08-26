import { supabase } from '../../lib/supabase';
import { ErrorHandler } from '../../lib/errorHandler';
import type { ServiceFamily } from '../db';

export interface FamilyPriceChange {
    id: string;
    name: string;
    sellingBefore: number;
    sellingAfter: number;
    costBefore: number;
    costAfter: number;
}

export interface FamilyPriceAdjustment {
    /** True when nothing was written and this is only a preview. */
    dryRun: boolean;
    /** Services whose price would change. */
    affected: number;
    /** Services actually written — 0 on a dry run. */
    applied: number;
    services: FamilyPriceChange[];
}

export const serviceFamilyService = {
    /**
     * Get all service families ordered by sort_order / name_ar.
     *
     * Throws on failure. Returning [] here made a broken query render as
     * "this lab has no service families", which is a claim about the
     * business rather than about the request.
     */
    async getFamilies(): Promise<ServiceFamily[]> {
        {
            const { data, error } = await supabase
                .from('service_families')
                .select('*')
                .order('sort_order', { ascending: true, nullsFirst: false })
                .order('name_ar', { ascending: true });

            if (error) throw ErrorHandler.handle(error, 'serviceFamilyService.getFamilies');

            return (data || []).map((row) => ({
                id: row.id,
                nameAr: row.name_ar,
                nameEn: row.name_en || undefined,
                description: row.description || undefined,
                color: row.color || 'emerald',
                defaultServiceId: row.default_service_id || null,
                defaultRouteId: row.default_route_id || null,
                sortOrder: row.sort_order ?? undefined,
                createdAt: row.created_at,
            }));
        }
    },

    /** Create a new service family */
    async createFamily(payload: {
        nameAr: string;
        nameEn?: string;
        description?: string;
        color?: string;
        defaultServiceId?: string | null;
        defaultRouteId?: string | null;
    }): Promise<ServiceFamily> {
        // sort_order defaults to 0 in the table, so every family created
        // through the UI tied on it and the ORDER BY fell through to name_ar,
        // making the column look broken. Append each new family after the
        // current last one instead.
        const { data: lastRow } = await supabase
            .from('service_families')
            .select('sort_order')
            .order('sort_order', { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();

        const nextSortOrder = (Number(lastRow?.sort_order) || 0) + 10;

        const { data, error } = await supabase
            .from('service_families')
            .insert({
                sort_order: nextSortOrder,
                name_ar: payload.nameAr.trim(),
                name_en: payload.nameEn?.trim() || null,
                description: payload.description?.trim() || null,
                color: payload.color || 'emerald',
                default_service_id: payload.defaultServiceId || null,
                default_route_id: payload.defaultRouteId || null,
            })
            .select('*')
            .single();

        if (error) throw ErrorHandler.handle(error, 'serviceFamilyService.createFamily');

        return {
            id: data.id,
            nameAr: data.name_ar,
            nameEn: data.name_en || undefined,
            description: data.description || undefined,
            color: data.color || 'emerald',
            defaultServiceId: data.default_service_id || null,
            defaultRouteId: data.default_route_id || null,
            sortOrder: data.sort_order ?? undefined,
            createdAt: data.created_at,
        };
    },

    /** Update an existing service family */
    async updateFamily(
        id: string,
        updates: Partial<{
            nameAr: string;
            nameEn: string | null;
            description: string | null;
            color: string;
            defaultServiceId: string | null;
            defaultRouteId: string | null;
            sortOrder: number;
        }>
    ): Promise<void> {
        const dbUpdates: Record<string, unknown> = {};
        if (updates.nameAr !== undefined) dbUpdates.name_ar = updates.nameAr.trim();
        if (updates.nameEn !== undefined) dbUpdates.name_en = updates.nameEn?.trim() || null;
        if (updates.description !== undefined) dbUpdates.description = updates.description?.trim() || null;
        if (updates.color !== undefined) dbUpdates.color = updates.color;
        if (updates.defaultServiceId !== undefined) dbUpdates.default_service_id = updates.defaultServiceId;
        if (updates.defaultRouteId !== undefined) dbUpdates.default_route_id = updates.defaultRouteId;
        if (updates.sortOrder !== undefined) dbUpdates.sort_order = updates.sortOrder;

        const { error } = await supabase
            .from('service_families')
            .update(dbUpdates)
            .eq('id', id);

        if (error) throw ErrorHandler.handle(error, 'serviceFamilyService.updateFamily');
    },

    /** Delete a service family (unlinks services) */
    async deleteFamily(id: string): Promise<void> {
        const { error } = await supabase
            .from('service_families')
            .delete()
            .eq('id', id);

        if (error) throw ErrorHandler.handle(error, 'serviceFamilyService.deleteFamily');
    },

    /** Assign or remove a service to/from a family */
    async assignServiceToFamily(serviceId: string, familyId: string | null): Promise<void> {
        const { error } = await supabase
            .from('services')
            .update({ family_id: familyId })
            .eq('id', serviceId);

        if (error) throw ErrorHandler.handle(error, 'serviceFamilyService.assignServiceToFamily');
    },

    /**
     * Reprice every service in a family, in one atomic statement.
     *
     * Previously a read followed by one UPDATE per service: a failure
     * halfway through left part of the catalogue repriced with no record of
     * which part, and no way back to the old prices. The RPC does the whole
     * family or none of it.
     *
     * Pass dryRun to get the exact before/after list without writing, which
     * is what the confirmation step in Services.tsx shows.
     */
    async bulkAdjustPrices(
        familyId: string,
        adjustmentType: 'percentage' | 'fixed',
        adjustmentValue: number,
        targetField: 'sellingPrice' | 'costPrice' | 'both',
        dryRun = false
    ): Promise<FamilyPriceAdjustment> {
        const { data, error } = await supabase.rpc('adjust_family_prices', {
            p_family_id: familyId,
            p_adjustment_type: adjustmentType,
            p_value: adjustmentValue,
            p_target: targetField,
            p_dry_run: dryRun,
        });

        if (error) throw ErrorHandler.handle(error, 'serviceFamilyService.bulkAdjustPrices');

        const raw = (data || {}) as {
            dry_run?: boolean;
            affected?: number;
            applied?: number;
            services?: {
                id: string;
                name: string;
                selling_price_before: number;
                selling_price_after: number;
                cost_price_before: number;
                cost_price_after: number;
            }[];
        };

        return {
            dryRun: Boolean(raw.dry_run),
            affected: Number(raw.affected) || 0,
            applied: Number(raw.applied) || 0,
            services: (raw.services || []).map(row => ({
                id: row.id,
                name: row.name,
                sellingBefore: Number(row.selling_price_before) || 0,
                sellingAfter: Number(row.selling_price_after) || 0,
                costBefore: Number(row.cost_price_before) || 0,
                costAfter: Number(row.cost_price_after) || 0,
            })),
        };
    }
};
