import {describe,it,expect,vi} from 'vitest';
const designer='ad000000-0000-4000-8000-000000000001';
vi.mock('../../src/lib/supabase',()=>({supabase:{
 rpc:async(name:string)=>({error:null,data:name==='get_my_role'?'designer':name==='get_my_user_id'?'ad000000-0000-4000-8000-000000000001':name==='get_designer_workspace'?[{id:'active',case_id:'ACTIVE',designer_id:'ad000000-0000-4000-8000-000000000001',workflow_type:'split',design_status:'in_progress',design_price:100,order_items:[]}]:name==='get_design_qc_compensations'?[{id:'settled',orderId:'former',caseId:'FORMER',designerId:'ad000000-0000-4000-8000-000000000001',amount:80,date:'2026-11-05'}]:null}),
 from:()=>{const chain={select:()=>chain,eq:()=>chain,order:()=>chain,range:async()=>({data:[],error:null})};return chain;}
}}));
import {fetchFullEntityStatement} from '../../src/services/supabase/orders';
import {getDesignerStatementAmount} from '../../src/constants/orderStatementFinancials';
describe('designer contribution detail parity',()=>{
 it('retains former earned contributions when another assigned order exists',async()=>{
  const result=await fetchFullEntityStatement(designer,'designer');
  expect(result.orders.map(o=>o.id)).toEqual(['active','qc-contribution-settled']);
  expect(getDesignerStatementAmount(result.orders[1],false)).toBe(80);
  expect(result.transactions).toEqual([]);
 });
});
