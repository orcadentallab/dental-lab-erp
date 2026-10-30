import { differenceInDays, format } from 'date-fns';
import type { Order } from '../../services/db';
import type { DoctorReceivable } from '../../services/supabase/analyticsService';
import {
    getDoctorReceivableAmount,
    getOfficialStatementDate,
    isDoctorStatementIncluded,
} from '../../constants/orderLifecycle';

export type OrderLike = Pick<Order, 'id' | 'doctorId' | 'totalPrice'> & Partial<Order>;
export interface TransactionLike { entityId?: string; entityType?: string; type: string; amount: number; }
export interface DoctorLike { id: string; name: string; phone?: string | null; parentId?: string | null; }

export function computeClientSideReceivables(
    orders: OrderLike[],
    transactions: TransactionLike[],
    doctors: DoctorLike[],
): DoctorReceivable[] {
    const entityIdOf = new Map<string, string>();
    const entityName = new Map<string, string>();
    const entityPhone = new Map<string, string | null>();
    for (const doctor of doctors) {
        const entityId = doctor.parentId || doctor.id;
        entityIdOf.set(doctor.id, entityId);
        if (!entityName.has(entityId)) {
            const parent = doctor.parentId ? doctors.find(candidate => candidate.id === doctor.parentId) : undefined;
            entityName.set(entityId, parent?.name || doctor.name);
            entityPhone.set(entityId, parent?.phone || doctor.phone || null);
        }
    }

    const statementOrders = orders.filter(order =>
        !order.isArchived
        && isDoctorStatementIncluded(order)
        && getDoctorReceivableAmount(order) > 0
    );
    const entityBilled = new Map<string, number>();
    const entityPaid = new Map<string, number>();
    const entityOrders = new Map<string, OrderLike[]>();
    const orderAmounts = new Map<string, number>();

    for (const order of statementOrders) {
        const entityId = entityIdOf.get(order.doctorId) || order.doctorId;
        const amount = getDoctorReceivableAmount(order);
        entityBilled.set(entityId, (entityBilled.get(entityId) || 0) + amount);
        orderAmounts.set(order.id, amount);
        entityOrders.set(entityId, [...(entityOrders.get(entityId) || []), order]);
    }

    for (const transaction of transactions) {
        if (transaction.entityType === 'doctor' && transaction.type === 'income') {
            const entityId = entityIdOf.get(transaction.entityId || '') || transaction.entityId || '';
            entityPaid.set(entityId, (entityPaid.get(entityId) || 0) + transaction.amount);
        }
    }

    const today = new Date();
    const result: DoctorReceivable[] = [];
    const orderDate = (order: OrderLike) => new Date(getOfficialStatementDate(order));

    for (const [entityId, billed] of entityBilled) {
        const paid = entityPaid.get(entityId) || 0;
        const balance = Math.max(0, billed - paid);
        if (balance <= 0) continue;

        const doctorOrders = entityOrders.get(entityId) || [];
        const oldestDate = doctorOrders.map(orderDate).sort((a, b) => a.getTime() - b.getTime())[0];
        const oldestUnpaidDate = oldestDate ? format(oldestDate, 'yyyy-MM-dd') : null;
        const daysOverdue = oldestDate ? Math.max(0, differenceInDays(today, oldestDate)) : null;
        let remainingPaid = paid;
        let aging_0_30 = 0;
        let aging_31_60 = 0;
        let aging_61_90 = 0;
        let aging_90_plus = 0;

        const sortedOrders = [...doctorOrders].sort((a, b) => orderDate(a).getTime() - orderDate(b).getTime());
        for (const order of sortedOrders) {
            const days = Math.max(0, differenceInDays(today, orderDate(order)));
            const amount = orderAmounts.get(order.id) || 0;
            const orderBalance = Math.max(0, amount - remainingPaid);
            remainingPaid = Math.max(0, remainingPaid - amount);

            if (days <= 30) aging_0_30 += orderBalance;
            else if (days <= 60) aging_31_60 += orderBalance;
            else if (days <= 90) aging_61_90 += orderBalance;
            else aging_90_plus += orderBalance;
        }

        result.push({
            doctorId: entityId,
            doctorName: entityName.get(entityId) || '—',
            doctorPhone: entityPhone.get(entityId) || null,
            totalBilled: billed,
            totalPaid: paid,
            balance,
            aging_0_30,
            aging_31_60,
            aging_61_90,
            aging_90_plus,
            orderCount: doctorOrders.length,
            unpaidOrderCount: doctorOrders.length,
            oldestUnpaidDate,
            maxDaysOverdue: daysOverdue,
        });
    }

    return result;
}
