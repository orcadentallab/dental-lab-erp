import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    BILLING_ENTITY_TYPES,
    BILLING_MODES,
    calculateDueDate,
    calculateMonthlyCycleDueDate,
    getDefaultBillingSettings,
    getFinancialPeriodRange,
    isBillingEntityType,
    normalizeBillingDay,
    validateBillingEntityType,
    validateBillingMode,
    validateBillingSettings,
} from '../src/constants/billingSettings';

test.describe('billing due date helpers', () => {
    test('calculates per-order due date as trigger date plus 7 days by default', () => {
        expect(calculateDueDate({
            billingMode: BILLING_MODES.perOrder,
            triggerDate: '2026-04-15',
        })).toBe('2026-04-22');
    });

    test('calculates per-order due date with custom due days', () => {
        expect(calculateDueDate({
            billingMode: BILLING_MODES.perOrder,
            triggerDate: '2026-04-15',
            perOrderDueDays: 14,
        })).toBe('2026-04-29');
    });

    test('calculates monthly cycle due date for April items on May billing day', () => {
        expect(calculateMonthlyCycleDueDate('2026-04-01', 10)).toBe('2026-05-10');
        expect(calculateDueDate({
            billingMode: BILLING_MODES.monthlyCycle,
            billingDay: 10,
            triggerDate: '2026-04-30',
        })).toBe('2026-05-10');
    });

    test('normalizes billing day 31 to the last valid day in February', () => {
        expect(normalizeBillingDay(2026, 2, 31)).toBe(28);
        expect(calculateMonthlyCycleDueDate('2026-01-20', 31)).toBe('2026-02-28');
    });

    test('normalizes February to 29 in leap years', () => {
        expect(normalizeBillingDay(2028, 2, 31)).toBe(29);
        expect(calculateMonthlyCycleDueDate('2028-01-20', 31)).toBe('2028-02-29');
    });

    test('returns default settings as per-order plus 7 days', () => {
        const defaults = getDefaultBillingSettings(BILLING_ENTITY_TYPES.doctor, 'doctor-1');

        expect(defaults.billingMode).toBe(BILLING_MODES.perOrder);
        expect(defaults.perOrderDueDays).toBe(7);
        expect(defaults.billingDay).toBeNull();
        expect(defaults.autoApplyCredit).toBe(true);
        expect(calculateDueDate({
            billingMode: defaults.billingMode,
            triggerDate: '2026-04-15',
            perOrderDueDays: defaults.perOrderDueDays,
        })).toBe('2026-04-22');
    });

    test('calculates financial period range without creating obligations', () => {
        expect(getFinancialPeriodRange('2026-04-15', BILLING_MODES.perOrder)).toEqual({
            periodStart: '2026-04-15',
            periodEnd: '2026-04-15',
        });
        expect(getFinancialPeriodRange('2026-04-15', BILLING_MODES.monthlyCycle)).toEqual({
            periodStart: '2026-04-01',
            periodEnd: '2026-04-30',
        });
    });
});

test.describe('billing settings validation', () => {
    test('accepts approved entity types', () => {
        expect(isBillingEntityType('doctor')).toBe(true);
        expect(isBillingEntityType('external_lab')).toBe(true);
        expect(isBillingEntityType('designer')).toBe(true);
    });

    test('rejects invalid entity type and billing mode', () => {
        expect(() => validateBillingEntityType('supplier')).toThrow();
        expect(() => validateBillingMode('weekly')).toThrow();
    });

    test('rejects invalid billing day', () => {
        expect(() => normalizeBillingDay(2026, 5, 0)).toThrow();
        expect(() => normalizeBillingDay(2026, 5, 32)).toThrow();
    });

    test('rejects monthly cycle settings without billing day', () => {
        expect(() => validateBillingSettings({
            entityType: BILLING_ENTITY_TYPES.doctor,
            entityId: 'doctor-1',
            billingMode: BILLING_MODES.monthlyCycle,
            billingDay: null,
            perOrderDueDays: 7,
            autoApplyCredit: true,
        })).toThrow();
    });
});

test.describe('entity billing settings migration', () => {
    const migration = readFileSync(resolve('supabase/migrations/081_entity_billing_settings.sql'), 'utf8');

    test('creates generic billing settings table and constraints', () => {
        expect(migration).toContain('CREATE TABLE IF NOT EXISTS entity_billing_settings');
        expect(migration).toContain("CHECK (entity_type IN ('doctor', 'external_lab', 'designer'))");
        expect(migration).toContain("CHECK (billing_mode IN ('per_order', 'monthly_cycle'))");
        expect(migration).toContain('entity_billing_settings_monthly_day_required');
        expect(migration).toContain("billing_mode <> 'monthly_cycle'");
        expect(migration).toContain('OR billing_day IS NOT NULL');
        expect(migration).toContain('UNIQUE (entity_type, entity_id)');
    });

    test('adds conservative RLS policies', () => {
        expect(migration).toContain('ALTER TABLE entity_billing_settings ENABLE ROW LEVEL SECURITY');
        expect(migration).toContain('Admins manage entity billing settings');
        expect(migration).toContain('Accountants view entity billing settings');
        expect(migration).toContain('Representatives view doctor billing settings');
        expect(migration).toContain("entity_type = 'doctor'");
    });

    test('does not create obligations, allocations, credits, balances, or reports', () => {
        const lowerMigration = migration.toLowerCase();

        expect(lowerMigration).not.toContain('financial_obligations');
        expect(lowerMigration).not.toContain('financial_allocations');
        expect(lowerMigration).not.toContain('entity_credits');
        expect(lowerMigration).not.toContain('payment_allocations');
        expect(lowerMigration).not.toContain('backfill');
        expect(lowerMigration).not.toContain('dashboard');
        expect(lowerMigration).not.toContain('analytics');
    });
});
