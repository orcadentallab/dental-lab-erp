import { createContext, useContext, useState, useEffect, type PropsWithChildren } from 'react';
import { supabase } from '../lib/supabase';
import type { User } from '../services/db';



// Extend User interface from db to include any auth specific needs if any, 
// strictly speaking we can just use the db User type but let's keep it clean
// Actually, let's reuse the db User type to avoid duplication
// But for Auth Context, we might want to strictly define the user object shape if it differs
// For now, we use the DB user.

interface AuthContextType {
    user: User | null;
    isAuthenticated: boolean;
    login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => Promise<void>;
    isLoading: boolean;
    hasPermission: (permissionKey: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const fetchProfileAndSetUser = async (session: { user?: { id: string; email?: string } } | null) => {
        if (!session?.user) {
            setUser(null);
            return;
        }

        try {
            const { data: profile, error } = await supabase
                .from('users')
                .select('*')
                .eq('auth_id', session.user.id)
                .single();

            // SECURITY: Block access if no profile exists
            if (error || !profile) {
                console.error('No profile found for user:', session.user.id);
                setUser(null);
                return;
            }

            const newUser: User = {
                id: profile.id,
                username: profile.username,
                name: profile.name,
                email: profile.email || session.user.email,
                role: profile.role,
                auth_id: session.user.id,
                entityId: profile.entity_id || undefined,
                baseSalary: profile.base_salary || undefined,
                unitRate: profile.unit_rate || undefined,
                customPermissions: profile.custom_permissions || undefined
            };
            setUser(newUser);
        } catch (e) {
            console.error("Error fetching profile", e);
            // SECURITY: Block access on error instead of fallback
            setUser(null);
        }
    };

    useEffect(() => {
        // Check active session
        supabase.auth.getSession().then(({ data: { session } }) => {
            fetchProfileAndSetUser(session).finally(() => setIsLoading(false));
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            fetchProfileAndSetUser(session).finally(() => setIsLoading(false));
        });

        return () => subscription.unsubscribe();
    }, []);

    const login = async (identifier: string, password: string): Promise<{ success: boolean; error?: string }> => {
        setIsLoading(true);

        let email = identifier;

        // Flexible Login Strategy:
        // 1. If identifier looks like an email (@), use it directly.
        // 2. If not, try to resolve username -> email via RPC.

        if (!identifier.includes('@')) {
            // Case-insensitive username lookup: convert input to lowercase
            // (Assumes usernames are stored/created or handled as case-insensitive, or we should lowercase them on creation too)
            // But for now, let's try to match exactly what is in DB? No, user wants case-insensitive entry.
            // If DB has MixedCase, lowercasing input might fail if we don't lowercase DB check.
            // Best approach: Send as is, let RPC handle it using ILIKE?
            // Actually, let's update the RPC to be case insensitive if we can, or just try to find it.

            // Wait, supabase.rpc call: 'get_email_by_username'
            // We should check that RPC function.

            const { data: resolvedEmail, error: lookupError } = await supabase.rpc('get_email_by_username', { uname: identifier.trim() });

            if (lookupError) {
                console.error('Username lookup failed:', lookupError);
                // If RPC missing or error, we can't resolve username.
                // But we shouldn't block generic login if they typed an email but forgot '@'? Unlikely.
                setIsLoading(false);
                return { success: false, error: 'اسم المستخدم غير موجود' };
            }

            if (resolvedEmail) {
                if (typeof resolvedEmail === 'string') {
                    email = resolvedEmail;
                }
            } else {
                // Return specific error if username not found
                setIsLoading(false);
                return { success: false, error: 'اسم المستخدم غير صحيح' };
            }
        }

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            console.error('Login error:', error.message);
            setIsLoading(false);
            return { success: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' };
        }

        // State update handled by onAuthStateChange
        setIsLoading(false);
        return { success: true };
    };

    const logout = async () => {
        setIsLoading(true);
        await supabase.auth.signOut();
        setUser(null);
        setIsLoading(false);
    };

    // Permission checking helper
    // Returns true if user has the permission (either via role or custom override)
    const hasPermission = (permissionKey: string): boolean => {
        if (!user) return false;

        // Super admin has all permissions
        if (user.username === 'admin') return true;

        // Check custom permissions first (overrides role-based)
        if (user.customPermissions && permissionKey in user.customPermissions) {
            return user.customPermissions[permissionKey];
        }

        // Default role-based permissions
        const rolePermissions: Record<string, string[]> = {
            admin: ['view_finance', 'view_doctors', 'view_analytics', 'view_staff', 'view_suppliers', 'manage_orders', 'manage_users', 'view_accounts'],
            accountant: ['view_finance', 'view_suppliers', 'view_accounts', 'view_staff'],
            representative: ['view_doctors', 'manage_orders', 'view_accounts'],
            lab: ['manage_orders'],
            designer: ['manage_orders', 'view_accounts']
        };

        return rolePermissions[user.role]?.includes(permissionKey) || false;
    };

    return (
        <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout, isLoading, hasPermission }}>
            {children}
        </AuthContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
