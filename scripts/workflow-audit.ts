// WF-1.5 Audit CLI runner.
//
// Usage: npx tsx scripts/workflow-audit.ts > audit.csv
//
// Reads VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (or SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY) from process.env. Streams CSV to stdout
// and prints summary counts to stderr.

import { createClient } from '@supabase/supabase-js';
import {
    buildWorkflowAuditRows,
    summarizeAuditRows,
    auditRowsToCSV,
} from '../src/services/supabase/workflowAudit';

async function main() {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
        || process.env.SUPABASE_KEY
        || process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) {
        throw new Error('Missing env: set SUPABASE_URL + (SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_ANON_KEY) or VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.');
    }
    const client = createClient(url, key);
    const rows = await buildWorkflowAuditRows(client);
    const summary = summarizeAuditRows(rows);

    process.stdout.write(auditRowsToCSV(rows));
    process.stdout.write('\n');

    const stderrLines = [
        '─── WF-1.5 Workflow Audit Summary ───────────────────────────────',
        `Total rows: ${summary.totalRows}`,
        '',
        'production_status counts:',
        ...Object.entries(summary.productionStatusCounts).map(([k, v]) => `  ${k}: ${v}`),
        '',
        'issue_state counts:',
        ...Object.entries(summary.issueStateCounts).map(([k, v]) => `  ${k}: ${v}`),
        '',
        'suspicious_mapping_flags counts:',
        ...(Object.keys(summary.suspiciousFlagCounts).length === 0
            ? ['  (none)']
            : Object.entries(summary.suspiciousFlagCounts).map(([k, v]) => `  ${k}: ${v}`)),
        '',
        'financial_consistency_flags counts:',
        ...Object.entries(summary.financialFlagCounts).map(([k, v]) => `  ${k}: ${v}`),
        '',
        `Rows needing manual review: ${summary.needsManualReviewCount}`,
        `Rows ready for rep audited edits (when strict mode flips on): ${summary.repAuditedEditReadinessCount}`,
        '─────────────────────────────────────────────────────────────────',
    ];
    process.stderr.write(stderrLines.join('\n') + '\n');
}

main().catch(err => {
    process.stderr.write('Audit failed: ' + (err instanceof Error ? err.message : String(err)) + '\n');
    process.exit(1);
});
