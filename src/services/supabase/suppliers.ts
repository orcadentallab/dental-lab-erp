import { supabase } from '../../lib/supabase';
import type { DbSupplier, DbSupplierInsert, DbSupplierUpdate } from './types';
import type { Supplier } from '../db';
import { SupplierCreateSchema, formatValidationError } from '../../lib/validation';
import { ErrorHandler, ValidationError } from '../../lib/errorHandler';

function dbToSupplier(dbSupplier: DbSupplier): Supplier {
    return {
        id: dbSupplier.id,
        name: dbSupplier.name,
        username: dbSupplier.username || '',
        phone: dbSupplier.phone,
        customPrices: dbSupplier.custom_prices || undefined,
        millingPrices: dbSupplier.milling_prices || undefined,
        redoCostPercentage: dbSupplier.redo_cost_percentage || undefined
    };
}

function supplierToDb(supplier: Omit<Supplier, 'id'>): DbSupplierInsert {
    return {
        name: supplier.name,
        username: supplier.username,
        phone: supplier.phone,
        custom_prices: supplier.customPrices || null,
        milling_prices: supplier.millingPrices || null,
        redo_cost_percentage: supplier.redoCostPercentage || null
    };
}

export async function getSuppliers(): Promise<Supplier[]> {
    const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .order('name', { ascending: true });

    if (error) {
        throw ErrorHandler.handle(error, 'getSuppliers');
    }
    return (data || []).map(dbToSupplier);
}

export async function addSupplier(supplier: Omit<Supplier, 'id'>): Promise<Supplier> {
    // Validate input
    try {
        SupplierCreateSchema.parse(supplier);
    } catch (error: unknown) {
        throw new ValidationError(formatValidationError(error));
    }

    const dbSupplier = supplierToDb(supplier);
    const { data, error } = await supabase
        .from('suppliers')
        .insert(dbSupplier)
        .select()
        .single();

    if (error) {
        throw ErrorHandler.handle(error, 'addSupplier');
    }
    return dbToSupplier(data);
}

export async function updateSupplier(id: string, updates: Partial<Supplier>): Promise<Supplier | null> {
    const dbUpdates: DbSupplierUpdate = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.username !== undefined) dbUpdates.username = updates.username;
    if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
    if (updates.customPrices !== undefined) dbUpdates.custom_prices = updates.customPrices;
    if (updates.millingPrices !== undefined) dbUpdates.milling_prices = updates.millingPrices;
    if (updates.redoCostPercentage !== undefined) dbUpdates.redo_cost_percentage = updates.redoCostPercentage;

    const { data, error } = await supabase
        .from('suppliers')
        .update(dbUpdates)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw ErrorHandler.handle(error, 'updateSupplier');
    }
    return data ? dbToSupplier(data) : null;
}
