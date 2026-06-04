import { execSync } from 'node:child_process';

function main() {
    const fileContent = execSync('git show HEAD:account-totals-current-vs-proposed.md', { encoding: 'utf8' });
    const lines = fileContent.split('\n');
    const tableLines: string[] = [];
    let inTable = false;

    for (const line of lines) {
        if (line.includes('| entity_type | entity_name | official |')) {
            inTable = true;
            continue;
        }
        if (inTable) {
            if (line.trim().startsWith('|') && !line.includes('|---|')) {
                tableLines.push(line);
            } else if (line.trim() === '') {
                inTable = false;
            }
        }
    }

    console.log(`Found ${tableLines.length} table rows.`);
    const results: any[] = [];
    for (const row of tableLines) {
        const parts = row.split('|').map(s => s.trim());
        if (parts.length < 10) continue;
        const type = parts[1];
        const name = parts[2];
        const official = parseFloat(parts[3].replace(/,/g, ''));
        const activeOblig = parseFloat(parts[4].replace(/,/g, ''));
        const cleanup = parseFloat(parts[5].replace(/,/g, ''));
        const cleanAllocation = parseFloat(parts[6].replace(/,/g, ''));
        
        // In the script, current difference is:
        // current_obligation_balance_before_cleanup = activeOblig - currentAllocated
        // But since we want the difference before simulated steps, let's look at the actual values:
        // Wait, the columns are:
        // official | active obligations | cleanup | clean allocation | after cleanup+allocation | final difference | flags
        // Wait, what was the current difference before proposed steps?
        // Let's compute it. In the script, current difference = current_obligation_balance_before_cleanup - official
        // where current_obligation_balance_before_cleanup = activeOblig - currentAllocated.
        // Wait, let's see. The script computed it as:
        // difference_current_obligation_vs_official = beforeCleanup - officialBalance
        // Let's check which rows have non-zero difference_current_obligation_vs_official in the original file.
        // Wait, let's look at Section C "Accounts With Zero Difference Now" in the git version.
        // If an account is not in Section C, it had a non-zero current difference!
        // Let's find which accounts are NOT in Section C.
    }

    // Let's parse Section C and find the ones not in it.
    let inSectionC = false;
    const zeroDiffNames = new Set<string>();
    for (const line of lines) {
        if (line.includes('## C) Accounts With Zero Difference Now')) {
            inSectionC = true;
            continue;
        }
        if (line.includes('## D)')) {
            inSectionC = false;
        }
        if (inSectionC && line.startsWith('|') && !line.includes('|---|') && !line.includes('| entity_type |')) {
            const parts = line.split('|').map(s => s.trim());
            zeroDiffNames.add(parts[2]);
        }
    }

    console.log(`Zero difference accounts in Section C: ${zeroDiffNames.size}`);

    const diffAccounts: any[] = [];
    inTable = false;
    for (const line of lines) {
        if (line.includes('| entity_type | entity_name | official |')) {
            inTable = true;
            continue;
        }
        if (inTable) {
            if (line.trim().startsWith('|') && !line.includes('|---|')) {
                const parts = line.split('|').map(s => s.trim());
                const type = parts[1];
                const name = parts[2];
                const official = parseFloat(parts[3].replace(/,/g, ''));
                const activeOblig = parseFloat(parts[4].replace(/,/g, ''));
                const cleanup = parseFloat(parts[5].replace(/,/g, ''));
                const cleanAlloc = parseFloat(parts[6].replace(/,/g, ''));
                const after = parseFloat(parts[7].replace(/,/g, ''));
                const finalDiff = parseFloat(parts[8].replace(/,/g, ''));
                const flags = parts[9];

                if (!zeroDiffNames.has(name)) {
                    diffAccounts.push({ type, name, official, activeOblig, cleanup, cleanAlloc, after, finalDiff, flags });
                }
            } else if (line.trim() === '') {
                inTable = false;
            }
        }
    }

    console.log(`Found ${diffAccounts.length} accounts with non-zero current difference:`);
    for (const a of diffAccounts) {
        // We know that current difference = (activeOblig - currentAllocated) - official.
        // Wait, what was the currentAllocated for each of these?
        // Let's compute it. We know that final_difference = after - official = (activeOblig - currentAllocated - cleanup - cleanAlloc) - official.
        // Therefore, current_allocated = activeOblig - cleanup - cleanAlloc - after.
        // Let's print them.
        const currentAllocated = a.activeOblig - a.cleanup - a.cleanAlloc - a.after;
        const currentObligBalance = a.activeOblig - currentAllocated;
        const currentDiff = currentObligBalance - a.official;
        console.log(`- ${a.type} | ${a.name} | Current Diff: ${currentDiff.toFixed(2)} | Official: ${a.official.toFixed(2)} | Active Oblig: ${a.activeOblig.toFixed(2)} | Current Allocated: ${currentAllocated.toFixed(2)} | Proposed Clean Alloc: ${a.cleanAlloc.toFixed(2)} | Proposed Cleanup: ${a.cleanup.toFixed(2)} | Flags: ${a.flags}`);
    }
}

main();
