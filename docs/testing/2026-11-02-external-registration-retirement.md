# Decision 80 — first local implementation slice

Source: English Consolidated ERP Implementation Plan — One-Week Target, packages 1/2, B02/B04/B09/B14/B16, decision 80. Latest owner instructions authorize local implementation, not production deployment or source cutover.

## Changes and preservation

`LEGACY_EXTERNAL_REGISTRATION_ENABLED=false` reversibly disables the old route (redirect to `/finance/ledgers`), navigation/search/favourites resolution, quick action, badge query, registration work query, financial transfer-only cells/headers and optional dashboard registration action. The old registration page/export implementation remains preserved behind the disabled route; the service returns empty work without querying. Existing saved favourites are resolved through the filtered registry.

No schema, historical registration value, audit record, cash mutation, `approved` meaning, coordinator permission, employee claim/settlement function, financial source flag or remake rule changed. Supplier timing has **not** been changed in this slice. Existing unrelated dirty work was not staged. The original registration backend history/trigger infrastructure remains; this is not completion of the entire package or notification center.

Rollback of this UI slice: restore the constant to true and re-run the relevant tests before a separately authorized release. Do not change employee `is_registered` values or delete historical events to roll back.

## TDD evidence

- RED: `node node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/unit/external-registration-retirement.test.ts`: 3 failed, 1 passed. Employee approved/unpaid settlement baseline already passed. Checkpoint `4ae3dec` contains only the new test.
- GREEN full unit run: `node node_modules/vitest/vitest.mjs run --config vitest.config.ts`: **63 files, 560 tests passed**.
- Existing navigation tests were updated to exclude a retired redirect from active destinations and remove the obsolete quick action expectation. Historical accounting snapshot/registration tests remain intact.
- TypeScript: `node node_modules/typescript/bin/tsc -b` passed.
- Build: `node node_modules/vite/bin/vite.js build` passed (37.55 seconds). Existing dynamic/static import chunk notices remain.
- ESLint on changed application files passed. Test files are excluded by the existing lint configuration; no lint success is claimed for ignored files.
- Browser: `node node_modules/@playwright/test/cli.js test --config playwright.registration.config.ts`: **3 passed** on installed Chrome, with an isolated build, loopback dummy API and intercepted requests. Tests cover admin/accountant/coordinator bookmarks, absent navigation/transfer header/buttons, and retained receipt/expense forms. This proves mocked UI behavior, not live API permissions or actual employee payout.

| Guarantee | Evidence |
|---|---|
| Retired entries disappear, including stale favourite resolution | `external-registration-retirement.test.ts` and navigation suite |
| Registration work/count calls do not query the database | `external-registration-queries.test.ts`, throwing Supabase mock |
| Approved unpaid employee expense remains outstanding until explicit settlement | `external-registration-retirement.test.ts`, employee suite |
| Cash recording screens remain accessible to the three authorized roles | `external-registration-retirement.spec.ts`, offline Chrome |

No numerical coverage percentage measured. Actual RLS/database coverage and live integrated UI acceptance remain separate gates.

## Database baseline — not green

Supabase image download and startup completed. Repository migrations were applied locally by startup, without a reset or production command. Command: `node_modules/supabase/bin/supabase.exe test db supabase/tests/database --local`.

Result: **54 files, 933 executed tests, exit 1; eight failing files**, including an aborted test file (12 of 18 planned tests). Financial obligations integration, finance transaction atomicity and RLS role matrix passed. No SQL/migration/test file was modified by this implementation slice, so these failures arise from the existing repository database baseline, not this UI code.

| Failing file | Observed failure / next diagnostic |
|---|---|
| admin_issue_state_correction | Expects legacy Delivered; actual `Ready:none:final_delivered`. Compare intended V2 projection; retain delivered evidence checks. |
| analytics_summary_order_count_parity | Rework queue expected 1, actual 0. Trace fixture axes and reporting reader. |
| archive_is_display_only | Legacy status-write guard rejects before the expected archive/money error. Test intended archive invariant through supported V2 writes. |
| atomic_redo_order | Expects legacy Doctor Rejected as well as V2 redo axes. Verify derived state and financial invariants without re-enabling legacy mirror. |
| costing_and_profitability | Cancellation fixture reports 1500 cost/5000 revenue instead of zero; subsequent job insert duplicates auto-created round 1 and aborts six remaining checks. Trace explicit cancellation axes and automatic production-job creation. |
| doctor_portal_scope_and_intake | Unreviewed case shipment unexpectedly succeeds. Investigate effective shipment eligibility versus Portal intake axes; do not weaken this assertion. |
| order_issue_workflow_v2 | Actual `New Case:lab_rejected:Rejected`, expected legacy Lab Rejected. Verify V2 issue and technical states. |
| shipments_and_packaging | Assertion combines final_delivered with obsolete Delivered projection. Validate actual receipt and billing separately from retired status. |

`20261027010000_disable_legacy_status_mirror.sql` explicitly makes the legacy projection read-only and switches its mirror off. This is evidence for diagnosis, not permission to change tests indiscriminately. The baseline blocks integrated release acceptance. Production definitions/flags remain unverified in this run.

## Environment recovery

First startup had two overlapping Supabase processes; stopped only the older process. A diagnostic extra postgres image pull was cancelled; no volume was removed. Sandbox blocked Docker/loopback access; authorized elevated commands were used. Bundled Playwright browser was absent, so installed Chrome was used. Development-server navigation timed out; isolated build/preview succeeded. An initial browser locator used heading wording instead of the actual submit button; corrected the locator after inspecting the page snapshot, with no product change.

## Self-evaluation

First slice is reviewable; integrated acceptance remains blocked. Accuracy 4/5: concrete test evidence, production unverified. Completeness 3/5: eight baseline SQL failures and remaining approved packages outstanding. Clarity 4/5: scope and evidence separated, large baseline table remains necessary. Actionability 4/5: runnable browser configuration and specific SQL diagnostics, release still blocked. Conciseness 4/5: evidence kept in one report; environment details retained for reproducibility. Average 3.8/5. Improvement priorities: resolve SQL baseline without restoring retired status behavior; then continue supplier timing with isolated financial non-regression tests. The user should agree this is a tested first implementation slice, not the completed ERP plan.
