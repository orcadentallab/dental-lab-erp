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
                const rootDoc = matches.find(d => !d.parent_id) || matches[0];
                let rootId = rootDoc.id;
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

    console.log(`INVESTIGATION REPORT FOR 17 TARGET ACCOUNTS (PAGINATION FIXED)\n`);

    for (const target of resolvedTargets) {
        console.log(`======================================================================`);
        console.log(`ENTITY: ${target.name} (${target.type})`);
        console.log(`======================================================================`);

        const idSet = new Set(target.ids);
        
        // Query only this entity's data to bypass 1000-row Supabase limit
        const { data: myOrdersRaw } = await supabase
            .from('orders')
            .select('*')
            .or(target.type === 'doctor' ? `doctor_id.in.(${target.ids.join(',')})` : `supplier_id.in.(${target.ids.join(',')})`);
            
        const { data: myTxsRaw } = await supabase
            .from('transactions')
            .select('*')
            .in('entity_id', target.ids);

        const { data: myAdjsRaw } = await supabase
            .from('adjustments')
            .select('*')
            .in('entity_id', target.ids)
            .eq('entity_type', target.type === 'doctor' ? 'doctor' : 'supplier');

        const { data: myObligsRaw } = await supabase
            .from('financial_obligations')
            .select('*')
            .in('entity_id', target.ids)
            .eq('entity_type', target.type === 'doctor' ? 'doctor' : 'external_lab')
            .neq('status', 'void');

        const myOrders = myOrdersRaw || [];
        const myTxs = (myTxsRaw || []).filter(t => {
            if (target.type === 'doctor') {
                return t.entity_type === 'doctor' || !t.entity_type;
            } else {
                return t.entity_type === 'supplier' || !t.entity_type;
            }
        });
        const myAdjs = myAdjsRaw || [];
        const myObligs = myObligsRaw || [];

        // Fetch allocations for these obligations
        const obligIds = myObligs.map(o => o.id);
        let myAllocs: any[] = [];
        if (obligIds.length > 0) {
            // chunk obligIds if too many
            const chunkSize = 100;
            for (let i = 0; i < obligIds.length; i += chunkSize) {
                const chunk = obligIds.slice(i, i + chunkSize);
                const { data: chunkAllocs } = await supabase
                    .from('payment_allocations')
                    .select('*')
                    .in('obligation_id', chunk);
                if (chunkAllocs) myAllocs.push(...chunkAllocs);
            }
        }

        // Calculations
        let officialDebits = 0;
        let officialCredits = 0;
        
        const includedOrders: any[] = [];
        const excludedOrders: any[] = [];

        for (const o of myOrders) {
            if (o.is_archived) continue;
            const lo = toOrder(o);
            if (target.type === 'doctor') {
                if (isDoctorStatementIncluded(lo)) {
                    const amt = getDoctorReceivableAmount(lo);
                    officialDebits += amt;
                    includedOrders.push({ ...lo, amt });
                } else {
                    excludedOrders.push(lo);
                }
            } else {
                const amt = supplierOfficialAmount(o);
                if (amt !== null) {
                    officialCredits += amt;
                    includedOrders.push({ ...lo, amt });
                } else {
                    excludedOrders.push(lo);
                }
            }
        }

        const collections: any[] = [];
        for (const t of myTxs) {
            if (target.type === 'doctor') {
                if (t.type === 'income') {
                    officialCredits += Number(t.amount || 0);
                    collections.push(t);
                }
            } else {
                if (t.type === 'expense') {
                    officialDebits += Number(t.amount || 0);
                    collections.push(t);
                }
            }
        }

        const adjsPrinted: any[] = [];
        for (const a of myAdjs) {
            adjsPrinted.push(a);
            if (target.type === 'doctor') {
                if (a.type === 'charge') officialDebits += Number(a.amount || 0);
                else officialCredits += Number(a.amount || 0);
            } else {
                if (a.type === 'credit') officialCredits += Number(a.amount || 0);
                else officialDebits += Number(a.amount || 0);
            }
        }

        const officialBalance = target.type === 'doctor' ? (officialDebits - officialCredits) : (officialCredits - officialDebits);

        let obligGross = 0;
        let obligNet = 0;
        let obligAllocated = 0;
        const activeObligs: any[] = [];

        for (const o of myObligs) {
            obligGross += Number(o.gross_amount || 0);
            obligNet += Number(o.net_amount || 0);
            obligAllocated += Number(o.allocated_amount || 0);
            activeObligs.push(o);
        }

        const obligationBalance = obligNet - obligAllocated;
        const diff = obligationBalance - officialBalance;

        // Print Summary Info
        console.log(`- Official Balance: ${officialBalance.toFixed(2)} (Debits: ${officialDebits.toFixed(2)}, Credits: ${officialCredits.toFixed(2)})`);
        console.log(`  └─ Orders sum: ${includedOrders.reduce((sum, x) => sum + x.amt, 0).toFixed(2)} (${includedOrders.length} orders included, ${excludedOrders.length} excluded)`);
        console.log(`  └─ Transactions sum: ${collections.reduce((sum, x) => sum + Number(x.amount || 0), 0).toFixed(2)} (${collections.length} payments/expenses)`);
        console.log(`  └─ Adjustments sum: ${adjsPrinted.reduce((sum, x) => sum + (x.type === 'charge' || (target.type === 'external_lab' && x.type === 'debit') ? Number(x.amount || 0) : -Number(x.amount || 0)), 0).toFixed(2)} (${adjsPrinted.length} adjustments)`);
        
        console.log(`- Proposed Oblig Balance: ${obligationBalance.toFixed(2)} (Net Obligs: ${obligNet.toFixed(2)}, Allocated: ${obligAllocated.toFixed(2)})`);
        console.log(`  └─ Active Obligations Count: ${activeObligs.length}`);
        
        console.log(`- RECONCILIATION DIFFERENCE: ${diff.toFixed(2)}`);

        // Investigate details
        console.log(`\nINVESTIGATION FINDINGS:`);
        
        // 1. Check for orders that are Delivered but have no corresponding obligation
        if (target.type === 'doctor') {
            const deliveredOrders = includedOrders.filter(o => o.status === 'Delivered');
            const missingObligOrders = deliveredOrders.filter(o => !activeObligs.some(ob => ob.order_id === o.id && ob.trigger_type === 'doctor_delivered'));
            if (missingObligOrders.length > 0) {
                console.log(`  [⚠️ Missing Obligations] There are ${missingObligOrders.length} delivered orders with NO 'doctor_delivered' obligation:`);
                for (const o of missingObligOrders.slice(0,5)) {
                    console.log(`    - CaseId: ${o.caseId} | Status: ${o.status} | Price: ${o.totalPrice} | ReceivableAmt: ${o.amt} | DeliveredDate: ${o.deliveryDate || o.actualDeliveryDate}`);
                }
                if (missingObligOrders.length > 5) console.log(`    ... and ${missingObligOrders.length - 5} more.`);
            }
        } else {
            // For external labs, orders with cost > 0 that are final_ready or final_delivered (status Ready/Delivered) should have trigger_type = 'external_lab_ready'
            const readyOrders = includedOrders.filter(o => o.status === 'Ready' || o.status === 'Delivered');
            const missingObligOrders = readyOrders.filter(o => o.amt > 0 && !activeObligs.some(ob => ob.order_id === o.id && ob.trigger_type === 'external_lab_ready'));
            if (missingObligOrders.length > 0) {
                console.log(`  [⚠️ Missing Obligations] There are ${missingObligOrders.length} ready/delivered orders with cost > 0 with NO 'external_lab_ready' obligation:`);
                for (const o of missingObligOrders.slice(0,5)) {
                    console.log(`    - CaseId: ${o.caseId} | Status: ${o.status} | Cost: ${o.cost} | PayableAmt: ${o.amt}`);
                }
                if (missingObligOrders.length > 5) console.log(`    ... and ${missingObligOrders.length - 5} more.`);
            }
        }

        // 2. Check adjustments representation gap
        const adjustmentsWithNoOblig = adjsPrinted.filter(a => {
            return !activeObligs.some(ob => ob.trigger_type === 'manual_adjustment' && Math.abs(Number(ob.net_amount) - Number(a.amount)) < 0.01);
        });
        if (adjustmentsWithNoOblig.length > 0) {
            console.log(`  [⚠️ Adjustment Gap] There are ${adjustmentsWithNoOblig.length} adjustments not represented in obligations:`);
            for (const a of adjustmentsWithNoOblig) {
                console.log(`    - Type: ${a.type} | Amount: ${a.amount} | Date: ${a.date.split('T')[0]}`);
            }
        }

        // 3. Highlight Issue Settlements, Dispute Settlements, Credit Candidates
        const issueObligs = activeObligs.filter(ob => ob.trigger_type === 'external_lab_issue_settlement');
        if (issueObligs.length > 0) {
            console.log(`  [ℹ️ Issue Settlements] Found ${issueObligs.length} issue settlement obligations:`);
            for (const ob of issueObligs) {
                const ord = myOrders.find(o => o.id === ob.order_id);
                console.log(`    - ObligId: ${ob.id.slice(0,8)} | CaseId: ${ord?.case_id} | Net: ${ob.net_amount} | Status: ${ob.status}`);
            }
        }

        // 4. Overpayments or unused collections (Potential Credits)
        const unallocatedTxs = collections.filter(t => {
            const txAllocs = myAllocs.filter(al => al.payment_transaction_id === t.id);
            const totalAlloc = txAllocs.reduce((sum, al) => sum + Number(al.allocated_amount || 0), 0);
            return totalAlloc < Number(t.amount || 0);
        });
        if (unallocatedTxs.length > 0) {
            console.log(`  [ℹ️ Credit Candidate] There are payments/collections that are not fully allocated:`);
            for (const t of unallocatedTxs) {
                const txAllocs = myAllocs.filter(al => al.payment_transaction_id === t.id);
                const totalAlloc = txAllocs.reduce((sum, al) => sum + Number(al.allocated_amount || 0), 0);
                const unallocAmount = Number(t.amount || 0) - totalAlloc;
                console.log(`    - TxId: ${t.id.slice(0,8)} | Amount: ${t.amount} | Allocated: ${totalAlloc} | Unallocated: ${unallocAmount} | Date: ${t.date.split('T')[0]} | Desc: ${t.description}`);
            }
        }

        // 5. Excluded non-final payables/receivables
        if (target.type === 'external_lab') {
            const nonFinalPayables = excludedOrders.filter(o => o.cost > 0 && (o.status === 'Try In' || o.status === 'New Case' || o.status === 'Under Production' || o.status === 'Under Design'));
            if (nonFinalPayables.length > 0) {
                console.log(`  [ℹ️ Excluded Non-Final Payables] There are ${nonFinalPayables.length} active orders with costs that aren't Ready/Delivered yet:`);
                for (const o of nonFinalPayables.slice(0,5)) {
                    console.log(`    - CaseId: ${o.caseId} | Status: ${o.status} | Cost: ${o.cost}`);
                }
                if (nonFinalPayables.length > 5) console.log(`    ... and ${nonFinalPayables.length - 5} more.`);
            }
        }

        console.log(`\n`);
    }
}

main().catch(console.error);
