import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const migration = readFileSync(
    'supabase/migrations/20260730060000_cover_all_order_changes_for_accounting_reregistration.sql',
    'utf8'
);
const registrationPage = readFileSync('src/pages/CaseRegistration.tsx', 'utf8');
const sidebar = readFileSync('src/components/Sidebar.tsx', 'utf8');

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
        expect(migration).toContain('app.order_items_change_in_progress');
        expect(migration).toContain('p_items IS NOT NULL');
    });

    test('clears the change marker when the accountant registers the order again', () => {
        expect(migration).toContain('NEW.is_registered = TRUE AND OLD.is_registered = FALSE');
        expect(migration).toContain('NEW.needs_accounting_reregistration := FALSE');
    });

    test('shows changed orders regardless of their current workflow status', () => {
        expect(registrationPage).toContain(
            "activeTab === 'pending' && hasPostRegistrationChange(order) && !order.isRegistered"
        );
        expect(registrationPage).toContain('order.needsAccountingReregistration');
        expect(sidebar).toContain('o.needsAccountingReregistration');
    });
});
