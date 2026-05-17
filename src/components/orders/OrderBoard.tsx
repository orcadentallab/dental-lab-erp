/* eslint-disable @typescript-eslint/consistent-type-assertions */
import React, { useState, useEffect } from 'react';
import type { Order } from '../../services/db';
import { db } from '../../services/db';
import { Clock, User, MessageCircle, Building2 } from 'lucide-react';
import { clsx } from 'clsx';
import { motion } from 'framer-motion';
import { filterVisibleOrderComments, getOrderCardDisplayDate } from '../../utils/orderDisplay';

const statuses = [
    { id: 'New Case', label: 'حالة جديدة (New)', color: 'bg-teal-100 text-teal-700 border-teal-200' },
    { id: 'Under Design', label: 'تصميم (Design)', color: 'bg-blue-100 text-blue-700 border-blue-200' },
    { id: 'Waiting Dr Approval', label: 'انتظار الموافقة (Approval)', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
    { id: 'Under Production', label: 'جاري التصنيع (Production)', color: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
    { id: 'Try In', label: 'مرحلة البروفة (Try In)', color: 'bg-orange-100 text-orange-700 border-orange-200' },
    { id: 'Try In Approved', label: 'بروفة موافق (Try In OK)', color: 'bg-teal-100 text-teal-700 border-teal-200' },
    { id: 'Ready', label: 'جاهز (Ready)', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    { id: 'Delivered', label: 'تم التسليم (Delivered)', color: 'bg-green-100 text-green-700 border-green-200' },
    { id: 'Returned for Adjustments', label: 'مرتجع لتعديل (Returned)', color: 'bg-red-100 text-red-700 border-red-200' },
];

interface OrderBoardProps {
    orders: Order[];
    onStatusChange: (id: string, status: Order['status'] | 'same', context?: { rejectedLabCost?: number }) => void;
    userRole?: string;
    onEdit?: (order: Order) => void;
    onAddNote?: (order: Order) => void;
}

export default function OrderBoard({ orders, onStatusChange, onEdit, onAddNote }: OrderBoardProps) {
    const [doctorsMap, setDoctorsMap] = useState<Record<string, string>>({});
    const [suppliersMap, setSuppliersMap] = useState<Record<string, string>>({});

    useEffect(() => {
        Promise.all([
            db.getDoctors(),
            db.getSuppliers()
        ]).then(([docs, sups]) => {
            const dMap: Record<string, string> = {};
            docs.forEach(d => dMap[d.id] = d.name);
            setDoctorsMap(dMap);

            const sMap: Record<string, string> = {};
            sups.forEach(s => sMap[s.id] = s.name);
            setSuppliersMap(sMap);
        });
    }, []);

    const handleDragStart = (e: React.DragEvent, orderId: string) => {
        e.dataTransfer.setData('orderId', orderId);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault(); // Necessary to allow dropping
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: React.DragEvent, newStatus: string) => {
        e.preventDefault();
        const orderId = e.dataTransfer.getData('orderId');
        if (orderId) {
            const order = orders.find(o => o.id === orderId);
            if (order && order.status !== newStatus) {
                onStatusChange(orderId, newStatus as Order['status']);
            }
        }
    };

    return (
        <div className="flex gap-4 overflow-x-auto pb-4 px-2 min-h-[calc(100vh-250px)] items-start">
            {statuses.map(col => {
                const colOrders = orders.filter(o => o.status === col.id);
                return (
                    <div
                        key={col.id}
                        className="flex flex-col flex-shrink-0 w-72 bg-surface-50 dark:bg-surface-800/50 rounded-2xl border border-surface-200 dark:border-surface-700 max-h-[calc(100vh-280px)]"
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, col.id)}
                    >
                        <div className={`p-3 border-b border-surface-200 dark:border-surface-700 rounded-t-2xl font-bold flex justify-between items-center bg-white dark:bg-surface-800`}>
                            <span className={clsx("text-xs px-2 py-1 rounded-lg border", col.color)}>{col.label}</span>
                            <span className="bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 text-xs px-2 py-0.5 rounded-full font-mono">{colOrders.length}</span>
                        </div>
                        <div className="p-2 flex-1 overflow-y-auto space-y-2">
                            {colOrders.map(order => {
                                const visibleComments = filterVisibleOrderComments(order.comments);
                                const displayDate = getOrderCardDisplayDate(order);

                                return (
                                <motion.div
                                    layoutId={order.id}
                                    key={order.id}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e as unknown as React.DragEvent, order.id)}
                                    className="bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-xl p-3 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow relative"
                                    onClick={() => onEdit && onEdit(order)}
                                >
                                    {(order.isUrgent || order.priority === 'Urgent') && (
                                        <div className="absolute top-0 right-0 w-8 h-8 pointer-events-none overflow-hidden rounded-tr-xl">
                                            <div className="absolute top-0 right-0 transform translate-x-1/2 -translate-y-1/2 rotate-45 bg-red-500 text-white text-[8px] font-bold py-1 w-12 text-center">
                                                عاجل
                                            </div>
                                        </div>
                                    )}
                                    <div className="flex justify-between items-start mb-2 pr-2">
                                        <span className="bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-100 dark:border-primary-800 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold">
                                            #{order.caseId}
                                        </span>
                                        {displayDate.date && (
                                            <span className="text-[9px] text-surface-500 flex items-center gap-1 font-mono" title={displayDate.label}>
                                                <Clock size={10} /> {displayDate.date}
                                            </span>
                                        )}
                                    </div>
                                    <h4 className="font-bold text-sm text-surface-900 dark:text-surface-100 truncate">{order.patientName}</h4>
                                    <div className="flex items-center justify-between mt-1 mb-2 gap-2">
                                        <div className="flex items-center gap-1 truncate min-w-0">
                                            <User size={12} className="text-surface-400 shrink-0" />
                                            <span className="text-xs text-surface-600 dark:text-surface-400 truncate">
                                                {doctorsMap[order.doctorId] || 'غير معروف'}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0 bg-surface-50 dark:bg-surface-800 text-surface-500 border border-surface-200 dark:border-surface-700 text-[9px] px-1.5 py-0.5 rounded-md" title="المعمل المنفذ">
                                            <Building2 size={10} className="text-surface-400" />
                                            <span className="truncate max-w-[70px]">
                                                {order.supplierId ? (suppliersMap[order.supplierId] || 'خارجي') : 'داخلي'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-1 mb-2">
                                        {(order.items || []).map((item, idx) => (
                                            <span key={idx} className="bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300 text-[9px] px-1.5 py-0.5 rounded border border-surface-200 dark:border-surface-700 truncate max-w-full">
                                                {item.serviceType}
                                            </span>
                                        ))}
                                    </div>
                                    <div className="flex justify-between items-center mt-3 pt-2 border-t border-surface-100 dark:border-surface-800">
                                        <div className="flex gap-2">
                                            {onAddNote && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onAddNote(order); }}
                                                    className="p-1 text-surface-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors relative"
                                                >
                                                    <MessageCircle size={14} />
                                                    {visibleComments.length > 0 && (
                                                        <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white ring-1 ring-white">
                                                            {visibleComments.length}
                                                        </span>
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
                                );
                            })}
                            {colOrders.length === 0 && (
                                <div className="text-center p-4 text-surface-300 dark:text-surface-600 text-xs border-2 border-dashed border-surface-200 dark:border-surface-700 rounded-xl mt-2">
                                    اسحب الحالات هنا
                                </div>
                            )}
                        </div>
                    </div>
                )
            })}
        </div>
    );
}
