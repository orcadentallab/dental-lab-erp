import { createClient } from '@supabase/supabase-js';
import {
    getDoctorReceivableAmount,
    isDoctorStatementIncluded,
} from '../src/constants/orderLifecycle.js';

type EntityType = 'doctor' | 'external_lab';

const TARGET_ENTITIES = [
    { type: 'external_lab', name: 'Allstars' },
    { type: 'doctor', name: 'خالد العامري' },
    { type: 'doctor', name: 'سلمي صلاح' },
    { type: 'doctor', name: 'سالي' },
    { type: 'doctor', name: 'ايهم تركاوي' },
    { type: 'external_lab', name: 'AB Lab' },
    { type: 'external_lab', name: 'Dr.M Lab' },
    { type: 'doctor', name: 'ابو صالح' },
    { type: 'doctor', name: 'محمد احمد حسن' },
    { type: 'doctor', name: 'بتول احمد' },
    { type: 'doctor', name: 'احمد مازن' },
    { type: 'doctor', name: 'محمد جلال' },
    { type: 'doctor', name: 'خالد قصر العيني' },
    { type: 'doctor', name: 'رسمى محمد' },
    { type: 'doctor', name: 'عليا الديري' },
    { type: 'external_lab', name: 'EZ Lab' },
    { type: 'doctor', name: 'هيا السعيد' }
];

function toOrder(o: any) {
    return {
        id: o.id,
        doctorId: o.doctor_id || '',
        supplierId: o.supplier_id || undefined,
        status: o.status,
        totalPrice: Number(o.total_price || 0),
        cost: Number(o.cost || 0),
        designPrice: o.design_price || undefined,
        workflowType: o.workflow_type,
        deliveryDate: o.delivery_date || '',
        actualDeliveryDate: o.actual_delivery_date || undefined,
        createdAt: o.created_at,
        isArchived: o.is_archived || false,
        rejectedLabCost: o.rejected_lab_cost ?? undefined,
        patientName: o.patient_name || '',
        caseId: o.case_id || ''
    };
}

function supplierOfficialAmount(o: any): number | null {
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

    // Resolve target IDs
    const resolvedTargets: any[] = [];
    for (const target of TARGET_ENTITIES) {
        if (target.type === 'doctor') {
            const matches = (doctors || []).filter(d => d.name === target.name);
            if (matches.length > 0) {
                // Get all descendant IDs if parent group
                const rootDoc = matches.find(d => !d.parent_id) || matches[0];
                let rootId = rootDoc.id;
                // walk up
                while (rootDoc.parent_id) {
                    const p = (doctors || []).find(d => d.id === rootDoc.parent_id);
                    if (!p) break;
                    rootId = p.id;
                }
                const ids = (doctors || []).filter(d => d.id === rootId || d.parent_id === rootId).map(d => d.id);
                resolvedTargets.push({ ...target, ids, rootId });
            } else {
                console.log(`Warning: Target doctor not found: ${target.name}`);
            }
        } else {
            const match = (suppliers || []).find(s => s.name === target.name);
            if (match) {
                resolvedTargets.push({ ...target, ids: [match.id], rootId: match.id });
            } else {
                console.log(`Warning: Target supplier not found: ${target.name}`);
            }
        }
    }

    console.log(`Resolved targets count: ${resolvedTargets.length}\n`);

    for (const target of resolvedTargets) {
        console.log(`=========================================`);
        console.log(`ENTITY: ${target.name} (${target.type})`);
        console.log(`Ids: ${target.ids.join(', ')}`);
        console.log(`=========================================`);

        const idSet = new Set(target.ids);
        
        // 1. Orders
        const myOrders = (orders || []).filter(o => {
            if (target.type === 'doctor') {
                return o.doctor_id && idSet.has(o.doctor_id);
            } else {
                return o.supplier_id && idSet.has(o.supplier_id);
            }
        });

        // 2. Transactions
        const myTxs = (txs || []).filter(t => {
            if (!t.entity_id) return false;
            if (target.type === 'doctor') {
                return idSet.has(t.entity_id) && (t.entity_type === 'doctor' || !t.entity_type);
            } else {
                return idSet.has(t.entity_id) && (t.entity_type === 'supplier' || !t.entity_type);
            }
        });

        // 3. Adjustments
        const myAdjs = (adjustments || []).filter(a => {
            if (target.type === 'doctor') {
                return a.entity_type === 'doctor' && idSet.has(a.entity_id);
            } else {
                return a.entity_type === 'supplier' && idSet.has(a.entity_id);
            }
        });

        // 4. Obligations
        const myObligs = (obligations || []).filter(o => {
            if (o.status === 'void') return false;
            if (target.type === 'doctor') {
                return o.entity_type === 'doctor' && idSet.has(o.entity_id);
            } else {
                return o.entity_type === 'external_lab' && idSet.has(o.entity_id);
            }
        });

        // Calculation
        let officialDebits = 0;
        let officialCredits = 0;
        
        console.log(`\n--- ORDERS ---`);
        for (const o of myOrders) {
            if (o.is_archived) continue;
            const lo = toOrder(o);
            if (target.type === 'doctor') {
                if (isDoctorStatementIncluded(lo)) {
                    const amt = getDoctorReceivableAmount(lo);
                    officialDebits += amt;
                    console.log(`- Order | CaseId: ${o.case_id} | Status: ${o.status} | Patient: ${o.patient_name} | Price: ${o.total_price} | ReceivableAmt: ${amt} | DeliveryDate: ${o.delivery_date || o.actual_delivery_date}`);
                } else {
                    console.log(`- Order (excluded) | CaseId: ${o.case_id} | Status: ${o.status} | Price: ${o.total_price}`);
                }
            } else {
                const amt = supplierOfficialAmount(o);
                if (amt !== null) {
                    officialCredits += amt;
                    console.log(`- Order | CaseId: ${o.case_id} | Status: ${o.status} | Patient: ${o.patient_name} | Cost: ${o.cost} | PayableAmt: ${amt}`);
                } else {
                    console.log(`- Order (excluded) | CaseId: ${o.case_id} | Status: ${o.status} | Cost: ${o.cost}`);
                }
            }
        }

        console.log(`\n--- TRANSACTIONS ---`);
        for (const t of myTxs) {
            console.log(`- Tx | Type: ${t.type} | Amount: ${t.amount} | Date: ${t.date.split('T')[0]} | Category: ${t.category} | Desc: ${t.description}`);
            if (target.type === 'doctor') {
                if (t.type === 'income') officialCredits += Number(t.amount || 0);
            } else {
                if (t.type === 'expense') officialDebits += Number(t.amount || 0);
            }
        }

        console.log(`\n--- ADJUSTMENTS ---`);
        for (const a of myAdjs) {
            console.log(`- Adj | Type: ${a.type} | Amount: ${a.amount} | Date: ${a.date.split('T')[0]}`);
            if (target.type === 'doctor') {
                if (a.type === 'charge') officialDebits += Number(a.amount || 0);
                else officialCredits += Number(a.amount || 0);
            } else {
                if (a.type === 'credit') officialCredits += Number(a.amount || 0);
                else officialDebits += Number(a.amount || 0);
            }
        }

        const officialBalance = target.type === 'doctor' ? (officialDebits - officialCredits) : (officialCredits - officialDebits);
        console.log(`\nOfficial Debits: ${officialDebits.toFixed(2)}`);
        console.log(`Official Credits: ${officialCredits.toFixed(2)}`);
        console.log(`Official Balance: ${officialBalance.toFixed(2)}`);

        console.log(`\n--- OBLIGATIONS (Active, non-void) ---`);
        let obligGross = 0;
        let obligNet = 0;
        let obligAllocated = 0;
        for (const o of myObligs) {
            const ord = (orders || []).find(ord => ord.id === o.order_id);
            console.log(`- Oblig | CaseId: ${ord?.case_id || 'N/A'} | Trigger: ${o.trigger_type} | Gross: ${o.gross_amount} | Net: ${o.net_amount} | Allocated: ${o.allocated_amount} | Remaining: ${o.remaining_amount} | Status: ${o.status}`);
            obligGross += Number(o.gross_amount || 0);
            obligNet += Number(o.net_amount || 0);
            obligAllocated += Number(o.allocated_amount || 0);
        }

        const obligationBalance = obligNet - obligAllocated;
        console.log(`Obligation Net Total: ${obligNet.toFixed(2)}`);
        console.log(`Obligation Allocated Total: ${obligAllocated.toFixed(2)}`);
        console.log(`Obligation Balance: ${obligationBalance.toFixed(2)}`);

        const diff = obligationBalance - officialBalance;
        console.log(`\nRECONCILIATION DIFFERENCE (Oblig Balance - Official Balance): ${diff.toFixed(2)}`);
        console.log(`\n`);
    }
}

main().catch(console.error);
