import {describe,it,expect} from 'vitest';
import {isAwaitingDesignQc,sortDesignQcQueue,formatDesignQcAge} from '../../src/lib/designQcQueue';
import type {DesignQueueItem} from '../../src/services/supabase/designQc';
const item=(id:string,required:boolean,state:string,submittedAt:string|null,revisionId:string|null='revision'):DesignQueueItem=>({id,caseId:id,required,state,revisionId,submittedAt});
describe('QC waiting work and upload age',()=>{
 it('counts mandatory pending revisions and unresolved bypass reviews only',()=>{
  expect(isAwaitingDesignQc(item('pending',true,'pending',null))).toBe(true);
  expect(isAwaitingDesignQc(item('bypass',false,'bypassed',null))).toBe(true);
  for(const row of [item('paused',false,'pending',null),item('not-uploaded',true,'pending',null,null),item('approved',true,'approved',null),item('rejected',true,'rejected',null)])expect(isAwaitingDesignQc(row)).toBe(false);
 });
 it('puts waiting work first and the oldest actual upload ahead of newer ones without mutating the input',()=>{
  const rows=[item('approved',true,'approved','2026-11-01T00:00:00Z'),item('new',true,'pending','2026-11-05T08:00:00Z'),item('unknown',true,'pending',null),item('old',true,'bypassed','2026-11-05T02:00:00Z')];
  expect(sortDesignQcQueue(rows).map(r=>r.id)).toEqual(['old','new','unknown','approved']);expect(rows[0].id).toBe('approved');
 });
 it('does not invent an age for missing dates or report a negative wait',()=>{
  const now=Date.parse('2026-11-05T10:00:00Z');
  expect(formatDesignQcAge(null,now)).toBe('وقت الرفع غير متاح');
  expect(formatDesignQcAge('bad',now)).toBe('وقت الرفع غير متاح');
  expect(formatDesignQcAge('2026-11-06T10:00:00Z',now)).toBe('منذ أقل من دقيقة');
  expect(formatDesignQcAge('2026-11-05T08:00:00Z',now)).toContain('ساعتين');
 });
});
