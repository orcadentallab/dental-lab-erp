# Order status retirement phase 3 — runtime migration evidence

Started: 2026-10-21
Last updated: 2026-10-22

## Source and scope

Source: `docs/ORDER_WORKFLOW_V2_REMAINING_PLAN.md`, phase 3.

This report is cumulative. The first completed slice removes direct legacy
status writes from the TypeScript workflow mutation paths while the database
legacy mirror remains enabled.

## Slice 1 — TypeScript workflow writers

Implemented guarantees:

| Guarantee | Test | Result |
|---|---|---|
| `changeProductionStatus` writes `productionStatus` without writing `status` | `tests/unit/order-workflow-status-retirement.test.ts` | PASS |
| `changeIssueState` writes V2 axes without writing `status` | same | PASS |
| The centralized non-terminal status adapter writes the mapped production axis, leaving the mirror to own `status` | same; `tests/unit/financial-obligations.test.ts` | PASS |
| Design-review fallback repairs write `productionStatus = designing` without writing `Under Design` into `status` | `tests/unit/order-workflow-status-retirement.test.ts` | PASS |
| Existing workflow wiring remains intact | `tests/workflowTransitions.spec.ts` | PASS |

RED evidence:

- The first targeted run failed 2/2 because both workflow operations included
  `status: targetLegacyStatus`.
- The centralized-writer test then failed because the update payload included
  `status: newStatus`.
- The design-review fallback test failed because two payloads included
  `status: 'Under Design'`.
- The first full unit run exposed one legacy mock assertion that expected the
  client to mutate `status` without a database trigger. The test now asserts
  the V2 production axis and explicitly verifies that the mock legacy value is
  untouched.

GREEN evidence:

- `npm run test:unit`: 370/370 passed across 43 files.
- `npx playwright test tests/workflowTransitions.spec.ts`: 4/4 passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.

## Slice 2 — TypeScript order filters

Implemented guarantees:

| Guarantee | Test | Result |
|---|---|---|
| Legacy display-filter names are translated centrally to V2 axes, including compatibility aliases | `tests/unit/order-derived-status-v2.test.ts` | PASS |
| Unknown display filters fail closed | same | PASS |
| `getOrders` status and hide-delivered filters do not query `orders.status` | `tests/unit/order-workflow-status-retirement.test.ts` | PASS |
| Dashboard and designer-dashboard active filters use `production_status` and `issue_state` | same | PASS |
| The legacy doctor-cost metric preserves current redo exclusion using `issue_state` | same | PASS |

RED evidence:

- The first targeted run failed 20 assertions because the V2 filter translator
  did not exist and `getOrders` still queried `status`.
- Dashboard and designer-dashboard contract tests then failed on their legacy
  `status.not.in` predicates.
- The doctor-cost contract failed on its three legacy `status` exclusions.

GREEN evidence:

- Targeted filter suite: 42/42 passed.

## Slice 3 — Generic writer and compatibility history

- `updateOrder` now rejects every supplied legacy `status` value rather than
  permitting an internal bypass.
- V2 workflow-axis changes keep `status_history` useful by appending the
  centrally derived display label; they do not write `orders.status`.
- Financial/accounting sensitivity detection now watches `productionStatus`
  and `issueState`.

RED evidence: the writer contract still found `dbUpdates.status`, legacy
history comparison, and the `allowStatusChange` bypass.

GREEN evidence: targeted runtime tests passed 63/63.

## Slice 4 — Doctor receivable transition decision

The emergency client-side fallback now decides whether a doctor receivable was
entered by comparing the previous and updated V2 order states. It no longer
compares string statuses. The database trigger remains the normal financial
owner because `clientSideMutationSyncEnabled` is false.

RED evidence:

- V2 transition unit test failed on final-ready -> final-delivered.
- Financial Playwright contract failed both behavior and source wiring.

GREEN evidence:

- `tests/unit/financial-obligation-lifecycle.test.ts`: 11/11 passed.
- `tests/financialObligations.spec.ts`: 116/116 passed.

## Slice 5 — Database zero-financial guards

Local-only migration:
`supabase/migrations/20261022000000_retire_runtime_status_financial_guards.sql`.

- The delivered-order guard now listens to and evaluates `issue_state`.
- Zero-field normalization now listens to and evaluates `issue_state`.
- The orphaned `enforce_zero_order_financials_for_lab_rejected_cancelled`
  function is dropped with `RESTRICT`; both local and Production inventories
  showed no trigger bound to it. The canonical obligation synchronizer remains
  active.
- No order or financial data is updated by this migration.

RED evidence: the new catalog test failed 6/6 against the previous local
definitions.

GREEN evidence:

- The migration applied successfully to local Supabase.
- New catalog test plus issue workflow, admin correction, and financial
  integration tests: 130/130 passed.
- Full unit suite: 394/394 passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `git diff --check`: passed (line-ending warnings only).

Rollback boundary: do not reverse in place on Production. If rollback is
needed, ship a forward migration that recreates the two previous function and
trigger definitions and the orphan function only if a reviewed consumer
actually requires it.

## Slice 6 — One-way compatibility mirror and primary RPC writers

Local-only migration:
`supabase/migrations/20261022010000_runtime_status_mirror_and_rpc_writers.sql`.

- Added an update-only V2-to-legacy mirror gated by
  `workflow_status_legacy_mirror`.
- The mirror intentionally does not run on INSERT, so Doctor Portal
  `Pending Review` intake rows are not collapsed into `New Case` before an
  explicit intake discriminator exists.
- `redo` keeps the reviewed legacy compatibility encoding
  `Doctor Rejected`; its V2 presentation label remains `Redo`.
- Primary issue, final-delivery, design-submission, admin lab-rejection, and
  designer-review RPCs no longer write `orders.status` directly.
- `update_order_atomic` now rejects a `status` key explicitly and has no
  generic legacy-status assignment.
- The compatibility rejection RPC now accepts `issue_state` rather than a
  duplicated legacy target status, and the TypeScript caller follows the new
  signature.

RED evidence: the catalog test failed the nine new mirror/writer assertions;
the TypeScript contract also detected `p_target_status` in the RPC payload.

GREEN evidence:

- Mirror/catalog behavior: 20/20 passed, including enabled, disabled, and
  re-enabled mirror behavior plus preservation of `Pending Review` on INSERT.
- Issue workflow, admin correction, financial integration: 144/144 passed.
- RPC grants and production transitions: 21/21 passed.

## Slice 7 — Remaining transition UPDATE writers

Local-only migration:
`supabase/migrations/20261022020000_retire_remaining_transition_status_updates.sql`.

- Admin issue correction leaves both its intermediate financial rebuild and
  final corrected display value to the one-way mirror.
- Legacy and V2 redo RPCs update the original order through V2 axes only.
- Replacement-order INSERTs still provide a compatibility status because the
  column remains `NOT NULL`; INSERT ownership is deferred to the intake/import
  slice.

RED evidence: the three new catalog assertions failed against the previous
definitions.

GREEN evidence:

- Runtime retirement catalog: 23/23 passed.
- Postflight over the ten migrated order-transition functions returned zero
  direct `status =` / `SET status =` assignments.
- Retirement + issue workflow + admin correction + legacy redo + financial
  integration: 165/165 passed.
- Full unit suite: 395/395 passed.
- Workflow and financial Playwright contracts: 120/120 passed.
- `npm run typecheck`: passed.
- `npm run build`: passed (existing Vite chunking warnings only).

## Slice 8 — Explicit Doctor Portal intake axis

Local-only migrations:

- `supabase/migrations/20261022030000_order_intake_state_v2.sql`
- `supabase/migrations/20261022040000_retire_pending_review_status_reads.sql`
- `supabase/migrations/20261022050000_retire_doctor_portal_delivered_status_fallback.sql`

Implemented guarantees:

| Guarantee | Evidence | Result |
|---|---|---|
| `Pending Review` has a V2 discriminator independent of legacy `orders.status` | `orders.intake_state` constraint and derivation tests | PASS |
| The schema migration does not guess the meaning of existing rows | preflight assertion aborts if an existing `Pending Review` row needs reviewed backfill | PASS |
| Existing non-portal orders retain accepted intake semantics | `NOT NULL DEFAULT 'accepted'` plus database tests | PASS |
| Legacy Doctor Portal INSERTs remain compatible during the transition | INSERT-only intake initialization trigger | PASS |
| Runtime acceptance and dashboard/action decisions use `intake_state` | TypeScript source-contract and workflow tests | PASS |
| Production sync and Doctor Portal projection do not use legacy status as a business input | PostgreSQL catalog assertions | PASS |
| Accepting a pending order does not change any accounting record or value | exact before/after JSON financial snapshot assertion | PASS |

The accounting snapshot covers obligation count and net total, payment
allocation count and amount, transaction count and amount, and accounting
review-change count. The test creates a pending intake order, accepts it by
changing only the workflow axes, and requires exact equality of the snapshot
before and after acceptance.

RED evidence:

- The targeted TypeScript run initially failed five assertions because intake
  derivation/filtering did not exist and UI decisions still read legacy status.
- The database test initially failed four assertions before the intake column,
  helper, constraints, and compatibility trigger existed.
- Two further catalog assertions failed until the remaining PostgreSQL
  `Pending Review` and delivered-status fallbacks were removed.

GREEN evidence:

- Targeted TypeScript intake/runtime contracts: 46/46 passed.
- Database retirement, Doctor Portal, transitions, issue workflow, admin
  correction, redo, and financial suites: 247/247 passed.
- Full unit suite: 397/397 passed across 43 files.
- Workflow and financial Playwright contracts: 120/120 passed.
- `npm run typecheck`: passed.
- `npm run build`: passed (existing Vite chunking warnings only).
- `git diff --check`: passed (line-ending warnings only).
- `supabase db lint --local --level error` reports only the pre-existing
  `apply_workflow_v2_backfill` temporary-relation false positive; no new
  migration is reported.

Safety boundary:

- These three migrations contain no order or accounting data rewrite.
- If Production contains any unresolved `Pending Review` rows, the intake
  migration deliberately aborts before changing the schema. Those rows must be
  reviewed and backfilled explicitly instead of being silently classified.
- The mirror remains one-way from the V2 axes to legacy display status and does
  not create, delete, or recalculate financial obligations, allocations, or
  transactions.

## Slice 9 — Active production and shipping readiness reads

- Active-stage lookup now selects and evaluates `production_status` only when
  excluding final-delivered orders. Stage-run `status` remains separate and is
  still used for the stage-run lifecycle.
- Ready-to-pack lookup now requires `production_status IN
  ('final_ready', 'try_in_ready')`; the legacy `orders.status = 'Ready'`
  fallback is removed.
- No accounting, pricing, obligation, allocation, transaction, or historical
  order data is written by this slice.

RED evidence: two source-contract tests failed against the legacy delivered
and ready fallbacks.

GREEN evidence: the targeted runtime retirement suite passed 13/13 after the
two reads were moved to the V2 production axis.

- Full unit suite: 399/399 passed across 43 files.
- `npm run typecheck`: passed.
- `npm run build`: passed (existing Vite chunking warnings only).
- Targeted ESLint for the changed production/shipping and V2 workflow files:
  passed.

## Slice 10 — Financial statement and reporting reads

Financial inclusion, payable, and display decisions are now centralized in
`src/constants/orderStatementFinancials.ts` and derive from the V2
`production_status` / `issue_state` axes. The migrated consumers are:

- doctor, supplier, and designer statements;
- account summaries, opening balances, and account detail rows;
- aging and balance-snapshot reports;
- the shared account information panel; and
- the financial reconciliation preview.

The accounting rules themselves are preserved:

- a returned external-lab case keeps the payable already earned at Final
  Ready;
- a split order with total lab cost 500 and designer cost 200 records 300 as
  the external-lab statement amount, preventing double counting;
- unresolved doctor rejection remains excluded unless a reviewed cost exists;
- cancellation and lab rejection remain non-productive; and
- a final-delivered zero-value case remains identifiable without consulting a
  stale legacy display status.

RED evidence:

- the first unit contract failed because the central statement helper did not
  exist;
- five source-contract checks then failed while financial screens still made
  direct legacy-status decisions; and
- focused regression assertions failed until closed-case, zero-value, and
  productive-cost decisions moved to the V2 axes.

GREEN evidence:

- Financial and order-lifecycle Playwright logic contracts: 143/143 passed.
- Targeted database financial, V2 derivation, and intake/accounting-isolation
  suites: 99/99 passed.
- Full unit suite: 417/417 passed across 44 files.
- `npm run typecheck`: passed.
- `npm run build`: passed (existing Vite chunking warnings only).
- Targeted ESLint for the changed financial production files: passed.
- `git diff --check`: passed (line-ending warnings only).

Safety boundary:

- This slice introduces no migration and performs no database or accounting
  data write.
- It changes which workflow axes are consulted for financial decisions, not
  the monetary formulas or stored ledger values.
- Legacy `status` remains available for compatibility presentation and the
  existing account status-edit path; retiring those writers is a later slice.

## Slice 11 — Accounting registration and snapshot isolation

Local-only migration:
`supabase/migrations/20261022060000_retire_accounting_registration_status_reads.sql`.

- Accounting queue inclusion, zero-impact classification, cancellation review
  type, exported values, and UI state now use the V2 workflow axes.
- `build_order_accounting_snapshot` derives its label and monetary branches
  from `production_status`, `issue_state`, and `intake_state`.
- `reopen_registered_order_for_accounting` no longer treats a legacy mirror
  update as an independent business change and classifies cancellation from
  `issue_state`.
- The Accounts statement editor strips the compatibility status field and no
  longer invokes a workflow transition from the financial screen.
- No order, snapshot, obligation, allocation, or transaction row is rewritten
  by the migration.

RED evidence:

- Two TypeScript tests failed because a stale legacy cancellation still zeroed
  a V2-delivered case and the accounting UIs still read `order.status`.
- Five database assertions failed because snapshot amounts and cancellation
  review classification still followed the legacy column.

GREEN evidence:

- Targeted accounting unit tests: 16/16 passed.
- Full unit suite: 419/419 passed across 44 files.
- Runtime-retirement database suite: 36/36 passed.
- Combined runtime-retirement, financial-obligation, V2-derivation, and
  intake/accounting-isolation database suites: 135/135 passed.
- `npm run typecheck`: passed.
- `npm run build`: passed (existing Vite chunking warnings only).
- Targeted production-file ESLint: passed.

## Slice 12 — Financial analytics and receivables fallback

- Service P&L detail and rejection classification in `StatementTab` now use
  `issue_state`, the shared non-productive classifier, and the shared lab-cost
  formula instead of interpreting the legacy display status.
- Expanded rows expose a status derived from the V2 axes for presentation;
  stale legacy text cannot change units, revenue, cost, or rejection metrics.
- The Doctor Receivables client fallback now uses the same V2 inclusion,
  reviewed doctor amount, and official statement date helpers as the primary
  statement path.
- FIFO aging allocates payments against the recognized statement amount. It
  no longer allocates against raw `total_price` when a reviewed rejection has
  a different doctor charge.

RED evidence:

- Two source-contract assertions failed while the financial analytics UI
  still normalized and compared `o.status`.
- The fallback behavior test failed because the helper was not exported and
  the old implementation selected only legacy `Delivered`/`Completed` rows.

GREEN evidence:

- Targeted financial tests: 22/22 passed.
- Full unit suite: 423/423 passed across 45 files.
- `npm run typecheck`: passed.
- `npm run build`: passed (existing Vite chunking warnings only).
- Targeted production-file ESLint: passed with no warnings or errors.

Safety boundary:

- This slice has no migration and performs no database, ledger, allocation,
  transaction, or accounting-snapshot write.
- It centralizes classification and amount selection; it does not modify any
  stored order price, payment, or cost.

## Slice 13 — Order cards, list rows, and global search presentation

- `OrderCard` financial display, rejection review visibility, terminal
  styling, delivered behavior, and archive eligibility now use the effective
  V2 production and issue axes. The displayed doctor amount comes from the
  shared settlement-aware helper.
- `OrderListItem` derives its badge label and color from the reviewed V2
  presentation status. Its archive and registration actions no longer inspect
  legacy status text.
- Global search derives Arabic labels from the central V2 status label map.
- Smart-search active/delivered grouping now uses V2 delivery eligibility, so
  stale `Delivered` text cannot move active work into the delivered bucket and
  stale `New Case` text cannot hide a delivered case.
- The shared rejection and lateness helpers used by order cards now classify
  from the V2 issue and production axes. A cancelled/rejected/redo case cannot
  become late because of stale legacy text.

RED evidence:

- Three source-contract assertions failed on direct `order.status` use in the
  list row, global search, and smart-search grouping.
- The behavior test reversed the active and delivered fixtures when their
  legacy text deliberately conflicted with the V2 production axis.
- Rejection and lateness behavior tests failed until the indirect legacy reads
  inside `orderUtils` were removed.

GREEN evidence:

- Targeted presentation, search, and financial contracts: 64/64 passed.
- Full unit suite: 431/431 passed across 46 files.
- `npm run typecheck`: passed.
- `npm run build`: passed (existing Vite chunking warnings only).
- Targeted production-file ESLint: passed with no warnings or errors.

Safety boundary:

- This slice contains no migration and performs no order, accounting, ledger,
  allocation, or transaction write.
- It changes UI derivation and grouping only; it does not execute a workflow
  transition or alter any stored monetary value.

## Slices 14–21 — completion of phase 3 runtime retirement

The remaining dashboard, operational, import, reporting, policy, and trigger
surfaces were migrated to the V2 axes.

- Dashboard grouping and counts use `production_status` and `issue_state` via
  the shared `dashboardOrderGroups` helpers. Designer views, cash flow,
  analytics, statement presentation, order lists, boards, and exports derive
  their display label centrally.
- TypeScript order writers, imports, acceptance, and production operations
  write V2 axes only. The in-memory compatibility `Order.status` value is
  derived from those axes; `redo` continues to serialize as `Doctor Rejected`
  only where an old compatibility consumer still requires that exact value.
- Historical-obligation and reconciliation previews select the V2 axes and
  derive a presentation label. Their amount, due-date, allocation, and cost
  formulas were not changed.
- Doctor Portal INSERT RPCs now provide `production_status`, `issue_state`, and
  `intake_state`. The one-way mirror also covers INSERTs while it remains on.
- Analytics summary, top reports, doctor reports, cost/quality reports, and the
  cutover baseline read the V2 axes through the compatibility derivation
  helper rather than treating `orders.status` as a business input.
- The orders UPDATE RLS policy now identifies final delivery from V2 axes.
- Reverse-sync and legacy design-status triggers were removed. A database
  guard rejects direct `UPDATE OF status`; V2-axis changes still reach the
  compatibility column through the one-way mirror.
- Operational RPC metadata now derives the presentation status from V2 axes.

Local migrations added for these slices:

- `20261022070000_retire_dashboard_status_reads.sql`
- `20261022080000_mirror_status_on_v2_inserts.sql`
- `20261022090000_doctor_portal_inserts_write_v2_axes.sql`
- `20261022100000_retire_analytics_summary_status_reads.sql`
- `20261022110000_retire_top_report_status_reads.sql`
- `20261022120000_retire_doctor_report_status_reads.sql`
- `20261022130000_retire_cost_quality_status_reads.sql`
- `20261022140000_orders_update_policy_uses_v2.sql`
- `20261022150000_retire_reverse_status_triggers.sql`
- `20261022160000_retire_operational_status_metadata.sql`

RED evidence:

- Source contracts found direct legacy reads in dashboard, operational,
  financial-preview, import, and presentation paths.
- PostgreSQL catalog tests found legacy reads/writes in reports, RLS, Doctor
  Portal RPCs, and reverse-sync triggers.
- The direct-write guard correctly broke a financial integration fixture that
  still updated `status`; the fixture was converted to the equivalent V2-axis
  transition without changing its expected amounts.
- Full-suite source assertions that expected legacy strings failed until their
  contracts were updated to assert V2 behavior.

Final GREEN evidence:

- Full unit suite: **463/463** passed across 48 files.
- Targeted Playwright logic and financial suites: **175/175** passed.
- Combined PostgreSQL suites: **280/280** passed across 8 files, including
  runtime retirement, derivation, issue workflow, financial obligations,
  order costs, Doctor Portal, and RLS.
- Phase-3 runtime retirement database contract: **47/47** passed.
- `npm run typecheck`: passed.
- `npm run build`: passed; only existing Vite chunking notices were emitted.
- Targeted ESLint: no errors; two pre-existing Dashboard hook-dependency
  warnings remain.
- `git diff --check`: passed.

## Phase 3 completion boundary

- Phase 3 is complete in the local environment.
- `workflow_status_legacy_mirror` remains enabled. Its function is the only
  intentional compatibility writer; the direct-write guard and the read-only
  backfill/audit objects are also intentionally retained.
- Migrations `20261022000000` through `20261022160000` are local only and have
  not been deployed to production.
- `workflowAudit` and `workflow_v2_backfill_dry_run` intentionally retain the
  legacy value as parity evidence for phase 4; they are not runtime business
  decision paths.
- `orderStatusHelpers.ts` is a test-only legacy compatibility fixture with no
  production import. It does not participate in runtime decisions.
- `supabase db lint --local` completes but reports the known
  `apply_workflow_v2_backfill` temporary-relation diagnostic for
  `workflow_v2_selected_backfill`, plus unrelated existing warnings. The
  executable pgTAP suite for that path remains green.
- No checkpoint commit was created and no files were staged because the
  checkout contains unrelated user work.
- The next step is phase 4 parity audit. Mirror-off and column deletion remain
  separate later phases and were not started.
