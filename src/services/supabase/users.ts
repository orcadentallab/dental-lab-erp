import { supabase } from '../../lib/supabase';
import type { DbUser, DbUserInsert, DbUserUpdate } from './types';
import type { User } from '../db';
import { UserCreateSchema, UserUpdateSchema, formatValidationError } from '../../lib/validation';
import { ErrorHandler, ValidationError } from '../../lib/errorHandler';

function dbToUser(dbUser: DbUser): User {
    return {
        id: dbUser.id,
        auth_id: dbUser.auth_id || undefined,
        username: dbUser.username,
        email: dbUser.email || undefined,
        // password removed - using Supabase Auth only
        role: dbUser.role,
        name: dbUser.name,
        entityId: dbUser.entity_id || undefined,
        baseSalary: dbUser.base_salary || undefined,
        unitRate: dbUser.unit_rate || undefined,
        customPermissions: dbUser.custom_permissions || undefined
    };
}

function userToDb(user: Omit<User, 'id'>): DbUserInsert {
    return {
        auth_id: user.auth_id || null,
        username: user.username,
        email: user.email || null,
        // password removed - using Supabase Auth only
        role: user.role,
        name: user.name,
        entity_id: user.entityId || null,
        base_salary: user.baseSalary || null,
        unit_rate: user.unitRate || null,
        custom_permissions: user.customPermissions || null
    };
}

export async function getUsers(): Promise<User[]> {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('name', { ascending: true });

    if (error) {
        throw ErrorHandler.handle(error, 'getUsers');
    }
    return (data || []).map(dbToUser);
}

export async function addUser(user: User & { password?: string }): Promise<void> {
    // Validate input
    try {
        UserCreateSchema.parse({
            ...user,
            password: user.password || undefined
        });
    } catch (error: unknown) {
        throw new ValidationError(formatValidationError(error));
    }

    let authId = user.auth_id;

    // Auto-create Auth User if email & password are provided
    // Password is now optional and only used during creation
    if (!authId && user.email && user.password && user.password.length >= 8) {
        try {
            // Removed sensitive console.log
            authId = await createAuthUser(user.email, user.password);
        } catch (e: any) {
            // Check for duplicate user error
            if (e.message?.includes('User already registered') || e.code === '422') {
                throw new ValidationError(
                    'هذا البريد الإلكتروني مسجل بالفعل. بما أن العملية السابقة فشلت، يرجى حذف المستخدم من لوحة تحكم Supabase (Authentication) ثم المحاولة مرة أخرى.',
                    'هذا البريد الإلكتروني مسجل بالفعل. يرجى حذف المستخدم من قائمة Authentication في Supabase ثم المحاولة.'
                );
            }
            // Auth creation failed - throw error to inform admin
            throw ErrorHandler.handle(e, 'addUser - createAuthUser');
        }
    }

    if (!authId && !user.email) {
        throw new ValidationError('يجب توفير البريد الإلكتروني لإنشاء حساب المستخدم');
    }

    // Remove password from user object before saving to database
    // Remove password from user object before saving to database
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...userWithoutPassword } = user;
    const dbUser = userToDb({ ...userWithoutPassword, auth_id: authId });

    const { error } = await supabase
        .from('users')
        .insert(dbUser);

    if (error) {
        throw ErrorHandler.handle(error, 'addUser - insert');
    }
}

export async function updateUser(user: User & { password?: string }): Promise<void> {
    // Validate input
    try {
        UserUpdateSchema.parse(user);
    } catch (error: unknown) {
        throw new ValidationError(formatValidationError(error));
    }

    // If password is provided, reject - password changes must be done via Supabase Auth
    // If password is provided, reject - password changes must be done via Supabase Auth
    if (user.password) {
        throw new ValidationError('تغيير كلمة المرور يجب أن يتم عبر Supabase Auth مباشرة');
    }

    // Remove password from updates - password changes handled by Supabase Auth
    // const { password: _, ...userWithoutPassword } = user;

    const dbUpdates: DbUserUpdate = {
        username: user.username,
        // password removed - password changes must be done via Supabase Auth
        role: user.role,
        name: user.name,
        entity_id: user.entityId || null,
        base_salary: user.baseSalary || null,
        unit_rate: user.unitRate || null,
        email: user.email || null
    };

    const { error } = await supabase
        .from('users')
        .update(dbUpdates)
        .eq('id', user.id);

    if (error) {
        throw ErrorHandler.handle(error, 'updateUser');
    }
}

export async function deleteUser(id: string): Promise<void> {
    // Validate UUID
    if (!id || typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new ValidationError('معرف المستخدم غير صحيح');
    }

    const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', id);

    if (error) {
        throw ErrorHandler.handle(error, 'deleteUser');
    }

    // Note: Auth user should also be deleted via Supabase Admin API
    // This is typically handled server-side or via Supabase dashboard
}

export async function resetUserPassword(userId: string, newPassword: string): Promise<void> {
    const { error } = await supabase.rpc('admin_reset_password', {
        target_user_id: userId,
        new_password: newPassword
    });

    if (error) {
        throw ErrorHandler.handle(error, 'resetUserPassword');
    }
}

// Helper to create Auth User without logging out the admin
// Uses a temporary client with memory storage
import { createClient } from '@supabase/supabase-js';

export async function createAuthUser(email: string, password: string): Promise<string> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase URL/Key missing');
    }

    const tempClient = createClient(supabaseUrl, supabaseKey, {
        auth: {
            persistSession: false, // In-memory only
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    });

    const { data, error } = await tempClient.auth.signUp({
        email,
        password,
    });

    if (error) throw error;
    if (!data.user) throw new Error('No user returned from signUp');

    return data.user.id;
}
