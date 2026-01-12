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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const fetchProfileAndSetUser = async (session: any) => {
        if (!session?.user) {
            setUser(null);
            return;
        }

        try {
            const { data: profile } = await supabase
                .from('users')
                .select('*')
                .eq('auth_id', session.user.id)
                .single();

            setUser({
                id: profile?.id || session.user.id,
                username: profile?.username || session.user.email || 'user',
                name: profile?.name || session.user.email || 'User',
                email: profile?.email || session.user.email,
                role: profile?.role || 'lab', // IMPORTANT: Default to restricted if not found
                auth_id: session.user.id,
                entityId: profile?.entity_id || undefined, // Map snake_case to camelCase
                baseSalary: profile?.base_salary || undefined,
                unitRate: profile?.unit_rate || undefined
            } as User);
        } catch (e) {
            console.error("Error fetching profile", e);
            // Fallback
            setUser({
                id: session.user.id,
                username: session.user.email || 'user',
                name: session.user.email || 'User',
                role: 'lab',
                auth_id: session.user.id
            } as any);
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
            const { data: resolvedEmail, error: lookupError } = await supabase.rpc('get_email_by_username', { uname: identifier });

            if (lookupError) {
                console.error('Username lookup failed:', lookupError);
                // If RPC missing or error, we can't resolve username.
                // But we shouldn't block generic login if they typed an email but forgot '@'? Unlikely.
                setIsLoading(false);
                return { success: false, error: 'اسم المستخدم غير موجود' };
            }

            if (resolvedEmail) {
                email = resolvedEmail as string;
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

    return (
        <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout, isLoading }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
