import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BILLING_ENTITY_TYPES, BILLING_MODES, getDefaultBillingSettings } from '../src/constants/billingSettings';
import {
    OBLIGATION_DIRECTIONS,
    OBLIGATION_SOURCES,
    OBLIGATION_TRIGGER_TYPES,
    OBLIGATION_STATUSES,
    DOCTOR_RECEIVABLE_OBLIGATION_FAILURE_MESSAGE,
    EXTERNAL_LAB_PAYABLE_OBLIGATION_FAILURE_MESSAGE,
    EXTERNAL_LAB_PAYABLE_VOID_FAILURE_MESSAGE,
    FINANCIAL_OBLIGATIONS_FLAGS,
    applyDueDateToCandidate,
    buildDesignerPayableCandidate,
    buildDoctorReceivableCandidate,
    buildExternalLabPayableCandidate,
    calculateNetAmount,
    getLabCostMetadata,
    shouldCreateDoctorReceivableObligationForStatusChange,
    shouldCreateExternalLabPayableObligationForStatusChange,
    shouldVoidDoctorReceivableForStatusOrIssueChange,
    shouldVoidExternalLabReadyObligationForStatusChange,
    validateFinancialObligationAmounts,
} from '../src/constants/financialObligations';
import { calculateDueDate } from '../src/constants/billingSettings';
import { classifyHistoricalOrderForObligationPreview } from '../src/services/supabase/historicalObligationsPreview';

const baseOrder = {
    id: '11111111-1111-4111-8111-111111111111',
    caseId: 'CASE-1',
    doctorId: '22222222-2222-4222-8222-222222222222',
    supplierId: '33333333-3333-4333-8333-333333333333',
    totalPrice: 1200,
    cost: 500,
    deliveryDate: '2026-04-15',
    createdAt: '2026-04-01T10:00:00.000Z',
};

test.describe('financial obligation candidates', () => {
    test('builds doctor receivable candidate for Delivered and legacy Completed', () => {
        for (const status of ['Delivered', 'Completed']) {
            const candidate = buildDoctorReceivableCandidate({ ...baseOrder, status });

            expect(candidate).toMatchObject({
                entityType: BILLING_ENTITY_TYPES.doctor,
                entityId: baseOrder.doctorId,
                direction: OBLIGATION_DIRECTIONS.receivable,
                triggerType: OBLIGATION_TRIGGER_TYPES.doctorDelivered,
                triggerStatus: status,
                grossAmount: 1200,
                source: OBLIGATION_SOURCES.order,
            });
        }
    });

    test('does not build doctor receivable candidate for non-delivered statuses', () => {
        for (const status of ['Ready', 'Try In', 'Try In Approved', 'Under Production', 'Under Design', 'Pending', 'New Case']) {
            expect(buildDoctorReceivableCandidate({ ...baseOrder, status })).toBeNull();
        }
    });

    test('does not build doctor receivable candidate without doctor id', () => {
        expect(buildDoctorReceivableCandidate({ ...baseOrder, doctorId: undefined, status: 'Delivered' })).toBeNull();
    });

    test('voids doctor receivable candidate when delivered order becomes non-billable or issue', () => {
        expect(shouldVoidDoctorReceivableForStatusOrIssueChange(
            { ...baseOrder, status: 'Delivered' },
            { ...baseOrder, status: 'Rejected' }
        )).toBe(true);
        expect(shouldVoidDoctorReceivableForStatusOrIssueChange(
            { ...baseOrder, status: 'Delivered' },
            { ...baseOrder, status: 'Cancelled' }
        )).toBe(true);
        expect(shouldVoidDoctorReceivableForStatusOrIssueChange(
            { ...baseOrder, status: 'Delivered', issueState: 'none' },
            { ...baseOrder, status: 'Delivered', issueState: 'doctor_rejected' }
        )).toBe(true);
        expect(shouldVoidDoctorReceivableForStatusOrIssueChange(
            { ...baseOrder, status: 'Delivered', issueState: 'none' },
            { ...baseOrder, status: 'Delivered', issueState: 'returned' }
        )).toBe(false);
        expect(shouldVoidDoctorReceivableForStatusOrIssueChange(
            { ...baseOrder, status: 'Delivered', issueState: 'none' },
            { ...baseOrder, status: 'Delivered', issueState: 'on_hold' }
        )).toBe(false);
        expect(shouldVoidDoctorReceivableForStatusOrIssueChange(
            { ...baseOrder, status: 'Delivered' },
            { ...baseOrder, status: 'Returned for Adjustments' }
        )).toBe(false);
        expect(shouldVoidDoctorReceivableForStatusOrIssueChange(
            { ...baseOrder, status: 'Delivered' },
            { ...baseOrder, status: 'Delivered' }
        )).toBe(false);
    });

    test('builds external lab payable candidate only for final ready', () => {
        const candidate = buildExternalLabPayableCandidate({ ...baseOrder, status: 'Ready' });

        expect(candidate).toMatchObject({
            entityType: BILLING_ENTITY_TYPES.externalLab,
            entityId: baseOrder.supplierId,
            direction: OBLIGATION_DIRECTIONS.payable,
            triggerType: OBLIGATION_TRIGGER_TYPES.externalLabReady,
            triggerStatus: 'Ready',
            grossAmount: 500,
            source: OBLIGATION_SOURCES.order,
        });
    });

    test('does not build external lab payable candidate for try-in ready, missing supplier, or zero cost', () => {
        expect(buildExternalLabPayableCandidate({ ...baseOrder, status: 'Ready', deliveryType: 'TryIn' })).toBeNull();
        expect(buildExternalLabPayableCandidate({ ...baseOrder, supplierId: undefined, status: 'Ready' })).toBeNull();
        expect(buildExternalLabPayableCandidate({ ...baseOrder, cost: 0, status: 'Ready' })).toBeNull();
        expect(buildExternalLabPayableCandidate({ ...baseOrder, cost: undefined, status: 'Ready' })).toBeNull();
    });

    test('builds implied final ready external lab payable candidate for direct Delivered', () => {
        const candidate = buildExternalLabPayableCandidate(
            { ...baseOrder, status: 'Delivered', actualDeliveryDate: '2026-05-11' },
            { impliedFinalReady: true, triggerDate: '2026-05-11' }
        );

        expect(candidate).toMatchObject({
            entityType: BILLING_ENTITY_TYPES.externalLab,
            direction: OBLIGATION_DIRECTIONS.payable,
            triggerType: OBLIGATION_TRIGGER_TYPES.externalLabReady,
            triggerDate: '2026-05-11',
            grossAmount: 500,
            metadata: expect.objectContaining({
                impliedFinalReady: true,
                cost: 500,
            }),
        });
    });

    test('does not create automatic designer payable candidates in 3B-1', () => {
        expect(buildDesignerPayableCandidate()).toBeNull();
    });

    test('wires prospective doctor obligations only for Delivered status updates', () => {
        expect(shouldCreateDoctorReceivableObligationForStatusChange('Ready', 'Delivered')).toBe(true);
        expect(shouldCreateDoctorReceivableObligationForStatusChange('Completed', 'Delivered')).toBe(true);

        expect(shouldCreateDoctorReceivableObligationForStatusChange('Ready', 'Ready')).toBe(false);
        expect(shouldCreateDoctorReceivableObligationForStatusChange('Under Production', 'Ready')).toBe(false);
        expect(shouldCreateDoctorReceivableObligationForStatusChange('Under Production', 'Try In')).toBe(false);
        expect(shouldCreateDoctorReceivableObligationForStatusChange('Try In', 'Try In Approved')).toBe(false);
        expect(shouldCreateDoctorReceivableObligationForStatusChange('Delivered', 'Completed')).toBe(false);
        expect(shouldCreateDoctorReceivableObligationForStatusChange('Delivered', 'Delivered')).toBe(false);
    });

    test('wires external lab payables only for Final Ready and direct Delivered implied Final Ready', () => {
        expect(shouldCreateExternalLabPayableObligationForStatusChange(
            { ...baseOrder, status: 'Under Production' },
            { ...baseOrder, status: 'Ready' }
        )).toEqual({ shouldCreate: true, impliedFinalReady: false });

        expect(shouldCreateExternalLabPayableObligationForStatusChange(
            { ...baseOrder, status: 'Under Production' },
            { ...baseOrder, status: 'Ready', deliveryType: 'TryIn' }
        )).toEqual({ shouldCreate: false, impliedFinalReady: false });

        expect(shouldCreateExternalLabPayableObligationForStatusChange(
            { ...baseOrder, status: 'Under Production' },
            { ...baseOrder, status: 'Delivered', actualDeliveryDate: '2026-05-11' }
        )).toEqual({ shouldCreate: true, impliedFinalReady: true });

        expect(shouldCreateExternalLabPayableObligationForStatusChange(
            { ...baseOrder, status: 'Ready', deliveryType: 'TryIn' },
            { ...baseOrder, status: 'Delivered', actualDeliveryDate: '2026-05-11' }
        )).toEqual({ shouldCreate: false, impliedFinalReady: false });

        expect(shouldCreateExternalLabPayableObligationForStatusChange(
            { ...baseOrder, status: 'Ready' },
            { ...baseOrder, status: 'Delivered', actualDeliveryDate: '2026-05-11' }
        )).toEqual({ shouldCreate: false, impliedFinalReady: false });
    });

    test('voids normal external lab ready payable when leaving final-ready workflow', () => {
        // Normal status transitions (issueState = none) should void
        for (const newStatus of ['New Case', 'Under Production', 'Try In']) {
            expect(shouldVoidExternalLabReadyObligationForStatusChange(
                { ...baseOrder, status: 'Ready' },
                { ...baseOrder, status: newStatus }
            )).toBe(true);
        }

        // Transitions entering issue states should NOT void
        for (const newStatus of ['Rejected', 'Cancelled', 'Returned for Adjustments']) {
            expect(shouldVoidExternalLabReadyObligationForStatusChange(
                { ...baseOrder, status: 'Ready' },
                { ...baseOrder, status: newStatus }
            )).toBe(false);
        }

        expect(shouldVoidExternalLabReadyObligationForStatusChange(
            { ...baseOrder, status: 'Delivered' },
            { ...baseOrder, status: 'Rejected' }
        )).toBe(false);

        expect(shouldVoidExternalLabReadyObligationForStatusChange(
            { ...baseOrder, status: 'Ready' },
            { ...baseOrder, status: 'Delivered' }
        )).toBe(false);

        expect(shouldVoidExternalLabReadyObligationForStatusChange(
            { ...baseOrder, status: 'Under Production' },
            { ...baseOrder, status: 'Rejected' }
        )).toBe(false);
    });
});

test.describe('financial obligation amounts and due dates', () => {
    test('calculates net amount internally as gross plus adjustment', () => {
        expect(calculateNetAmount(1000, -100)).toBe(900);
        expect(calculateNetAmount(1000, 150)).toBe(1150);
    });

    test('validates gross, net, and allocated amounts', () => {
        expect(() => validateFinancialObligationAmounts({ grossAmount: 1000, adjustmentAmount: -100, allocatedAmount: 900 })).not.toThrow();
        expect(() => validateFinancialObligationAmounts({ grossAmount: -1 })).toThrow();
        expect(() => validateFinancialObligationAmounts({ grossAmount: 100, adjustmentAmount: -101 })).toThrow();
        expect(() => validateFinancialObligationAmounts({ grossAmount: 100, allocatedAmount: 101 })).toThrow();
    });

    test('applies due date from billing settings to candidate metadata', () => {
        const candidate = buildDoctorReceivableCandidate({ ...baseOrder, status: 'Delivered' });
        const settings = getDefaultBillingSettings(BILLING_ENTITY_TYPES.doctor, baseOrder.doctorId);
        const dueDate = calculateDueDate({
            billingMode: settings.billingMode,
            triggerDate: candidate!.triggerDate,
            perOrderDueDays: settings.perOrderDueDays,
        });

        const withDueDate = applyDueDateToCandidate(candidate!, settings, dueDate);

        expect(withDueDate.dueDate).toBe('2026-04-22');
        expect(withDueDate.metadata).toMatchObject({
            billingMode: BILLING_MODES.perOrder,
            perOrderDueDays: 7,
        });
    });

    test('keeps obligations in shadow mode for tracking only', () => {
        expect(FINANCIAL_OBLIGATIONS_FLAGS.trackingEnabled).toBe(true);
        expect(FINANCIAL_OBLIGATIONS_FLAGS.reportingEnabled).toBe(false);
    });

    test('detects lab cost source metadata without recalculating payable amount', () => {
        expect(getLabCostMetadata({ ...baseOrder, cost: 450, manualCost: 450 })).toEqual({
            cost: 450,
            manualCost: 450,
            defaultCost: null,
            costSource: 'manual',
        });

        expect(getLabCostMetadata({ ...baseOrder, cost: 500, manualCost: null })).toEqual({
            cost: 500,
            manualCost: null,
            defaultCost: null,
            costSource: 'unknown',
        });

        expect(getLabCostMetadata({ ...baseOrder, cost: 500, manualCost: null, defaultCost: 500 })).toMatchObject({
            costSource: 'default',
        });

        expect(getLabCostMetadata({ ...baseOrder, cost: 650, manualCost: null, defaultCost: 500 })).toMatchObject({
            cost: 650,
            defaultCost: 500,
            costSource: 'legacy_manual_inferred',
        });
    });

    test('detects lab cost for salaried vs per-piece designers correctly', () => {
        // Per-piece designer (isSalariedDesigner = false): always subtract designPrice
        expect(getLabCostMetadata({
            ...baseOrder,
            workflowType: 'split',
            cost: 2000,
            designPrice: 150,
        }, false)).toMatchObject({
            cost: 1850
        });

        // Salaried designer (isSalariedDesigner = true): do NOT subtract designPrice
        expect(getLabCostMetadata({
            ...baseOrder,
            workflowType: 'split',
            cost: 1850,
            designPrice: 150,
        }, true)).toMatchObject({
            cost: 1850
        });
    });

    test('external lab payable helper uses order cost and preserves manual cost metadata', () => {
        const candidate = buildExternalLabPayableCandidate({
            ...baseOrder,
            status: 'Ready',
            cost: 450,
            manualCost: 450,
        });

        expect(candidate).toMatchObject({
            grossAmount: 450,
            metadata: expect.objectContaining({
                cost: 450,
                manualCost: 450,
                defaultCost: null,
                costSource: 'manual',
            }),
        });
    });

    test('supports external lab issue settlement trigger type for future historical issue backfill', () => {
        expect(OBLIGATION_TRIGGER_TYPES.externalLabIssueSettlement).toBe('external_lab_issue_settlement');
        expect(Object.values(OBLIGATION_TRIGGER_TYPES)).toEqual(expect.arrayContaining([
            'doctor_delivered',
            'external_lab_ready',
            'external_lab_issue_settlement',
            'designer_approved',
            'manual_adjustment',
        ]));
    });
});

test.describe('historical obligations backfill preview', () => {
    const activeDoctorObligation = {
        order_id: baseOrder.id,
        entity_type: BILLING_ENTITY_TYPES.doctor,
        entity_id: baseOrder.doctorId,
        direction: OBLIGATION_DIRECTIONS.receivable,
        trigger_type: OBLIGATION_TRIGGER_TYPES.doctorDelivered,
        source: OBLIGATION_SOURCES.order,
        status: OBLIGATION_STATUSES.unpaid,
    } as const;

    const activeExternalLabObligation = {
        order_id: baseOrder.id,
        entity_type: BILLING_ENTITY_TYPES.externalLab,
        entity_id: baseOrder.supplierId,
        direction: OBLIGATION_DIRECTIONS.payable,
        trigger_type: OBLIGATION_TRIGGER_TYPES.externalLabReady,
        source: OBLIGATION_SOURCES.order,
        status: OBLIGATION_STATUSES.unpaid,
    } as const;

    const activeIssueSettlementObligation = {
        ...activeExternalLabObligation,
        trigger_type: OBLIGATION_TRIGGER_TYPES.externalLabIssueSettlement,
    } as const;

    test('finds Delivered and legacy Completed orders missing doctor receivable obligations', () => {
        for (const status of ['Delivered', 'Completed']) {
            const rows = classifyHistoricalOrderForObligationPreview({
                ...baseOrder,
                status,
                patientName: 'Patient A',
                actualDeliveryDate: '2026-05-05',
            }, [], { doctorName: 'Dr Test' });

            expect(rows).toContainEqual(expect.objectContaining({
                rowType: 'missing_obligation',
                entityType: BILLING_ENTITY_TYPES.doctor,
                reason: 'missing_doctor_receivable',
                doctorId: baseOrder.doctorId,
                doctorName: 'Dr Test',
                amount: baseOrder.totalPrice,
                date: '2026-05-05',
                dateBasis: 'actualDeliveryDate',
            }));
        }
    });

    test('excludes orders that already have an active doctor receivable obligation', () => {
        const rows = classifyHistoricalOrderForObligationPreview(
            { ...baseOrder, status: 'Delivered', actualDeliveryDate: '2026-05-05' },
            [activeDoctorObligation]
        );

        expect(rows.some(row => row.reason === 'missing_doctor_receivable')).toBe(false);
    });

    test('finds Final Ready external lab payables and uses delivery date as ready date basis', () => {
        const rows = classifyHistoricalOrderForObligationPreview({
            ...baseOrder,
            status: 'Ready',
            deliveryType: 'Final',
            actualDeliveryDate: '2026-05-09',
            cost: 450,
            manualCost: 450,
        }, [], { supplierName: 'Lab Test' });

        expect(rows).toContainEqual(expect.objectContaining({
            rowType: 'missing_obligation',
            entityType: BILLING_ENTITY_TYPES.externalLab,
            reason: 'missing_external_lab_payable',
            supplierId: baseOrder.supplierId,
            supplierName: 'Lab Test',
            amount: 450,
            cost: 450,
            manualCost: 450,
            defaultCost: null,
            costSource: 'manual',
            date: baseOrder.deliveryDate,
            dateBasis: 'deliveryDate',
        }));
    });

    test('normal external lab payable preview uses order cost with unknown cost source when default cost is unavailable', () => {
        const rows = classifyHistoricalOrderForObligationPreview({
            ...baseOrder,
            status: 'Ready',
            manualCost: null,
            cost: 725,
        }, []);

        expect(rows).toContainEqual(expect.objectContaining({
            rowType: 'missing_obligation',
            reason: 'missing_external_lab_payable',
            amount: 725,
            cost: 725,
            manualCost: null,
            defaultCost: null,
            costSource: 'unknown',
        }));
    });

    test('normal external lab payable preview does not use rejected lab cost', () => {
        const rows = classifyHistoricalOrderForObligationPreview({
            ...baseOrder,
            status: 'Ready',
            cost: 500,
            rejectedLabCost: 275,
        }, []);

        expect(rows).toContainEqual(expect.objectContaining({
            reason: 'missing_external_lab_payable',
            amount: 500,
            cost: 500,
            costSource: 'unknown',
        }));
        expect(rows.some(row => row.reason === 'missing_external_lab_issue_settlement')).toBe(false);
    });

    test('treats Delivered and Completed as implied Final Ready for missing external lab payables', () => {
        for (const status of ['Delivered', 'Completed']) {
            const rows = classifyHistoricalOrderForObligationPreview({
                ...baseOrder,
                status,
                actualDeliveryDate: '2026-05-05',
            }, [activeDoctorObligation]);

            expect(rows).toContainEqual(expect.objectContaining({
                rowType: 'missing_obligation',
                entityType: BILLING_ENTITY_TYPES.externalLab,
                reason: 'missing_external_lab_payable',
                amount: baseOrder.cost,
                date: '2026-05-05',
                dateBasis: 'actualDeliveryDate',
            }));
        }
    });

    test('excludes Try-In Ready from final external lab payable backfill', () => {
        const rows = classifyHistoricalOrderForObligationPreview({
            ...baseOrder,
            status: 'Ready',
            deliveryType: 'TryIn',
        }, []);

        expect(rows).toContainEqual(expect.objectContaining({
            rowType: 'missing_data_warning',
            entityType: BILLING_ENTITY_TYPES.externalLab,
            reason: 'try_in_ready_excluded',
        }));
        expect(rows.some(row => row.reason === 'missing_external_lab_payable')).toBe(false);
    });

    test('emits missing data warnings instead of obligation rows', () => {
        expect(classifyHistoricalOrderForObligationPreview({
            ...baseOrder,
            doctorId: undefined,
            status: 'Delivered',
        }, [])).toContainEqual(expect.objectContaining({ reason: 'doctor_receivable_missing_doctor' }));

        expect(classifyHistoricalOrderForObligationPreview({
            ...baseOrder,
            totalPrice: 0,
            status: 'Completed',
        }, [])).toContainEqual(expect.objectContaining({ reason: 'doctor_receivable_zero_or_missing_amount' }));

        expect(classifyHistoricalOrderForObligationPreview({
            ...baseOrder,
            supplierId: undefined,
            status: 'Ready',
        }, [])).toContainEqual(expect.objectContaining({ reason: 'external_lab_payable_missing_supplier' }));

        expect(classifyHistoricalOrderForObligationPreview({
            ...baseOrder,
            cost: 0,
            status: 'Ready',
        }, [])).toContainEqual(expect.objectContaining({ reason: 'external_lab_payable_zero_or_missing_cost' }));
    });

    test('keeps rejected, cancelled, and returned cases warning-only for future issue workflow', () => {
        for (const status of ['Rejected', 'Cancelled', 'Returned for Adjustments']) {
            const rows = classifyHistoricalOrderForObligationPreview({ ...baseOrder, status }, []);

            expect(rows).toEqual([expect.objectContaining({
                rowType: 'missing_data_warning',
                reason: 'issue_settlement_missing_admin_amount',
            })]);
        }
    });

    test('does not duplicate external lab rows when an active payable exists', () => {
        const rows = classifyHistoricalOrderForObligationPreview(
            { ...baseOrder, status: 'Ready' },
            [activeExternalLabObligation]
        );

        expect(rows.some(row => row.reason === 'missing_external_lab_payable')).toBe(false);
    });

    test('classifies issue cases with rejected lab cost as external lab issue settlement preview rows', () => {
        for (const status of ['Rejected', 'Returned for Adjustments']) {
            const rows = classifyHistoricalOrderForObligationPreview({
                ...baseOrder,
                status,
                cost: 999,
                manualCost: 888,
                rejectedLabCost: 275,
            }, [], { supplierName: 'Issue Lab' });

            expect(rows).toEqual([expect.objectContaining({
                rowType: 'missing_obligation',
                entityType: BILLING_ENTITY_TYPES.externalLab,
                reason: 'missing_external_lab_issue_settlement',
                supplierId: baseOrder.supplierId,
                supplierName: 'Issue Lab',
                amount: 275,
                date: baseOrder.deliveryDate,
                dateBasis: 'deliveryDate',
            })]);
            expect(rows.some(row => row.reason === 'missing_external_lab_payable')).toBe(false);
            expect(rows[0]).not.toHaveProperty('costSource');
        }
    });

    test('issue settlement rows are excluded when an active issue settlement obligation exists', () => {
        const rows = classifyHistoricalOrderForObligationPreview({
            ...baseOrder,
            status: 'Rejected',
            rejectedLabCost: 275,
        }, [activeIssueSettlementObligation]);

        expect(rows).toEqual([]);
    });

    test('issue cases with rejected lab cost but missing supplier remain warnings', () => {
        const rows = classifyHistoricalOrderForObligationPreview({
            ...baseOrder,
            status: 'Rejected',
            supplierId: undefined,
            rejectedLabCost: 275,
        }, []);

        expect(rows).toEqual([expect.objectContaining({
            rowType: 'missing_data_warning',
            entityType: BILLING_ENTITY_TYPES.externalLab,
            reason: 'issue_settlement_missing_supplier',
            amount: 275,
        })]);
    });

    test('issue cases without positive rejected lab cost remain admin amount warnings', () => {
        for (const rejectedLabCost of [0, undefined]) {
            const rows = classifyHistoricalOrderForObligationPreview({
                ...baseOrder,
                status: 'Rejected',
                rejectedLabCost,
            }, []);

            expect(rows).toEqual([expect.objectContaining({
                rowType: 'missing_data_warning',
                reason: 'issue_settlement_missing_admin_amount',
                amount: 0,
            })]);
        }
    });
});

test.describe('financial obligations service wiring', () => {
    const serviceSource = readFileSync(resolve('src/services/supabase/financialObligations.ts'), 'utf8');
    const ordersSource = readFileSync(resolve('src/services/supabase/orders.ts'), 'utf8');
    const historicalPreviewSource = readFileSync(resolve('src/services/supabase/historicalObligationsPreview.ts'), 'utf8');
    const historicalBackfillSource = readFileSync(resolve('src/services/supabase/historicalObligationsBackfill.ts'), 'utf8');
    const reconciliationSource = readFileSync(resolve('src/services/supabase/financialReconciliationPreview.ts'), 'utf8');
    const dbSource = readFileSync(resolve('src/services/db.ts'), 'utf8');

    test('returns existing active obligation for idempotent duplicate creation', () => {
        expect(serviceSource).toContain('const existing = await findExistingObligation');
        expect(serviceSource).toContain('if (existing) return existing;');
    });

    test('doctor receivable creation applies due date and shadow metadata', () => {
        expect(serviceSource).toContain('createDoctorReceivableObligationForOrder');
        expect(serviceSource).toContain('const dueDate = await calculateObligationDueDate(candidate);');
        expect(serviceSource).toContain('shadowMode: true');
        expect(serviceSource).toContain('trackingOnly: true');
    });

    test('orders status wiring creates only shadow doctor receivable and external lab payable tracking', () => {
        expect(ordersSource).toContain('shouldCreateDoctorReceivableObligationForStatusChange(currentOrder.status, newStatus)');
        expect(ordersSource).toContain('createDoctorReceivableObligationForOrder(updatedOrder');
        expect(ordersSource).toContain('DOCTOR_RECEIVABLE_OBLIGATION_FAILURE_MESSAGE');
        expect(DOCTOR_RECEIVABLE_OBLIGATION_FAILURE_MESSAGE).toBe('Order delivered, but doctor receivable obligation could not be created.');
        expect(ordersSource).toContain('shouldCreateExternalLabPayableObligationForStatusChange(currentOrder, updatedOrder)');
        expect(ordersSource).toContain('createExternalLabPayableObligationForOrder(updatedOrder');
        expect(ordersSource).toContain('EXTERNAL_LAB_PAYABLE_OBLIGATION_FAILURE_MESSAGE');
        expect(EXTERNAL_LAB_PAYABLE_OBLIGATION_FAILURE_MESSAGE).toBe('Order marked Ready, but external lab payable obligation could not be created.');
        expect(ordersSource).not.toContain('buildDesignerPayableCandidate');
    });

    test('finds active doctor delivered obligation without touching other obligation types', () => {
        expect(serviceSource).toContain('findActiveDoctorDeliveredObligationForOrder');
        expect(serviceSource).toContain(".eq('entity_type', 'doctor')");
        expect(serviceSource).toContain('.eq(\'direction\', OBLIGATION_DIRECTIONS.receivable)');
        expect(serviceSource).toContain('.eq(\'trigger_type\', OBLIGATION_TRIGGER_TYPES.doctorDelivered)');
        expect(serviceSource).toContain(".eq('source', OBLIGATION_SOURCES.order)");
        expect(serviceSource).not.toContain('OBlIGATION_TRIGGER_TYPES.externalLabReady');
        expect(serviceSource).not.toContain('OBlIGATION_TRIGGER_TYPES.designerApproved');
    });

    test('voids shadow doctor delivered obligation on Delivered reversal only', () => {
        expect(ordersSource).toContain('const isDeliveredReversal = updatedOrder ? wasDelivered && !isNowDelivered : false;');
        expect(ordersSource).toContain('findActiveDoctorDeliveredObligationForOrder(orderId)');
        expect(ordersSource).toContain('voidFinancialObligation(obligation.id, voidReason');
        expect(ordersSource).toContain('voidReason: \'delivery_reverted\'');
        expect(ordersSource).toContain('revertedToStatus: newStatus');
        expect(ordersSource).toContain('shadowMode: true');
    });

    test('voids active doctor receivable when delivered order becomes rejected returned cancelled or issue', () => {
        expect(ordersSource).toContain('shouldVoidDoctorReceivableForStatusOrIssueChange(financialPartyCorrection.previousOrder, updatedOrder)');
        expect(ordersSource).toContain('const shouldVoidDoctorReceivableForLifecycle');
        expect(ordersSource).toContain('findActiveDoctorDeliveredObligationForOrder(id)');
        expect(ordersSource).toContain("voidReason: 'delivery_rejected_or_reverted'");
        expect(ordersSource).toContain('previousIssueState');
        expect(ordersSource).toContain('newIssueState');
        expect(ordersSource).toContain('reviewNeeded: true');
        expect(ordersSource).toContain('Order left final delivered / became rejected, returned, cancelled, or issue; doctor receivable obligation voided.');
        expect(ordersSource).toContain('&& !shouldVoidDoctorReceivableForLifecycle');
        expect(ordersSource).not.toContain('createDoctorIssueReceivable');
    });

    test('voiding preserves obligation metadata and marks status void', () => {
        expect(serviceSource).toContain('const existing = existingData ? dbToFinancialObligation');
        expect(serviceSource).toContain('status: OBLIGATION_STATUSES.void');
        expect(serviceSource).toContain('...existing.metadata');
        expect(serviceSource).toContain('...metadataPatch');
    });

    test('missing active obligation does not fail Delivered reversal', () => {
        expect(ordersSource).toContain('if (obligation) {');
        expect(ordersSource).toContain('No active shadow doctor receivable obligation found to void after Delivered reversal');
    });

    test('Delivered and Ready reversals do not wire external lab or designer payable voiding', () => {
        expect(ordersSource).not.toContain('voidExternalLab');
        expect(ordersSource).not.toContain('designer_approved');
        expect(ordersSource).toContain('shadowObligationVoidNeeded: true');
    });

    test('voids active normal external lab ready payable when order leaves Final Ready workflow', () => {
        expect(ordersSource).toContain('shouldVoidExternalLabReadyObligationForStatusChange(currentOrder, updatedOrder)');
        expect(ordersSource).toContain('findActiveExternalLabReadyObligationForOrder(orderId)');
        expect(ordersSource).toContain('Order left Final Ready/Delivered workflow; normal external lab payable voided. Issue settlement may be entered separately.');
        expect(ordersSource).toContain("voidReason: 'left_final_ready_or_issue_status'");
        expect(ordersSource).toContain('previousStatus: currentOrder.status');
        expect(ordersSource).toContain('newStatus');
        expect(ordersSource).toContain('reviewNeeded: true');
        expect(ordersSource).toContain('issueSettlementMayBeNeeded: true');
        expect(ordersSource).toContain('EXTERNAL_LAB_PAYABLE_VOID_FAILURE_MESSAGE');
        expect(EXTERNAL_LAB_PAYABLE_VOID_FAILURE_MESSAGE).toBe('Order left Final Ready/Delivered workflow, but shadow external lab payable obligation could not be voided.');
    });

    test('external lab payable voiding does not touch issue settlement, designer, or create issue settlement automatically', () => {
        expect(serviceSource).toContain('findActiveExternalLabReadyObligationForOrder');
        expect(serviceSource).toContain('.eq(\'trigger_type\', OBLIGATION_TRIGGER_TYPES.externalLabReady)');
        expect(serviceSource).not.toContain('findActiveExternalLabIssueSettlementObligationForOrder');
        expect(ordersSource).not.toContain('createExternalLabIssueSettlement');
        expect(ordersSource).not.toContain('OBlIGATION_TRIGGER_TYPES.externalLabIssueSettlement');
        expect(ordersSource).not.toContain('buildDesignerPayableCandidate');
    });

    test('external lab payable creation is shadow mode and skips missing supplier or zero cost without failing', () => {
        expect(serviceSource).toContain('createExternalLabPayableObligationForOrder');
        expect(serviceSource).toContain('buildExternalLabPayableCandidate(');
        expect(serviceSource).toContain('normalExternalLabPayable: true');
        expect(ordersSource).toContain('externalLabPayableDecision.shouldCreate && updatedOrder.supplierId && (updatedOrder.cost || 0) > 0');
    });

    test('issue, remake, rejection, and rejected lab cost do not auto-adjust external lab payables', () => {
        expect(ordersSource).not.toContain('createExternalLabPayableObligationForOrder(updatedOrder, { rejectedLabCost');
        expect(ordersSource).not.toContain('remake');
        expect(ordersSource).not.toContain('financial_adjustment');
        expect(serviceSource).not.toContain('rejectedLabCost');
    });

    test('finds active external lab ready obligation without touching designer obligations', () => {
        expect(serviceSource).toContain('findActiveExternalLabReadyObligationForOrder');
        expect(serviceSource).toContain(".eq('entity_type', 'external_lab')");
        expect(serviceSource).toContain('.eq(\'direction\', OBLIGATION_DIRECTIONS.payable)');
        expect(serviceSource).toContain('.eq(\'trigger_type\', OBLIGATION_TRIGGER_TYPES.externalLabReady)');
        expect(serviceSource).toContain(".eq('source', OBLIGATION_SOURCES.order)");
    });

    test('corrects shadow external lab payable when supplier changes after Final Ready or Delivered', () => {
        expect(ordersSource).toContain('correctExternalLabPayablePartyAfterOrderUpdate');
        expect(ordersSource).toContain('const previousSupplierId = input.previousOrder.supplierId || null;');
        expect(ordersSource).toContain('const newSupplierId = input.updatedOrder.supplierId || null;');
        expect(ordersSource).toContain('const impliedFinalReady = getProductionStatus(input.updatedOrder) === \'final_delivered\';');
        expect(ordersSource).toContain('const isPayableEligible = isFinalReady(input.updatedOrder) || impliedFinalReady;');
        expect(ordersSource).toContain('Supplier corrected from ${previousSupplierId} to ${newSupplierId || \'none\'}');
        expect(ordersSource).toContain('voidReason: \'supplier_corrected\'');
        expect(ordersSource).toContain('correctionReason: previousSupplierId ? \'supplier_corrected\' : \'supplier_added_after_ready_or_delivered\'');
        expect(ordersSource).toContain('replacedObligationId');
        expect(ordersSource).toContain('createExternalLabPayableObligationForOrder(input.updatedOrder');
    });

    test('skips supplier correction creation for missing or zero cost and Try-In Ready', () => {
        expect(ordersSource).toContain('if ((input.updatedOrder.cost || 0) <= 0) {');
        expect(ordersSource).toContain('shadow payable was not created because cost is missing or zero');
        expect(ordersSource).toContain('if (!isPayableEligible) return;');
        expect(ordersSource).toContain('isFinalReady(input.updatedOrder) || impliedFinalReady');
    });

    test('corrects shadow doctor receivable when doctor changes after Delivered', () => {
        expect(ordersSource).toContain('correctDoctorReceivablePartyAfterOrderUpdate');
        expect(ordersSource).toContain('const previousDoctorId = input.previousOrder.doctorId || null;');
        expect(ordersSource).toContain('const newDoctorId = input.updatedOrder.doctorId || null;');
        expect(ordersSource).toContain('const isReceivableEligible = getProductionStatus(input.updatedOrder) === \'final_delivered\';');
        expect(ordersSource).toContain('Doctor corrected from ${previousDoctorId} to ${newDoctorId || \'none\'}');
        expect(ordersSource).toContain('voidReason: \'doctor_corrected\'');
        expect(ordersSource).toContain('correctionReason: previousDoctorId ? \'doctor_corrected\' : \'doctor_added_after_delivered\'');
        expect(ordersSource).toContain('createDoctorReceivableObligationForOrder(input.updatedOrder');
    });

    test('skips doctor correction creation for missing or zero total price and non-delivered orders', () => {
        expect(ordersSource).toContain('if (!isReceivableEligible) return;');
        expect(ordersSource).toContain('if ((input.updatedOrder.totalPrice || 0) <= 0) {');
        expect(ordersSource).toContain('shadow receivable was not created because totalPrice is missing or zero');
    });

    test('corrects shadow doctor receivable amounts using official receivable helper', () => {
        expect(ordersSource).toContain('correctDoctorReceivableAmountAfterOrderUpdate');
        expect(ordersSource).toContain('const newAmount = getDoctorReceivableAmount(input.updatedOrder);');
        expect(ordersSource).toContain('const previousAmount = activeObligation?.grossAmount ?? getDoctorReceivableAmount(input.previousOrder);');
        expect(ordersSource).toContain('Doctor receivable amount corrected from ${activeObligation.grossAmount} to ${newAmount}');
        expect(ordersSource).toContain('voidReason: \'doctor_amount_corrected\'');
        expect(ordersSource).toContain('correctionReason: \'doctor_amount_corrected\'');
        expect(ordersSource).toContain('correctionReason: \'doctor_amount_added_after_delivered\'');
        expect(ordersSource).toContain('replacedObligationId: activeObligation.id');
    });

    test('voids active shadow doctor receivable when corrected amount becomes zero', () => {
        expect(ordersSource).toContain('if (newAmount <= 0) {');
        expect(ordersSource).toContain('voidReason: \'doctor_amount_zero_or_removed\'');
        expect(ordersSource).toContain('newAmount: 0');
    });

    test('detects total price and discount changes for doctor amount correction without changing official helper logic', () => {
        expect(ordersSource).toContain('updates.totalPrice !== undefined || updates.discount !== undefined');
        expect(ordersSource).toContain('const oldDoctorAmount = getDoctorReceivableAmount(currentOrder);');
        expect(ordersSource).toContain('const newDoctorAmount = getDoctorReceivableAmount(nextOrderForAmount);');
        expect(ordersSource).toContain('doctorAmountChanged: oldDoctorAmount !== newDoctorAmount');
    });

    test('corrects shadow external lab payable amounts from cost only', () => {
        expect(ordersSource).toContain('correctExternalLabPayableAmountAfterOrderUpdate');
        expect(ordersSource).toContain('const labCostMetadata = getLabCostMetadata(input.updatedOrder, isUpdatedDesignerSalaried);');
        expect(ordersSource).toContain('const newAmount = labCostMetadata.cost;');
        expect(ordersSource).toContain('const previousAmount = activeObligation?.grossAmount ?? getLabCostMetadata(input.previousOrder, isPreviousDesignerSalaried).cost;');
        expect(ordersSource).toContain('External lab payable amount corrected from ${activeObligation.grossAmount} to ${newAmount}');
        expect(ordersSource).toContain('voidReason: \'lab_cost_corrected\'');
        expect(ordersSource).toContain('correctionReason: \'lab_cost_corrected\'');
        expect(ordersSource).toContain('correctionReason: \'lab_cost_added_after_ready_or_delivered\'');
        expect(ordersSource).toContain('replacedObligationId: activeObligation.id');
        expect(ordersSource).toContain('...labCostMetadata');
    });

    test('voids active shadow external lab payable when cost becomes zero', () => {
        expect(ordersSource).toContain('voidReason: \'lab_cost_zero_or_removed\'');
        expect(ordersSource).toContain('External lab payable amount corrected from ${activeObligation.grossAmount} to 0');
        expect(ordersSource).toContain('newAmount: 0');
    });

    test('skips Try-In Ready cost corrections and does not use rejected lab cost for normal payable amount correction', () => {
        expect(ordersSource).toContain("const impliedFinalReady = getProductionStatus(input.updatedOrder) === 'final_delivered' && !isTryInOrder(input.updatedOrder);");
        expect(ordersSource).toContain('const isPayableEligible = (isFinalReady(input.updatedOrder) || impliedFinalReady) && !!input.updatedOrder.supplierId;');
        expect(ordersSource).toContain('updates.cost !== undefined');
        expect(ordersSource).not.toContain('rejectedLabCost !== undefined || updates.cost');
        expect(ordersSource).not.toContain('designPrice !== undefined || updates.cost');
        expect(ordersSource).not.toContain('totalPrice !== undefined || updates.cost');
    });

    test('detects manual cost changes through effective order cost for external lab amount correction only', () => {
        expect(ordersSource).toContain('updates.cost !== undefined || updates.manualCost !== undefined');
        expect(ordersSource).toContain('const oldLabCost = getLabCostMetadata(currentOrder, isCurrentDesignerSalaried).cost;');
        expect(ordersSource).toContain('const newLabCost = getLabCostMetadata(nextOrderForAmount, isNextDesignerSalaried).cost;');
        expect(ordersSource).toContain('labCostChanged: oldLabCost !== newLabCost');
        expect(ordersSource).toContain('if (financialPartyCorrection.labCostChanged && !financialPartyCorrection.supplierChanged)');
        expect(ordersSource).not.toContain('manualCostChanged');
        expect(ordersSource).not.toContain('doctorAmountChanged: oldDoctorAmount !== newDoctorAmount || updates.manualCost');
    });

    test('runs amount correction after successful update and keeps party corrections separate', () => {
        expect(ordersSource).toContain('doctorAmountChanged: oldDoctorAmount !== newDoctorAmount');
        expect(ordersSource).toContain('labCostChanged: oldLabCost !== newLabCost');
        expect(ordersSource).toContain('financialPartyCorrection.doctorAmountChanged');
        expect(ordersSource).toContain('!financialPartyCorrection.doctorChanged');
        expect(ordersSource).toContain('!shouldVoidDoctorReceivableForLifecycle');
        expect(ordersSource).toContain('if (financialPartyCorrection.labCostChanged && !financialPartyCorrection.supplierChanged)');
        expect(ordersSource).toContain('DOCTOR_RECEIVABLE_AMOUNT_CORRECTION_FAILURE_MESSAGE');
        expect(ordersSource).toContain('EXTERNAL_LAB_PAYABLE_AMOUNT_CORRECTION_FAILURE_MESSAGE');
    });

    test('runs party correction from updateOrder after successful update without requiring admin actor role', () => {
        expect(ordersSource).toContain('updates.doctorId !== undefined || updates.supplierId !== undefined || updates.totalPrice !== undefined || updates.discount !== undefined || updates.cost !== undefined || updates.manualCost !== undefined');
        expect(ordersSource).toContain('doctorChanged: oldDoctorId !== newDoctorId');
        expect(ordersSource).toContain('supplierChanged: oldSupplierId !== newSupplierId');
        expect(ordersSource).toContain('if (updatedOrder && financialPartyCorrection && FINANCIAL_OBLIGATIONS_FLAGS.trackingEnabled)');
        expect(ordersSource).toContain('changedBy: context.userId || null');
        expect(ordersSource).not.toContain("context.actorRole === 'admin'");
        expect(ordersSource).not.toContain('actorRole === \'admin\'');
    });

    test('party correction remains shadow-only and does not wire official reporting', () => {
        expect(ordersSource).toContain('trackingOnly: true');
        expect(ordersSource).toContain('shadowMode: true');
        expect(ordersSource).not.toContain('statementService');
        expect(ordersSource).not.toContain('dashboardKpi');
        expect(ordersSource).not.toContain('financial_allocations');
        expect(ordersSource).not.toContain('entity_credits');
    });

    test('review service uses pagination, filters, and created_at descending sort', () => {
        expect(serviceSource).toContain('getFinancialObligationsReview');
        expect(serviceSource).toContain(".select('*, orders(case_id, patient_name)', { count: 'exact' })");
        expect(serviceSource).toContain('.range(from, to)');
        expect(serviceSource).toContain(".order('created_at', { ascending: false })");
        expect(serviceSource).toContain("params.entityType && params.entityType !== 'all'");
        expect(serviceSource).toContain("params.direction && params.direction !== 'all'");
        expect(serviceSource).toContain("params.status && params.status !== 'all'");
        expect(serviceSource).toContain("params.triggerType && params.triggerType !== 'all'");
        expect(serviceSource).toContain("query.gte('created_at'");
        expect(serviceSource).toContain("query.lte('created_at'");
        expect(serviceSource).toContain(".from('orders')");
        expect(serviceSource).toContain(".ilike('case_id'");
        expect(serviceSource).toContain("query.in('order_id'");
        expect(serviceSource).toContain('patientName: row.orders?.patient_name || null');
    });

    test('review service resolves doctor and external lab names only for returned page rows', () => {
        expect(serviceSource).toContain('resolveReviewEntityNames(rows)');
        expect(serviceSource).toContain(".from('doctors')");
        expect(serviceSource).toContain(".from('suppliers')");
        expect(serviceSource).toContain('entityNames.get');
    });

    test('finance review UI is read-only and does not introduce allocation, credit, or backfill actions', () => {
        const financeSource = readFileSync(resolve('src/pages/Finance.tsx'), 'utf8');
        const reviewSource = readFileSync(resolve('src/components/finance/FinancialObligationsReview.tsx'), 'utf8');

        expect(financeSource).toContain('مراجعة الالتزامات المالية');
        expect(financeSource).toContain('<FinancialObligationsReview />');
        expect(reviewSource).toContain('جاري تحميل الالتزامات المالية...');
        expect(reviewSource).toContain('لا توجد التزامات مالية مسجلة');
        expect(reviewSource).toContain('تعذر تحميل الالتزامات المالية');
        expect(reviewSource).toContain('اسم المريض');
        expect(reviewSource).toContain("item.patientName || '-'");
        expect(reviewSource).toContain('db.getFinancialObligationsReview(params)');
        expect(reviewSource).not.toContain('createFinancialObligation');
        expect(reviewSource).not.toContain('voidFinancialObligation');
        expect(reviewSource).not.toContain('delete');
        expect(reviewSource).not.toContain('allocate');
        expect(reviewSource).not.toContain('write_off');
        expect(reviewSource).not.toContain('financial_allocations');
        expect(reviewSource).not.toContain('entity_credits');
        expect(reviewSource).not.toContain('backfill');
    });

    test('historical obligations preview is exposed through db facade and remains read-only', () => {
        expect(dbSource).toContain('previewHistoricalObligationsBackfill');
        expect(dbSource).toContain("./supabase/historicalObligationsPreview");
        expect(historicalPreviewSource).toContain('previewHistoricalObligationsBackfill');
        expect(historicalPreviewSource).toContain(".from('orders')");
        expect(historicalPreviewSource).toContain(".from('financial_obligations')");
        expect(historicalPreviewSource).toContain('manual_cost');
        expect(historicalPreviewSource).toContain('rejected_lab_cost');
        expect(historicalPreviewSource).toContain('getLabCostMetadata(order, isSalariedDesigner)');
        expect(historicalPreviewSource).toContain('missing_external_lab_issue_settlement');
        expect(historicalPreviewSource).toContain('externalLabIssueSettlement');
        expect(historicalPreviewSource).toContain(".from('doctors')");
        expect(historicalPreviewSource).toContain(".from('suppliers')");
        expect(historicalPreviewSource).toContain('.range(from, to)');
        expect(historicalPreviewSource).toContain('Counts are based on the current fetched candidate orders page');

        expect(historicalPreviewSource).not.toContain('.insert(');
        expect(historicalPreviewSource).not.toContain('.update(');
        expect(historicalPreviewSource).not.toContain('.delete(');
        expect(historicalPreviewSource).not.toContain(".from('payment_allocations')");
        expect(historicalPreviewSource).not.toContain(".from('account_credits')");
        expect(historicalPreviewSource).not.toContain(".from('allocation_events')");
        expect(historicalPreviewSource).not.toContain(".from('financial_exception_reviews')");
        expect(historicalPreviewSource).not.toContain(".from('transactions')");
    });

    test('historical obligations preview does not wire official statements, reports, or dashboards', () => {
        const statementSource = readFileSync(resolve('src/services/statementService.ts'), 'utf8');
        const financeSource = readFileSync(resolve('src/pages/Finance.tsx'), 'utf8');
        const analyticsSource = readFileSync(resolve('src/pages/Analytics.tsx'), 'utf8');

        expect(statementSource).not.toContain('previewHistoricalObligationsBackfill');
        expect(financeSource).not.toContain('previewHistoricalObligationsBackfill');
        expect(analyticsSource).not.toContain('previewHistoricalObligationsBackfill');
        expect(historicalPreviewSource).not.toContain('statementService');
        expect(historicalPreviewSource).not.toContain('dashboard');
        expect(historicalPreviewSource).not.toContain('analytics');
    });

    test('historical obligations preview UI is a read-only Finance tab', () => {
        const financeSource = readFileSync(resolve('src/pages/Finance.tsx'), 'utf8');
        const previewUiSource = readFileSync(resolve('src/components/finance/HistoricalObligationsPreview.tsx'), 'utf8');

        expect(financeSource).toContain('معاينة الالتزامات القديمة');
        expect(financeSource).toContain('<HistoricalObligationsPreview />');
        expect(financeSource).toContain("activeTab === 'historicalObligationsPreview'");
        expect(previewUiSource).toContain('db.previewHistoricalObligationsBackfill(params)');
        expect(previewUiSource).toContain('جاري تحميل معاينة الالتزامات القديمة...');
        expect(previewUiSource).toContain('لا توجد نتائج في هذه الصفحة');
        expect(previewUiSource).toContain('تعذر تحميل معاينة الالتزامات القديمة');
        expect(previewUiSource).toContain('الأرقام المعروضة مبنية على الصفحة الحالية فقط لحين إضافة عدّاد شامل لاحقًا');
        expect(previewUiSource).toContain('missingDoctorReceivables');
        expect(previewUiSource).toContain('missingExternalLabPayables');
        expect(previewUiSource).toContain('warnings');
        expect(previewUiSource).toContain('total');
        expect(previewUiSource).toContain('Case ID');
        expect(previewUiSource).toContain('اسم المريض');
        expect(previewUiSource).toContain('مصدر تكلفة المعمل');
        expect(previewUiSource).toContain('تكلفة يدوية');
        expect(previewUiSource).toContain('غير محدد');
        expect(previewUiSource).toContain('مصدر التاريخ');
    });

    test('historical obligations preview UI exposes filters and warning labels without mutation actions', () => {
        const previewUiSource = readFileSync(resolve('src/components/finance/HistoricalObligationsPreview.tsx'), 'utf8');

        expect(previewUiSource).toContain('entityType');
        expect(previewUiSource).toContain('rowType');
        expect(previewUiSource).toContain('dateFrom');
        expect(previewUiSource).toContain('dateTo');
        expect(previewUiSource).toContain('pageSize');
        expect(previewUiSource).toContain('بحث برقم الحالة أو اسم المريض أو معرف الأوردر');
        expect(previewUiSource).toContain('مستحق دكتور ناقص');
        expect(previewUiSource).toContain('مستحق معمل ناقص');
        expect(previewUiSource).toContain('مستحق معمل لحالة مشكلة/رفض');
        expect(previewUiSource).toContain('حالة مشكلة بدون رقم تسوية معمل');
        expect(previewUiSource).toContain('حالة مشكلة بها رقم تسوية لكن بدون معمل');
        expect(previewUiSource).toContain('تحذير بيانات');
        expect(previewUiSource).toContain('حالة مستبعدة من الباكفيل العادي');
        expect(previewUiSource).toContain('Try-In Ready مستبعد من مستحق المعمل النهائي');

        expect(previewUiSource).not.toContain('createFinancialObligation');
        expect(previewUiSource).not.toContain('previewPaymentAllocation');
        expect(previewUiSource).not.toContain('create allocation');
        expect(previewUiSource).not.toContain('create credit');
        expect(previewUiSource).not.toContain('تطبيق');
        expect(previewUiSource).not.toContain('إنشاء مستحق');
        expect(previewUiSource).not.toContain('إنشاء توزيع');
        expect(previewUiSource).not.toContain('إنشاء رصيد');
        expect(previewUiSource).not.toContain('.insert(');
        expect(previewUiSource).not.toContain('.update(');
        expect(previewUiSource).not.toContain('.delete(');
    });

    test('historical obligations backfill batch is exposed through db facade and supports dry run', () => {
        expect(dbSource).toContain('createHistoricalObligationsBackfillBatch');
        expect(dbSource).toContain("./supabase/historicalObligationsBackfill");
        expect(historicalBackfillSource).toContain('previewHistoricalObligationsBackfill(previewParams)');
        expect(historicalBackfillSource).toContain('const dryRun = params.dryRun !== false;');
        expect(historicalBackfillSource).toContain("action: 'would_create'");
        expect(historicalBackfillSource).toContain('if (dryRun) {');
        expect(historicalBackfillSource).toContain('createFinancialObligation(input)');
    });

    test('historical obligations backfill write requires admin role and writes only missing obligation rows', () => {
        expect(historicalBackfillSource).toContain("if (!dryRun && params.actorRole !== 'admin')");
        expect(historicalBackfillSource).toContain('row.rowType === \'missing_data_warning\'');
        expect(historicalBackfillSource).toContain("action: 'warning'");
        expect(historicalBackfillSource).toContain('!isWritableReason(row.reason)');
        expect(historicalBackfillSource).toContain('matchesReasonFilter(row, params.reason)');
        expect(historicalBackfillSource).not.toContain("context.actorRole === 'admin'");
    });

    test('historical obligations backfill re-checks duplicates before every insert', () => {
        expect(historicalBackfillSource).toContain('async function duplicateExists(input: FinancialObligationInput)');
        expect(historicalBackfillSource).toContain('findExistingObligation({');
        expect(historicalBackfillSource).toContain('orderId: input.orderId');
        expect(historicalBackfillSource).toContain('entityType: input.entityType');
        expect(historicalBackfillSource).toContain('entityId: input.entityId');
        expect(historicalBackfillSource).toContain('triggerType: input.triggerType');
        expect(historicalBackfillSource).toContain('source: input.source');
        expect(historicalBackfillSource).toContain('if (await duplicateExists(input))');
        expect(historicalBackfillSource).toContain("action: 'skipped_duplicate'");
    });

    test('historical doctor receivable backfill uses doctor delivered trigger and shadow metadata', () => {
        expect(historicalBackfillSource).toContain("row.reason === 'missing_doctor_receivable'");
        expect(historicalBackfillSource).toContain('entityType: BILLING_ENTITY_TYPES.doctor');
        expect(historicalBackfillSource).toContain('direction: OBLIGATION_DIRECTIONS.receivable');
        expect(historicalBackfillSource).toContain('triggerType: OBLIGATION_TRIGGER_TYPES.doctorDelivered');
        expect(historicalBackfillSource).toContain("backfillType: 'historical_doctor_receivable'");
        expect(historicalBackfillSource).toContain('dateBasis: row.dateBasis');
        expect(historicalBackfillSource).toContain('shadowMode: true');
        expect(historicalBackfillSource).toContain('trackingOnly: true');
    });

    test('historical external lab payable backfill uses order cost and manual cost metadata', () => {
        expect(historicalBackfillSource).toContain("row.reason === 'missing_external_lab_payable'");
        expect(historicalBackfillSource).toContain('entityType: BILLING_ENTITY_TYPES.externalLab');
        expect(historicalBackfillSource).toContain('direction: OBLIGATION_DIRECTIONS.payable');
        expect(historicalBackfillSource).toContain('triggerType: OBLIGATION_TRIGGER_TYPES.externalLabReady');
        expect(historicalBackfillSource).toContain("backfillType: 'historical_external_lab_payable'");
        expect(historicalBackfillSource).toContain('cost: row.cost ?? row.amount');
        expect(historicalBackfillSource).toContain('manualCost: row.manualCost ?? null');
        expect(historicalBackfillSource).toContain("costSource: row.costSource || 'unknown'");
        expect(historicalBackfillSource).toContain('normalExternalLabPayable: true');
        expect(historicalBackfillSource).not.toContain('grossAmount: row.rejectedLabCost');
    });

    test('historical external lab issue settlement backfill uses rejected lab cost intent only', () => {
        expect(historicalBackfillSource).toContain("row.reason === 'missing_external_lab_issue_settlement'");
        expect(historicalBackfillSource).toContain('triggerType: OBLIGATION_TRIGGER_TYPES.externalLabIssueSettlement');
        expect(historicalBackfillSource).toContain("backfillType: 'historical_external_lab_issue_settlement'");
        expect(historicalBackfillSource).toContain('issueBased: true');
        expect(historicalBackfillSource).toContain('adminEnteredAmount: true');
        expect(historicalBackfillSource).toContain("sourceField: 'rejectedLabCost'");
        expect(historicalBackfillSource).toContain('rejectedLabCost: row.amount');
        expect(historicalBackfillSource).not.toContain('manualCost: row.manualCost ?? null,\\n                rejectedLabCost');
    });

    test('historical backfill calculates due date and creates unpaid unallocated shadow obligations only', () => {
        expect(historicalBackfillSource).toContain('calculateObligationDueDate(input)');
        expect(historicalBackfillSource).toContain('input.dueDate = dueDate');
        expect(historicalBackfillSource).toContain('allocatedAmount: 0');
        expect(historicalBackfillSource).toContain('status: OBLIGATION_STATUSES.unpaid');
        expect(historicalBackfillSource).toContain('source: OBLIGATION_SOURCES.order');
        expect(historicalBackfillSource).not.toContain(".from('transactions')");
        expect(historicalBackfillSource).not.toContain(".from('payment_allocations')");
        expect(historicalBackfillSource).not.toContain(".from('account_credits')");
        expect(historicalBackfillSource).not.toContain(".from('allocation_events')");
        expect(historicalBackfillSource).not.toContain(".from('financial_exception_reviews')");
        expect(historicalBackfillSource).not.toContain('previewPaymentAllocation');
    });

    test('historical backfill service is not wired to write UI or official finance flows', () => {
        const financeSource = readFileSync(resolve('src/pages/Finance.tsx'), 'utf8');
        const statementSource = readFileSync(resolve('src/services/statementService.ts'), 'utf8');
        const analyticsSource = readFileSync(resolve('src/pages/Analytics.tsx'), 'utf8');

        expect(financeSource).not.toContain('db.createHistoricalObligationsBackfillBatch');
        expect(statementSource).not.toContain('createHistoricalObligationsBackfillBatch');
        expect(analyticsSource).not.toContain('createHistoricalObligationsBackfillBatch');
        expect(historicalBackfillSource).not.toContain('statementService');
        expect(historicalBackfillSource).not.toContain('dashboard');
        expect(historicalBackfillSource).not.toContain('analytics');
        expect(historicalBackfillSource).not.toContain('account_credits');
        expect(historicalBackfillSource).not.toContain('payment_allocations');
    });

    test('historical backfill dry-run UI is a Finance tab and hardcodes dryRun true', () => {
        const financeSource = readFileSync(resolve('src/pages/Finance.tsx'), 'utf8');
        const dryRunSource = readFileSync(resolve('src/components/finance/HistoricalObligationsBackfillDryRun.tsx'), 'utf8');

        expect(financeSource).toContain('تجربة تجهيز الالتزامات القديمة');
        expect(financeSource).toContain('<HistoricalObligationsBackfillDryRun />');
        expect(financeSource).toContain("activeTab === 'historicalBackfillDryRun'");
        expect(dryRunSource).toContain('db.createHistoricalObligationsBackfillBatch(params)');
        expect(dryRunSource).toContain('dryRun: true as const');
        expect(dryRunSource).not.toContain('dryRun: false');
        expect(dryRunSource).not.toContain('setDryRun');
        expect(dryRunSource).toContain('هذه تجربة فقط. لن يتم إنشاء أي التزامات أو ربط أي تحصيلات أو تعديل أي حسابات.');
    });

    test('historical backfill dry-run UI renders summary and rows without write actions', () => {
        const dryRunSource = readFileSync(resolve('src/components/finance/HistoricalObligationsBackfillDryRun.tsx'), 'utf8');

        expect(dryRunSource).toContain('processed');
        expect(dryRunSource).toContain('createdDoctorReceivables');
        expect(dryRunSource).toContain('createdExternalLabPayables');
        expect(dryRunSource).toContain('createdIssueSettlementPayables');
        expect(dryRunSource).toContain('skippedDuplicate');
        expect(dryRunSource).toContain('warnings');
        expect(dryRunSource).toContain('hasMore');
        expect(dryRunSource).toContain('nextPage');
        expect(dryRunSource).toContain('سيتم إنشاؤه');
        expect(dryRunSource).toContain('مكرر / موجود بالفعل');
        expect(dryRunSource).toContain('تحذير');
        expect(dryRunSource).toContain('خطأ');
        expect(dryRunSource).toContain('Case ID');
        expect(dryRunSource).toContain('اسم المريض');
        expect(dryRunSource).toContain('Trigger');

        expect(dryRunSource).not.toContain('createFinancialObligation');
        expect(dryRunSource).not.toContain('voidFinancialObligation');
        expect(dryRunSource).not.toContain('payment_allocations');
        expect(dryRunSource).not.toContain('account_credits');
        expect(dryRunSource).not.toContain('تطبيق');
        expect(dryRunSource).not.toContain('باكفيل');
        expect(dryRunSource).not.toContain('حفظ');
    });

    test('financial reconciliation preview is exposed through db facade and remains read-only', () => {
        expect(dbSource).toContain('previewFinancialReconciliation');
        expect(dbSource).toContain("./supabase/financialReconciliationPreview");
        expect(reconciliationSource).toContain('previewFinancialReconciliation');
        expect(reconciliationSource).toContain("fetchAllRows<OrderRow>('orders'");
        expect(reconciliationSource).toContain("fetchAllRows<TransactionRow>('transactions'");
        expect(reconciliationSource).toContain("fetchAllRows<ObligationRow>('financial_obligations'");
        expect(reconciliationSource).toContain("fetchAllRows<Adjustment>('adjustments'");
        expect(reconciliationSource).toContain(".from('doctors')");
        expect(reconciliationSource).toContain(".from('suppliers')");
        expect(reconciliationSource).toContain('slice(from, from + pageSize)');

        expect(reconciliationSource).not.toContain('.insert(');
        expect(reconciliationSource).not.toContain('.update(');
        expect(reconciliationSource).not.toContain('.delete(');
        expect(reconciliationSource).not.toContain(".from('payment_allocations')");
        expect(reconciliationSource).not.toContain(".from('account_credits')");
        expect(reconciliationSource).not.toContain(".from('allocation_events')");
        expect(reconciliationSource).not.toContain(".from('financial_exception_reviews')");
    });

    test('financial reconciliation preview mirrors current official account sources', () => {
        expect(reconciliationSource).toContain('getDoctorReceivableAmount(order)');
        expect(reconciliationSource).toContain('getOfficialStatementDate(order)');
        expect(reconciliationSource).toContain('isDoctorStatementIncluded(order)');
        expect(reconciliationSource).toContain("transaction.entity_type === 'doctor' || !transaction.entity_type");
        expect(reconciliationSource).toContain("transaction.entity_type === 'supplier' || !transaction.entity_type");
        expect(reconciliationSource).toContain("transaction.type === 'income'");
        expect(reconciliationSource).toContain("transaction.type === 'expense'");
        expect(reconciliationSource).toContain("adjustment.entity_type === 'doctor'");
        expect(reconciliationSource).toContain("adjustment.entity_type === 'supplier'");
        expect(reconciliationSource).toContain("const isDoctorRejected = isDoctorRejectedStatus(order.status);");
        expect(reconciliationSource).toContain("const hasRejectionCost = isDoctorRejected && typeof order.rejectedLabCost === 'number';");
        expect(reconciliationSource).toContain("getLabCostMetadata(order, isSalaried)");
    });

    test('financial reconciliation preview compares obligations against transactions and flags differences', () => {
        expect(reconciliationSource).toContain("obligation.entity_type === 'doctor'");
        expect(reconciliationSource).toContain("obligation.trigger_type === 'doctor_delivered'");
        expect(reconciliationSource).toContain("obligation.trigger_type === 'external_lab_ready'");
        expect(reconciliationSource).toContain("obligation.trigger_type === 'external_lab_issue_settlement'");
        expect(reconciliationSource).toContain('const obligationBasedBalance = obligationTotal - transactionPaymentTotal');
        expect(reconciliationSource).toContain('const difference = obligationBasedBalance - officialBalance');
        expect(reconciliationSource).toContain("'difference_zero'");
        expect(reconciliationSource).toContain("'difference_nonzero'");
        expect(reconciliationSource).toContain("'missing_transactions'");
        expect(reconciliationSource).toContain("'obligations_without_transactions'");
        expect(reconciliationSource).toContain("'payments_without_obligations'");
        expect(reconciliationSource).toContain("'issue_settlement_present'");
    });

    test('financial reconciliation preview classifies settlement and stale receivable differences without writes', () => {
        expect(reconciliationSource).toContain("'account_closing_or_dispute_settlement_needed'");
        expect(reconciliationSource).toContain("'stale_doctor_receivable_after_rejection'");
        expect(reconciliationSource).toContain("'obligations_include_item_not_in_official_logic'");
        expect(reconciliationSource).toContain("'doctor_payment_missing'");
        expect(reconciliationSource).toContain('supplierSettlementTransactionByEntity');
        expect(reconciliationSource).toContain("settlementText.includes('تقفيل')");
        expect(reconciliationSource).toContain("settlementText.includes('فرق')");
        expect(reconciliationSource).toContain("settlementText.includes('settlement')");
        expect(reconciliationSource).toContain('staleDoctorReceivableByEntity');
        expect(reconciliationSource).toContain('orderById.get(obligation.order_id)');
        expect(reconciliationSource).toContain('getDoctorReceivableAmount(order) <= 0');
    });

    test('financial reconciliation preview does not wire official finance flows', () => {
        const financeSource = readFileSync(resolve('src/pages/Finance.tsx'), 'utf8');
        const accountsSource = readFileSync(resolve('src/pages/Accounts.tsx'), 'utf8');
        const statementSource = readFileSync(resolve('src/services/statementService.ts'), 'utf8');
        const analyticsSource = readFileSync(resolve('src/pages/Analytics.tsx'), 'utf8');

        expect(financeSource).not.toContain('previewFinancialReconciliation');
        expect(accountsSource).not.toContain('previewFinancialReconciliation');
        expect(statementSource).not.toContain('previewFinancialReconciliation');
        expect(analyticsSource).not.toContain('previewFinancialReconciliation');
        expect(reconciliationSource).not.toContain('createHistoricalObligationsBackfillBatch');
        expect(reconciliationSource).not.toContain('previewPaymentAllocation');
        expect(reconciliationSource).not.toContain('createFinancialObligation');
    });
});

test.describe('manualCost clearing contract', () => {
    const ordersSource = readFileSync(resolve('src/services/supabase/orders.ts'), 'utf8');
    const orderFormSource = readFileSync(resolve('src/components/orders/OrderForm.tsx'), 'utf8');

    test('updateOrder rejects clearing manualCost without providing recalculated cost', () => {
        expect(ordersSource).toContain("'manualCost' in updates && updates.manualCost === null && updates.cost === undefined");
        expect(ordersSource).toContain('Clearing manual cost requires providing the recalculated effective cost.');
    });

    test('updateOrder mirrors cost to manualCost when manualCost is a number and cost is omitted', () => {
        expect(ordersSource).toContain("if (updates.cost === undefined && typeof updates.manualCost === 'number')");
        expect(ordersSource).toContain('dbUpdates.cost = updates.manualCost;');
    });

    test('updateOrder accepts clearing manualCost when cost is provided alongside', () => {
        // The validation only fires when cost is undefined; when provided, both fields are written.
        expect(ordersSource).toContain('if (updates.cost !== undefined) dbUpdates.cost = updates.cost;');
        expect(ordersSource).toContain('dbUpdates.manual_cost = updates.manualCost ?? null;');
    });

    test('clearing manualCost runs external lab payable amount correction via effective cost comparison', () => {
        // Trigger condition includes manualCost so amount-only changes are detected.
        expect(ordersSource).toContain('updates.cost !== undefined || updates.manualCost !== undefined');
        // Old/new lab cost are computed via effective cost (manualCost-aware).
        expect(ordersSource).toContain('const oldLabCost = getLabCostMetadata(currentOrder, isCurrentDesignerSalaried).cost;');
        expect(ordersSource).toContain('const newLabCost = getLabCostMetadata(nextOrderForAmount, isNextDesignerSalaried).cost;');
        // The amount-correction branch reads effective cost too.
        expect(ordersSource).toContain('const labCostMetadata = getLabCostMetadata(input.updatedOrder, isUpdatedDesignerSalaried);');
        expect(ordersSource).toContain('const newAmount = labCostMetadata.cost;');
    });

    test('doctor receivable amount is not affected by manualCost or cost changes', () => {
        // Doctor receivable is totalPrice-based; manualCost/cost must never appear in its trigger.
        expect(ordersSource).toContain('const oldDoctorAmount = getDoctorReceivableAmount(currentOrder);');
        expect(ordersSource).toContain('const newDoctorAmount = getDoctorReceivableAmount(nextOrderForAmount);');
        expect(ordersSource).not.toContain('doctorAmountChanged: oldDoctorAmount !== newDoctorAmount || updates.manualCost');
        expect(ordersSource).not.toContain('doctorAmountChanged: oldDoctorAmount !== newDoctorAmount || updates.cost');
    });

    test('rejectedLabCost remains separate from normal lab cost flow', () => {
        // Mapped via its own DB column and not mixed into the lab cost correction path.
        expect(ordersSource).toContain('if (updates.rejectedLabCost !== undefined) dbUpdates.rejected_lab_cost = updates.rejectedLabCost || null;');
        expect(ordersSource).not.toContain('rejectedLabCost !== undefined || updates.cost');
        expect(ordersSource).not.toContain('rejectedLabCost !== undefined || updates.manualCost');
    });

    test('isFinancialAdminOnly does not strip workflow fields when they are actually changing', () => {
        expect(ordersSource).toContain('const anyWorkflowFieldChanging = workflowFields.some');
        expect(ordersSource).toContain('!anyWorkflowFieldChanging');
    });

    test('OrderForm always sends recalculated cost when saving (including when manualCost is cleared)', () => {
        // Both `cost` and `manualCost` are submitted together. When the admin clears
        // the manual override (manualCost state === null), `cost` falls back to the
        // calculated automatic cost — satisfying the backend contract.
        expect(orderFormSource).toContain('cost: finalCost,');
        expect(orderFormSource).toContain('manualCost: (isAdmin && manualCost !== null) ? manualCost : null,');
    });
});

test.describe('financial obligations migration', () => {
    const migration = readFileSync(resolve('supabase/migrations/082_financial_obligations.sql'), 'utf8');

    test('creates order-based financial obligations table with generated remaining amount', () => {
        expect(migration).toContain('CREATE TABLE IF NOT EXISTS financial_obligations');
        expect(migration).toContain('order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE');
        expect(migration).toContain('GENERATED ALWAYS AS (net_amount - allocated_amount) STORED');
        expect(migration).toContain('allocated_amount <= net_amount');
    });

    test('adds partial unique index for duplicate prevention', () => {
        expect(migration).toContain('uq_financial_obligation_source_trigger');
        expect(migration).toContain('ON financial_obligations(order_id, entity_type, entity_id, direction, trigger_type, source)');
        expect(migration).toContain("WHERE status <> 'void'");
    });

    test('adds conservative RLS policies', () => {
        expect(migration).toContain('Admins manage financial obligations');
        expect(migration).toContain('Accountants view financial obligations');
        expect(migration).toContain('Representatives view doctor receivable obligations');
        expect(migration).toContain("entity_type = 'doctor'");
        expect(migration).toContain("direction = 'receivable'");
    });

    test('does not create allocations, credits, backfill, reports, or lifecycle wiring', () => {
        const lowerMigration = migration.toLowerCase();

        expect(lowerMigration).not.toContain('financial_allocations');
        expect(lowerMigration).not.toContain('entity_credits');
        expect(lowerMigration).not.toContain('payment_allocations');
        expect(lowerMigration).not.toContain('historical_backfill');
        expect(lowerMigration).not.toContain('backfill_preview');
        expect(lowerMigration).not.toContain('dashboard');
        expect(lowerMigration).not.toContain('analytics');
        expect(lowerMigration).not.toContain('order_events');
    });
});

test.describe('allocation engine foundation migration', () => {
    const migration = readFileSync(resolve('supabase/migrations/083_allocation_engine_foundation.sql'), 'utf8');
    const lowerMigration = migration.toLowerCase();
    const transactionsSource = readFileSync(resolve('src/services/supabase/transactions.ts'), 'utf8');
    const financeSource = readFileSync(resolve('src/pages/Finance.tsx'), 'utf8');
    const statementSource = readFileSync(resolve('src/services/statementService.ts'), 'utf8');

    test('creates empty foundation tables for allocations, credits, audit, and exception reviews', () => {
        expect(migration).toContain('CREATE TABLE IF NOT EXISTS payment_allocations');
        expect(migration).toContain('CREATE TABLE IF NOT EXISTS account_credits');
        expect(migration).toContain('CREATE TABLE IF NOT EXISTS allocation_events');
        expect(migration).toContain('CREATE TABLE IF NOT EXISTS financial_exception_reviews');
    });

    test('defines required payment allocation columns, checks, and indexes', () => {
        expect(migration).toContain('payment_transaction_id UUID NOT NULL REFERENCES transactions(id)');
        expect(migration).toContain('obligation_id UUID NOT NULL REFERENCES financial_obligations(id)');
        expect(migration).toContain("CHECK (entity_type IN ('doctor', 'external_lab', 'designer'))");
        expect(migration).toContain("CHECK (direction IN ('receivable', 'payable'))");
        expect(migration).toContain('CHECK (allocated_amount > 0)');
        expect(migration).toContain("'fifo'");
        expect(migration).toContain("'manual'");
        expect(migration).toContain("'credit_auto_apply'");
        expect(migration).toContain("'correction_transfer'");
        expect(migration).toContain("CHECK (status IN ('active', 'reversed', 'void'))");
        expect(migration).toContain('idx_payment_allocations_transaction');
        expect(migration).toContain('idx_payment_allocations_obligation');
        expect(migration).toContain('idx_payment_allocations_entity');
        expect(migration).toContain('idx_payment_allocations_status_allocated_at');
        expect(migration).toContain('idx_payment_allocations_method');
    });

    test('prevents active allocations to void obligations without syncing allocated amounts yet', () => {
        expect(migration).toContain('prevent_active_allocation_to_void_obligation');
        expect(migration).toContain("IF obligation_status = 'void' THEN");
        expect(migration).toContain('Cannot create active allocation for a void financial obligation');
        expect(migration).not.toContain('UPDATE financial_obligations');
        expect(migration).not.toContain('allocated_amount = allocated_amount');
    });

    test('defines account credits with allowed sources, statuses, and amount constraints', () => {
        expect(migration).toContain('source_transaction_id UUID REFERENCES transactions(id)');
        expect(migration).toContain('source_allocation_id UUID REFERENCES payment_allocations(id)');
        expect(migration).toContain('source_obligation_id UUID REFERENCES financial_obligations(id)');
        expect(migration).toContain("'overpayment'");
        expect(migration).toContain("'correction_excess'");
        expect(migration).toContain("'manual_credit'");
        expect(migration).toContain("'refund_cancelled'");
        expect(migration).toContain("'supplier_credit'");
        expect(migration).toContain("'supplier_review'");
        expect(migration).toContain("CHECK (status IN ('active', 'used', 'refunded', 'void', 'review'))");
        expect(migration).toContain('CONSTRAINT account_credits_remaining_valid CHECK (remaining_amount <= amount)');
    });

    test('defines allocation event and exception review audit vocabularies', () => {
        expect(migration).toContain("'allocation_created'");
        expect(migration).toContain("'allocation_reversed'");
        expect(migration).toContain("'allocation_transferred'");
        expect(migration).toContain("'credit_created'");
        expect(migration).toContain("'credit_applied'");
        expect(migration).toContain("'manual_override_applied'");
        expect(migration).toContain("'supplier_payment_review_required'");
        expect(migration).toContain("'supplier_corrected_after_payment'");
        expect(migration).toContain("'supplier_cost_decreased_after_payment'");
        expect(migration).toContain("'supplier_overpayment'");
        expect(migration).toContain("'voided_obligation_has_payment'");
        expect(migration).toContain("'overallocated_obligation'");
        expect(migration).toContain("CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed'))");
    });

    test('adds conservative RLS policies with admin manage and accountant select only', () => {
        for (const tableName of ['payment_allocations', 'account_credits', 'allocation_events', 'financial_exception_reviews']) {
            expect(migration).toContain(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`);
        }

        expect(migration).toContain('Admins manage payment allocations');
        expect(migration).toContain('Accountants view payment allocations');
        expect(migration).toContain('Admins manage account credits');
        expect(migration).toContain('Accountants view account credits');
        expect(migration).toContain('Admins manage allocation events');
        expect(migration).toContain('Accountants view allocation events');
        expect(migration).toContain('Admins manage financial exception reviews');
        expect(migration).toContain('Accountants view financial exception reviews');
        expect(migration).not.toContain('Representatives view payment allocations');
        expect(migration).not.toContain('Representatives view account credits');
        expect(migration).not.toContain('Representatives view allocation events');
        expect(migration).not.toContain('Representatives view financial exception reviews');
    });

    test('contains no data migration, historical allocation, credit creation, or transaction linking writes', () => {
        expect(lowerMigration).not.toContain('insert into payment_allocations');
        expect(lowerMigration).not.toContain('insert into account_credits');
        expect(lowerMigration).not.toContain('insert into allocation_events');
        expect(lowerMigration).not.toContain('insert into financial_exception_reviews');
        expect(lowerMigration).not.toContain('bulk insert');
        expect(lowerMigration).not.toContain('bulk update');
    });

    test('does not wire transactions, finance UI, or statements to allocation/credit tables', () => {
        expect(transactionsSource).not.toContain('payment_allocations');
        expect(transactionsSource).not.toContain('account_credits');
        expect(financeSource).not.toContain('payment_allocations');
        expect(financeSource).not.toContain('account_credits');
        expect(statementSource).not.toContain('payment_allocations');
        expect(statementSource).not.toContain('account_credits');
    });
});

test.describe('external lab issue settlement trigger migration', () => {
    const migration = readFileSync(resolve('supabase/migrations/084_add_external_lab_issue_settlement_trigger.sql'), 'utf8');
    const lowerMigration = migration.toLowerCase();

    test('widens financial obligation trigger type constraint for issue settlement without removing existing values', () => {
        expect(migration).toContain('financial_obligations_trigger_type_check');
        expect(migration).toContain('external_lab_issue_settlement');
        expect(migration).toContain('doctor_delivered');
        expect(migration).toContain('external_lab_ready');
        expect(migration).toContain('designer_approved');
        expect(migration).toContain('manual_adjustment');
    });

    test('drops and recreates only the trigger_type check constraint safely', () => {
        expect(migration).toContain('pg_get_constraintdef');
        expect(migration).toContain("ILIKE '%trigger_type%'");
        expect(migration).toContain('DROP CONSTRAINT');
        expect(migration).toContain('ADD CONSTRAINT financial_obligations_trigger_type_check');
    });

    test('does not add backfill writes, allocations, credits, or official reporting changes', () => {
        expect(lowerMigration).not.toContain('insert into financial_obligations');
        expect(lowerMigration).not.toContain('update financial_obligations');
        expect(lowerMigration).not.toContain('insert into payment_allocations');
        expect(lowerMigration).not.toContain('insert into account_credits');
        expect(lowerMigration).not.toContain('transactions');
        expect(lowerMigration).not.toContain('statement');
        expect(lowerMigration).not.toContain('dashboard');
        expect(lowerMigration).not.toContain('analytics');
    });
});
