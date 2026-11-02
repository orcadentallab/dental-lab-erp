import {describe,it,expect} from 'vitest';
import {validateDesignFiles,isolatedDesignHtml,DESIGN_EXECUTION_MAX_BYTES,DESIGN_HTML_MAX_BYTES} from '../../src/lib/designPreview';
import {designQcCompensationRows} from '../../src/lib/designQcCompensations';
import {getDesignerStatementAmount,getSupplierStatementAmount} from '../../src/constants/orderStatementFinancials';
const file=(name:string,size:number)=>({name,size} as File);
describe('Design QC immutable file validation and isolation',()=>{
 it('accepts ZIP and standalone HTML within bounds',()=>{expect(()=>validateDesignFiles(file('case.zip',20),file('preview.html',30))).not.toThrow();});
 it.each([file('case.html',20),file('case.zip',0),file('case.zip',DESIGN_EXECUTION_MAX_BYTES+1)])('rejects invalid execution file %j',f=>{expect(()=>validateDesignFiles(f)).toThrow();});
 it.each([file('preview.js',20),file('preview.html',0),file('preview.html',DESIGN_HTML_MAX_BYTES+1)])('rejects invalid preview %j',f=>{expect(()=>validateDesignFiles(file('case.zip',10),f)).toThrow();});
 it('adds CSP before attacker markup and permits no credential-bearing origin',()=>{
  const html=isolatedDesignHtml('<script>fetch("https://evil.test")</script>');
  expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script>'));
  expect(html).toContain("connect-src 'none'"); expect(html).toContain("form-action 'none'");expect(html).toContain("base-uri 'none'");
 });
 it('projects settled contributions only into designer financial consumers',()=>{
  const [row]=designQcCompensationRows([{id:'settlement',orderId:'case',caseId:'QC-1',designerId:'old',amount:80,date:'2026-11-03'}]);
  expect(getDesignerStatementAmount(row,false)).toBe(80);
  expect(getSupplierStatementAmount(row,false,false)).toBeNull();
  expect(row.doctorId).toBe(''); expect(row.totalPrice).toBe(0);expect(row.id).toBe('qc-contribution-settlement');
 });
});
