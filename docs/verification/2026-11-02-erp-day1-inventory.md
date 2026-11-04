# ERP implementation — Day 1 evidence (2026-11-02)

> The 2 November sections below are a preserved historical snapshot. The current result is in **4 November 2026 — unified isolated database verification** at the end of this document. Docker download, route availability and supplier-timing statements in the original snapshot must not be read as today's status.

## Authority and scope

Current reference: `English Consolidated ERP Implementation Plan — One-Week Target` in the owner's 2026-10-31 backlog, consolidated 2026-11-01. Preserve B01–B21 and original Decision/Task IDs; latest explicit owner decision governs. The owner authorized local implementation after starting Docker on 2026-11-02. Production deployment, source cutover, production migrations, backfills and historical correction remain separately gated.

## Preserved starting state

- Branch: `codex/temporary-laptop-backup-20261030`.
- Working tree already contains modified finance statements, workflow permissions/actions, authentication, dashboard, package scripts, seeds and scratch files, plus untracked correction migrations/tests and release receipts. These are pre-existing work, not this implementation's changes. No reset, stash, checkout or bulk staging performed.
- No `AGENTS.md` was found in the repository's discoverable files or at `D:/AGENTS.md`.
- `docs/RESTORE_MAIN_COMPUTER_20261030_AR.md` identifies this branch as a work backup and warns against deploying it wholesale. Its production observations are historical evidence only.

## Local environment and baseline

- Docker engine responds: 29.9.2. Initial `docker ps` returned no running containers.
- Sandbox cannot access Docker's named pipe; the authorized elevated Docker check succeeded.
- `npm`/`npx` are unavailable on the current PATH. Existing local executables work: `node node_modules/vitest/vitest.mjs` and `node_modules/supabase/bin/supabase.exe`.
- Unit baseline: **61 files, 555 tests passed**, Vitest 4.1.9, duration 30.04 seconds.
- TypeScript project build check: `node node_modules/typescript/bin/tsc -b` passed (exit 0).
- Local Supabase startup initiated; first-run image download is in progress. Database/API/UI acceptance is **not yet verified**.
- CLI reports local auth/storage image versions differ from the linked project. This is a compatibility observation, not a current production inventory. No link/update or source change performed.

## Initial dependency findings — not a completed inventory

| References | Local evidence | Next validation |
|---|---|---|
| B02/B04/B09; decision 80 | `src/App.tsx` still exposes `/case-registration`; `src/lib/navigation.ts` contains workspace/search, quick action and default favourite entries; `src/hooks/useNavBadges.ts` invokes the registration count query | Trace all route, UI, query and event callers before reversible retirement |
| B02/B04; T14/F13 | `src/utils/employeeFinance.ts` uses `!t.isRegistered` for approved unpaid employee expenses; `EmployeeDetail.tsx` and `Employees.tsx` write this field during settlement | Preserve employee settlement, actual cash and approved semantics; test independently from obsolete order transfer |
| B04/B11/B13/B15; decisions 58–62 | Existing obligation trigger implementation and integration suite present. `20260808003000_order_issue_v2_finance_and_accounting.sql` normal supplier branch includes `final_ready` and `final_delivered`; later migrations also modify financial definitions | Verify effective local function, all later mutations and external-work-order paths; test final receipt only for normal supplier liability while preserving designer, cash and remake results |
| B05–B08 | Existing `needs_design_review` fields and production infrastructure found | A field name alone does not prove revision-bound approval, bypass or physical-round gates; trace real writers and permissions |
| B18–B20 | Existing Portal tests, dedicated QA script and migration history present | Check compatibility with effective V2 definitions, then isolated role/API/storage and billing tests; no real-user pilot claimed |

## Outstanding gates

1. Complete local image pull/startup and inspect effective schema before any reset; do not delete existing local volumes/data.
2. Run transactional database baseline, then build/type checks and isolated UI checks.
3. Complete writer/trigger/reader/flag inventory and map reusable behavior versus demonstrated gaps.
4. Current deployed definitions/permissions/flags have not been verified in this run. Old release receipts do not establish today's production state.
5. Representative de-identified exocad HTML/execution/STL/PLY samples and current supplier/courier evidence are still required for their dependent acceptance paths.

No application implementation, production change or historical repair is claimed by this initial evidence record.

Additional financial callers found: `src/constants/financialObligations.ts` contains Ready-based candidate/status helpers; `FINANCIAL_OBLIGATIONS_FLAGS` currently has tracking true, reporting false and client-side mutation sync false in local source. `20260914003000_external_stage_financial_obligation.sql` adds a stage-return obligation path in `receive_external_work_order`. These require caller/effective-definition checks before changing timing; none establishes a live production setting.

## 4 November 2026 — unified isolated database verification

Authority: the owner explicitly requested one database test command covering all 56 SQL files on isolated QA, an actual run, and this inventory update, preserving other work and making no production changes. Current branch: `codex/recovered-erp-20261104`; starting HEAD: `155ed7e`. B01, B02/B04, decision 80 and the English consolidated plan's Day 1 remain the references. No IDs or owner decisions were replaced.

### Command and isolation

Run from the repository:

```powershell
npm run test:db
```

On PowerShell, `npm.cmd run test:db` is also supported. Node/npm, PowerShell 7 (`pwsh`), Docker and the installed repository dependencies are required. This machine has those executables; the earlier missing-npm observation applied to the other machine.

- The command delegates to `pwsh -NoProfile -File scripts/design-qc-local-e2e.ps1 -DatabaseOnly`, reusing the existing QA setup. This mode exits after SQL verification, without browser fixture creation or browser tests.
- It discovers the complete `supabase/tests/database/*.sql` collection. Previously `test:db` enumerated 44 files and omitted 12, including Design QC, supplier final receipt and several analytics/V2 parity tests. There is no fixed file allow-list now; future SQL files are included automatically.
- It compares copied test names with source test names and requires the actual SQL runner's file count to match. An empty or mismatching snapshot fails instead of reporting a partial suite as complete. SQL failures propagate as a failed npm command with the diagnostic log location.
- QA workspace: `.design-qc-qa`; required marker: `.codex-owned-qc-test-workspace` containing `design-qc-disposable-local-only`; project: `design-qc-qa`; API/DB ports: `56501/56502`. Start/reset/test use the fixed workspace; reset/test explicitly use `--local`. No linked project or connection URL is accepted or forwarded.
- Each run resets only this owned disposable QA database, applies the current migration tree with default seeds disabled, then runs SQL tests before any browser fixtures. The main project database is not reset.
- `test:db:fresh` now delegates to `test:db`, which already creates a fresh QA baseline. The existing `verify` chain consequently uses the same isolated database path; its former direct main-project `supabase db reset --local` step is removed.

### Executed evidence on this machine

| Check | Actual result |
|---|---|
| `npm.cmd run test:db` | **PASS, exit 0: 56 files, 1031 SQL assertions**, all successful |
| Source and copied suite counts | **56 = 56**, checked by the runner and actual TAP summary |
| Targeted external registration/employee expense regression | **PASS: 2 Vitest files, 5 tests**; approved unpaid employee expense remains payable until explicit settlement |
| PowerShell parser | PASS for the changed script |
| Unknown argument | Rejected before running the script body; `-UnrecognizedProductionTarget` produces a nonzero exit |
| Unowned QA directory | Rejected before Supabase startup in a temporary local fixture; no QA config created there |
| Post-run QA readback | `design_qc_control.enabled=false`; `workflow_flag_enabled('production_v1')=false`; latest migration `20261103028000` |
| Browser fixtures in DatabaseOnly mode | `qc_browser_%` user count **0** |
| Main local database | `supabase_db_dental-lab-erp` remains exited, with its existing 27 October termination timestamp; it was not started or reset |
| Production | Not queried, deployed, migrated, source-switched or historically corrected in this task |

The first targeted Vitest attempt failed before executing tests because the sandbox blocked Vite's temporary-file rename (`EPERM`). Running the same unchanged tests with the appropriate process permissions passed. No assertions were weakened or application code changed.

Fresh logs: `.tmp/day1-db-command.log`, `.tmp/design-qc-clean-db.log`, `.tmp/day1-registration-tests.log`, `.tmp/day1-unowned-guard.log`, `.tmp/day1-qa-readback.log`. Startup/reset logs remain private because local CLI output can include local credentials. Previous build, full-unit and browser evidence remains in `docs/ERP_RESTORE_2026-11-04_AR.md`; those checks were not rerun or relabelled as part of this command-only change. No numerical coverage percentage is claimed for the orchestration change.

### Updated writer / trigger / reader map

These are current local-source contracts, with the critical function definitions read back from the newly migrated QA database. They do not establish production parity.

| References / surface | Writer and storage contract | Reader / current boundary |
|---|---|---|
| B02/B04/B09, decision 80: retired external registration | `LEGACY_EXTERNAL_REGISTRATION_ENABLED=false`; App redirects the route; navigation, badges and registration service queries are gated | Finance receipt/payment surfaces retained. Historical registration data/backend and employee `is_registered` settlement semantics retained |
| B02/B04, T14/F13: actual receipts/payments | `transactions.ts` → `create_finance_transaction_atomic`; transaction updates retain database permission/atomicity guards | Finance/Accounts/Statements and cash readers use actual transaction dates and existing `approved` semantics. No source switch |
| B02/B04: employee expenses | `EmployeeDetail`/`Employees` → `settle_employee_expenses`, with explicit settlement date, effective date and amount | `getEmployeeFinanceStats` retains approved/unpaid expense tracking; retirement does not clear claims. The five targeted checks are helper/UI-contract coverage, not a new real employee payout |
| B04/B11/B13/B15, 58–62: normal order liabilities | V2 order mutations in `orders.ts`/`orderWorkflow.ts` → guarded RPCs/direct writers → `trigger_sync_order_financial_obligations` → `sync_order_financial_obligations`/single-obligation/allocation helpers | Normal supplier earns at `final_delivered`; designer at completion. Existing statements/AR/AP readers retained; complete consumer reconciliation remains a later package |
| B05/B06/B09: design files/review | `designQc.ts` → immutable Storage objects + `submit_design_revision`/`decide_design_revision`; order/stage/external guards and revision snapshots | Design QC queue/history and authorized download paths implemented. Persistent admin pause remains OFF; full Notification Center is package 12 |
| B07/B08/B13/B16: production/shipping | Status-driven `sync_production_from_order`; stage RPCs; `shippingService.ts` → `create_shipment`/`confirm_shipment_delivery` | V2 intake/readiness shipping guard exists. New Try-In/Physical QC/round semantics are not declared complete by the baseline passing |
| B13/B15: separate external stage liability | `production.ts` → `receive_external_work_order`; distinct `external_stage_returned` contract | Do not infer normal-order timing applies to this writer or enable production routes without its own reconciliation |
| B18–B20: existing Portal | Existing scoped Portal RPCs, intake/review and billing readers; full SQL suite includes their current tests | Real-user pilot, real 3D samples and broader release acceptance are not completed by these SQL results |

QA function fingerprints for later comparison (PostgreSQL `md5(pg_get_functiondef(...))`, not production values): `sync_order_financial_obligations` = `b2b4444f4ac4c8274d9ba95a7893c769`; `create_shipment` = `85d082c75863a3c1d998b0ae96edb0c1`; `settle_employee_expenses` = `ec78f603e53ca8e1aa502b52d3232f05`; `guard_design_qc_execution` = `1e3086f4bdd5aebc26fb0bf2ad612751`. Full local signatures/fingerprints are in `.tmp/day1-qa-readback.log`.

Local source flags remain `trackingEnabled=true`, `reportingEnabled=false`, `clientSideMutationSyncEnabled=false`. Runtime QC and production flags above are observations of isolated QA only. The main and production flag values were not inferred from them.

### Day 1 closure and preserved work

**Closed locally:** the complete database test entry point, fresh isolated baseline, current source/QA evidence and the obsolete-registration/employee-settlement regression check. **Still open for full Day 1 production inventory:** current deployed definitions, RLS/Storage permissions and flags compared with the local contracts. Older production reports are historical evidence; this task does not close that gate.

Real exocad/STL/PLY samples, supplier/courier evidence, complete financial consumer reconciliation and later operational packages retain their existing gates. They do not require rebuilding working Financial Obligations and were not silently counted as finished here.

Pre-existing application/auth/workflow/statement/correction-migration/cleanup edits remain preserved. The pre-existing `.tmp` directory-creation line is retained in the shared runner because the command must work after workspace cleanup. The separate pre-existing `test:financial` addition in package.json is preserved and kept outside this task's commit. No unrelated migrations, tests or restore/cleanup documents are bundled into this change. The original 2 November inventory remains intact above.

Self-evaluation (`verification-loop` and `agent-self-evaluation` skills): accuracy 4/5 (actual SQL and runtime readback; production unverified), completeness 5/5 (requested command/run/inventory completed), clarity 4/5 (current update explicitly separated from the retained historical snapshot), actionability 4/5 (one documented command; PowerShell 7 and Docker required), conciseness 4/5 (single inventory update with relevant evidence and map). Average **4.2/5**. Improvement priorities: complete read-only deployed-contract comparison; retain cross-device runtime prerequisites in setup documentation. The user can review actual local completion without mistaking it for a production release.
