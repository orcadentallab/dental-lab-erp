import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
    getDoctorReceivableAmount,
    isDoctorStatementIncluded,
} from '../src/constants/orderLifecycle.js';

type EntityType = 'doctor' | 'external_lab';
type DoctorRow = { id: string; name: string; parent_id: string | null };
type SupplierRow = { id: string; name: string };
type OrderRow = {
    id: string; case_id: string | null; patient_name: string | null;
    doctor_id: string | null; supplier_id: string | null; status: string;
    total_price: number | null; cost: number | null; design_price: number | null;
    workflow_type: string | null; delivery_date: string | null; actual_delivery_date: string | null;
    created_at: string; is_archived: boolean | null; rejected_lab_cost: number | null;
};
type TxRow = {
    id: string; type: 'income' | 'expense'; amount: number; date: string;
    category: string | null; description: string | null; entity_id: string | null; entity_type: string | null;
};
type ObligationRow = {
    id: string; order_id: string; entity_type: EntityType | 'designer'; entity_id: string;
    direction: 'receivable' | 'payable'; trigger_type: string; net_amount: number | null;
    allocated_amount: number | null; remaining_amount: number | null; status: string;
    due_date: string | null; trigger_date: string | null; created_at: string;
};
type AdjustmentRow = { entity_type: string; entity_id: string; type: 'charge' | 'credit'; amount: number; date: string };

function toOrder(o: OrderRow) {
    return {
        id: o.id,
        doctorId: o.doctor_id || '',
        supplierId: o.supplier_id || undefined,
        status: o.status as any,
        totalPrice: Number(o.total_price || 0),
        cost: Number(o.cost || 0),
        designPrice: o.design_price || undefined,
        workflowType: o.workflow_type as any,
        deliveryDate: o.delivery_date || '',
        actualDeliveryDate: o.actual_delivery_date || undefined,
        createdAt: o.created_at,
        isArchived: o.is_archived || false,
        rejectedLabCost: o.rejected_lab_cost ?? undefined,
    };
}

function supplierOfficialAmount(o: OrderRow): number | null {
    const status = o.status || '';
    const lower = status.toLowerCase();
    const hasRejectedCost = status === 'Rejected' && typeof o.rejected_lab_cost === 'number';
    const relevant = (status !== 'Rejected' || hasRejectedCost) && (lower === 'delivered' || lower === 'cancelled' || hasRejectedCost);
    if (!relevant) return null;
    let cost = status === 'Cancelled' || status === 'Rejected' ? 0 : Number(o.cost || 0);
    if (hasRejectedCost) cost = Number(o.rejected_lab_cost || 0);
    if (o.workflow_type === 'split' && o.design_price && status !== 'Cancelled' && status !== 'Rejected' && !hasRejectedCost) {
        cost -= Number(o.design_price || 0);
    }
    return cost;
}

async function main() {
    const url = process.env.SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const supabase = createClient(url, key);

    const { data: doctors } = await supabase.from('doctors').select('id, name, parent_id');
    const { data: suppliers } = await supabase.from('suppliers').select('id, name');
    const { data: orders } = await supabase.from('orders').select('*');
    const { data: txs } = await supabase.from('transactions').select('*');
    const { data: obligations } = await supabase.from('financial_obligations').select('*');
    const { data: adjustments } = await supabase.from('adjustments').select('*');

    const parentByDoctor = new Map((doctors || []).map(d => [d.id, d.parent_id || d.id]));
    const doctorName = new Map((doctors || []).map(d => [d.id, d.name]));
    const supplierName = new Map((suppliers || []).map(s => [s.id, s.name]));
    const root = (id: string) => parentByDoctor.get(id) || id;

    const keys = new Set<string>();
    const orderTotal = new Map<string, number>();
    const adjTotal = new Map<string, number>();
    const txTotal = new Map<string, number>();
    const obligationTotal = new Map<string, number>();
    const allocatedTotal = new Map<string, number>();

    const add = (map: Map<string, number>, key: string, amount: number) => {
        map.set(key, (map.get(key) || 0) + amount);
    };

    for (const o of (orders || [])) {
        if (o.is_archived) continue;
        const lo = toOrder(o);
        if (o.doctor_id && isDoctorStatementIncluded(lo)) {
            const k = `doctor:${root(o.doctor_id)}`;
            keys.add(k);
            add(orderTotal, k, getDoctorReceivableAmount(lo));
        }
        if (o.supplier_id) {
            const amt = supplierOfficialAmount(o);
            if (amt !== null) {
                const k = `external_lab:${o.supplier_id}`;
                keys.add(k);
                add(orderTotal, k, amt);
            }
        }
    }

    for (const a of (adjustments || [])) {
        if (a.entity_type === 'doctor') {
            const k = `doctor:${root(a.entity_id)}`;
            keys.add(k);
            add(adjTotal, k, a.type === 'charge' ? Number(a.amount || 0) : -Number(a.amount || 0));
        } else if (a.entity_type === 'supplier') {
            const k = `external_lab:${a.entity_id}`;
            keys.add(k);
            add(adjTotal, k, a.type === 'credit' ? Number(a.amount || 0) : -Number(a.amount || 0));
        }
    }

    for (const t of (txs || [])) {
        if (!t.entity_id) continue;
        if (t.type === 'income' && (t.entity_type === 'doctor' || !t.entity_type)) {
            const k = `doctor:${root(t.entity_id)}`;
            keys.add(k);
            add(txTotal, k, Number(t.amount || 0));
        } else if (t.type === 'expense' && (t.entity_type === 'supplier' || !t.entity_type)) {
            const k = `external_lab:${t.entity_id}`;
            keys.add(k);
            add(txTotal, k, Number(t.amount || 0));
        }
    }

    for (const o of (obligations || [])) {
        if (o.status === 'void') continue;
        if (o.entity_type !== 'doctor' && o.entity_type !== 'external_lab') continue;
        const k = `${o.entity_type}:${o.entity_type === 'doctor' ? root(o.entity_id) : o.entity_id}`;
        keys.add(k);
        add(obligationTotal, k, Number(o.net_amount || 0));
        add(allocatedTotal, k, Number(o.allocated_amount || 0));
    }

    console.log('--- ACTUAL RECONCILIATION DIFFERENCES ---');
    const results: any[] = [];
    for (const k of Array.from(keys)) {
        const [type, id] = k.split(':');
        const name = type === 'doctor' ? doctorName.get(id) || id : supplierName.get(id) || id;
        const officialOrder = orderTotal.get(k) || 0;
        const officialAdj = adjTotal.get(k) || 0;
        const officialTx = txTotal.get(k) || 0;
        const officialBalance = officialOrder + officialAdj - officialTx;

        const activeOblig = obligationTotal.get(k) || 0;
        const allocated = allocatedTotal.get(k) || 0;
        const obligationBalance = activeOblig - allocated;

        const diff = obligationBalance - officialBalance;
        if (Math.abs(diff) >= 0.01) {
            results.push({
                type,
                name,
                id,
                officialBalance,
                obligationBalance,
                diff,
                activeOblig,
                allocated,
                officialOrder,
                officialAdj,
                officialTx
            });
        }
    }

    // Sort by absolute difference descending
    results.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    console.log(`Found ${results.length} accounts with differences:`);
    for (const r of results) {
        console.log(`- ${r.type} | ${r.name} | Diff: ${r.diff.toFixed(2)} | Official: ${r.officialBalance.toFixed(2)} | Oblig Balance: ${r.obligationBalance.toFixed(2)} (Obligs: ${r.activeOblig.toFixed(2)} - Allocated: ${r.allocated.toFixed(2)}) | Tx: ${r.officialTx.toFixed(2)}`);
    }
}

main().catch(console.error);
