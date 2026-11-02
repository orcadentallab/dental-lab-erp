import {beforeEach,describe,it,expect,vi} from 'vitest';
const api=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),signed:vi.fn()}));
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:api.rpc,storage:{from:api.from}}}));
import {designExecutionUrl} from '../../src/services/supabase/designQc';

describe('canonical design download and legacy compatibility',()=>{
 beforeEach(()=>{vi.resetAllMocks();api.from.mockReturnValue({createSignedUrl:api.signed});});
 it('retains domain-only legacy URLs accepted by existing submission',async()=>{
  api.rpc.mockResolvedValue({data:null,error:null});
  await expect(designExecutionUrl('case','drive.google.com/file/d/legacy')).resolves.toBe('https://drive.google.com/file/d/legacy');
  expect(api.from).not.toHaveBeenCalled();
 });
 it('uses a short-lived immutable file URL instead of the mutable reference',async()=>{
  api.rpc.mockResolvedValue({data:'case/revision/execution.zip',error:null});
  api.signed.mockResolvedValue({data:{signedUrl:'http://127.0.0.1/signed?token=opaque'},error:null});
  await expect(designExecutionUrl('case','https://mutable.example.test')).resolves.toBe('http://127.0.0.1/signed?token=opaque');
  expect(api.signed).toHaveBeenCalledWith('case/revision/execution.zip',60);
 });
 it('resolves the running stage snapshot when a stage is provided',async()=>{
  api.rpc.mockResolvedValue({data:null,error:null});
  await designExecutionUrl('case','https://legacy.example.test','stage');
  expect(api.rpc).toHaveBeenCalledWith('get_stage_design_execution_path',{p_stage_id:'stage'});
  expect(api.rpc).toHaveBeenCalledTimes(1);
 });
 it('never falls back to a known reference after assignment access is denied',async()=>{
  api.rpc.mockResolvedValue({data:null,error:{message:'Design access denied'}});
  await expect(designExecutionUrl('case','https://known.example.test')).rejects.toThrow('لم يعد لديك صلاحية');
  expect(api.from).not.toHaveBeenCalled();
 });
 it('does not silently use mutable files when private signing fails',async()=>{
  api.rpc.mockResolvedValue({data:'case/revision/execution.zip',error:null});
  api.signed.mockResolvedValue({data:null,error:{message:'Storage unavailable'}});
  await expect(designExecutionUrl('case','https://mutable.example.test')).rejects.toThrow('Storage unavailable');
 });
});
