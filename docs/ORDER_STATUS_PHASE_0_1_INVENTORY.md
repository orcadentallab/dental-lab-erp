# `orders.status` retirement — phase 0/1 inventory

Baseline date: 2026-08-12  
Branch: `codex/order-status-retirement-phase-0-1`

This inventory is intentionally read-only. It does not disable
`workflow_status_legacy_mirror`, alter runtime behavior, or modify production.

## Phase 0 baseline

| Check | Result | Evidence / disposition |
|---|---:|---|
| Targeted V2 + RLS DB tests | PASS | 2 files, 73 tests |
| TypeScript typecheck | PASS | `tsc --noEmit` |
| Production build | PASS | `tsc -b && vite build` |
| Unit suite | BASELINE FAIL | 123 pass, 6 fail; failures are stale migration-text assertions in accounting re-registration, doctor FIFO, DB repair guards, and payable allocation tests |
| Full DB suite | BASELINE FAIL | V2/RLS and finance transaction atomicity pass; old fixtures hit the enforced Issue V2 RPC guard, and allocation tests inherit contaminated/reset state |

The focused gate is reproducible. The full-suite failures predate this inventory;
none were edited to make the baseline green.

## Runtime code inventory

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
| `public.orders_select` | RLS policy | representative predicate uses `status <> 'Delivered'` | Express access using V2 production/lifecycle semantics |
| `public.orders_update` | RLS policy | representative `USING` and `WITH CHECK` use `status <> 'Delivered'` | Express access using V2 production/lifecycle semantics |
| `public.sync_workflow_states_fn` | trigger function | legacy/V2 bidirectional synchronization and mirror ownership | Reduce to one-way V2-to-legacy mirror while the flag is on, then retire separately |
| `public.build_order_accounting_snapshot` | financial function | reads order legacy status | Replace classifications with V2 axes without bulk execution |
| zero-financial guards/normalizers | financial triggers | legacy cancellation/lab-rejection checks remain present | Move checks to `issue_state`; preserve zero-obligation invariants |
| reporting/analytics functions | reports | several definitions contain order-status predicates | Inspect aliases individually and replace only true `orders.status` reads |

The broad textual function scan returns false positives because many unrelated
tables also have a `status` column. Each function must therefore be confirmed
against its full definition before implementation. The audit deliberately
reports candidates rather than silently discarding them.

The local `orders` table is empty, so it cannot establish a production value
crosswalk. Phase 2 must not infer the mapping from this result. Run the same
read-only audit against the linked production database only after review; the
script does not write data and does not call the bulk accounting snapshot.

## Phase 1 exit status

- Code ownership and replacement categories: documented.
- Repeatable catalog audit: added.
- Local direct dependency/RLS blockers: confirmed.
- Production catalog/value crosswalk: pending reviewed read-only execution.
- Mirror-off/drop-column work: not started and not authorized.

