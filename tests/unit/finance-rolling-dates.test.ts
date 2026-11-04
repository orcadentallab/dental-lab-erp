import {afterEach,expect,it,vi} from 'vitest';
import {filterEntries} from '../../src/components/finance/FinanceFilters';
afterEach(()=>vi.useRealTimers());
it('includes seven calendar days including today across a month boundary, excluding future dates',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date(2026,10,4,16));
 const rows=['2026-10-28','2026-10-29','2026-11-04','2026-11-05'].map(date=>({date}));
 expect(filterEntries(rows,'last7').map(x=>x.date)).toEqual(['2026-10-29','2026-11-04']);
});
it('includes thirty calendar days including today rather than the current month',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date(2026,10,4,16));
 const rows=['2026-10-05','2026-10-06','2026-10-31','2026-11-04','2026-11-05'].map(date=>({date}));
 expect(filterEntries(rows,'last30').map(x=>x.date)).toEqual(['2026-10-06','2026-10-31','2026-11-04']);
});
