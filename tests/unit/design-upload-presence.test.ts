import {describe,it,expect} from 'vitest';
import {canChangeProductionStatus} from '../../src/lib/workflowPermissions';
import {getForwardActions} from '../../src/constants/workflowTransitions';
import {isDesignSubmitted,getDesignSubmittedAt} from '../../src/lib/designerOrderUtils';
import type {Order} from '../../src/services/db';
describe('uploaded designs are usable without a fabricated URL',()=>{
 it('retains submitted state and its real timestamp',()=>{
  const order={designRevisionId:'revision',designStatus:'completed',designSubmittedAt:'2026-11-05T00:00:00Z'} as Order;
  expect(isDesignSubmitted(order)).toBe(true);expect(getDesignSubmittedAt(order)).toBe(order.designSubmittedAt);
 });
 it('counts a saved upload as design evidence without granting new roles',()=>{
  const context={workflowType:'split',designRevisionId:'revision'};
  expect(canChangeProductionStatus('production_manager','designing','in_production','none',context)).toBe(true);
  expect(canChangeProductionStatus('designer','designing','in_production','none',context)).toBe(false);
  expect(canChangeProductionStatus('production_manager','designing','in_production','none',{workflowType:'split'})).toBe(false);
  expect(getForwardActions('designing','none',context)).toHaveLength(1);
 });
});
