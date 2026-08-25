import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const migration = readFileSync(
    'supabase/migrations/20260731000000_make_accounting_reregistration_deterministic.sql',
    'utf8'
);
const remainingLegacyMigration = readFileSync(
    'supabase/migrations/20260731002000_restore_remaining_legacy_accounting_registrations.sql',
    'utf8'
);
const tasneemCancellationRepair = readFileSync(
    'supabase/migrations/20260805020000_reopen_tasneem_cancelled_accounting_entry.sql',
    'utf8'
);
const accountingSnapshotsMigration = readFileSync(
    'supabase/migrations/20260805010000_add_accounting_review_snapshots.sql',
    'utf8'
);
const registrationPage = readFileSync('src/pages/CaseRegistration.tsx', 'utf8');
// The unregistered-cases badge count moved out of the sidebar into the
// shared navigation badge hook, so every badge is one fetch rather than one
// query per menu item. The rule it must obey is unchanged.
const navBadges = readFileSync('src/hooks/useNavBadges.ts', 'utf8');
const dashboard = readFileSync('src/pages/DashboardNew.tsx', 'utf8');

describe('accounting re-registration protection', () => {
    test('reopens a registered order for status, money, party, and item changes', () => {
        expect(migration).toContain('OLD.is_registered = TRUE AND v_business_changed');
        expect(migration).toContain('NEW.is_registered := FALSE');
        expect(migration).toContain('NEW.needs_accounting_reregistration := TRUE');
        expect(migration).toContain('NEW.status');
        expect(migration).toContain('NEW.total_price');
        expect(migration).toContain('NEW.doctor_id');
        expect(migration).toContain('NEW.supplier_id');
        expect(migration).toContain('NEW.designer_id');
        expect(migration).not.toContain('NEW.is_archived                       IS DISTINCT FROM OLD.is_archived');
        expect(migration).toContain('v_existing_items IS DISTINCT FROM v_requested_items');
        expect(migration).toContain('p_items IS NOT NULL AND v_items_changed');
        expect(migration).toContain('zz_reopen_order_after_direct_item_change');
        expect(migration).not.toContain('app.order_items_change_in_progress');
        expect(migration).not.toContain('regexp_replace');
    });

    test('clears the change marker when the accountant registers the order again', () => {
        expect(migration).toContain('NEW.is_registered = TRUE AND OLD.is_registered = FALSE');
        expect(migration).toContain('NEW.needs_accounting_reregistration := FALSE');
    });

    test('restores the reviewed non-archived legacy rows without changing money', () => {
        expect(remainingLegacyMigration).toContain('v_updated_count <> 7');
        expect(remainingLegacyMigration).toContain('needs_accounting_reregistration = FALSE');
        expect(remainingLegacyMigration).not.toMatch(/SET\s+(total_price|discount|cost|manual_cost|design_price)/i);
    });

    test('shows changed orders regardless of their current workflow status', () => {
        expect(registrationPage).toContain('isAccountingRegistrationCandidate(order, activeTab)');
        expect(registrationPage).toContain('getOrdersForAccountingRegistration');
        expect(registrationPage).toContain("change: 'تعديل'");
        expect(registrationPage).not.toContain('تعديل بعد التسجيل');
        expect(registrationPage).not.toContain('مؤرشفة بعد التسجيل');
        expect(navBadges).toContain("isAccountingRegistrationCandidate(order, 'pending')");
        expect(navBadges).toContain('getOrdersForAccountingRegistration');
    });

    test('reopens only Tasneem cancelled entry for one-time accounting removal', () => {
        expect(tasneemCancellationRepair).toContain('4f0f9156-ac82-4c3b-a785-2e501dd2f71d');
        expect(tasneemCancellationRepair).toContain("case_id = '1503-260507-511'");
        expect(tasneemCancellationRepair).toContain("status = 'Cancelled'");
        expect(tasneemCancellationRepair).toContain('is_registered = FALSE');
        expect(tasneemCancellationRepair).toContain('needs_accounting_reregistration = TRUE');
        expect(tasneemCancellationRepair).not.toMatch(/SET\s+(total_price|discount|cost|manual_cost|design_price)/i);
    });

    test('stores a safe accounting baseline without changing order money', () => {
        expect(accountingSnapshotsMigration).toContain('accounting_snapshot JSONB');
        expect(accountingSnapshotsMigration).toContain('accounting_previous_snapshot JSONB');
        expect(accountingSnapshotsMigration).toContain('public.build_order_accounting_snapshot');
        expect(accountingSnapshotsMigration).toContain("THEN 'cancellation'");
        expect(accountingSnapshotsMigration).toContain("THEN 'change'");
        expect(accountingSnapshotsMigration).toContain("ELSE 'new'");
        expect(accountingSnapshotsMigration).not.toMatch(/SET\s+(total_price|discount|cost|manual_cost|design_price)\s*=/i);
    });

    test('does not register accounting when a case is accepted', () => {
        const acceptOrderBlock = dashboard.slice(
            dashboard.indexOf('const handleAcceptOrder'),
            dashboard.indexOf('const openDeliveryDateEditor')
        );

        expect(acceptOrderBlock).not.toContain('isRegistered: true');
    });

    test('restores accounting registration after item price backfill without modifying financials', () => {
        const repairMigration = readFileSync(
            'supabase/migrations/20260826001000_restore_accounting_after_item_price_backfill.sql',
            'utf8'
        );
        expect(repairMigration).toContain('is_registered = TRUE');
        expect(repairMigration).toContain('needs_accounting_reregistration = FALSE');
        expect(repairMigration).toContain('accounting_review_cycle_id = NULL');
        expect(repairMigration).toContain('order_item_price_backfill_audit');
        expect(repairMigration).not.toMatch(/SET\s+(total_price|discount|cost|manual_cost|design_price)/i);
    });
});
