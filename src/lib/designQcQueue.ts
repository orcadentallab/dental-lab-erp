import type {DesignQueueItem} from '../services/supabase/designQc';
export const DESIGN_QC_CHANGED='orca:design-qc-changed';
export function isAwaitingDesignQc(row:DesignQueueItem):boolean{
 return !!row.revisionId&&((row.required&&row.state==='pending')||row.state==='bypassed');
}
export function sortDesignQcQueue(rows:DesignQueueItem[]):DesignQueueItem[]{
 const timestamp=(value:string|null|undefined)=>{const parsed=value?Date.parse(value):NaN;return Number.isFinite(parsed)?parsed:Number.POSITIVE_INFINITY;};
 return [...rows].sort((a,b)=>Number(isAwaitingDesignQc(b))-Number(isAwaitingDesignQc(a))||timestamp(a.submittedAt)-timestamp(b.submittedAt)||a.id.localeCompare(b.id));
}
export function formatDesignQcAge(value:string|null|undefined,now:number):string{
 const submitted=value?Date.parse(value):NaN;
 if(!Number.isFinite(submitted))return 'وقت الرفع غير متاح';
 const minutes=Math.floor(Math.max(0,now-submitted)/60000);
 if(minutes<1)return 'منذ أقل من دقيقة';
 const formatter=new Intl.RelativeTimeFormat('ar-EG',{numeric:'always'});
 if(minutes<60)return formatter.format(-minutes,'minute');
 if(minutes<1440)return formatter.format(-Math.floor(minutes/60),'hour');
 return formatter.format(-Math.floor(minutes/1440),'day');
}
