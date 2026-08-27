import { describe, expect, test, vi } from 'vitest';
import {
    flagReconciliationIssue,
    listReconciliationFlags,
    resolveReconciliationFlag,
} from '../../src/services/supabase/reconciliationFlags';

// Mock supabase client
vi.mock('../../src/lib/supabase', () => {
    let mockFlags: any[] = [];
    return {
        supabase: {
            from: vi.fn((table: string) => {
                if (table === 'reconciliation_flags') {
                    return {
                        insert: vi.fn((payload: any) => ({
                            select: vi.fn(() => ({
                                single: vi.fn(async () => {
                                    const row = {
                                        id: 'flag-123',
                                        created_at: new Date().toISOString(),
                                        resolved_at: null,
                                        resolved_by: null,
                                        resolution_notes: null,
                                        ...payload,
                                    };
                                    mockFlags.push(row);
                                    return { data: row, error: null };
                                }),
                            })),
                        })),
                        select: vi.fn(() => {
                            let filtered = [...mockFlags];
                            const chain: any = {
                                order: vi.fn(() => chain),
                                eq: vi.fn((col: string, val: any) => {
                                    filtered = filtered.filter(r => r[col] === val);
                                    return chain;
                                }),
                                then: (resolve: any) => resolve({ data: filtered, error: null }),
                            };
                            return chain;
                        }),
                        update: vi.fn((updates: any) => ({
                            eq: vi.fn((_col: string, id: string) => ({
                                select: vi.fn(() => ({
                                    single: vi.fn(async () => {
                                        const idx = mockFlags.findIndex(r => r.id === id);
                                        if (idx >= 0) {
                                            mockFlags[idx] = { ...mockFlags[idx], ...updates };
                                            return { data: mockFlags[idx], error: null };
                                        }
                                        return {
                                            data: {
                                                id,
                                                flag_type: 'test',
                                                message: 'test',
                                                severity: 'error',
                                                status: 'resolved',
                                                created_at: new Date().toISOString(),
                                                ...updates,
                                            },
                                            error: null,
                                        };
                                    }),
                                })),
                            })),
                        })),
                    };
                }
                return {};
            }),
        },
    };
});

describe('reconciliation flags service', () => {
    test('flagReconciliationIssue inserts and formats open flag', async () => {
        const flag = await flagReconciliationIssue({
            flagType: 'orphaned_doctor_obligation_on_deletion',
            orderId: 'order-001',
            entityType: 'doctor',
            entityId: 'doc-001',
            severity: 'error',
            message: 'Failed to void doctor receivable',
            metadata: { error: 'Network timeout' },
        });

        expect(flag).not.toBeNull();
        expect(flag?.flagType).toBe('orphaned_doctor_obligation_on_deletion');
        expect(flag?.status).toBe('open');
        expect(flag?.severity).toBe('error');
        expect(flag?.orderId).toBe('order-001');
    });

    test('resolveReconciliationFlag updates status and resolution notes', async () => {
        const resolved = await resolveReconciliationFlag('flag-123', 'Reconciled manually', 'user-admin');

        expect(resolved).not.toBeNull();
        expect(resolved.status).toBe('resolved');
        expect(resolved.resolutionNotes).toBe('Reconciled manually');
        expect(resolved.resolvedBy).toBe('user-admin');
    });

    test('listReconciliationFlags returns items', async () => {
        const items = await listReconciliationFlags('all');
        expect(Array.isArray(items)).toBe(true);
    });
});

// The TD-001..TD-004 guarantees are enforced in the database, so they are
// covered where they can actually fail: order_workflow_atomicity.test.sql
// (delete guards) and reconciliation_flags.test.sql (table + RLS). Asserting on
// migration file text here would only re-check that strings exist.
