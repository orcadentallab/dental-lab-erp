import {describe,it,expect,vi,beforeEach} from 'vitest';
const api=vi.hoisted(()=>({rpc:vi.fn(),upload:vi.fn()}));
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:api.rpc,storage:{from:()=>({upload:api.upload})}}}));
import {submitDesignDelivery} from '../../src/services/supabase/designQc';
describe('owner choice: one execution source',()=>{
 beforeEach(()=>{vi.clearAllMocks();api.rpc.mockResolvedValue({data:'revision',error:null});api.upload.mockResolvedValue({error:null});});
 it('submits a link without uploading a duplicate execution package',async()=>{
  await expect(submitDesignDelivery('case',{mode:'link',url:'https://drive.google.com/file/d/example',execution:null,html:null,reason:'No preview supplied'})).resolves.toBe('revision');
  expect(api.upload).not.toHaveBeenCalled();expect(api.rpc).toHaveBeenCalledWith('submit_design_delivery',expect.objectContaining({p_mode:'link',p_execution_url:'https://drive.google.com/file/d/example'}));
 });
 it('submits an uploaded ZIP without demanding or fabricating a link',async()=>{
  await submitDesignDelivery('case',{mode:'file',url:'',execution:new File(['zip'],'case.zip'),html:null,reason:'No preview supplied'});
  expect(api.upload).toHaveBeenCalledTimes(1);expect(api.rpc).toHaveBeenCalledWith('submit_design_delivery',expect.objectContaining({p_mode:'file',p_execution_url:null}));
 });
 it('rejects no source, unsafe links and both sources before writing',async()=>{
  for(const input of [{mode:'link' as const,url:'',execution:null},{mode:'link' as const,url:'javascript:alert(1)',execution:null},{mode:'link' as const,url:'https://example.test/file',execution:new File(['zip'],'case.zip')},{mode:'file' as const,url:'',execution:null}])await expect(submitDesignDelivery('case',{...input,html:null,reason:'No preview'})).rejects.toThrow();
  expect(api.rpc).not.toHaveBeenCalled();expect(api.upload).not.toHaveBeenCalled();
 });
});
