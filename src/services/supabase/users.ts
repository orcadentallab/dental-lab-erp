 
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
        designerServicePrices: dbUser.designer_service_prices || undefined,
        customPermissions: dbUser.custom_permissions || undefined,
        isActive: dbUser.is_active ?? true,
        deactivatedAt: dbUser.deactivated_at || undefined,
        employeeType: dbUser.employee_type || undefined
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
        designer_service_prices: user.designerServicePrices || null,
        custom_permissions: user.customPermissions || null,
        is_active: user.isActive ?? true,
        deactivated_at: user.deactivatedAt || null,
        employee_type: user.employeeType || null
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
        } catch (e: unknown) {
            // Check for duplicate user error
            const err = e as { message?: string; code?: string };
            if (err.message?.includes('User already registered') || err.code === '422') {
                throw new ValidationError(
                    'هذا البريد الإلكتروني مسجل بالفعل. راجع الحساب الموجود في إدارة المستخدمين؛ وإذا تعثرت إضافة سابقة، راجع هوية Auth غير المربوطة قبل إعادة الإضافة.',
                    'هذا البريد الإلكتروني مسجل بالفعل. راجع الحساب الموجود أو إضافة سابقة لم تكتمل مع مسؤول النظام.'
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...userWithoutPassword } = user;
    const dbUser = userToDb({ ...userWithoutPassword, auth_id: authId });

    const { error } = await supabase
        .from('users')
        .insert(dbUser);

    if (error) {
        throw ErrorHandler.handle(error, 'addUser - insert');
    }
    if (authId && user.isActive !== false) {
        const { error: activationError } = await supabase.rpc('admin_activate_password_auth_user', { p_auth_id: authId });
        if (activationError) throw ErrorHandler.handle(activationError, 'addUser - activate');
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
        designer_service_prices: user.designerServicePrices || null,
        email: user.email || null,
        custom_permissions: user.customPermissions || null,
        is_active: user.isActive ?? true,
        deactivated_at: user.deactivatedAt || null,
        employee_type: user.employeeType || null
    };


    const { error } = await supabase
        .from('users')
        .update(dbUpdates)
        .eq('id', user.id);

    if (error) {
        throw ErrorHandler.handle(error, 'updateUser');
    }
    if (user.auth_id && user.isActive === true && user.role !== 'doctor') {
        const { error: activationError } = await supabase.rpc('admin_activate_password_auth_user', { p_auth_id: user.auth_id });
        if (activationError) throw ErrorHandler.handle(activationError, 'updateUser - activate');
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

// Active-admin RPC replaces raw signup; creating staff must work while public
// Auth signup is disabled for the reviewed doctor registration flow.

export async function createAuthUser(email: string, password: string): Promise<string> {
    const { data, error } = await supabase.rpc('admin_create_password_auth_user', { p_email: email, p_password: password });

    if (error) throw error;
    if (typeof data !== 'string') throw new Error('لم يتم إنشاء حساب الدخول');
    return data;
}
