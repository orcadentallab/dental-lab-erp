/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions */
import { supabase } from '../../lib/supabase';
import type { DbService, DbServiceInsert, DbServiceUpdate } from './types';
import type { Service } from '../db';
import { ErrorHandler } from '../../lib/errorHandler';

function dbToService(dbService: DbService): Service {
    return {
        id: dbService.id,
        name: dbService.name,
        sellingPrice: dbService.selling_price,
        costPrice: dbService.cost_price,
        millingPrice: dbService.milling_price ?? undefined,
        sortOrder: (dbService as unknown as Record<string, unknown>).sort_order as number | undefined,
    };
}

function serviceToDb(service: Omit<Service, 'id'>): DbServiceInsert {
    const dbService: any = {
        name: service.name,
        selling_price: service.sellingPrice,
        cost_price: service.costPrice,
    };

    // Only include milling_price if it has a meaningful value
    // This prevents "Column not found" errors if the DB migration hasn't been run
    if (service.millingPrice && service.millingPrice > 0) {
        dbService.milling_price = service.millingPrice;
    }

    return dbService;
}

export async function getServices(): Promise<Service[]> {
    const { data, error } = await supabase
        .from('services')
        .select('*')
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true });

    if (error) {
        throw ErrorHandler.handle(error, 'getServices');
    }

    return (data || []).map(dbToService);
}

export async function addService(service: Omit<Service, 'id'>): Promise<Service> {
    const dbService = serviceToDb(service);
    const { data, error } = await supabase
        .from('services')
        .insert(dbService)
        .select()
        .single();

    if (error) {
        throw ErrorHandler.handle(error, 'addService');
    }

    return dbToService(data);
}

export async function updateService(id: string, updates: Partial<Omit<Service, 'id'>>): Promise<Service | null> {
    const dbUpdates: DbServiceUpdate = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.sellingPrice !== undefined) dbUpdates.selling_price = updates.sellingPrice;
    if (updates.costPrice !== undefined) dbUpdates.cost_price = updates.costPrice;
    if (updates.millingPrice !== undefined) dbUpdates.milling_price = updates.millingPrice;
    if ((updates as Service).sortOrder !== undefined) (dbUpdates as Record<string, unknown>).sort_order = (updates as Service).sortOrder;

    const { data, error } = await supabase
        .from('services')
        .update(dbUpdates)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw ErrorHandler.handle(error, 'updateService');
    }

    return data ? dbToService(data) : null;
}

export async function deleteService(id: string): Promise<void> {
    const { error } = await supabase
        .from('services')
        .delete()
        .eq('id', id);

    if (error) {
        throw ErrorHandler.handle(error, 'deleteService');
    }
}

export async function bulkUpsertServices(services: Service[]): Promise<number> {
    const dbServices = services.map(service => {
        const dbService = serviceToDb(service);
        return {
            ...dbService,
            id: service.id, // Include ID for upsert
        };
    });

    const { data, error } = await supabase
        .from('services')
        .upsert(dbServices, { onConflict: 'id' })
        .select('id');

    if (error) {
        throw ErrorHandler.handle(error, 'bulkUpsertServices');
    }

    return data?.length || 0;
}

/**
 * Saves a new display order for all services by updating sort_order.
 * Uses individual updates to avoid partial-upsert issues with NOT NULL constraints.
 * @param orderedIds - Array of service IDs in the desired display order
 */
export async function reorderServices(orderedIds: string[]): Promise<void> {
    const promises = orderedIds.map((id, index) =>
        supabase
            .from('services')
            .update({ sort_order: (index + 1) * 10 })
            .eq('id', id)
    );

    const results = await Promise.all(promises);
    const failed = results.find(r => r.error);
    if (failed?.error) {
        throw ErrorHandler.handle(failed.error, 'reorderServices');
    }
}

