import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
    scripts: Record<string, string>;
};
const suite = readFileSync(
    resolve('supabase/tests/database/financial_obligations_integration.test.sql'),
    'utf8',
);
const doctorRepairMigration = readFileSync(
    resolve('supabase/migrations/20260729000000_repair_doctor_obligations_and_enforce_integrity.sql'),
    'utf8',
);
const returnedOrderRepairMigration = readFileSync(
    resolve('supabase/migrations/20260729010000_sync_returned_lab_obligation_price_changes.sql'),
    'utf8',
);
const atomicRedoMigration = readFileSync(
    resolve('supabase/migrations/20260801000000_create_redo_order_atomic.sql'),
    'utf8',
);
const onHoldRetirementMigration = readFileSync(
    resolve('supabase/migrations/20260801010000_retire_on_hold_issue_state.sql'),
    'utf8',
);
const redoModal = readFileSync(resolve('src/components/orders/RedoOrderModal.tsx'), 'utf8');

describe('local database integration suite safety', () => {
    test('the npm command is pinned to the local Supabase database', () => {
        expect(packageJson.scripts['test:db']).toContain('--local');
        expect(packageJson.scripts['test:db']).not.toContain('--linked');
        expect(packageJson.scripts['test:db']).not.toContain('--db-url');
        expect(packageJson.scripts['test:db']).toContain('atomic_redo_order.test.sql');
        expect(packageJson.scripts['test:db']).toContain('on_hold_retirement.test.sql');
    });

    test('fixtures are always wrapped in a rollback transaction', () => {
        expect(suite.trimStart()).toMatch(/^BEGIN;/);
        expect(suite.trimEnd()).toMatch(/ROLLBACK;$/);
        expect(suite).not.toContain('piuiiwcjnfvjwyewczuz');
    });

    test('the declared pgTAP plan matches the assertion count', () => {
        const declaredPlan = Number(suite.match(/SELECT plan\((\d+)\);/)?.[1]);
        const assertions = suite.match(/^SELECT (?:is|ok|throws_like)\(/gm) ?? [];

        expect(declaredPlan).toBe(assertions.length);
        expect(declaredPlan).toBe(30);
    });

    test('production-only repair guards allow a fresh local schema', () => {
        expect(doctorRepairMigration).toMatch(
            /v_count = 0\r?\n\s+AND NOT EXISTS \(SELECT 1 FROM public\.orders\)/,
        );
        expect(returnedOrderRepairMigration).toMatch(
            /WHERE case_id = '2005-260706-511'[\s\S]*IF NOT FOUND THEN\s+RETURN;/,
        );
    });

    test('redo creation is one database operation with separate party costs', () => {
        expect(atomicRedoMigration).toContain('CREATE OR REPLACE FUNCTION public.create_redo_order_atomic');
        expect(atomicRedoMigration).toContain('pg_advisory_xact_lock');
        expect(atomicRedoMigration).toContain('p_rejected_lab_cost');
        expect(atomicRedoMigration).toContain('p_rejected_designer_cost');
        expect(redoModal).toContain('db.createRedoOrderAtomic');
        expect(redoModal).not.toContain('db.updateOrderStatus');
        expect(redoModal).not.toContain('db.addOrder');
        expect(redoModal).not.toContain('generateNextCaseIdForDoctor');
    });

    test('on_hold retirement blocks new assignments without rewriting historical data', () => {
        expect(onHoldRetirementMigration).toContain('BEFORE INSERT OR UPDATE OF issue_state');
        expect(onHoldRetirementMigration).toContain("OLD.issue_state = 'on_hold'");
        expect(onHoldRetirementMigration).not.toMatch(/UPDATE\s+public\.orders/i);
        expect(onHoldRetirementMigration).not.toContain('financial_obligations');
    });
});
