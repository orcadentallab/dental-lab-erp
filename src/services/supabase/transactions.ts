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
        status: dbTx.status || (dbTx.is_approved ? 'approved' : 'pending'), // Fallback for backward compatibility
        effectiveDate: dbTx.effective_date || undefined,
        cashboxId: dbTx.cashbox_id || undefined,
        linkedTransactionId: dbTx.linked_transaction_id || undefined,
        isSystemGeneratedFee: dbTx.is_system_generated_fee || undefined,
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
        is_approved: tx.status === 'approved' || tx.isApproved || false,
        status: tx.status || (tx.isApproved ? 'approved' : 'pending'),
        effective_date: tx.effectiveDate || null,
        cashbox_id: tx.cashboxId || null,
        linked_transaction_id: tx.linkedTransactionId || null,
        is_system_generated_fee: tx.isSystemGeneratedFee || false,
    };
}

export async function getTransactions(): Promise<Transaction[]> {
    let allData: DbTransaction[] = [];
    let from = 0;
    const limit = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .order('date', { ascending: false })
            .range(from, from + limit - 1);

        if (error) {
            throw ErrorHandler.handle(error, 'getTransactions');
        }

        allData = allData.concat((data || []) as unknown as DbTransaction[]);
        if (!data || data.length < limit) {
            hasMore = false;
        } else {
            from += limit;
        }
    }

    return allData.map(dbToTransaction);
}

/**
 * LIGHTWEIGHT fetch for Finance Summary (Accounts Page)
 */
interface FinanceSummaryTxDbRow {
    id: string;
    entity_id: string | null;
    entity_type: string | null;
    type: 'income' | 'expense';
    amount: number;
    date: string;
}

export async function getTransactionsForFinanceSummary(): Promise<Partial<Transaction>[]> {
    let allData: FinanceSummaryTxDbRow[] = [];
    let from = 0;
    const limit = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabase
            .from('transactions')
            .select('id, entity_id, entity_type, type, amount, date')
            .order('date', { ascending: false })
            .range(from, from + limit - 1);

        if (error) throw ErrorHandler.handle(error, 'getTransactionsForFinanceSummary');

        allData = allData.concat((data || []) as unknown as FinanceSummaryTxDbRow[]);
        if (!data || data.length < limit) {
            hasMore = false;
        } else {
            from += limit;
        }
    }

    // Map to Partial<Transaction>
    return allData.map(t => ({
        id: t.id,
        entityId: t.entity_id || undefined,
        entityType: (t.entity_type || undefined) as Transaction['entityType'],
        type: t.type,
        amount: t.amount,
        date: t.date
    }));
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
    if (updates.status !== undefined) {
        dbUpdates.status = updates.status;
        // Sync is_approved for backward compatibility logic
        if (updates.status === 'approved') dbUpdates.is_approved = true;
        if (updates.status === 'pending' || updates.status === 'rejected') dbUpdates.is_approved = false;
    }
    if (updates.effectiveDate !== undefined) dbUpdates.effective_date = updates.effectiveDate || null;
    if (updates.cashboxId !== undefined) dbUpdates.cashbox_id = updates.cashboxId || null;
    if (updates.linkedTransactionId !== undefined) dbUpdates.linked_transaction_id = updates.linkedTransactionId || null;
    if (updates.isSystemGeneratedFee !== undefined) dbUpdates.is_system_generated_fee = updates.isSystemGeneratedFee;

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
