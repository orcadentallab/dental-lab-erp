
import { createClient } from '@supabase/supabase-js';

// These would normally be in .env
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://xyz.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'abc';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Mock Auth Service for initial development without keys
interface MockUser {
    id: string;
    email: string;
    user_metadata: { role: string };
}

interface MockAuthResponse {
    user: MockUser | null;
    error: Error | null;
}

export const mockAuth = {
    signIn: async (role: 'admin' | 'technician' | 'representative'): Promise<MockAuthResponse> => {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve({
                    user: {
                        id: 'mock-user-id',
                        email: `${role}@dental-lab.com`,
                        user_metadata: { role },
                    },
                    error: null,
                });
            }, 500);
        });
    },
    signOut: async () => {
        return Promise.resolve({ error: null });
    }
};
