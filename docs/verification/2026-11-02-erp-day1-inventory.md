# ERP implementation — Day 1 evidence (2026-11-02)

> The 2 November sections below are a preserved historical snapshot. Current evidence is in the **4 November 2026 — unified isolated database verification** and **4 November 2026 — current production comparison (read-only)** sections below. Statements about downloading Docker, active legacy registration and unverified production in earlier task snapshots must not be read as today's status.

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

## 4 November 2026 — current production comparison (read-only)

Authority: the owner's subsequent explicit request to compare current deployed definitions, permissions and flags with local QA using reads only. This section supersedes the earlier *production not verified* status for the catalog and DB flags inspected here; previous task statements remain historical evidence. Reference: B01/Day 1, the existing writer/reader map above, and the latest owner boundaries on cash, `approved`, coordinator responsibilities, designer earning and Remake.

### Identity, method and evidence

- Verified live Supabase project **Orca ERP**, ref `piuiiwcjnfvjwyewczuz`, `ACTIVE_HEALTHY`. The ref agrees with `.env`, `.env.production`, the linked-project marker and the Supabase hostname in the **currently served** public JS entry at `https://orcalab.vercel.app/`.
- Production catalog observation started **4 November, 05:36 Cairo** (`03:36 UTC`); closeout at **05:50 Cairo**. Local comparison target was the existing isolated QA container `supabase_db_design-qc-qa`, not the stopped main local database. Both PostgreSQL servers report `17.6`.
- Remote reads used the connected Supabase plugin. Every catalog query ran inside `BEGIN READ ONLY ... COMMIT`; observed `transaction_read_only=on` on both sides. Queried schema metadata, privilege catalogs, migration version/name metadata, an explicit allow-list of operational settings and bucket configuration. No order, patient, account, payment, Storage-object contents or auth-user records were read. Business RPCs were inspected as definitions, never invoked.
- The closeout confirmed unchanged migration count/latest version, all nine observed settings and fingerprints of five critical production functions during this audit. Samples are separate read-only transactions, not one atomic cross-environment snapshot.
- Live HTML/JS were fetched with GET only, without an authenticated browser session. Current entry: `/assets/index-BCZPm9n2.js`, SHA-256 `2e64d89475aa917fdd0ae115f8a406e5d4ac7e905332bf3e4dcc996bf6684719`. This establishes the served artifact, not a Git commit or Vercel deployment ID.
- Read-only GitHub deployment metadata identifies the latest successful `Production – orca` deployment as **7474986991**, commit **`daf0aa9dba99d5e7c801dfe3e0a13f43e75a5f5b`**, created 1 November at 15:22 Cairo. The plugin was used for exact-commit source reads; GitHub CLI GET was used for deployment/status endpoints unavailable in that plugin. The immutable deployment URL returns **302 to Vercel SSO**. Authentication/protection was not bypassed; therefore an exact binary comparison between that deployment and the current public alias was not completed.

Durable, machine-readable comparison: [2026-11-04-production-local-catalog-diff.json](2026-11-04-production-local-catalog-diff.json). It contains names, definitions of constraints/indexes, permission differences and fingerprints, with no credentials, function bodies or business rows. Full private catalog snapshots and reviewed function-source differences remain under `.tmp/day1-{prod,local}-*.json` / `.tmp/day1-*-fn-*.sql`. One metadata query initially needed an explicit PostgreSQL `"char"`→text cast; it failed within a read-only transaction and was corrected. No migration command, DDL/DML, source switch, historical correction, grant, bucket change, upload or deployment was performed.

### Confirmed differences

| Surface | Production now | Isolated local QA | Consequence / review boundary |
|---|---|---|---|
| Migration ledger | **272**, latest `20261101000000` | **297**, latest `20261103028000` | **25 versions absent from production**. Version lists alone do not establish function parity; actual definitions were also compared |
| Missing packages | 13 October Portal/security/scan migrations; `20261101010000`; shipment guard; supplier timing; 9 Design QC migrations absent | Present in the tested local chain | Prepare compatible release packages; do not apply a blanket migration list or include historical repairs by implication |
| Retired external registration, decision 80 | Current public entry directly mounts its lazy-loaded `CaseRegistration-kip_3Y06.js` at `/case-registration` | `LEGACY_EXTERNAL_REGISTRATION_ENABLED=false`, route redirects to ledgers | Retirement is locally implemented, **not currently active on the live frontend**. Static artifact evidence; no user login or registration operation was performed |
| Normal supplier accrual | Actual `sync_order_financial_obligations` branch includes `final_ready` **and** `final_delivered` | Normal branch only at `final_delivered`, with a historical-preservation guard | The approved new timing is implemented locally but **not deployed**. No historical impact query, void/reallocation or correction was run |
| Shipment entry point | `create_shipment` predates the local Portal intake/readiness/row-lock/address checks | Current V2 guard and its prerequisites present | `20261103000000` alone cannot be applied to this production definition: its exact expected replacement text is absent. Review the prerequisite chain or prepare a narrow compatible patch and test it on an isolated production-schema copy first |
| Design QC | No `design_qc_*` / `design_revisions` tables, no revision/gate RPCs and no `design-qc-files` bucket | Implemented; persistent control OFF | Do not assume the deployed ERP has a usable QC switch or revision workflow. The authenticated local tests establish local readiness only |
| Portal and scoped access | New invitation/registration/scope/inbox/scan contracts absent | 11 Portal-related tables plus 5 QC tables added | Current old Portal is not the new Portal package. Reader, permission and Storage prerequisites need a coherent release |
| Delivery-type editing | Existing representative audited RPC lacks the local delivery-type transition contract | `20261101010000` adds audited transition/guards | Keep this pre-existing merged work separate from new feature claims; don't deploy the new caller against the old RPC |
| Production-stage synchronization | Actual `sync_production_from_order` differs in route-record alias and stage closing/reopening handling | Local October sync correction present | A behavioral difference, not just source formatting; include in compatibility review before enabling production routes |
| Existing admin correction | `admin_correct_order_production_status_v2` is present | Present; body equivalent after CRLF normalization | Reuse it; do not infer it is missing from an older report or redevelop it |
| Financial handoff schema | No QC assignment FK/settlement shape; `financial_obligations.order_id` NOT NULL; original active-obligation indexes | Separate QC settlements, scoped nullable order FK and matching index predicates | Client reassignment and schema must ship together. Ordinary issue/cash rules are not changed by this audit |

The 25 missing versions are grouped as **13 Portal/security/production-sync/scan**, **1 delivery-type editing**, **1 shipment guard**, **1 normal supplier timing**, **9 QC**. Their exact IDs/names are retained in the JSON evidence. Production has no migration-ledger version absent from QA, but it does have additional catalog differences outside that version list.

### Functions, policies, roles and Storage

- Public functions: **188 production / 258 local**. **71 local-only**, **1 production-only** (`_cost_split_metrics`, not invoked or removed), **187 common**. Of 40 common functions with changed metadata, **29 differ only in CRLF/outer whitespace**, **2 in comments/whitespace**, **8 have reviewed behavioral changes**, and **1 has only access-metadata changes**. Fingerprint inequality was not automatically labelled a business defect.
- The eight reviewed behavioral differences are: `create_shipment`, `sync_order_financial_obligations`, `admin_reset_password`, `admin_review_order_edit`, `get_my_doctor_orders_v2`, `orders_role_field_guard`, `rep_update_order_fields_with_audit`, `sync_production_from_order`. Password reset and doctor-scope changes belong to the pending Portal/security package; no password operation was attempted.
- **All 183 existing production policies match their same-named local policies**. Local has **39 additional policies**: 25 on public tables and 14 on Storage. These include the new Portal restrictive projections and QC immutable/assignment access. No policy present in production is removed or changed by the compared local definitions.
- All inspected public/Storage **tables have RLS enabled** on both sides; common RLS/force-RLS attributes match. This is catalog evidence, not proof of every role's effective runtime access. There are **no column-specific ACLs** on the inspected relations; row access does not itself hide costs/selling prices or other sensitive columns.
- The six inspected role attributes, eight relevant role memberships, 17 schema grants, nine default-ACL records and 12 sequence grants match. Existing common public table grants match. Local has grants on new objects; 16 changed grant-option records concern the internal `supabase_storage_admin` role on Storage tables, alongside platform-owned Storage schema differences.
- Two common function EXECUTE differences: production allows `authenticated` on the older `create_my_order_request_v2`, while local revokes that entry point in favor of the new Portal contract; production also exposes `check_lab_column_updates` EXECUTE to PUBLIC/anon/authenticated, while local retains postgres/service-role only. The latter is a trigger-returning function; metadata exposure is not a demonstrated callable mutation exploit. `get_my_doctor_orders_v2` also has a different `search_path` and scoped body locally.
- Non-internal triggers: **70 production / 74 local**. Seven local-only triggers include QC and audit/role guards; three production-only triggers protect platform-owned Storage bucket lifecycle/control columns. Same-named common trigger definitions match.
- `case-files` is **private on both**, limit **10 MiB**, identical allowed MIME types. Production's existing read policy allows any non-null application role; the new Portal restrictive read/size policies are absent. A private bucket alone does not establish assignment-scoped access. No user impersonation, signed-URL creation or file read was used to test that inference.
- Local has private `case-scans` (50 MiB, STL/PLY) and `design-qc-files` (50 MiB), absent from production. Production's public **ORCA Marketing** bucket is absent from the fresh QA seed; this is an existing marketing asset difference, not a clinical bucket to delete or make private.
- Supabase-managed Storage columns/functions/indexes differ between hosted Storage and the local image, including hosted bucket lifecycle/version controls and local Iceberg catalogs. Keep these separate from application migrations; do not overwrite platform catalogs to manufacture parity.
- Additional DDL drift is explicit in the JSON: UUID default-function choices, nullable `orders.is_archived` in production, CHECK validation status/extra constraints, two obligation unique-index predicates, and five public performance indexes present only in production. No index or constraint was changed. Common view security options match (`security_invoker=true` on the changed backfill view); its expanded column definition differs, and the view was not queried.

### Operational flags — actual production versus QA

| Setting | Production | QA |
|---|---|---|
| `production_v1` | off | off |
| `workflow_accounting_audit_v2` | on | on |
| `workflow_finance_v2` | on | on |
| `workflow_issue_v2_enforce` | on | on |
| `workflow_issue_v2_shadow_read` | **on** | **off** |
| `workflow_issue_v2_write` | on | on |
| `workflow_status_legacy_mirror` | off | off |
| `workflow_strict_rep` | on | on |
| `production_autostart_since` | `2026-08-27 12:37:52.176405+00` | `2026-11-04 03:28:27.753464+00` |

The autostart dates are environment-specific measurement boundaries; never copy the fresh-QA timestamp into production. The shadow-read difference is documented, not permission to toggle either environment. Design QC control has no production counterpart yet; it is **absent**, not an observed OFF production switch.

`FINANCIAL_OBLIGATIONS_FLAGS` (`trackingEnabled=true`, `reportingEnabled=false`, `clientSideMutationSyncEnabled=false`) and `LEGACY_EXTERNAL_REGISTRATION_ENABLED=false` are local build-time source constants, not rows in `app_settings`. The three financial values **also match source at GitHub's latest successful reported production commit** `daf0aa9`: [financial flags at that exact commit](https://github.com/orcadentallab/dental-lab-erp/blob/daf0aa9dba99d5e7c801dfe3e0a13f43e75a5f5b/src/constants/financialObligations.ts), Git blob `976a5fc51feae09ebb0813b327c5b544c1680ed8`. [App at that commit](https://github.com/orcadentallab/dental-lab-erp/blob/daf0aa9dba99d5e7c801dfe3e0a13f43e75a5f5b/src/App.tsx), blob `a4f4fc0636d1d41c3c849a69b1127227125dd525`, retains the legacy registration route; this is independently confirmed by the directly observed current public JS route/import.

The optimized public assets do not expose the financial flag object as literal properties. Source-at-reported-deployment evidence is kept distinct from proof that the current public alias serves that exact Git SHA: the immutable deployment's SSO redirect prevented the final asset-hash comparison. Deployed financial flag equality is consequently not promoted to an unconditional live-binary claim. Registration retirement, however, is definitely absent from the observed public artifact. No API publishable key, secret or credential was requested or rotated.

### Day 1 status and what remains

**Completed for B01's live database inventory:** current project identity; effective function/trigger/schema differences; RLS, grants, Storage configuration; operational DB flags; known local writers/readers mapped to those differences; retained reproducible local test evidence. The earlier broad statement that production was never inspected is now superseded by this explicitly dated read-only evidence. The new comparison did not modify or invalidate the previous 56-file/1031-test QA result; no application tests were rerun for a documentation-only audit.

**One evidence item remains for complete Day 1 closure:** tie the current public alias's entry SHA-256 to the immutable successful production deployment/source SHA, using read-only Vercel deployment/alias metadata or access to that protected deployment artifact. The current live asset, DB host, legacy-registration route, latest successful GitHub deployment SHA and that SHA's three financial source flags are all verified; their last exact artifact-to-source link is not. This gap needs read-only evidence, not a redeploy, feature switch, migration or historical repair.

**Release gates identified, not work to perform on production during inventory:** review/narrow the 25 missing migrations and eight behavioral differences into compatible packages; preserve the production-only helper/indexes, validated constraints and genuine timestamps; rehearse the selected upgrade against an isolated production-schema snapshot, with particular attention to the shipment replacement precondition, Portal permissions/Storage and normal supplier timing; then run the approved workflow/financial/privacy acceptance. Explicit owner approval remains required for deployment, production migrations/source switches and any historical correction. Real auth/assignment runtime tests and exocad/device compatibility remain their own later acceptance gates.

Only this inventory and the metadata-only JSON comparison are changed by this task. Existing source, migration, auth, statement, cleanup and package changes remain intact and outside the audit commit. No remote repository write or message was sent.

Self-evaluation: accuracy **4/5** (actual read-only production/QA catalogs, reviewed textual-vs-behavioral differences, stable closeout; frontend source flags remain unverified), completeness **4/5** (requested database comparison completed; exact deployed client source provenance remains open), clarity **4/5** (grouped findings and raw machine evidence; old snapshots explicitly retained as history), actionability **4/5** (specific compatibility gates and missing evidence; no production mutation implied), conciseness **4/5** (one human inventory plus a metadata-only diff). Average **4.0/5**. Next improvement is read-only deployment provenance for the current live asset, followed by an isolated compatibility rehearsal under the implementation scope. The user can distinguish a completed database inventory from a production-ready integrated release.
