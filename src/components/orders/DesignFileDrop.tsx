import {useState} from 'react';
import {Upload} from 'lucide-react';

export default function DesignFileDrop({label,file,kind,disabled,onChange,onError}:{label:string;file:File|null;kind:'zip'|'html';disabled:boolean;onChange:(file:File)=>void;onError:(message:string)=>void}){
 const [dragging,setDragging]=useState(false);
 function select(files:File[]){
  if(disabled)return;
  if(files.length!==1){onError('اختر ملفًا واحدًا فقط لكل مكان رفع');return;}
  const selected=files[0],valid=kind==='zip'?/\.zip$/i.test(selected.name):/\.html?$/i.test(selected.name),max=(kind==='zip'?50:10)*1024*1024;
  if(!valid||selected.size<1||selected.size>max){onError(kind==='zip'?'اختر حزمة ZIP كاملة لا تتجاوز 50 ميجا':'اختر HTML مستقلًا لا يتجاوز 10 ميجا');return;}
  onError('');onChange(selected);
 }
 return <label data-design-drop={kind} onDragOver={event=>{event.preventDefault();if(!disabled){event.dataTransfer.dropEffect='copy';setDragging(true);}}} onDragLeave={event=>{if(!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)))setDragging(false);}} onDrop={event=>{event.preventDefault();setDragging(false);select(Array.from(event.dataTransfer.files));}} className={`flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center text-sm transition-colors focus-within:ring-2 focus-within:ring-cyan-600 ${disabled?'cursor-wait opacity-60':'cursor-pointer'} ${dragging?'border-cyan-700 bg-cyan-100 dark:bg-cyan-950':'border-cyan-300 bg-cyan-50/50 hover:bg-cyan-50 dark:bg-slate-800'} text-cyan-900 dark:text-cyan-200`}>
  <Upload size={24} aria-hidden="true"/>
  <span className="max-w-full break-all font-semibold">{file?.name||`اسحب ملف ${kind==='zip'?'التصميم ZIP':'المعاينة HTML'} هنا`}</span>
  <span className="text-xs">{file?'اسحب ملفًا آخر أو اضغط لاستبداله':'أو اضغط لاختيار الملف'} · حتى {kind==='zip'?50:10} ميجا</span>
  <input aria-label={label} type="file" accept={kind==='zip'?'.zip':'.html,.htm'} disabled={disabled} required={!file} className="sr-only" onChange={event=>{if(event.target.files?.length)select(Array.from(event.target.files));event.target.value='';}}/>
 </label>;
}
