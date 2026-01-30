
import { supabase } from '../lib/supabase';

// Re-export the singleton instance to prevent multiple client instances
export { supabase };

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
