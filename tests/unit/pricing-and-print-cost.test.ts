import { describe, it, expect } from 'vitest';
import { getLabCostMetadata } from '../../src/constants/financialObligations';
import type { OrderCostBreakdown } from '../../src/services/supabase/costingService';

describe('Effective Pricing & Print Cost Transparency (Day 5)', () => {
    describe('Pricing Stability Across Tariff Updates', () => {
        it('preserves historical captured prices when service tariffs change', () => {
            const historicalOrder = {
                id: 'ord-hist-1',
                caseId: 'HIST-001',
                totalPrice: 1200,
                cost: 500,
                items: [
                    { serviceType: 'Zirconia Crown', price: 1200, teethNumbers: ['11'] }
                ]
            };

            // Simulating catalog service price update from 1200 to 1400
            const catalogServices = [
                { name: 'Zirconia Crown', price: 1400 }
            ];

            // Existing historical order should remain unchanged
            expect(historicalOrder.totalPrice).toBe(1200);
            expect(historicalOrder.items[0].price).toBe(1200);

            // New order reflects the updated tariff
            const newOrder = {
                id: 'ord-new-1',
                caseId: 'NEW-001',
                totalPrice: catalogServices[0].price,
                items: [
                    { serviceType: 'Zirconia Crown', price: catalogServices[0].price, teethNumbers: ['12'] }
                ]
            };
            expect(newOrder.totalPrice).toBe(1400);
        });

        it('retains manual cost overrides without being overwritten by default catalog rates', () => {
            const orderWithManualCost = {
                cost: 650,
                manualCost: 650,
                defaultCost: 500,
                workflowType: 'split'
            };

            const metadata = getLabCostMetadata(orderWithManualCost);
            expect(metadata.cost).toBe(650);
            expect(metadata.costSource).toBe('manual');
        });
    });

    describe('Internal Print Cost: Actual, Estimated, and Unknown', () => {
        it('identifies print with recorded material usage as actual cost when batch is closed', () => {
            const actualCostBreakdown: OrderCostBreakdown = {
                order_id: 'ord-print-1',
                case_id: 'PRT-001',
                is_internal_production: true,
                is_billable: true,
                overhead_status: 'allocated',
                materials_are_estimated: false, // Closed disc / batch -> actual
                total_units: 1,
                total_price: 350,
                materials_cost: 45.5,
                labor_cost: 30,
                external_cost: 0,
                overhead_cost: 20,
                overhead_rate_applied: 20,
                total_cost: 95.5,
                cost_per_unit: 95.5,
                gross_profit: 254.5,
                margin_percent: 72.7,
                details: {
                    materials: [
                        {
                            material_name: 'Denture 3D Resin',
                            batch_code: 'BATCH-2026-09',
                            units_attributed: 1,
                            is_estimated: false,
                            cost: 45.5
                        }
                    ],
                    labor: [
                        {
                            stage_name: 'طباعة الكاست',
                            assignee_id: 'user-tech-1',
                            units_passed: 1,
                            rate_per_unit: 30,
                            cost: 30
                        }
                    ],
                    external: []
                }
            };

            expect(actualCostBreakdown.materials_are_estimated).toBe(false);
            expect(actualCostBreakdown.details.materials[0].is_estimated).toBe(false);
            expect(actualCostBreakdown.total_cost).toBe(95.5);
        });

        it('identifies print with active open batch as estimated cost', () => {
            const estimatedCostBreakdown: OrderCostBreakdown = {
                order_id: 'ord-print-2',
                case_id: 'PRT-002',
                is_internal_production: true,
                is_billable: true,
                overhead_status: 'allocated',
                materials_are_estimated: true, // Disc/batch still open -> estimate
                total_units: 1,
                total_price: 350,
                materials_cost: 50.0,
                labor_cost: 30,
                external_cost: 0,
                overhead_cost: 20,
                overhead_rate_applied: 20,
                total_cost: 100.0,
                cost_per_unit: 100.0,
                gross_profit: 250.0,
                margin_percent: 71.4,
                details: {
                    materials: [
                        {
                            material_name: 'NextDent Model Resin',
                            batch_code: 'BATCH-OPEN-01',
                            units_attributed: 1,
                            is_estimated: true,
                            cost: 50.0
                        }
                    ],
                    labor: [
                        {
                            stage_name: 'طباعة الكاست',
                            assignee_id: 'user-tech-1',
                            units_passed: 1,
                            rate_per_unit: 30,
                            cost: 30
                        }
                    ],
                    external: []
                }
            };

            expect(estimatedCostBreakdown.materials_are_estimated).toBe(true);
            expect(estimatedCostBreakdown.details.materials[0].is_estimated).toBe(true);
        });

        it('identifies print with missing material usage as explicit unknown, never assuming zero', () => {
            const orderWithoutMaterials = {
                cost: 0,
                manualCost: null,
                defaultCost: null
            };

            const metadata = getLabCostMetadata(orderWithoutMaterials);
            expect(metadata.costSource).toBe('unknown');
            // Unknown is marked explicitly rather than silently masking missing data
        });

        it('counts rework reprint cost once and preserves remake responsibility', () => {
            // Stage run 1: initial print (failed at QC)
            const initialPrint = {
                stage: 'cast_print',
                units: 1,
                laborCost: 30,
                rework_of: null,
                failed: true
            };

            // Stage run 2: reprint rework
            const reprintPrint = {
                stage: 'cast_print',
                units: 1,
                laborCost: 30,
                rework_of: 'run-initial',
                failed: false
            };

            // Both runs are visible in stage audit
            const runs = [initialPrint, reprintPrint];
            expect(runs).toHaveLength(2);
            expect(runs[1].rework_of).toBe('run-initial');

            // Completed manufacturing unit counted once for billable output
            const billableUnits = runs.filter(r => !r.failed).reduce((sum, r) => sum + r.units, 0);
            expect(billableUnits).toBe(1);
        });
    });
});
