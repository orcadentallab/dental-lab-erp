# Order status retirement phase 2 — TDD evidence

Date: 2026-10-19

## Source and journey

Source: `docs/ORDER_WORKFLOW_V2_REMAINING_PLAN.md`, phase 2.

As an operator viewing an order, I need one deterministic presentation status
derived from `production_status` and `issue_state`, so that UI and SQL readers
can migrate away from `orders.status` without changing workflow or finance.

## Evidence

| Guarantee | Test | Type | Result |
|---|---|---|---|
| All eight issue-free production stages map identically in TypeScript and SQL | `tests/unit/order-derived-status-v2.test.ts`; `supabase/tests/database/order_status_derivation_v2.test.sql` | Unit + DB integration | PASS |
| Every active issue state overrides the production stage | Same targets | Unit + DB integration | PASS |
| `redo` stays distinct and renders «إعادة إنتاج» | Same targets | Unit + DB integration | PASS |
| Missing or unknown axes return `null`; no legacy fallback is invented | Same targets | Unit + DB integration | PASS |

RED evidence:

- TypeScript failed because `orderDerivedStatusV2` did not exist.
- SQL failed because `derive_order_display_status_v2(text,text)` did not exist.

GREEN evidence:

- `npx vitest run tests/unit/order-derived-status-v2.test.ts --config vitest.config.ts`: 15/15 passed.
- `npx supabase test db supabase/tests/database/order_status_derivation_v2.test.sql --local`: 17/17 passed.

Full verification after a clean local database reset:

- `npx supabase db reset --local`: passed; every migration was replayed from scratch.
- `npm run test:db`: 758/758 passed across 41 files.
- `npm run test:unit`: 366/366 passed across 42 files.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npx eslint --no-ignore src/constants/orderDerivedStatusV2.ts tests/unit/order-derived-status-v2.test.ts`: passed.
- `git diff --check`: passed.

The repository-wide `npm run lint` remains red because it scans pre-existing
untracked release snapshots under `tmp/` (430 errors and 47 warnings). None of
the phase 2 files reports a lint error when checked directly.

## Boundaries

- The helper is presentation-only and is not wired into runtime decisions yet.
- The migration does not update orders, financial rows, feature flags, or the
  legacy mirror.
- Lifecycle timing validation remains owned by the existing V2 guards; the
  display helper does not invent delivery evidence or timestamps.
- Checkpoint commits were intentionally not created because the checkout
  contains unrelated uncommitted Doctor Portal work.
