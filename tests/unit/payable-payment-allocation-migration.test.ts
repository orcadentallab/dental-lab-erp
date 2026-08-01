import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
    'supabase/migrations/20260801030000_allocate_future_payable_payments_fifo.sql'
), 'utf8');
const backfill = readFileSync(resolve(
    'supabase/migrations/20260801050000_backfill_reviewed_payable_payment_allocations.sql'
), 'utf8');
const categoryGuardRelaxation = readFileSync(resolve(
    'supabase/migrations/20260801035000_allow_allocated_payment_category_normalization.sql'
), 'utf8');

describe('future supplier/designer payment allocation migration', () => {
    it('allocates approved payable payments FIFO in the transaction write', () => {
        expect(migration).toContain('allocate_payable_transaction_fifo');
        expect(migration).toContain("ORDER BY due_date, trigger_date, created_at, id");
        expect(migration).toContain("'allocation_created'");
        expect(migration).toContain('AFTER INSERT OR UPDATE OF status, is_approved');
        expect(migration).toContain("NEW.entity_type = 'supplier'");
        expect(migration).toContain("NEW.entity_type = 'designer'");
    });

    it('sends excess payments to explicit review instead of inventing an active credit', () => {
        expect(migration).toContain("'supplier_overpayment'");
        expect(migration).toContain("'supplier_payment_review_required'");
        expect(migration).not.toContain('INSERT INTO public.account_credits');
    });

    it('protects allocated payments from non-atomic edits and deletes', () => {
        expect(migration).toContain('guard_allocated_payable_payment_mutation');
        expect(migration).toContain('BEFORE UPDATE OR DELETE');
        expect(migration).toContain('cannot be edited or deleted directly');
        expect(migration).not.toContain('NEW.category IS DISTINCT FROM OLD.category');
    });

    it('does not run a historical backfill as part of the schema migration', () => {
        expect(migration).not.toMatch(/SELECT\s+public\.allocate_payable_transaction_fifo\s*\(/i);
        expect(migration).not.toMatch(/PERFORM\s+public\.allocate_payable_transaction_fifo\s*\([^N]/i);
    });
});

describe('allocated payment category normalization compatibility', () => {
    it('allows category-only normalization while keeping financial fields guarded', () => {
        expect(categoryGuardRelaxation).not.toContain('NEW.category IS DISTINCT FROM OLD.category');
        expect(categoryGuardRelaxation).toContain('NEW.amount IS DISTINCT FROM OLD.amount');
        expect(categoryGuardRelaxation).toContain('NEW.entity_id IS DISTINCT FROM OLD.entity_id');
        expect(categoryGuardRelaxation).toContain('NEW.status IS DISTINCT FROM OLD.status');
        expect(categoryGuardRelaxation).toContain("IF TG_OP = 'DELETE'");
    });
});

describe('reviewed payable payment allocation backfill', () => {
    it('guards the exact approved preview before writing', () => {
        expect(backfill).toContain('expected 17 reviewed payments');
        expect(backfill).toContain('expected 333285.00 unallocated');
        expect(backfill).toContain('expected 320 rows / 325895.00');
        expect(backfill).toContain('backfill is already complete; skipping');
    });

    it('closes EZ settlement excess without creating future credit', () => {
        expect(backfill).toContain('ae0f72ae-e883-4022-94ba-974691844d6f');
        expect(backfill).toContain("'settled_by_adjustment'");
        expect(backfill).toContain('not a future supplier credit');
    });

    it('writes off only the reviewed AB residual against its closing adjustment', () => {
        expect(backfill).toContain('45d09bdf-4219-4054-b2f2-99c87c9ae188');
        expect(backfill).toContain('1d4ed38c-60ce-43d2-a786-5b1ba7e9295f');
        expect(backfill).toContain("SET status = 'written_off'");
        expect(backfill).toContain("remaining_amount = 465.00");
    });
});
