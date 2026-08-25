import { supabase } from '../../lib/supabase';
import { ErrorHandler } from '../../lib/errorHandler';
import type { ServiceFamily } from '../db';

export const serviceFamilyService = {
    /** Get all service families ordered by sort_order / name_ar */
    async getFamilies(): Promise<ServiceFamily[]> {
        try {
            const { data, error } = await supabase
                .from('service_families')
                .select('*')
                .order('sort_order', { ascending: true, nullsFirst: false })
                .order('name_ar', { ascending: true });

            if (error) {
                console.warn('[serviceFamilyService] Table may not exist or error:', error.message);
                return [];
            }

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
        } catch (err) {
            console.warn('[serviceFamilyService] Exception fetching families:', err);
            return [];
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
        const { data, error } = await supabase
            .from('service_families')
            .insert({
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

    /** Bulk adjust prices for all services in a family */
    async bulkAdjustPrices(
        familyId: string,
        adjustmentType: 'percentage' | 'fixed',
        adjustmentValue: number,
        targetField: 'sellingPrice' | 'costPrice' | 'both'
    ): Promise<void> {
        // Fetch all services in this family
        const { data: services, error: fetchErr } = await supabase
            .from('services')
            .select('id, selling_price, cost_price')
            .eq('family_id', familyId);

        if (fetchErr) throw ErrorHandler.handle(fetchErr, 'serviceFamilyService.bulkAdjustPrices.fetch');
        if (!services || services.length === 0) return;

        for (const s of services) {
            const updates: Record<string, number> = {};

            if (targetField === 'sellingPrice' || targetField === 'both') {
                const current = Number(s.selling_price || 0);
                const nextVal = adjustmentType === 'percentage'
                    ? Math.max(0, Math.round(current * (1 + adjustmentValue / 100)))
                    : Math.max(0, current + adjustmentValue);
                updates.selling_price = nextVal;
            }

            if (targetField === 'costPrice' || targetField === 'both') {
                const current = Number(s.cost_price || 0);
                const nextVal = adjustmentType === 'percentage'
                    ? Math.max(0, Math.round(current * (1 + adjustmentValue / 100)))
                    : Math.max(0, current + adjustmentValue);
                updates.cost_price = nextVal;
            }

            if (Object.keys(updates).length > 0) {
                const { error: updateErr } = await supabase
                    .from('services')
                    .update(updates)
                    .eq('id', s.id);
                if (updateErr) throw ErrorHandler.handle(updateErr, 'serviceFamilyService.bulkAdjustPrices.update');
            }
        }
    }
};
