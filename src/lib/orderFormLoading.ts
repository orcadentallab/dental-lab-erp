import type { User } from '../services/db';
import { isDesignerUser } from './userRoles';

export function getOrderFormDesigners(users: User[], assignedDesignerId?: string): User[] {
    // Historical assignments remain visible even after the user's role changes.
    return users.filter(user => isDesignerUser(user) || user.id === assignedDesignerId);
}

export async function loadOrderFormList<T>(load: () => Promise<T[]>): Promise<{ data: T[]; failed: boolean }> {
    try {
        return { data: await load(), failed: false };
    } catch (error) {
        console.error('Order form list failed to load:', error);
        return { data: [], failed: true };
    }
}
