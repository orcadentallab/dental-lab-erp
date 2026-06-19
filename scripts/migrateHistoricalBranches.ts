import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// 1. Load environment variables from .env
const envContent = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf-8');
const env: Record<string, string> = {};
envContent.split('\n').forEach(line => {
    const [key, ...values] = line.split('=');
    if (key && values.length > 0) {
        env[key.trim()] = values.join('=').trim().replace(/['"]/g, '');
    }
});

const supabaseUrl = env['VITE_SUPABASE_URL'];
const supabaseKey = env['VITE_SUPABASE_ANON_KEY'];

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env file');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 2. Arabic string normalization helper
const normalizeArabic = (text: string): string => {
    return text
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
};

interface Branch {
    id: string;
    name: string;
    address?: string;
    phone?: string;
}

interface OrderMatch {
    orderId: string;
    orderCode: string;
    patientName: string;
    doctorId: string;
    doctorName: string;
    instructions: string;
    detectedBranch: string;
}

async function run() {
    const args = process.argv.slice(2);
    const isCommit = args.includes('--commit');

    console.log(isCommit ? '🚀 Running in COMMIT mode (database will be updated)...' : '🔍 Running in DRY RUN mode (preview only)...');

    // 1. Get doctors who have branches enabled
    console.log('Fetching doctors with branches...');
    const { data: doctors, error: docsError } = await supabase
        .from('doctors')
        .select('id, name, has_branches, branches')
        .eq('has_branches', true);

    if (docsError) throw docsError;
    if (!doctors || doctors.length === 0) {
        console.log('No doctors found with branches enabled.');
        return;
    }

    console.log(`Found ${doctors.length} doctors with branches.`);

    // Map doctor ID to doctor branches
    const doctorMap = new Map(doctors.map(d => [d.id, d]));

    // 2. Fetch all orders for these doctors where branch_name is NULL
    const doctorIds = doctors.map(d => d.id);
    console.log('Fetching orders with empty branch names...');
    
    // We can fetch in batches if needed, but standard query can retrieve them
    const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('id, case_id, patient_name, doctor_id, instructions, branch_name')
        .in('doctor_id', doctorIds)
        .or('branch_name.is.null,branch_name.eq.""');

    if (ordersError) throw ordersError;
    if (!orders || orders.length === 0) {
        console.log('No historical orders found without branch names.');
        return;
    }

    console.log(`Found ${orders.length} orders to inspect.`);

    const matches: OrderMatch[] = [];
    const skipped: any[] = [];

    // 3. Scan instructions to detect branch
    for (const order of orders) {
        const doc = doctorMap.get(order.doctor_id);
        if (!doc) continue;

        const docBranches: Branch[] = doc.branches ? (doc.branches as any) : [];
        if (docBranches.length === 0) {
            skipped.push({ order, reason: 'Doctor has has_branches=true but no branches list is set.' });
            continue;
        }

        const instructions = order.instructions || '';
        if (!instructions.trim()) {
            skipped.push({ order, reason: 'Instructions are empty.' });
            continue;
        }

        const normalizedInstructions = normalizeArabic(instructions);
        let detectedBranch: string | null = null;

        for (const branch of docBranches) {
            const normalizedBranchName = normalizeArabic(branch.name);
            if (!normalizedBranchName) continue;

            // Simple substring check
            if (normalizedInstructions.includes(normalizedBranchName)) {
                detectedBranch = branch.name;
                break;
            }
        }

        if (detectedBranch) {
            matches.push({
                orderId: order.id,
                orderCode: order.case_id || '-',
                patientName: order.patient_name || '-',
                doctorId: order.doctor_id,
                doctorName: doc.name,
                instructions: instructions,
                detectedBranch: detectedBranch
            });
        } else {
            skipped.push({ order, reason: 'No matching branch name found in instructions.' });
        }
    }

    console.log(`\nScan finished. Found ${matches.length} matches out of ${orders.length} orders.`);

    if (matches.length === 0) {
        console.log('No matches found to migrate.');
        return;
    }

    // 4. Handle output
    if (!isCommit) {
        // Generate Markdown report
        let report = `# تقرير معاينة ترحيل الفروع التاريخية (Branch Migration Preview Report)\n\n`;
        report += `تم إجراء الفحص في: ${new Date().toLocaleString('ar-EG')}\n\n`;
        report += `* **إجمالي الطلبات التي تم فحصها:** ${orders.length}\n`;
        report += `* **عدد الطلبات المطابقة المقترح تحديثها:** ${matches.length}\n`;
        report += `* **عدد الطلبات المستبعدة (لعدم كتابة فرع أو فراغ التعليمات):** ${skipped.length}\n\n`;
        report += `## الطلبات المطابقة المقترحة للتحديث\n\n`;
        report += `| كود الأوردر | اسم المريض | الطبيب / المركز | الفرع المكتشف | نص التعليمات |\n`;
        report += `| :--- | :--- | :--- | :--- | :--- |\n`;

        matches.forEach(m => {
            // Clean up instruction text for markdown cell (replace newlines with space)
            const cleanInstructions = m.instructions.replace(/\r?\n/g, ' ').slice(0, 100);
            report += `| ${m.orderCode} | ${m.patientName} | ${m.doctorName} | **${m.detectedBranch}** | ${cleanInstructions}... |\n`;
        });

        const reportPath = path.resolve(process.cwd(), 'branch_migration_preview.md');
        fs.writeFileSync(reportPath, report, 'utf-8');
        console.log(`\n🎉 Report generated successfully! Please review the preview file at:\n   ${reportPath}`);
        console.log(`\nIf the matching looks correct, run this command to execute the updates:`);
        console.log(`   npx vite-node scripts/migrateHistoricalBranches.ts --commit`);
    } else {
        console.log('\nExecuting updates in database...');
        let successCount = 0;
        let failCount = 0;

        for (const m of matches) {
            const { error: updateError } = await supabase
                .from('orders')
                .update({ branch_name: m.detectedBranch })
                .eq('id', m.orderId);

            if (updateError) {
                console.error(`❌ Failed to update Order ${m.orderCode} (${m.orderId}):`, updateError);
                failCount++;
            } else {
                successCount++;
                if (successCount % 10 === 0 || successCount === matches.length) {
                    console.log(`Updated ${successCount}/${matches.length} orders...`);
                }
            }
        }

        console.log(`\n✅ Migration Completed!`);
        console.log(`* Successfully updated: ${successCount} orders.`);
        if (failCount > 0) {
            console.log(`* Failed updates: ${failCount} orders.`);
        }
    }
}

run().catch(error => {
    console.error('Fatal error during migration execution:', error);
    process.exit(1);
});
