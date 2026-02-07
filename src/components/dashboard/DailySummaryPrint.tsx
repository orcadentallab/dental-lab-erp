import { useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Printer, CheckCircle } from 'lucide-react';
import type { Order } from '../../services/db';

interface DailySummaryPrintProps {
    orders: Order[]; // These should be the "Ready" orders
    doctors: Record<string, string>; // doctorId -> name map
    suppliers: Record<string, string>; // supplierId -> name map
    onClose?: () => void;
}

export default function DailySummaryPrint({ orders, doctors, suppliers, onClose }: DailySummaryPrintProps) {
    const printRef = useRef<HTMLDivElement>(null);

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: `Daily_Summary_${new Date().toISOString().split('T')[0]}`,
        onAfterPrint: onClose
    });

    const today = new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // Group orders by Supplier
    const groupedOrders = orders.reduce((acc, order) => {
        const key = order.supplierId || 'unknown';
        if (!acc[key]) acc[key] = [];
        acc[key].push(order);
        return acc;
    }, {} as Record<string, Order[]>);

    const supplierIds = Object.keys(groupedOrders);

    return (
        <div className="bg-white p-6 rounded-xl space-y-4 max-w-4xl mx-auto dark:text-black shadow-2xl h-[90vh] flex flex-col">
            {/* Action Bar - Hidden during print */}
            <div className="flex justify-between items-center pb-4 border-b no-print shrink-0">
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

            {/* Content Area - Scrollable for view, Auto for print */}
            <div className="flex-1 overflow-y-auto no-scrollbar">
                {/* Printable Content */}
                <div ref={printRef} className="p-8 bg-white min-h-[29.7cm] text-right print:p-0" dir="rtl">
                    {/* Print Header - Repeated only once at top or for each page if needed, but let's keep simple main header */}
                    <div className="text-center border-b-2 border-black pb-6 mb-8">
                        <h1 className="text-3xl font-black mb-2">معمل الأسنان الرقمي</h1>
                        <h2 className="text-xl text-gray-600">كشف تسليم الأوردرات اليومي</h2>
                        <p className="font-bold mt-2 text-lg">{today}</p>
                    </div>

                    {supplierIds.length > 0 ? (
                        supplierIds.map(supplierId => {
                            const supplierName = suppliers[supplierId] || (supplierId === 'unknown' ? 'غير محدد (بدون معمل)' : 'Unknown Lab');
                            const supplierOrders = groupedOrders[supplierId];

                            return (
                                <div key={supplierId} className="mb-12 break-inside-avoid">
                                    {/* Supplier Section Header */}
                                    <div className="bg-gray-100 p-3 border-y-2 border-black mb-4 flex justify-between items-center">
                                        <h3 className="text-lg font-black">{supplierName}</h3>
                                        <span className="text-sm font-bold bg-white px-2 py-1 rounded border border-gray-300">
                                            عدد الحالات: {supplierOrders.length}
                                        </span>
                                    </div>

                                    {/* Table */}
                                    <table className="w-full border-collapse border border-black mb-4">
                                        <thead>
                                            <tr className="bg-gray-50 font-bold text-sm">
                                                <th className="border border-black p-2 w-12 text-center">#</th>
                                                <th className="border border-black p-2 text-right">رقم الحالة</th>
                                                <th className="border border-black p-2 text-right">اسم المريض</th>
                                                <th className="border border-black p-2 text-right">اسم الطبيب</th>
                                                <th className="border border-black p-2 text-center w-24">النوع</th>
                                                <th className="border border-black p-2 text-center w-32">التوقيع</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {supplierOrders.map((order, index) => (
                                                <tr key={order.id} className="text-sm">
                                                    <td className="border border-black p-2 text-center font-bold">{index + 1}</td>
                                                    <td className="border border-black p-2 font-mono font-bold text-center" dir="ltr">{order.caseId}</td>
                                                    <td className="border border-black p-2 font-bold">{order.patientName}</td>
                                                    <td className="border border-black p-2 text-gray-700">d. {doctors[order.doctorId] || 'غير محدد'}</td>
                                                    <td className="border border-black p-2 text-center">
                                                        <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${order.deliveryType === 'TryIn' ? 'border-dashed' : ''}`}>
                                                            {order.deliveryType === 'TryIn' ? 'بروفة' : 'نهائي'}
                                                        </span>
                                                    </td>
                                                    <td className="border border-black p-2"></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            );
                        })
                    ) : (
                        <div className="text-center p-12 border-2 border-dashed border-gray-300 rounded-xl">
                            <p className="text-xl text-gray-500 font-bold">لا توجد أوردرات جاهزة للتسليم اليوم</p>
                        </div>
                    )}

                    {/* Footer - Total Summary */}
                    <div className="flex justify-between items-end border-t-2 border-black pt-6 mt-12 break-before-avoid">
                        <div>
                            <p className="font-bold mb-2">توقيع المسؤول:</p>
                            <div className="w-48 border-b border-dashed border-black h-8"></div>
                        </div>
                        <div>
                            <p className="font-bold mb-2 text-lg">اجمالي الحالات الكلي: {orders.length}</p>
                            <div className="flex items-center gap-1 text-xs text-gray-500">
                                <CheckCircle size={10} />
                                تم المراجعة النهائية
                            </div>
                        </div>
                    </div>

                    {/* Print Only Styles */}
                    <style type="text/css" media="print">
                        {`
                            @page { size: A4; margin: 15mm; }
                            body { -webkit-print-color-adjust: exact; }
                            .no-print { display: none !important; }
                            .break-inside-avoid { page-break-inside: avoid; }
                        `}
                    </style>
                </div>
            </div>
        </div>
    );
}
