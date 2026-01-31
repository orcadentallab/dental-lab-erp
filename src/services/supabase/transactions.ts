import { supabase } from '../../lib/supabase';
import type { DbTransaction, DbTransactionInsert, DbTransactionUpdate } from './types';
import type { Transaction } from '../db';
import { TransactionCreateSchema, formatValidationError } from '../../lib/validation';
import { ErrorHandler, ValidationError } from '../../lib/errorHandler';

// Transform database record to application format
function dbToTransaction(dbTx: DbTransaction): Transaction {
    return {
        id: dbTx.id,
        type: dbTx.type,
        amount: dbTx.amount,
        category: dbTx.category,
        date: dbTx.date,
        description: dbTx.description,
        entityId: dbTx.entity_id || undefined,
        entityType: dbTx.entity_type || undefined,
        isRegistered: dbTx.is_registered || undefined,
        isApproved: dbTx.is_approved || undefined,
        createdAt: dbTx.created_at,
    };
}

// Transform application format to database format
function transactionToDb(tx: Omit<Transaction, 'id'>): DbTransactionInsert {
    return {
        type: tx.type,
        amount: tx.amount,
        category: tx.category,
        date: tx.date,
        description: tx.description,
        entity_id: tx.entityId || null,
        entity_type: tx.entityType || null,
        is_registered: tx.isRegistered || false,
        is_approved: tx.isApproved || false,
    };
}

export async function getTransactions(): Promise<Transaction[]> {
    const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('date', { ascending: false });

    if (error) {
        throw ErrorHandler.handle(error, 'getTransactions');
    }

    return (data || []).map(dbToTransaction);
}

export async function getTransaction(id: string): Promise<Transaction | null> {
    const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw ErrorHandler.handle(error, 'getTransaction');
    }

    return data ? dbToTransaction(data) : null;
}

export async function addTransaction(tx: Omit<Transaction, 'id'>): Promise<Transaction> {
    // Validate input
    try {
        TransactionCreateSchema.parse(tx);
    } catch (error: unknown) {
        throw new ValidationError(formatValidationError(error));
    }

    const dbTx = transactionToDb(tx);

    const { data, error } = await supabase
        .from('transactions')
        .insert(dbTx)
        .select()
        .single();

    if (error) {
        throw ErrorHandler.handle(error, 'addTransaction');
    }

    return dbToTransaction(data);
}

export async function updateTransaction(id: string, updates: Partial<Transaction>): Promise<Transaction | null> {
    const dbUpdates: DbTransactionUpdate = {};

    if (updates.type !== undefined) dbUpdates.type = updates.type;
    if (updates.amount !== undefined) dbUpdates.amount = updates.amount;
    if (updates.category !== undefined) dbUpdates.category = updates.category;
    if (updates.date !== undefined) dbUpdates.date = updates.date;
    if (updates.description !== undefined) dbUpdates.description = updates.description;
    if (updates.entityId !== undefined) dbUpdates.entity_id = updates.entityId || null;
    if (updates.entityType !== undefined) dbUpdates.entity_type = updates.entityType || null;
    if (updates.isRegistered !== undefined) dbUpdates.is_registered = updates.isRegistered;
    if (updates.isApproved !== undefined) dbUpdates.is_approved = updates.isApproved;

    const { data, error } = await supabase
        .from('transactions')
        .update(dbUpdates)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw ErrorHandler.handle(error, 'updateTransaction');
    }

    return data ? dbToTransaction(data) : null;
}

export async function deleteTransaction(id: string): Promise<void> {
    const { error } = await supabase
        .from('transactions')
        .delete()
        .eq('id', id);

    if (error) {
        throw ErrorHandler.handle(error, 'deleteTransaction');
    }
}

export async function bulkUpsertTransactions(transactions: Transaction[]): Promise<number> {
    const dbTransactions = transactions.map(tx => {
        const dbTx = transactionToDb(tx);
        return {
            ...dbTx,
            id: tx.id, // Include ID for upsert
        };
    });

    const { data, error } = await supabase
        .from('transactions')
        .upsert(dbTransactions, { onConflict: 'id' })
        .select('id');

    if (error) {
        throw ErrorHandler.handle(error, 'bulkUpsertTransactions');
    }

    return data?.length || 0;
}
