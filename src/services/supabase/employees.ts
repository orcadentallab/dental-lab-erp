import { supabase } from '../../lib/supabase';
import type {
    DbEmployeeAdvance,
    DbEmployeeAdvanceInsert,
    DbEmployeeAdvanceUpdate,
    DbEmployeeCustody,
    DbEmployeeCustodyInsert,
    DbEmployeeCustodyUpdate,
    DbEmployeeCommission,
    DbEmployeeCommissionInsert
} from './types';
import type { EmployeeAdvance, EmployeeCustody, EmployeeCommission } from '../db';
import { ErrorHandler } from '../../lib/errorHandler';

// --- Advances Mappings ---
function dbToAdvance(db: DbEmployeeAdvance): EmployeeAdvance {
    return {
        id: db.id,
        employeeId: db.employee_id,
        amount: Number(db.amount),
        reason: db.reason,
        date: db.date,
        status: db.status,
        createdBy: db.created_by || undefined,
        createdAt: db.created_at
    };
}

function advanceToDb(val: Omit<EmployeeAdvance, 'id' | 'createdAt'>): DbEmployeeAdvanceInsert {
    return {
        employee_id: val.employeeId,
        amount: val.amount,
        reason: val.reason,
        date: val.date,
        status: val.status,
        created_by: val.createdBy || null
    };
}

// --- Custody Mappings ---
function dbToCustody(db: DbEmployeeCustody): EmployeeCustody {
    return {
        id: db.id,
        employeeId: db.employee_id,
        description: db.description,
        amount: db.amount !== null && db.amount !== undefined ? Number(db.amount) : null,
        item: db.item || null,
        dateGiven: db.date_given,
        dateReturned: db.date_returned || null,
        status: db.status,
        notes: db.notes || null,
        createdBy: db.created_by || undefined,
        createdAt: db.created_at
    };
}

function custodyToDb(val: Omit<EmployeeCustody, 'id' | 'createdAt'>): DbEmployeeCustodyInsert {
    return {
        employee_id: val.employeeId,
        description: val.description,
        amount: val.amount ?? null,
        item: val.item ?? null,
        date_given: val.dateGiven,
        date_returned: val.dateReturned ?? null,
        status: val.status,
        notes: val.notes ?? null,
        created_by: val.createdBy || null
    };
}

// --- Commissions Mappings ---
function dbToCommission(db: DbEmployeeCommission): EmployeeCommission {
    return {
        id: db.id,
        employeeId: db.employee_id,
        amount: Number(db.amount),
        date: db.date,
        period: db.period,
        note: db.note || null,
        createdBy: db.created_by || undefined,
        createdAt: db.created_at
    };
}

function commissionToDb(val: Omit<EmployeeCommission, 'id' | 'createdAt'>): DbEmployeeCommissionInsert {
    return {
        employee_id: val.employeeId,
        amount: val.amount,
        date: val.date,
        period: val.period,
        note: val.note || null,
        created_by: val.createdBy || null
    };
}

// --- API Methods ---

export async function getEmployeeAdvances(employeeId?: string): Promise<EmployeeAdvance[]> {
    try {
        let query = supabase.from('employee_advances').select('*');
        if (employeeId) {
            query = query.eq('employee_id', employeeId);
        }
        const { data, error } = await query.order('date', { ascending: false });
        if (error) throw error;
        return (data || []).map(dbToAdvance);
    } catch (error) {
        throw ErrorHandler.handle(error, 'getEmployeeAdvances');
    }
}

export async function addEmployeeAdvance(advance: Omit<EmployeeAdvance, 'id' | 'createdAt'>): Promise<void> {
    try {
        const dbVal = advanceToDb(advance);
        const { error } = await supabase.from('employee_advances').insert(dbVal);
        if (error) throw error;
    } catch (error) {
        throw ErrorHandler.handle(error, 'addEmployeeAdvance');
    }
}

export async function updateEmployeeAdvance(id: string, updates: Partial<EmployeeAdvance>): Promise<void> {
    try {
        const dbUpdates: DbEmployeeAdvanceUpdate = {};
        if (updates.status !== undefined) dbUpdates.status = updates.status;
        if (updates.reason !== undefined) dbUpdates.reason = updates.reason;
        if (updates.amount !== undefined) dbUpdates.amount = updates.amount;
        if (updates.date !== undefined) dbUpdates.date = updates.date;

        const { error } = await supabase.from('employee_advances').update(dbUpdates).eq('id', id);
        if (error) throw error;
    } catch (error) {
        throw ErrorHandler.handle(error, 'updateEmployeeAdvance');
    }
}

export async function getEmployeeCustodies(employeeId?: string): Promise<EmployeeCustody[]> {
    try {
        let query = supabase.from('employee_custody').select('*');
        if (employeeId) {
            query = query.eq('employee_id', employeeId);
        }
        const { data, error } = await query.order('date_given', { ascending: false });
        if (error) throw error;
        return (data || []).map(dbToCustody);
    } catch (error) {
        throw ErrorHandler.handle(error, 'getEmployeeCustodies');
    }
}

export async function addEmployeeCustody(custody: Omit<EmployeeCustody, 'id' | 'createdAt'>): Promise<void> {
    try {
        const dbVal = custodyToDb(custody);
        const { error } = await supabase.from('employee_custody').insert(dbVal);
        if (error) throw error;
    } catch (error) {
        throw ErrorHandler.handle(error, 'addEmployeeCustody');
    }
}

export async function updateEmployeeCustody(id: string, updates: Partial<EmployeeCustody>): Promise<void> {
    try {
        const dbUpdates: DbEmployeeCustodyUpdate = {};
        if (updates.status !== undefined) dbUpdates.status = updates.status;
        if (updates.dateReturned !== undefined) dbUpdates.date_returned = updates.dateReturned;
        if (updates.notes !== undefined) dbUpdates.notes = updates.notes;

        const { error } = await supabase.from('employee_custody').update(dbUpdates).eq('id', id);
        if (error) throw error;
    } catch (error) {
        throw ErrorHandler.handle(error, 'updateEmployeeCustody');
    }
}

export async function getEmployeeCommissions(employeeId?: string, period?: string): Promise<EmployeeCommission[]> {
    try {
        let query = supabase.from('employee_commissions').select('*');
        if (employeeId) {
            query = query.eq('employee_id', employeeId);
        }
        if (period) {
            query = query.eq('period', period);
        }
        const { data, error } = await query.order('date', { ascending: false });
        if (error) throw error;
        return (data || []).map(dbToCommission);
    } catch (error) {
        throw ErrorHandler.handle(error, 'getEmployeeCommissions');
    }
}

export async function addEmployeeCommission(commission: Omit<EmployeeCommission, 'id' | 'createdAt'>): Promise<void> {
    try {
        const dbVal = commissionToDb(commission);
        const { error } = await supabase.from('employee_commissions').insert(dbVal);
        if (error) throw error;
    } catch (error) {
        throw ErrorHandler.handle(error, 'addEmployeeCommission');
    }
}

export async function deleteEmployeeCommission(id: string): Promise<void> {
    try {
        const { error } = await supabase.from('employee_commissions').delete().eq('id', id);
        if (error) throw error;
    } catch (error) {
        throw ErrorHandler.handle(error, 'deleteEmployeeCommission');
    }
}
