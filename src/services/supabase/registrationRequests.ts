import { supabase } from '../../lib/supabase';
import { addDoctor } from './doctors';
import type { Doctor } from '../db';

export interface RegistrationRequest {
    id: string;
    name: string;
    phone: string;
    phone2?: string;
    address: string;
    email: string;
    clinicName?: string;
    status: 'pending' | 'approved' | 'rejected';
    doctorId?: string;
    userId?: string;
    adminNotes?: string;
    reviewedBy?: string;
    reviewedAt?: string;
    createdAt: string;
}

interface DbRegistrationRequest {
    id: string;
    name: string;
    phone: string;
    phone2: string | null;
    address: string;
    email: string;
    clinic_name: string | null;
    status: 'pending' | 'approved' | 'rejected';
    doctor_id: string | null;
    user_id: string | null;
    admin_notes: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    created_at: string;
}

function dbToRequest(db: DbRegistrationRequest): RegistrationRequest {
    return {
        id: db.id,
        name: db.name,
        phone: db.phone,
        phone2: db.phone2 || undefined,
        address: db.address,
        email: db.email,
        clinicName: db.clinic_name || undefined,
        status: db.status,
        doctorId: db.doctor_id || undefined,
        userId: db.user_id || undefined,
        adminNotes: db.admin_notes || undefined,
        reviewedBy: db.reviewed_by || undefined,
        reviewedAt: db.reviewed_at || undefined,
        createdAt: db.created_at,
    };
}

// Public: Create a new registration request
export async function createRegistrationRequest(data: {
    name: string;
    phone: string;
    phone2?: string;
    address: string;
    email: string;
    clinicName?: string;
}): Promise<RegistrationRequest> {
    const { data: result, error } = await supabase
        .from('doctor_registration_requests')
        .insert({
            name: data.name,
            phone: data.phone,
            phone2: data.phone2 || null,
            address: data.address,
            email: data.email,
            clinic_name: data.clinicName || null,
        })
        .select()
        .single();

    if (error) {
        console.error('Registration request error:', error);
        throw new Error('حدث خطأ أثناء إرسال طلب التسجيل');
    }

    return dbToRequest(result);
}

// Admin: Get pending registration requests
export async function getPendingRequests(): Promise<RegistrationRequest[]> {
    const { data, error } = await supabase
        .from('doctor_registration_requests')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Get pending requests error:', error);
        throw new Error('حدث خطأ أثناء جلب طلبات التسجيل');
    }

    return (data || []).map(dbToRequest);
}

// Admin: Get all registration requests
export async function getAllRequests(): Promise<RegistrationRequest[]> {
    const { data, error } = await supabase
        .from('doctor_registration_requests')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Get all requests error:', error);
        throw new Error('حدث خطأ أثناء جلب طلبات التسجيل');
    }

    return (data || []).map(dbToRequest);
}

// Admin: Approve a registration request
export async function approveRequest(
    requestId: string,
    adminUserId: string
): Promise<{ doctor: Doctor; userId: string }> {
    // 1. Get the request
    const { data: request, error: fetchError } = await supabase
        .from('doctor_registration_requests')
        .select('*')
        .eq('id', requestId)
        .single();

    if (fetchError || !request) {
        throw new Error('طلب التسجيل غير موجود');
    }

    // 2. Check if doctor already exists by phone
    const { data: existingDoctors } = await supabase
        .from('doctors')
        .select('id')
        .eq('phone', request.phone)
        .limit(1);

    let doctorId: string;

    if (existingDoctors && existingDoctors.length > 0) {
        // Link to existing doctor
        doctorId = existingDoctors[0].id;
    } else {
        // Create new doctor
        const newDoctor = await addDoctor({
            name: request.name,
            phone: request.phone,
            phone2: request.phone2 || undefined,
            address: request.address,
            doctorCode: `DR-${Date.now().toString().slice(-6)}`,
            representativeName: '',
        });
        doctorId = newDoctor.id;
    }

    // 3. Create Supabase Auth user using signUp (not admin API)
    const tempPassword = generateTempPassword();

    const { createAuthUser } = await import('./users');
    const authId = await createAuthUser(request.email, tempPassword);

    // 4. Create user record directly
    const { data: newUserData, error: userError } = await supabase
        .from('users')
        .insert({
            auth_id: authId,
            username: request.email.split('@')[0],
            name: request.name,
            email: request.email,
            role: 'doctor',
            entity_id: doctorId,
        })
        .select('id')
        .single();

    if (userError) {
        console.error('User creation error:', userError);
        throw new Error('حدث خطأ أثناء إنشاء حساب المستخدم');
    }

    // 5. Update the request as approved
    const { error: updateError } = await supabase
        .from('doctor_registration_requests')
        .update({
            status: 'approved',
            doctor_id: doctorId,
            user_id: newUserData.id,
            reviewed_by: adminUserId,
            reviewed_at: new Date().toISOString(),
        })
        .eq('id', requestId);

    if (updateError) {
        console.error('Update request error:', updateError);
    }

    // 6. Send password reset email so doctor can set their own password
    await supabase.auth.resetPasswordForEmail(request.email);

    const doctor = (await supabase.from('doctors').select('*').eq('id', doctorId).single()).data;

    return {
        doctor: {
            id: doctor.id,
            name: doctor.name,
            phone: doctor.phone,
            phone2: doctor.phone2 || undefined,
            address: doctor.address,
            doctorCode: doctor.doctor_code,
            representativeName: doctor.representative_name,
            representativeId: doctor.representative_id || undefined,
        },
        userId: newUserData.id,
    };
}

// Admin: Reject a registration request
export async function rejectRequest(
    requestId: string,
    adminUserId: string,
    notes?: string
): Promise<void> {
    const { error } = await supabase
        .from('doctor_registration_requests')
        .update({
            status: 'rejected',
            admin_notes: notes || null,
            reviewed_by: adminUserId,
            reviewed_at: new Date().toISOString(),
        })
        .eq('id', requestId);

    if (error) {
        console.error('Reject request error:', error);
        throw new Error('حدث خطأ أثناء رفض الطلب');
    }
}

// Helper: Generate a temporary password
function generateTempPassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 12; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

// Get count of pending requests (for badge)
export async function getPendingCount(): Promise<number> {
    const { count, error } = await supabase
        .from('doctor_registration_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

    if (error) {
        return 0;
    }

    return count || 0;
}
