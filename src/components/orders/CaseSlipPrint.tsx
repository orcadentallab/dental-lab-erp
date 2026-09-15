import { useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Printer, X, AlertCircle, Sparkles } from 'lucide-react';
import type { Order, Doctor } from '../../services/db';

interface CaseSlipPrintProps {
    order: Order;
    doctor?: Doctor | null;
    onClose: () => void;
}

export default function CaseSlipPrint({ order, doctor, onClose }: CaseSlipPrintProps) {
    const printRef = useRef<HTMLDivElement>(null);

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `Case_Slip_${order.caseId}`,
    });

    const isUrgent = order.priority === 'Urgent';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in" dir="rtl">
            <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header / Actions */}
                <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <Printer className="text-primary-600" size={20} />
                        <h2 className="text-base font-bold text-slate-800">بطاقة الحالة للبنش (Case Slip)</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => handlePrint()}
                            className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold rounded-xl shadow-sm transition"
                        >
                            <Printer size={15} />
                            طباعة اللاصقة
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded-xl transition"
                            aria-label="Close"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Printable Slip Preview */}
                <div className="p-6 overflow-y-auto bg-slate-100 flex justify-center">
                    <div
                        ref={printRef}
                        className="bg-white border-2 border-slate-800 rounded-xl p-6 w-full max-w-[105mm] text-slate-900 shadow-sm print:m-0 print:p-4 print:border-2 print:border-black print:shadow-none print:w-full"
                        style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
                    >
                        {/* Slip Header */}
                        <div className="flex justify-between items-start border-b-2 border-slate-800 pb-3 mb-3">
                            <div>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">رقم الحالة</span>
                                <h1 className="text-2xl font-black font-mono tracking-tight text-slate-900">{order.caseId}</h1>
                            </div>
                            <div className="text-left">
                                {isUrgent && (
                                    <span className="inline-block bg-rose-600 text-white text-xs font-black px-2.5 py-1 rounded-md mb-1 uppercase">
                                        مستعجل URGENT
                                    </span>
                                )}
                                <div className="text-[11px] font-bold text-slate-600">
                                    {order.deliveryType === 'TryIn' ? 'تجربة (Try-In)' : 'نهائي (Final)'}
                                </div>
                            </div>
                        </div>

                        {/* Core Info Grid */}
                        <div className="grid grid-cols-2 gap-3 mb-3 text-xs border-b border-slate-200 pb-3">
                            <div>
                                <span className="text-slate-500 block text-[10px] font-bold">الطبيب:</span>
                                <span className="text-sm font-black text-slate-900">{doctor?.name || '—'}</span>
                            </div>
                            <div>
                                <span className="text-slate-500 block text-[10px] font-bold">المريض:</span>
                                <span className="text-sm font-black text-slate-900">{order.patientName || '—'}</span>
                            </div>
                            <div>
                                <span className="text-slate-500 block text-[10px] font-bold">تاريخ التسليم:</span>
                                <span className={`font-mono font-bold ${isUrgent ? 'text-rose-600 font-black' : 'text-slate-900'}`}>
                                    {order.deliveryDate || '—'}
                                </span>
                            </div>
                            <div>
                                <span className="text-slate-500 block text-[10px] font-bold">اللون (Shade):</span>
                                <span className="font-mono font-black text-slate-900">{order.shade || '—'}</span>
                            </div>
                        </div>

                        {/* Items & Teeth */}
                        <div className="mb-3 border-b border-slate-200 pb-3">
                            <span className="text-slate-500 block text-[10px] font-bold mb-1">الخدمات والأسنان:</span>
                            <div className="space-y-1">
                                {order.items.map((item, idx) => (
                                    <div key={idx} className="flex justify-between items-center text-xs bg-slate-50 px-2 py-1 rounded border border-slate-200">
                                        <span className="font-bold text-slate-800">{item.serviceType}</span>
                                        <span className="font-mono font-black text-primary-700 dir-ltr text-left">
                                            [{Array.isArray(item.teethNumbers) ? item.teethNumbers.join(', ') : item.teethNumbers}]
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Doctor Permanent Instructions */}
                        {doctor?.labInstructions && (
                            <div className="mb-2 bg-amber-50 border border-amber-300 rounded-lg p-2 text-xs">
                                <div className="flex items-center gap-1 font-bold text-amber-900 mb-0.5 text-[11px]">
                                    <Sparkles size={12} className="text-amber-600" />
                                    <span>تعليمات الطبيب الثابتة:</span>
                                </div>
                                <p className="text-amber-900 leading-relaxed font-medium text-[11px]">
                                    {doctor.labInstructions}
                                </p>
                            </div>
                        )}

                        {/* Order Specific Instructions */}
                        {order.instructions && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 text-xs">
                                <div className="flex items-center gap-1 font-bold text-blue-900 mb-0.5 text-[11px]">
                                    <AlertCircle size={12} className="text-blue-600" />
                                    <span>تعليمات الحالة:</span>
                                </div>
                                <p className="text-blue-900 leading-relaxed text-[11px]">
                                    {order.instructions}
                                </p>
                            </div>
                        )}

                        <div className="mt-4 pt-2 border-t border-slate-200 text-center text-[9px] text-slate-400 font-mono">
                            Dental Lab ERP — تم الطباعة: {new Date().toLocaleDateString('ar-EG')}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
