import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('designer transitions with the legacy mirror disabled', () => {
    it('does not send legacy status when starting or revising a design', () => {
        const source = readFileSync('src/services/supabase/orders.ts', 'utf8');
        const start = source.indexOf('export async function updateOrderStatus(');
        const declaration = source.indexOf('const updates: Partial<Order>', start);
        expect(source.slice(declaration, declaration + 240)).toContain("['Under Design', 'Waiting Dr Approval'].includes(newStatus)");
        expect(source.slice(declaration, declaration + 240)).toContain('? {}');
    });
});
