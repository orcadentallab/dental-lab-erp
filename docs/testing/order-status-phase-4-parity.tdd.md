# Order status retirement phase 4 — parity audit evidence

Source plan: `docs/ORDER_WORKFLOW_V2_REMAINING_PLAN.md`, phase 4.

## Safety boundary

- The phase creates read-only views and a read-only audit script.
- It does not update orders, obligations, allocations, transactions,
  accounting snapshots, or workflow flags.
- `workflow_status_legacy_mirror` remains `on`.
- Migration `20261022170000` was applied locally and to staging. No production
  deployment was performed.

## Guarantees

| Guarantee | Evidence | Result |
|---|---|---|
| Every order exposes legacy status, V2-derived display status, and the temporary compatibility value | `order_status_parity_audit_phase4.test.sql` | PASS |
| Presentation mismatch and financial-effect mismatch are independent fields | same | PASS |
| A stale `New Case` label on a V2-delivered order blocks mirror-off and is classified as financially different | same | PASS |
| The intentional `redo -> Doctor Rejected` compatibility alias is explained and does not create financial-review noise | same | PASS |
| Reviewed legacy delivery can be reported without inventing a timestamp | same | PASS |
| Unresolved historical review evidence remains a blocking row | same | PASS |
| Audit views are not selectable by `anon` or `authenticated` | same | PASS |
| The aggregate gate closes when any unexplained presentation, legacy, or financial row exists | same | PASS |

## RED evidence

The new database test was executed before the migration existed. It failed on
the missing `workflow_v2_status_parity_audit`,
`workflow_v2_status_parity_review`, and
`workflow_v2_status_parity_gate` views. Subsequent fixture failures exposed and
then respected the existing guards for legacy delivery confirmation, approved
issue transitions, and post-delivery issue timing; production guards were not
weakened to make the test pass.

## GREEN evidence

- Targeted phase-4 pgTAP test: **20/20 passed**.
- Combined phase-3/phase-4 and financial/RLS/portal pgTAP gate:
  **300/300 passed across 9 files**.
- Full unit suite: **463/463 passed across 48 files**.
- `npm run typecheck`: passed.
- `npm run build`: passed with existing Vite chunking notices only.
- `git diff --check`: passed.
- `supabase db lint --local`: no new phase-4 issue. It still reports the known
  temporary-relation diagnostic in `apply_workflow_v2_backfill` and unrelated
  pre-existing warnings.

## Local data audit

The bounded read-only audit script executed successfully with a 10-second
statement timeout and a 100-row detail limit.

- Local orders: **0**.
- Unexplained presentation mismatches: **0**.
- Unresolved V2 rows: **0**.
- Unresolved legacy review rows: **0**.
- Financial-effect differences: **0**.
- Local mirror flag: **on**.
- Direct column dependencies: the historical backfill audit view and the new
  phase-4 parity audit view only.
- Orders RLS policies reading legacy status: **0**.

Because the local database contains no orders, these zeroes validate the audit
mechanism but do not prove live-data parity.

## Staging data audit — 2026-10-27

Migration `20261022170000` and the bounded audit were executed against staging
project `qutnamkwhsfqzijreeyo`. The audit ran read-only and the legacy mirror
remained on.

- Staging orders: **1304**.
- Unexplained presentation mismatches: **0**.
- Explained `redo -> Doctor Rejected` aliases: **10** (7 `not_started`,
  3 `final_delivered`).
- Unresolved V2 rows: **0**.
- Unresolved legacy review rows: **0**.
- Financial-effect differences: **0**.
- Review rows: **0**.
- `ready_for_mirror_off`: **true**.
- Orders RLS policies reading legacy status: **0**.
- Mirror flag: **on**.

Both explained alias groups preserve `issue_settlement` as their financial
effect in the legacy and V2 classifications. No order, obligation, allocation,
transaction, snapshot, or workflow flag was modified by the audit.

## Remaining operational gate

Completed on production on 2026-10-27:

1. Production orders: **1304**; review rows: **0**; financial differences:
   **0**; `ready_for_mirror_off`: **true**.
2. The same 10 explained Redo aliases were present (7 `not_started`,
   3 `final_delivered`), all preserving `issue_settlement`.
3. Financial baseline was unchanged before and after deployment: total price
   `2486285.00`, cost `1603187.00`, design price `45220.00`, and 3361 financial
   obligations.
4. The mirror remained `on`; phase 5 was not started.
5. Production schema drift required the reviewed, function-only reconciliation
   scripts `workflow_v2_production_drift_reconcile_20261027.sql` and
   `workflow_v2_production_portal_drift_20261027.sql`. Neither performs table
   DML.

No Git checkpoint was created because this checkout contains unrelated user
changes and the user did not request staging or commits.
