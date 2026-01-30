import { useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Printer, CheckCircle } from 'lucide-react';
import type { Order } from '../../services/db';

interface DailySummaryPrintProps {
    orders: Order[]; // These should be the "Ready" orders
    doctors: Record<string, string>; // doctorId -> name map
    onClose?: () => void;
}

export default function DailySummaryPrint({ orders, doctors, onClose }: DailySummaryPrintProps) {
    const printRef = useRef<HTMLDivElement>(null);

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `Daily_Summary_${new Date().toISOString().split('T')[0]}`,
        onAfterPrint: onClose
    });

    const today = new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    return (
        <div className="bg-white p-6 rounded-xl space-y-4 max-w-4xl mx-auto dark:text-black">
            {/* Action Bar - Hidden during print */}
            <div className="flex justify-between items-center pb-4 border-b no-print">
                <h2 className="text-xl font-bold flex items-center gap-2">
                    <Printer className="text-blue-600" />
                    كشف تسليمات يومي
                </h2>
                <div className="flex gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg"
                    >
                        إغلاق
                    </button>
                    <button
                        onClick={() => handlePrint()}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow flex items-center gap-2 transition-all"
                    >
                        <Printer size={18} />
                        طباعة الكشف
                    </button>
                </div>
            </div>

            {/* Printable Content */}
            <div ref={printRef} className="p-8 bg-white min-h-[29.7cm] text-right" dir="rtl">
                {/* Print Header */}
                <div className="text-center border-b-2 border-black pb-6 mb-6">
                    <h1 className="text-3xl font-black mb-2">معمل الأسنان الرقمي</h1>
                    <h2 className="text-xl text-gray-600">كشف تسليم الأوردرات اليومي</h2>
                    <p className="font-bold mt-2 text-lg">{today}</p>
                </div>

                {/* Table */}
                <table className="w-full border-collapse border border-black mb-8">
                    <thead>
                        <tr className="bg-gray-100 font-bold text-sm">
                            <th className="border border-black p-3 w-16 text-center">#</th>
                            <th className="border border-black p-3 text-right">رقم الحالة</th>
                            <th className="border border-black p-3 text-right">اسم المريض</th>
                            <th className="border border-black p-3 text-right">اسم الطبيب</th>
                            <th className="border border-black p-3 text-center">النوع</th>
                            <th className="border border-black p-3 text-center w-32">التوقيع</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orders.length > 0 ? (
                            orders.map((order, index) => (
                                <tr key={order.id} className="text-sm">
                                    <td className="border border-black p-3 text-center font-bold">{index + 1}</td>
                                    <td className="border border-black p-3 font-mono font-bold text-center" dir="ltr">{order.caseId}</td>
                                    <td className="border border-black p-3 font-bold">{order.patientName}</td>
                                    <td className="border border-black p-3 text-gray-700">د. {doctors[order.doctorId] || 'غير محدد'}</td>
                                    <td className="border border-black p-3 text-center">
                                        <span className={`px-2 py-0.5 rounded border text-xs font-bold ${order.deliveryType === 'TryIn' ? 'border-dashed' : ''}`}>
                                            {order.deliveryType === 'TryIn' ? 'بروفة' : 'نهائي'}
                                        </span>
                                    </td>
                                    <td className="border border-black p-3"></td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={6} className="text-center p-8 text-gray-500 font-bold border border-black">
                                    لا توجد أوردرات جاهزة للتسليم اليوم
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>

                {/* Footer */}
                <div className="flex justify-between items-end border-t-2 border-black pt-6 mt-auto">
                    <div>
                        <p className="font-bold mb-2">توقيع المسؤول:</p>
                        <div className="w-48 border-b border-dashed border-black h-8"></div>
                    </div>
                    <div>
                        <p className="font-bold mb-2">اجمالي الحالات: {orders.length}</p>
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                            <CheckCircle size={10} />
                            تم المراجعة النهائية
                        </div>
                    </div>
                </div>

                {/* Print Only Styles */}
                <style type="text/css" media="print">
                    {`
                        @page { size: A4; margin: 20mm; }
                        body { -webkit-print-color-adjust: exact; }
                        .no-print { display: none !important; }
                    `}
                </style>
            </div>
        </div>
    );
}
