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
    };
}

export async function getDoctors(search?: string): Promise<Doctor[]> {
    let query = supabase
        .from('doctors')
        .select('*')
        .order('name', { ascending: true });

    query = query.or(`name.ilike.%${search}%,doctor_code.ilike.%${search}%`);

    // Limit results if searching to avoid huge payloads
    if (search) {
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

    const dbUpdates: DbDoctorUpdate = {};

    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
    if (updates.phone2 !== undefined) dbUpdates.phone2 = updates.phone2 || null;
    if (updates.address !== undefined) dbUpdates.address = updates.address;
    if (updates.doctorCode !== undefined) dbUpdates.doctor_code = updates.doctorCode;
    if (updates.representativeName !== undefined) dbUpdates.representative_name = updates.representativeName;
    if (updates.representativeId !== undefined) dbUpdates.representative_id = updates.representativeId || null;

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
