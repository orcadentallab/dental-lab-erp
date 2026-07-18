import { supabase } from '../../lib/supabase';
import type { DbDoctor, DbDoctorInsert, DbDoctorUpdate } from './types';
import type { Doctor } from '../db';
import { DoctorCreateSchema, DoctorUpdateSchema, formatValidationError } from '../../lib/validation';
import { ErrorHandler, ValidationError } from '../../lib/errorHandler';

// Transform database record to application format (snake_case -> camelCase)
function dbToDoctor(dbDoctor: DbDoctor): Doctor {
    return {
        id: dbDoctor.id,
        name: dbDoctor.name,
        phone: dbDoctor.phone,
        phone2: dbDoctor.phone2 || undefined,
        address: dbDoctor.address,
        doctorCode: dbDoctor.doctor_code,
        representativeName: dbDoctor.representative_name,
        representativeId: dbDoctor.representative_id || undefined,
        customPrices: dbDoctor.custom_prices || undefined,
        isCenter: dbDoctor.is_center || false,
        parentId: dbDoctor.parent_id || undefined,
        hasBranches: dbDoctor.has_branches || false,
        branches: dbDoctor.branches ? (dbDoctor.branches as import('../db').DoctorBranch[]) : undefined,
    };
}

// Transform application format to database format (camelCase -> snake_case)
function doctorToDb(doctor: Omit<Doctor, 'id'>): DbDoctorInsert {
    return {
        name: doctor.name,
        phone: doctor.phone,
        phone2: doctor.phone2 || null,
        address: doctor.address,
        doctor_code: doctor.doctorCode,
        representative_name: doctor.representativeName,
        representative_id: doctor.representativeId || null,
        custom_prices: doctor.customPrices || null,
        is_center: doctor.isCenter || false,
        parent_id: doctor.parentId || null,
        has_branches: doctor.hasBranches || false,
        branches: doctor.branches ? (doctor.branches as unknown as DbDoctorInsert['branches']) : null,
    };
}

import { generateArabicSearchPattern } from '../../lib/searchUtils';

// ... (existing code)

export async function getDoctors(search?: string): Promise<Doctor[]> {
    let query = supabase
        .from('doctors')
        .select('*')
        .order('name', { ascending: true });

    // Only apply search if provided
    if (search && search.trim()) {
        const regexBuilder = generateArabicSearchPattern(search.trim());
        const regex = `"${regexBuilder}"`;
        query = query.or(`name.imatch.${regex},doctor_code.imatch.${regex}`);
        query = query.limit(20);
    }

    const { data, error } = await query;


    if (error) {
        throw ErrorHandler.handle(error, 'getDoctors');
    }

    return (data || []).map(dbToDoctor);
}

export async function getDoctor(id: string): Promise<Doctor | null> {
    // Validate UUID
    if (!id || typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new ValidationError('معرف الطبيب غير صحيح');
    }

    const { data, error } = await supabase
        .from('doctors')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw ErrorHandler.handle(error, 'getDoctor');
    }

    return data ? dbToDoctor(data) : null;
}

export async function addDoctor(doctor: Omit<Doctor, 'id'>): Promise<Doctor> {
    // Validate input
    try {
        DoctorCreateSchema.parse(doctor);
    } catch (error: unknown) {
        throw new ValidationError(formatValidationError(error));
    }

    const dbDoctor = doctorToDb(doctor);

    const { data, error } = await supabase
        .from('doctors')
        .insert(dbDoctor)
        .select()
        .single();

    if (error) {
        throw ErrorHandler.handle(error, 'addDoctor');
    }

    return dbToDoctor(data);
}

export async function updateDoctor(id: string, updates: Partial<Doctor>): Promise<Doctor | null> {
    // Validate UUID
    if (!id || typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new ValidationError('معرف الطبيب غير صحيح');
    }

    // Validate updates if provided
    if (Object.keys(updates).length > 0) {
        try {
            DoctorUpdateSchema.parse({ id, ...updates });
        } catch (error: unknown) {
            throw new ValidationError(formatValidationError(error));
        }
    }

    // Check branch edits/deletions if updates.branches is provided
    const branchRenames: { oldName: string; newName: string }[] = [];
    if (updates.branches !== undefined) {
        // Fetch current doctor to compare branches
        const currentDoctor = await getDoctor(id);
        if (currentDoctor) {
            const oldBranches = currentDoctor.branches || [];
            const newBranches = updates.branches || [];

            // 1. Check for deleted branches
            for (const oldB of oldBranches) {
                const stillExists = newBranches.some(b => b.id === oldB.id);
                if (!stillExists) {
                    // Check if this branch is used in any orders
                    const { count, error: countErr } = await supabase
                        .from('orders')
                        .select('id', { count: 'exact', head: true })
                        .eq('doctor_id', id)
                        .eq('branch_name', oldB.name)
                        // Orders are soft-deleted, so deleted records must not
                        // prevent a branch from being removed.
                        .or('is_deleted.eq.false,is_deleted.is.null');

                    if (countErr) {
                        throw ErrorHandler.handle(countErr, 'checkBranchUsage');
                    }

                    if (count && count > 0) {
                        throw new ValidationError(`لا يمكن حذف الفرع "${oldB.name}" لارتباطه بطلبات مسجلة بالفعل`);
                    }
                }
            }

            // 2. Check for renamed branches
            for (const newB of newBranches) {
                const oldB = oldBranches.find(b => b.id === newB.id);
                if (oldB && oldB.name !== newB.name) {
                    // We need to rename the branch in old orders
                    branchRenames.push({ oldName: oldB.name, newName: newB.name });
                }
            }
        }
    }

    const dbUpdates: DbDoctorUpdate = {};

    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
    if (updates.phone2 !== undefined) dbUpdates.phone2 = updates.phone2 || null;
    if (updates.address !== undefined) dbUpdates.address = updates.address;
    if (updates.doctorCode !== undefined) dbUpdates.doctor_code = updates.doctorCode;
    if (updates.representativeName !== undefined) dbUpdates.representative_name = updates.representativeName;
    if (updates.representativeId !== undefined) dbUpdates.representative_id = updates.representativeId || null;
    if (updates.customPrices !== undefined) dbUpdates.custom_prices = updates.customPrices || null;
    if (updates.isCenter !== undefined) dbUpdates.is_center = updates.isCenter;
    if (updates.parentId !== undefined) dbUpdates.parent_id = updates.parentId || null;
    if (updates.hasBranches !== undefined) dbUpdates.has_branches = updates.hasBranches;
    if (updates.branches !== undefined) dbUpdates.branches = updates.branches ? (updates.branches as unknown as DbDoctorUpdate['branches']) : null;

    const { data, error } = await supabase
        .from('doctors')
        .update(dbUpdates)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw ErrorHandler.handle(error, 'updateDoctor');
    }

    // Apply branch name changes to old orders
    for (const rename of branchRenames) {
        const { error: renameErr } = await supabase
            .from('orders')
            .update({ branch_name: rename.newName })
            .eq('doctor_id', id)
            .eq('branch_name', rename.oldName);

        if (renameErr) {
            console.error(`Failed to update branch name from "${rename.oldName}" to "${rename.newName}":`, renameErr);
        }
    }

    return data ? dbToDoctor(data) : null;
}

export async function deleteDoctor(id: string): Promise<void> {
    // Validate UUID
    if (!id || typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new ValidationError('معرف الطبيب غير صحيح');
    }

    const { error } = await supabase
        .from('doctors')
        .delete()
        .eq('id', id);

    if (error) {
        throw ErrorHandler.handle(error, 'deleteDoctor');
    }
}

export async function bulkUpsertDoctors(doctors: Doctor[]): Promise<number> {
    const dbDoctors = doctors.map(doctor => {
        const dbDoctor = doctorToDb(doctor);
        return {
            ...dbDoctor,
            id: doctor.id, // Include ID for upsert
        };
    });

    const { data, error } = await supabase
        .from('doctors')
        .upsert(dbDoctors, { onConflict: 'id' })
        .select('id');

    if (error) {
        throw ErrorHandler.handle(error, 'bulkUpsertDoctors');
    }

    return data?.length || 0;
}
