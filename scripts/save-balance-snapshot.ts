/**
 * BALANCE SNAPSHOT SCRIPT
 * ========================
 * يسحب أرصدة جميع الأطباء والموردين والمصممين
 * بنفس منطق AccountInfoPanel الموجود في النظام.
 *
 * الهدف: حفظ snapshot "قبل" أي تغييرات في الـ UI
 * علشان نتأكد بعدين ان الأرقام متغيرتش ولو جنيه واحد.
 *
 * الاستخدام:
 *   npx tsx scripts/save-balance-snapshot.ts
 *   npx tsx scripts/save-balance-snapshot.ts --compare snapshots/before_XXXX.json
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';

// ─── Load .env ────────────────────────────────────────────────────────────────
function loadEnv(filePath: string) {
    if (!existsSync(filePath)) return;
    for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        process.env[key] = process.env[key] ?? val;
    }
}
loadEnv(join(process.cwd(), '.env'));
loadEnv(join(process.cwd(), '.env.local'));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Types ────────────────────────────────────────────────────────────────────
interface EntityBalance {
    entityType: 'doctor' | 'supplier' | 'designer';
    entityId: string;
    entityName: string;
    totalWork: number;        // مجموع العمل المستحق (إيرادات / مصاريف)
    totalPaid: number;        // مجموع المدفوعات
    totalAdjCharges: number;  // إجمالي الرسوم الإضافية (adjustments charges)
    totalAdjCredits: number;  // إجمالي الائتمانات (adjustments credits)
    balance: number;          // الرصيد الصافي (طبيب: موجب = عليه، سالب = له)
    ordersCount: number;
    transactionsCount: number;
}

interface BalanceSnapshot {
    generatedAt: string;
    snapshotLabel: string;
    summary: {
        totalDoctorReceivables: number;
        totalSupplierPayables: number;
        totalDesignerPayables: number;
        totalDoctorsWithBalance: number;
        totalSuppliersWithBalance: number;
        totalDesignersWithBalance: number;
    };
    entities: EntityBalance[];
}

// ─── Balance Logic (mirrors AccountInfoPanel EXACTLY) ─────────────────────────

/** يطابق isDoctorStatementIncluded في orderLifecycle.ts */
const DOCTOR_STATEMENT_STATUSES = [
    'Delivered', 'Completed', 'Ready', 'Try In', 'Try In Approved',
    'Under Production', 'In Progress', 'Under Design',
    'Waiting Dr Approval', 'New Case', 'Pending', 'Pending Review',
    'Returned for Adjustments', 'Rejected',
];

function isDoctorStatementIncluded(order: any): boolean {
    return DOCTOR_STATEMENT_STATUSES.includes(order.status);
}

function isBillableToDoctor(order: any): boolean {
    return isDoctorStatementIncluded(order);
}

/** يطابق getDoctorReceivableAmount في orderLifecycle.ts */
function getDoctorReceivableAmount(order: any): number {
    return isBillableToDoctor(order) ? (order.total_price || order.totalPrice || 0) : 0;
}

/** يطابق منطق supplier في AccountInfoPanel */
function getSupplierCost(order: any): number {
    const hasRejectionCost = order.status === 'Rejected' && typeof order.rejected_lab_cost === 'number';
    const isDelivered = (order.status || '').toLowerCase() === 'delivered';
    const isRelevant = isDelivered || hasRejectionCost;
    if (!isRelevant) return 0;

    if (hasRejectionCost) return order.rejected_lab_cost;

    if (order.workflow_type === 'split') {
        // تكلفة المعمل = الـ cost - design_price
        const cost = order.cost || 0;
        const designPrice = order.design_price || 0;
        return Math.max(0, cost - designPrice);
    }

    return order.cost || 0;
}

/** يطابق منطق designer في AccountInfoPanel */
function getDesignerCost(order: any): number {
    const hasRejectionCost = order.status === 'Rejected' && typeof order.rejected_lab_cost === 'number';
    const isRelevant = order.workflow_type === 'split' &&
        (order.design_status === 'completed' || order.status === 'Rejected' ||
         order.status === 'Cancelled' || hasRejectionCost);

    if (!isRelevant) return 0;
    if (hasRejectionCost && order.rejected_lab_cost !== undefined) return order.rejected_lab_cost;
    return order.design_price || 0;
}

// ─── Data Fetching ─────────────────────────────────────────────────────────────

async function fetchAll() {
    console.log('⏳ جاري سحب البيانات من Supabase...\n');

    const [
        doctorsRes,
        suppliersRes,
        designersRes,
        ordersRes,
        transactionsRes,
        adjustmentsRes,
    ] = await Promise.all([
        supabase.from('doctors').select('id, name, parent_id').order('name'),
        supabase.from('suppliers').select('id, name').order('name'),
        supabase.from('users').select('id, name, role, custom_permissions').order('name'),
        supabase.from('orders').select(
            'id, doctor_id, supplier_id, designer_id, status, workflow_type, ' +
            'design_status, total_price, cost, design_price, rejected_lab_cost'
        ).order('created_at', { ascending: false }),
        supabase.from('transactions').select(
            'id, type, amount, entity_type, entity_id, date'
        ).order('date', { ascending: false }),
        supabase.from('adjustments').select(
            'id, type, amount, entity_type, entity_id'
        ),
    ]);

    const errors = [
        doctorsRes.error, suppliersRes.error, designersRes.error,
        ordersRes.error, transactionsRes.error, adjustmentsRes.error,
    ].filter(Boolean);

    if (errors.length > 0) {
        console.error('❌ أخطاء في سحب البيانات:');
        errors.forEach(e => console.error(' -', e?.message));
        process.exit(1);
    }

    // Filter designers (users with designer role)
    const allUsers = (designersRes.data || []) as any[];
    const designers = allUsers.filter(u =>
        u.role === 'designer' ||
        (u.custom_permissions && JSON.stringify(u.custom_permissions).includes('designer'))
    );

    return {
        doctors: (doctorsRes.data || []) as any[],
        suppliers: (suppliersRes.data || []) as any[],
        designers,
        orders: (ordersRes.data || []) as any[],
        transactions: (transactionsRes.data || []) as any[],
        adjustments: (adjustmentsRes.data || []) as any[],
    };
}

// ─── Calculate Balances ────────────────────────────────────────────────────────

function calculateDoctorBalance(
    doctor: any,
    allDoctors: any[],
    orders: any[],
    transactions: any[],
    adjustments: any[]
): EntityBalance {
    // Include sub-doctors (branches) under the same parent
    const entityIds = new Set([
        doctor.id,
        ...allDoctors.filter(d => d.parent_id === doctor.id).map(d => d.id),
    ]);

    const entityOrders = orders.filter(o =>
        entityIds.has(o.doctor_id) && isDoctorStatementIncluded(o)
    );

    const entityTransactions = transactions.filter(t =>
        (t.entity_type === 'doctor') && t.entity_id && entityIds.has(t.entity_id)
    );

    const entityAdjustments = adjustments.filter(a =>
        a.entity_type === 'doctor' && entityIds.has(a.entity_id)
    );

    const totalAdjCharges = entityAdjustments
        .filter(a => a.type === 'charge')
        .reduce((s: number, a: any) => s + a.amount, 0);

    const totalAdjCredits = entityAdjustments
        .filter(a => a.type === 'credit')
        .reduce((s: number, a: any) => s + a.amount, 0);

    const totalWork = entityOrders.reduce((s, o) => s + getDoctorReceivableAmount(o), 0) + totalAdjCharges;
    const totalPaid = entityTransactions
        .filter(t => t.type === 'income')
        .reduce((s: number, t: any) => s + t.amount, 0) + totalAdjCredits;

    return {
        entityType: 'doctor',
        entityId: doctor.id,
        entityName: doctor.name,
        totalWork: Math.round(totalWork * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        totalAdjCharges: Math.round(totalAdjCharges * 100) / 100,
        totalAdjCredits: Math.round(totalAdjCredits * 100) / 100,
        balance: Math.round((totalWork - totalPaid) * 100) / 100,
        ordersCount: entityOrders.length,
        transactionsCount: entityTransactions.length,
    };
}

function calculateSupplierBalance(
    supplier: any,
    orders: any[],
    transactions: any[],
    adjustments: any[]
): EntityBalance {
    const entityOrders = orders.filter(o => o.supplier_id === supplier.id);
    const entityTransactions = transactions.filter(t =>
        t.entity_type === 'supplier' && t.entity_id === supplier.id
    );
    const entityAdjustments = adjustments.filter(a =>
        a.entity_type === 'supplier' && a.entity_id === supplier.id
    );

    const totalAdjCharges = entityAdjustments.filter(a => a.type === 'charge').reduce((s: number, a: any) => s + a.amount, 0);
    const totalAdjCredits = entityAdjustments.filter(a => a.type === 'credit').reduce((s: number, a: any) => s + a.amount, 0);

    const totalWork = entityOrders.reduce((s, o) => s + getSupplierCost(o), 0) + totalAdjCharges;
    const totalPaid = entityTransactions.filter(t => t.type === 'expense').reduce((s: number, t: any) => s + t.amount, 0) + totalAdjCredits;

    return {
        entityType: 'supplier',
        entityId: supplier.id,
        entityName: supplier.name,
        totalWork: Math.round(totalWork * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        totalAdjCharges: Math.round(totalAdjCharges * 100) / 100,
        totalAdjCredits: Math.round(totalAdjCredits * 100) / 100,
        balance: Math.round((totalWork - totalPaid) * 100) / 100,
        ordersCount: entityOrders.length,
        transactionsCount: entityTransactions.length,
    };
}

function calculateDesignerBalance(
    designer: any,
    orders: any[],
    transactions: any[],
    adjustments: any[]
): EntityBalance {
    const entityOrders = orders.filter(o => o.designer_id === designer.id);
    const entityTransactions = transactions.filter(t =>
        t.entity_type === 'designer' && t.entity_id === designer.id
    );
    const entityAdjustments = adjustments.filter(a =>
        a.entity_type === 'designer' && a.entity_id === designer.id
    );

    const totalAdjCharges = entityAdjustments.filter(a => a.type === 'charge').reduce((s: number, a: any) => s + a.amount, 0);
    const totalAdjCredits = entityAdjustments.filter(a => a.type === 'credit').reduce((s: number, a: any) => s + a.amount, 0);

    const totalWork = entityOrders.reduce((s, o) => s + getDesignerCost(o), 0) + totalAdjCharges;
    const totalPaid = entityTransactions.filter(t => t.type === 'expense').reduce((s: number, t: any) => s + t.amount, 0) + totalAdjCredits;

    return {
        entityType: 'designer',
        entityId: designer.id,
        entityName: designer.name,
        totalWork: Math.round(totalWork * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        totalAdjCharges: Math.round(totalAdjCharges * 100) / 100,
        totalAdjCredits: Math.round(totalAdjCredits * 100) / 100,
        balance: Math.round((totalWork - totalPaid) * 100) / 100,
        ordersCount: entityOrders.length,
        transactionsCount: entityTransactions.length,
    };
}

// ─── Compare with previous snapshot ──────────────────────────────────────────

function compareSnapshots(before: BalanceSnapshot, after: BalanceSnapshot) {
    console.log('\n' + '═'.repeat(70));
    console.log('  📊 مقارنة الأرصدة: قبل vs بعد');
    console.log('  قبل : ' + before.generatedAt);
    console.log('  بعد  : ' + after.generatedAt);
    console.log('═'.repeat(70));

    const beforeMap = new Map(before.entities.map(e => [`${e.entityType}:${e.entityId}`, e]));
    const afterMap = new Map(after.entities.map(e => [`${e.entityType}:${e.entityId}`, e]));

    let totalDiff = 0;
    const diffs: { key: string; name: string; field: string; before: number; after: number; diff: number }[] = [];

    // Check all entities
    for (const [key, aft] of afterMap) {
        const bef = beforeMap.get(key);
        if (!bef) {
            console.log(`  ➕ كيان جديد: ${aft.entityName} (${aft.entityType}) — رصيد: ${aft.balance}`);
            continue;
        }

        const fields: Array<keyof EntityBalance> = ['totalWork', 'totalPaid', 'balance'];
        for (const field of fields) {
            const bVal = bef[field] as number;
            const aVal = aft[field] as number;
            const diff = Math.round((aVal - bVal) * 100) / 100;
            if (Math.abs(diff) > 0.005) {
                diffs.push({ key, name: aft.entityName, field, before: bVal, after: aVal, diff });
                totalDiff += Math.abs(diff);
            }
        }
    }

    if (diffs.length === 0) {
        console.log('\n  ✅ ممتاز! لا يوجد أي فرق — الأرصدة مطابقة تماماً');
    } else {
        console.log(`\n  ❌ تم اكتشاف ${diffs.length} فرق:\n`);
        for (const d of diffs) {
            const arrow = d.diff > 0 ? '▲' : '▼';
            console.log(`  ${arrow} ${d.name} (${d.field})`);
            console.log(`      قبل: ${d.before.toLocaleString()} | بعد: ${d.after.toLocaleString()} | فرق: ${d.diff > 0 ? '+' : ''}${d.diff.toLocaleString()} ج.م`);
        }
        console.log(`\n  ⚠️  إجمالي الفروقات: ${totalDiff.toLocaleString()} ج.م`);
    }

    console.log('\n  ─── ملخص الأرقام الإجمالية ───');
    console.log(`  إجمالي الأطباء المستحق  : قبل ${before.summary.totalDoctorReceivables.toLocaleString()} → بعد ${after.summary.totalDoctorReceivables.toLocaleString()}`);
    console.log(`  إجمالي الموردين المستحق : قبل ${before.summary.totalSupplierPayables.toLocaleString()} → بعد ${after.summary.totalSupplierPayables.toLocaleString()}`);
    console.log(`  إجمالي المصممين المستحق : قبل ${before.summary.totalDesignerPayables.toLocaleString()} → بعد ${after.summary.totalDesignerPayables.toLocaleString()}`);

    process.exit(diffs.length > 0 ? 1 : 0);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    const compareIdx = args.indexOf('--compare');
    const compareFile = compareIdx !== -1 ? args[compareIdx + 1] : null;

    const { doctors, suppliers, designers, orders, transactions, adjustments } = await fetchAll();

    console.log(`📦 البيانات المسحوبة:`);
    console.log(`   أطباء: ${doctors.length} | موردون: ${suppliers.length} | مصممون: ${designers.length}`);
    console.log(`   أوردرات: ${orders.length} | معاملات: ${transactions.length} | تسويات: ${adjustments.length}\n`);

    const entities: EntityBalance[] = [];

    // Doctors (only primary — no sub-doctors to avoid double-counting)
    const primaryDoctors = doctors.filter((d: any) => !d.parent_id);
    for (const doctor of primaryDoctors) {
        const b = calculateDoctorBalance(doctor, doctors, orders, transactions, adjustments);
        entities.push(b);
    }

    // Suppliers
    for (const supplier of suppliers) {
        const b = calculateSupplierBalance(supplier, orders, transactions, adjustments);
        entities.push(b);
    }

    // Designers
    for (const designer of designers) {
        const b = calculateDesignerBalance(designer, orders, transactions, adjustments);
        entities.push(b);
    }

    const doctorEntities = entities.filter(e => e.entityType === 'doctor');
    const supplierEntities = entities.filter(e => e.entityType === 'supplier');
    const designerEntities = entities.filter(e => e.entityType === 'designer');

    const snapshot: BalanceSnapshot = {
        generatedAt: new Date().toISOString(),
        snapshotLabel: compareFile ? 'after_ui_changes' : 'before_ui_changes',
        summary: {
            totalDoctorReceivables: Math.round(doctorEntities.reduce((s, e) => s + Math.max(0, e.balance), 0) * 100) / 100,
            totalSupplierPayables: Math.round(supplierEntities.reduce((s, e) => s + Math.max(0, e.balance), 0) * 100) / 100,
            totalDesignerPayables: Math.round(designerEntities.reduce((s, e) => s + Math.max(0, e.balance), 0) * 100) / 100,
            totalDoctorsWithBalance: doctorEntities.filter(e => Math.abs(e.balance) > 0).length,
            totalSuppliersWithBalance: supplierEntities.filter(e => Math.abs(e.balance) > 0).length,
            totalDesignersWithBalance: designerEntities.filter(e => Math.abs(e.balance) > 0).length,
        },
        entities,
    };

    // Print summary
    console.log('═'.repeat(70));
    console.log('  💰 ملخص الأرصدة الحالية');
    console.log('═'.repeat(70));

    console.log('\n📋 الأطباء (الأرصدة الكبيرة):');
    doctorEntities
        .filter(e => Math.abs(e.balance) > 0)
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 20)
        .forEach(e => {
            const sign = e.balance > 0 ? '🔴 عليه' : '🟢 له  ';
            console.log(`  ${sign}  ${e.entityName.padEnd(30)} ${Math.abs(e.balance).toLocaleString().padStart(12)} ج.م  (عمل: ${e.totalWork.toLocaleString()} | مدفوع: ${e.totalPaid.toLocaleString()})`);
        });

    console.log('\n🏭 الموردون:');
    supplierEntities
        .filter(e => Math.abs(e.balance) > 0)
        .sort((a, b) => b.balance - a.balance)
        .forEach(e => {
            const sign = e.balance > 0 ? '🔴 عليهم' : '🟢 لهم  ';
            console.log(`  ${sign}  ${e.entityName.padEnd(30)} ${Math.abs(e.balance).toLocaleString().padStart(12)} ج.م`);
        });

    console.log('\n🎨 المصممون:');
    designerEntities
        .filter(e => Math.abs(e.balance) > 0)
        .sort((a, b) => b.balance - a.balance)
        .forEach(e => {
            const sign = e.balance > 0 ? '🔴 عليهم' : '🟢 لهم  ';
            console.log(`  ${sign}  ${e.entityName.padEnd(30)} ${Math.abs(e.balance).toLocaleString().padStart(12)} ج.م`);
        });

    console.log('\n═'.repeat(70));
    console.log(`  إجمالي المستحق من الأطباء  : ${snapshot.summary.totalDoctorReceivables.toLocaleString()} ج.م`);
    console.log(`  إجمالي المستحق للموردين    : ${snapshot.summary.totalSupplierPayables.toLocaleString()} ج.م`);
    console.log(`  إجمالي المستحق للمصممين    : ${snapshot.summary.totalDesignerPayables.toLocaleString()} ج.م`);
    console.log('═'.repeat(70));

    // Save snapshot
    const snapshotDir = join(process.cwd(), 'snapshots');
    if (!existsSync(snapshotDir)) mkdirSync(snapshotDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const snapshotFile = join(snapshotDir, `${snapshot.snapshotLabel}_${timestamp}.json`);
    writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2), 'utf-8');
    console.log(`\n✅ تم حفظ الـ snapshot في: ${snapshotFile}`);

    // Compare if requested
    if (compareFile) {
        if (!existsSync(compareFile)) {
            console.error(`\n❌ ملف المقارنة غير موجود: ${compareFile}`);
            process.exit(1);
        }
        const before: BalanceSnapshot = JSON.parse(readFileSync(compareFile, 'utf-8'));
        compareSnapshots(before, snapshot);
    } else {
        console.log(`\n💡 لمقارنة الأرصدة بعد التغييرات:`);
        console.log(`   npx tsx scripts/save-balance-snapshot.ts --compare ${snapshotFile}`);
    }
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
