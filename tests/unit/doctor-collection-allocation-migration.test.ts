import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const migration = readFileSync(
    resolve('supabase/migrations/20260801070000_allocate_doctor_collections_fifo.sql'),
    'utf8'
);

describe('doctor collection FIFO migration', () => {
    test('allocates across the canonical doctor or center account', () => {
        expect(migration).toContain('canonical_doctor_account_id');
        expect(migration).toContain('reconcile_doctor_account_fifo');
        expect(migration).toContain("payment.type = 'income'");
        expect(migration).toContain("payment.entity_type = 'doctor'");
        expect(migration).toContain("obligation.direction = 'receivable'");
        expect(migration).toContain("ORDER BY obligation.due_date");
        expect(migration).toContain("THEN 'credit_auto_apply'");
        expect(migration).toContain("ELSE 'fifo'");
    });

    test('creates overpayment credit without adding a second statement payment', () => {
        expect(migration).toContain("'overpayment'");
        expect(migration).toContain("'doctor collection exceeds current open receivables'");
        expect(migration).not.toMatch(/INSERT\s+INTO\s+public\.transactions/i);
        expect(migration).not.toMatch(/UPDATE\s+public\.transactions/i);
        expect(migration).not.toMatch(/UPDATE\s+public\.orders/i);
        expect(migration).not.toMatch(/UPDATE\s+public\.adjustments/i);
    });

    test('wires future collections, obligations, and credits to the atomic reconciler', () => {
        expect(migration).toContain('trigger_reconcile_approved_doctor_collection');
        expect(migration).toContain('trigger_reconcile_open_doctor_obligation');
        expect(migration).toContain('trigger_reconcile_doctor_credit');
        expect(migration).toContain("current_setting('orca.doctor_fifo_reconciling', TRUE)");
    });

    test('guards the exact approved production preview and statement sources', () => {
        expect(migration).toContain('v_untracked_count <> 87');
        expect(migration).toContain('v_untracked_amount <> 524730.00');
        expect(migration).toContain('v_credit_count <> 5');
        expect(migration).toContain('v_credit_amount <> 4200.00');
        expect(migration).toContain('v_new_allocation_count <> 340');
        expect(migration).toContain('v_new_allocation_amount <> 518560.00');
        expect(migration).toContain('v_affected_obligation_count <> 324');
        expect(migration).toContain('v_result_credit_count <> 7');
        expect(migration).toContain('v_result_credit_amount <> 10370.00');
        expect(migration).toContain('historicalBackfill20260801');
        expect(migration).toContain('v_already_applied');
        expect(migration).toContain('v_empty_database');
        expect(migration).toContain('doctor_statement_source_guard_20260801');
        expect(migration).toContain('Doctor statement source guard failed');
    });

    test('protects allocated or credited payment records from direct mutation', () => {
        expect(migration).toContain('guard_allocated_payable_payment_mutation');
        expect(migration).toContain('source_transaction_id = v_transaction_id');
        expect(migration).toContain('use an atomic payment correction workflow');
    });
});
