/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import type { Order, Doctor } from '../../services/db';

interface OrderInvoiceProps {
    order: Order;
    doctor?: Doctor;
    labInfo?: {
        name: string;
        address: string;
        phone: string;
        logoUrl?: string;
    };
}

export const OrderInvoice = React.forwardRef<HTMLDivElement, OrderInvoiceProps>(({ order, doctor, labInfo }, ref) => {
    const total = order.totalPrice || 0;

    return (
        <div ref={ref} className="p-8 bg-white text-black font-sans max-w-[210mm] mx-auto" dir="rtl">
            {/* Header */}
            <div className="flex justify-between items-start border-b-2 border-gray-800 pb-6 mb-8">
                <div className="text-right">
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">{labInfo?.name || 'ORCA Dental Lab'}</h1>
                    <p className="text-sm text-gray-600">{labInfo?.address || 'Cairo, Egypt'}</p>
                    <p className="text-sm text-gray-600">{labInfo?.phone || '+20 123 456 7890'}</p>
                </div>
                <div className="text-left">
                    {labInfo?.logoUrl ? (
                        <img src={labInfo.logoUrl} alt="Logo" className="h-16 w-auto" />
                    ) : (
                        <div className="h-16 w-16 bg-gray-200 rounded-full flex items-center justify-center text-gray-500 font-bold text-xl">
                            OL
                        </div>
                    )}
                </div>
            </div>

            {/* Invoice Info */}
            <div className="flex justify-between mb-8">
                <div>
                    <h2 className="text-gray-500 uppercase text-xs tracking-wider mb-1">فاتورة إلى</h2>
                    <h3 className="text-xl font-bold text-gray-900">{typeof doctor === 'object' ? doctor.name : (doctor || 'Non-registered Doctor')}</h3>
                    {typeof doctor === 'object' && doctor.address && <p className="text-gray-600 text-sm max-w-[200px]">{doctor.address}</p>}
                </div>
                <div className="text-left">
                    <div className="mb-2">
                        <span className="text-gray-500 uppercase text-xs tracking-wider block">رقم الفاتورة</span>
                        <span className="font-bold">INV-{order.caseId}</span>
                    </div>
                    <div className="mb-2">
                        <span className="text-gray-500 uppercase text-xs tracking-wider block">التاريخ</span>
                        <span className="font-bold">{new Date().toLocaleDateString('en-GB')}</span>
                    </div>
                    <div>
                        <span className="text-gray-500 uppercase text-xs tracking-wider block">رقم الحالة</span>
                        <span className="font-mono text-sm bg-gray-100 px-2 py-0.5 rounded">{order.caseId}</span>
                    </div>
                </div>
            </div>

            {/* Patient & Case Details */}
            <div className="bg-gray-50 rounded-lg p-4 mb-8 border border-gray-100">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <span className="text-gray-500 text-xs block">المريض</span>
                        <span className="font-bold text-gray-900">{order.patientName}</span>
                    </div>
                    <div>
                        <span className="text-gray-500 text-xs block">تاريخ التسليم</span>
                        <span className="font-bold text-gray-900">{order.deliveryDate || '-'}</span>
                    </div>
                    <div>
                        <span className="text-gray-500 text-xs block">اللون (Shade)</span>
                        <span className="font-bold text-gray-900">{order.shade || '-'}</span>
                    </div>
                    <div>
                        <span className="text-gray-500 text-xs block">نوع العمل</span>
                        <span className="font-bold text-gray-900">{order.deliveryType || 'Standard'}</span>
                    </div>
                </div>
            </div>

            {/* Items Table */}
            <table className="w-full mb-8">
                <thead>
                    <tr className="border-b-2 border-gray-900">
                        <th className="text-right py-3 font-bold text-gray-900">الوصف</th>
                        <th className="text-center py-3 font-bold text-gray-900 w-24">الأسنان</th>
                        <th className="text-left py-3 font-bold text-gray-900 w-32">السعر</th>
                    </tr>
                </thead>
                <tbody>
                    {order.items && order.items.map((item: any, index: number) => (
                        <tr key={index} className="border-b border-gray-200">
                            <td className="py-4">
                                <p className="font-bold text-gray-900">{item.serviceType}</p>
                                {/* <p className="text-sm text-gray-500">ملاحظات إضافية هنا إن وجدت</p> */}
                            </td>
                            <td className="py-4 text-center">
                                <span className="bg-gray-100 px-2 py-1 rounded text-xs font-mono">
                                    {Array.isArray(item.teethNumbers) ? item.teethNumbers.join(', ') : item.teethNumbers}
                                </span>
                            </td>
                            <td className="py-4 text-left font-mono">
                                {/* Assuming we don't have per-item price easily accessible or it's complex, 
                                    we might show total directly or calculate if available.
                                    For now, let's assume specific price breakdown isn't always available in 'items' array 
                                    based on previous knowledge, but let's check db.ts structure if possible.
                                    The user wants 'invoice shape', usually implying itemized costs.
                                    If distinct item prices aren't stored, we can leave blank or show 'Included'.
                                */}
                                {item.price ? `${item.price.toLocaleString()} EGP` : '-'}
                            </td>
                        </tr>
                    ))}
                    {(!order.items || order.items.length === 0) && (
                        <tr className="border-b border-gray-200">
                            <td className="py-4" colSpan={3}>
                                <p className="font-bold text-gray-900">تفاصيل عامة</p>
                            </td>
                        </tr>
                    )}
                </tbody>
                <tfoot>
                    <tr>
                        <td colSpan={2} className="pt-4 text-right font-bold text-gray-900">الإجمالي</td>
                        <td className="pt-4 text-left font-bold text-xl text-gray-900 font-mono">{total.toLocaleString()} EGP</td>
                    </tr>
                </tfoot>
            </table>

            {/* Footer */}
            <div className="border-t border-gray-200 pt-8 text-center text-sm text-gray-500 mt-auto">
                <p className="mb-1">شكراً لتعاملكم مع ORCA Dental Lab</p>
                <p>في حالة وجود أي استفسار، يرجى التواصل معنا</p>
            </div>

            {/* Print Styles */}
            <style>
                {`
                    @media print {
                        body {
                            background: white;
                        }
                        @page {
                            margin: 0;
                            size: auto;
                        }
                        .no-print {
                            display: none;
                        }
                    }
                `}
            </style>
        </div>
    );
});

OrderInvoice.displayName = 'OrderInvoice';
