# `orders.status` retirement — phase 0/1 inventory

Original baseline date: 2026-08-12
Latest verification: 2026-10-19
Verified checkout: `master` at `70d9107`, with unrelated Doctor Portal work in
the working tree

This inventory is intentionally read-only. It does not disable
`workflow_status_legacy_mirror`, alter runtime behavior, or modify production.

## Phase 0 baseline

| Check | Result | Evidence / disposition |
|---|---:|---|
| Clean local database reset | PASS | Every migration through `20261018001000` applied from scratch |
| Targeted V2 + RLS DB tests | PASS | 2 files, 73 tests |
| Full DB suite after clean reset | PASS | 40 files, 741 tests |
| TypeScript typecheck | PASS | `tsc --noEmit` |
| Production build | PASS | `tsc -b && vite build` |
| Unit suite | PASS | 41 files, 351 tests |

The October baseline is reproducible and supersedes the stale August failure
list. No test assertion was weakened to obtain these results.

The reset emitted existing `SET LOCAL can only be used in transaction blocks`
warnings in three September migrations. They did not fail the reset, but should
be repaired separately; they are not part of `orders.status` retirement.

## Runtime code inventory

The 2026-10-19 scan found 42 runtime files with an exact legacy order-status
candidate, 85 migration files containing historical/current candidates, and 8
test or fixture files. Historical migration occurrences are evidence, not all
active dependencies; the live catalog is authoritative for active objects.

### Direct writes and filters (highest priority)

| Owner | Classification | Current dependency | Replacement plan |
|---|---|---|---|
| `src/services/supabase/orderWorkflow.ts` | business write | Computes `targetLegacyStatus` and writes `status` during production/issue transitions | Make V2 axes the only input; leave the database mirror as the sole temporary writer |
| `src/services/supabase/orders.ts` | CRUD write/filter | Serializes `order.status`; filters with `.eq('status', filters.status)`; persists history | Replace filters and decision inputs with `production_status`/`issue_state`; retain explicitly versioned history compatibility only |
| `src/components/orders/WorkflowActionBar.tsx` | business transition | Routes V2 actions back through a legacy target status | Dispatch the V2 action/RPC directly |
| `src/components/orders/OrderBoard.tsx` | business read/write | Board columns and drag updates are keyed by legacy status | Key workflow columns by the derived presentation helper and write only V2 axes |
| `src/components/orders/OrderList.tsx` | business read | Special-cases `New Case` | Replace with the appropriate V2 production state |
| `src/components/orders/RepEditModal.tsx` | business write | Builds representative edits containing legacy status | Remove status from representative mutations; use approved V2 RPCs |
| `src/lib/excelImporter.ts` | historical import | Imports legacy status values | Preserve as an explicit historical adapter that emits reviewed V2 axes |

### Financial/reporting business reads

These files use legacy status to include, exclude, price, or classify orders and
must migrate before presentation-only work:

- `src/constants/accountingRegistration.ts`
- `src/constants/financialObligations.ts`
- `src/components/finance/AccountInfoPanel.tsx`
- `src/components/finance/DoctorReceivablesModal.tsx`
- `src/components/finance/StatementTab.tsx`
- `src/pages/Accounts.tsx`
- `src/pages/AgingReport.tsx`
- `src/pages/BalanceSnapshot.tsx`
- `src/pages/Statements.tsx`
- `src/services/statementService.ts`
- `src/services/supabase/financialReconciliationPreview.ts`
- `src/services/supabase/historicalObligationsBackfill.ts`
- `src/services/supabase/historicalObligationsPreview.ts`
- `src/services/supabase/workflowAudit.ts`
- `src/lib/orderStatusHelpers.ts`
- `src/utils/orderUtils.tsx`

Replacement rule: use `issue_state` for cancellation/rejection/redo semantics,
`production_status` plus approved lifecycle evidence for delivery, and preserve
the reviewed `decide_later` and manual-price rules. No financial behavior is to
be changed as part of the mechanical retirement.

### Presentation, search, and UI grouping

- `src/components/dashboard/OrderListItem.tsx`
- `src/components/GlobalSearch.tsx`
- `src/components/orders/OrderCard.tsx`
- `src/components/orders/OrderForm.tsx`
- `src/components/orders/OrderHistoryModal.tsx`
- `src/lib/designerOrderUtils.ts`
- `src/lib/smartSearch.ts`
- `src/pages/CaseRegistration.tsx`
- `src/pages/Dashboard.tsx`
- `src/pages/DashboardNew.tsx`
- `src/pages/DesignerDashboard.tsx`
- `src/pages/DesignerStats.tsx`
- `src/pages/Orders.tsx`
- `src/pages/Quality.tsx`
- `src/translations/ar.ts`
- `src/translations/en.ts`

Replacement rule: one reviewed TypeScript derivation helper supplies labels,
badges, grouping, and search tokens. Presentation must not become a second
business-state authority.

### Types, validation, lifecycle compatibility, and tests

- `src/constants/orderLifecycle.ts`
- `src/constants/workflowTransitions.ts`
- `src/lib/validation.ts`
- `src/services/db.ts`
- `src/services/supabase/orderEvents.ts`
- `src/services/supabase/types.ts`
- `tests/` and `supabase/tests/database/`

Fixtures must be split into current V2 behavior versus explicitly named legacy
import/history compatibility. Old migration-text assertions are baseline debt,
not acceptance evidence for the retirement.

## PostgreSQL catalog inventory (local schema)

The reusable audit is in
`supabase/audits/order_status_dependency_inventory.sql`. It sets short read-only
timeouts and scans direct dependencies plus function, trigger, policy, and view
definitions.

Confirmed local blockers:

| Object | Kind | Dependency | Required replacement |
|---|---|---|---|
| `public.workflow_v2_backfill_dry_run` | view | direct `pg_depend` dependency on `orders.status` | Rebuild from the V2 axes and approved legacy evidence |
| `public.orders_update` | RLS policy | representative `USING` and `WITH CHECK` use `status <> 'Delivered'` | Express access using V2 production/lifecycle semantics |
| `public.sync_workflow_states_fn` | trigger function | legacy/V2 bidirectional synchronization and mirror ownership | Reduce to one-way V2-to-legacy mirror while the flag is on, then retire separately |
| `public.build_order_accounting_snapshot` | financial function | reads order legacy status | Replace classifications with V2 axes without bulk execution |
| zero-financial guards/normalizers | financial triggers | legacy cancellation/lab-rejection checks remain present | Move checks to `issue_state`; preserve zero-obligation invariants |
| reporting/analytics functions | reports | several definitions contain order-status predicates | Inspect aliases individually and replace only true `orders.status` reads |

Latest clean-schema catalog counts:

- 1 direct dependency: `public.workflow_v2_backfill_dry_run`.
- 41 function candidates requiring definition-level classification.
- 18 active `orders` trigger candidates whose function definitions mention
  `status`.
- 1 active RLS dependency: `orders_update`. The earlier `orders_select`
  dependency has been removed; its remaining `production_jobs.status`
  reference is unrelated to `orders.status`.

The broad textual function scan returns false positives because many unrelated
tables also have a `status` column. Each function must therefore be confirmed
against its full definition before implementation. The audit deliberately
reports candidates rather than silently discarding them.

The local `orders` table is empty, so it cannot establish a production value
crosswalk. Phase 2 must not infer the mapping from this result.

The linked Production project was reached successfully with the Supabase CLI on
2026-10-19; `public.orders` had an estimated 1,294 rows. The aggregate crosswalk
was then executed manually in the Supabase SQL Editor inside the audit's
read-only transaction. The 20 groups total exactly 1,294 orders and the legacy
mirror flag was confirmed `on`. No Production write occurred.

### Production value crosswalk (2026-10-19)

| `production_status` | `issue_state` | observed legacy `status` | count |
|---|---|---|---:|
| `designing` | `cancelled` | `Cancelled` | 5 |
| `designing` | `doctor_rejected` | `Doctor Rejected` | 1 |
| `designing` | `lab_rejected` | `Lab Rejected` | 1 |
| `designing` | `none` | `Under Design` | 1 |
| `final_delivered` | `doctor_rejected` | `Doctor Rejected` | 33 |
| `final_delivered` | `none` | `Delivered` | 1,138 |
| `final_delivered` | `redo` | `Doctor Rejected` | 2 |
| `final_ready` | `doctor_rejected` | `Doctor Rejected` | 16 |
| `in_production` | `cancelled` | `Cancelled` | 15 |
| `in_production` | `doctor_rejected` | `Doctor Rejected` | 5 |
| `in_production` | `none` | `Under Production` | 11 |
| `in_production` | `returned` | `Returned for Adjustments` | 1 |
| `not_started` | `cancelled` | `Cancelled` | 27 |
| `not_started` | `doctor_rejected` | `Doctor Rejected` | 12 |
| `not_started` | `lab_rejected` | `Lab Rejected` | 6 |
| `not_started` | `none` | `New Case` | 6 |
| `not_started` | `redo` | `Doctor Rejected` | 7 |
| `try_in_ready` | `cancelled` | `Cancelled` | 3 |
| `try_in_ready` | `doctor_rejected` | `Doctor Rejected` | 1 |
| `try_in_ready` | `none` | `Try In` | 3 |

Issue totals are: `none=1,159`, `doctor_rejected=68`, `cancelled=50`,
`redo=9`, `lab_rejected=7`, and `returned=1`.

Observed parity is internally consistent: every observed `cancelled`,
`doctor_rejected`, `lab_rejected`, `redo`, and `returned` row has the expected
legacy mirror value. In particular, all nine `redo` rows currently mirror to
`Doctor Rejected`; the future display helper must deliberately render them as
"redo" / «إعادة إنتاج» instead of copying that legacy label.

This crosswalk is observational evidence, not yet the approved derivation
mapping. Combinations such as post-delivery issue states paired with
`not_started`, `designing`, `in_production`, or `final_ready` require lifecycle
evidence review before classification; no timestamp or correction is inferred
from the aggregate counts.

The remaining Production catalog result sets were captured separately from the
SQL Editor. Production currently has:

- 1 direct view dependency: `public.workflow_v2_backfill_dry_run`.
- 39 function candidates whose definitions reference an order-like `status`.
- 16 active `orders` trigger candidates.
- 1 confirmed legacy-status RLS dependency: `public.orders_update`.

The `orders_update` dependency is specifically the representative/coordinator
`USING` predicate `status <> 'Delivered'`; its `WITH CHECK` no longer contains
that restriction. It must be replaced with the reviewed V2 lifecycle rule, not
removed mechanically.

### Production/local catalog drift

Production and the freshly reset local schema are not identical:

- Local-only function candidates: `check_lab_column_updates` and
  `get_doctor_portal_cases`.
- Local-only active triggers: `enforce_lab_column_updates` and
  `trigger_check_order_update`.
- Seven shared function definitions have different hashes:
  `apply_workflow_v2_backfill`, `capture_stage_completion_cost`,
  `get_doctor_receivables_breakdown_privileged_20260812`,
  `get_top_doctors_privileged_20260801`,
  `guard_allocated_payable_payment_mutation`,
  `sync_preserved_external_lab_price_change`, and
  `sync_production_from_order`.
- The trigger function behind
  `trigger_sync_preserved_external_lab_price_change` consequently has a
  different hash as well.

This drift is a deployment fact, not permission to repair Production during
status retirement. Phase 2/3 migrations must be based on captured Production
definitions for the drifted objects, or the unrelated deployment chain must be
reconciled first in a separately reviewed release.

The linked migration list also showed unrelated unpublished Doctor Portal
migrations dated 2026-10-04 through 2026-10-11. That deployment-history drift is
outside this retirement phase and must not be repaired as part of this work.

## Phase 1 exit status

- Code ownership and replacement categories: documented.
- Repeatable catalog audit: added.
- Local direct dependency/RLS blockers: confirmed.
- Production connectivity, mirror flag, exact order count, and value crosswalk:
  verified read-only.
- Production direct/function/trigger/policy catalog results: captured.
- View coverage: the direct dependency scan confirms
  `workflow_v2_backfill_dry_run`; the clean local textual view scan finds the
  same single view.
- Phase 1 evidence collection is complete. All catalog candidates remain open
  implementation items; completing the inventory does not authorize mirror-off
  or column deletion.
- Mirror-off/drop-column work: not started and not authorized.

