import { describe, expect, it } from 'vitest';
import { buildExternalLabPayableCandidate, shouldCreateExternalLabPayableObligationForStatusChange, buildDesignerPayableCandidate } from '../../src/constants/financialObligations';
const order = { id:'timing',supplierId:'supplier',cost:400,designPrice:100,workflowType:'split',designerId:'designer',designStatus:'completed',issueState:'none',createdAt:'2026-10-01',deliveryDate:'2026-10-15' };
describe('normal supplier final-receipt policy', () => {
    it.each(['not_started','designing','in_production','try_in_ready','waiting_doctor','finalization','final_ready'])('%s cannot earn AP even with legacy implied-ready hint', productionStatus => {
        expect(buildExternalLabPayableCandidate({...order,productionStatus},{impliedFinalReady:true})).toBeNull();
    });
    it('earns the supplier split at actual final receipt', () => {
        expect(buildExternalLabPayableCandidate({...order,productionStatus:'final_delivered',actualDeliveryDate:'2026-11-03'})).toMatchObject({grossAmount:300,triggerDate:'2026-11-03'});
    });
    it('does not create on Ready; creates on Ready-to-delivered and direct delivered only once', () => {
        expect(shouldCreateExternalLabPayableObligationForStatusChange({productionStatus:'in_production'},{productionStatus:'final_ready'}).shouldCreate).toBe(false);
        expect(shouldCreateExternalLabPayableObligationForStatusChange({productionStatus:'final_ready'},{productionStatus:'final_delivered'}).shouldCreate).toBe(true);
        expect(shouldCreateExternalLabPayableObligationForStatusChange({productionStatus:'final_delivered'},{productionStatus:'final_delivered'}).shouldCreate).toBe(false);
    });
    it('retains design completion earning before final receipt', () => {
        expect(buildDesignerPayableCandidate({...order,productionStatus:'designing'})).toMatchObject({grossAmount:100});
    });
});
