# Order status retirement phase 5 — mirror-off evidence

Source plan: `docs/ORDER_WORKFLOW_V2_REMAINING_PLAN.md`, phase 5.

## Guarantees

| Guarantee | Evidence | Result |
|---|---|---|
| Mirror-off is blocked unless phase-4 parity is ready | `20261027010000_disable_legacy_status_mirror.sql` | PASS |
| Legacy `status` remains present but nullable during observation | `order_status_mirror_off_phase5.test.sql` | PASS |
| New orders can be inserted without writing legacy status | same | PASS |
| V2 production transitions work without changing legacy status | same | PASS |
| Direct legacy status writes remain blocked | same | PASS |
| The transactional smoke leaves financial totals unchanged | `workflow_v2_mirror_off_staging_smoke.sql` | PASS |
| Emergency rollback can re-enable and repair only NULL legacy projections | `workflow_v2_mirror_off_rollback.sql` | REVIEWED |

## RED / GREEN evidence

- RED: the phase-5 pgTAP target ran before the migration and failed 4 of 7
  assertions: the column was not nullable, the flag was on, and INSERT/UPDATE
  still wrote compatibility values.
- GREEN: after applying the migration locally, the same target passed 7/7.
- Combined phase-3, phase-4, and phase-5 database gate: **74/74 passed**.
- Unit suite: **463/463 passed across 48 files**.
- `npm run typecheck`: passed.
- `npm run build`: passed with the existing Vite chunking notices only.

## Staging cutover evidence — 2026-10-27

- Project: `qutnamkwhsfqzijreeyo`.
- Migration `20261027010000` applied and recorded in migration history.
- Mirror flag: `off`; `orders.status`: nullable; existing NULL statuses: 0.
- Transactional V2-only insert/update smoke: passed and rolled back.
- Admin orders-page smoke: passed.
- Before/after counts were identical: 1304 orders, 2615 active obligations,
  obligation net 3425177, 2734 allocations totaling 3660980, and 1355
  transactions totaling 4235519.74.

## Remaining gate

The representative-role pilot completed on Staging:

- Login and full doctors/orders visibility passed, including orders owned by other representatives.
- The representative edit form opened for an order owned by another representative.
- A non-financial `is_urgent` edit and its restoration both succeeded through
  `rep_update_order_fields_with_audit` with HTTP 200; no 4xx/5xx or console errors were observed.
- Post-pilot parity stayed ready: 1304 orders, zero unexplained presentation mismatches,
  zero unresolved V2/legacy rows, zero financial differences, and zero review rows.
- Financial totals remained unchanged: 2615 active obligations / 3425177.00 net,
  2734 allocations / 3660980.00, and 1355 transactions / 4235519.74.

## Production rollout

- The Production preflight passed with 1306 orders, zero unexplained presentation
  mismatches, zero unresolved V2/legacy rows, zero financial differences, and zero
  review rows.
- Migration `20261027010000` was applied and recorded in remote migration history.
- Production now has `workflow_status_legacy_mirror=off`; `orders.status` remains
  present and nullable for the observation window.
- The transactional smoke passed and rolled back fully. The financial baseline was
  unchanged at 2615 active obligations / 3427127.00 net, 2735 allocations /
  3661030.00, and 1355 transactions / 4235519.74.
- Final parity remained ready, with 11 explained `redo` aliases and no actionable
  mismatch or NULL workflow axes.

Remaining: complete the observation window and repeat the phase-6 preflight before
any separately approved migration that drops `orders.status`.
