import { describe, expect, it } from 'vitest';
import { getImportedOrderWorkflowAxes } from '../../src/lib/excelImporter';

describe('historical order import workflow V2 adapter', () => {
    it.each([
        ['New Case', 'not_started', 'none'],
        ['Under Design', 'designing', 'none'],
        ['Printing', 'in_production', 'none'],
        ['Try In', 'try_in_ready', 'none'],
        ['Ready', 'final_ready', 'none'],
        ['Delivered', 'final_delivered', 'none'],
        ['Cancelled', 'not_started', 'cancelled'],
    ] as const)('maps %s to V2 axes', (legacyStatus, productionStatus, issueState) => {
        expect(getImportedOrderWorkflowAxes(legacyStatus)).toMatchObject({
            productionStatus,
            issueState,
            intakeState: 'accepted',
        });
    });

    it('preserves the historical importer default of treating unknown values as delivered', () => {
        expect(getImportedOrderWorkflowAxes('old custom value')).toMatchObject({
            status: 'Delivered',
            productionStatus: 'final_delivered',
            issueState: 'none',
        });
    });
});
