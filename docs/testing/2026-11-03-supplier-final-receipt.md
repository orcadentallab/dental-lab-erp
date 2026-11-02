# Normal supplier accrual at final doctor receipt — local implementation

Authority: owner's explicit 3 November instruction; English consolidated plan, package 3, B04/B11/B13/B15, decisions 58–62. Scope is normal order supplier payable timing, preserving cash, designer and remake finance. No production or historical repair authorization.

## Behavior

- The canonical order trigger now earns normal supplier AP only at `production_status='final_delivered'`, with the existing `issue_state='none'` requirement and unchanged cost/salaried-designer formulas.
- Existing date/term logic now receives the actual receipt date when the delivery RPC sets it. Ready no longer creates the earlier obligation whose date previously survived delivery. Due-date rules themselves did not change.
- `external_lab_ready` remains the stable trigger identifier for compatibility. New normal obligations carry `normalSupplierAccrual='final_delivered'` metadata; no IDs were renamed.
- Existing unmarked normal Ready obligations are preserved on subsequent pre-delivery synchronization. They are not voided, replaced, redated or reallocated by this timing change. Migration contains only a guarded function-definition change, no historical data updates/backfills or source flags. Existing issue/deletion/restoration behavior remains separate.
- Candidate/transition helpers and disabled client correction fallback eligibility now also require final delivery. The old implied-ready hint cannot authorize a pre-delivery normal candidate. Client-side mutation synchronization remains disabled; no emergency fallback was activated.
- Cash transactions, `approved`, coordinator permissions, revenue/profitability readers, designer completion liability, fixed salary and remake/rejection/return settlements were not redefined.

## RED/GREEN evidence

RED checkpoint `eb5b200`: the new SQL suite completed 16 tests with five failures: Ready accrual, repeated Ready accrual, accrual despite a pre-delivery actual payment, receipt trigger date and due date. Ten new unit tests had nine failures and one designer-baseline pass. Evidence: `.tmp/supplier-timing-red.log`, `.tmp/supplier-timing-unit-red.log`.

After the local migration, all 16 SQL tests passed. Added five fixed-salary parity assertions. Final evidence:

| Check | Actual result / command |
|---|---|
| Complete SQL suite | **55 files / 968 tests PASS**, `node_modules/supabase/bin/supabase.exe test db supabase/tests/database --local` |
| Complete unit suite | **64 files / 570 tests PASS**, `node node_modules/vitest/vitest.mjs run --config vitest.config.ts` |
| Existing financial Playwright-runner pure tests | **116 PASS**, `node node_modules/@playwright/test/cli.js test --config .tmp/playwright-financial-pure.config.ts` (no browser/server) |
| Changed-source ESLint / TypeScript / build | All passed; build 22.91 seconds, `.tmp/supplier-timing-build.log`. A later text-only failure-message correction passed the financial pure suite again. |

The pure-test configuration selects only `tests/financialObligations.spec.ts`, workers=1, reporter=list, and has no webServer/projects requiring a browser. No new UI flow is claimed tested by these pure tests. Numeric coverage percentage was not measured.

The 21 new SQL guarantees cover Ready, Try-In ready/receipt, final Ready, an actual advance, actual delivery date/terms, split cost, retry and repeated-sync identity, byte-for-byte designer/cash preservation, no automatic cash, untouched legacy Ready fields/row count, and fixed-salary designer/supplier formulas before/after receipt. Existing full suites retain remake settlement, allocation transfer, return, rejection, overpayment and rollback assertions.

## Existing test alignment and preserved work

- Paid-supplier reassignment and allocation-actor fixtures now use `final_delivered`; their expected payment, amount, party and actor checks are unchanged. Their stale legacy Ready label remains deliberately irrelevant.
- Unit and pure-helper tests replace Ready-earning expectations with final receipt. Existing rejection/return/credit and historical-preview assertions remain intact.
- `admin_production_status_correction.test.sql` was already untracked work from the previous owner session. It was read in full before alignment. Its Ready fixture now expects no AP, and financial-failure injection targets Delivered (the actual accrual boundary) rather than Ready. All audit/rollback/permission/designer checks remain. It stays untracked rather than being silently absorbed into this commit; the narrow delta is preserved in `2026-11-03-admin-production-supplier-timing.patch`, applicable to the prior version. The corresponding pre-existing migration was not edited or staged.
- An initial migration attempt failed closed on CRLF-sensitive matching and rolled back. Matching was made whitespace-tolerant; the compatibility assertions remain. The migration was then applied locally successfully.

## Boundaries and next release review

Only `20261103010000_normal_supplier_final_receipt.sql` was applied to local Docker. No reset, production definition verification, deployment, source cutover or historical correction occurred. Source flags stay unchanged (tracking=true, reporting=false, client sync=false).

The separately identified `external_stage_returned` writer in `receive_external_work_order` is a distinct stage-run liability contract, not this normal-order `external_lab_ready` branch. It was not rewritten or activated; local `production_v1` was observed off. A release that activates that separate production path needs its own reader/writer reconciliation; this report does not assert its parity or current deployed flag state.

Review effective deployed trigger definitions before any separately authorized migration. Do not roll back by re-enabling Ready accrual on used orders or voiding real financial history; prepare a compatible correction while retaining earned obligations and payments.

Self-evaluation: accuracy 4/5 (local SQL and helper evidence; production unverified); completeness 4/5 (normal-order timing and parity covered; separate stage contract not claimed); clarity 4/5 (stable IDs and historical exception explicit; supporting patch required for pre-existing untracked test); actionability 4/5 (migration/test commands supplied; release requires separate review); conciseness 4/5 (single report with necessary scope detail). Overall 4.0/5. Follow-ups: review production definitions/flags under separate authorization and separately reconcile external-stage contracts before enabling that route. The user should agree this is a local normal-order timing change, not a historical accounting repair.
