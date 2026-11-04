# Day 1 reviewed frontend release — 4 November 2026

The owner explicitly approved deploying Day 1 registration retirement and the reviewed finance UI changes, excluding Day 2, production migrations, source cutovers and historical corrections.

## Published scope and provenance

- Production baseline: `daf0aa9dba99d5e7c801dfe3e0a13f43e75a5f5b`.
- Isolated release checkout: `.deployment/day1-reviewed`, branch `codex/release-day1-reviewed`.
- Published commit: **`5f691de51234a97fb8f9e995d4cd92669209d413`**. Fast-forward push to `master`, no force push. Local Day 2 work stayed on `codex/recovered-erp-20261104`.
- GitHub production deployment **7551007921**, created **2026-11-04 16:03:23 UTC / 18:03:23 Cairo**; `Vercel – orca` and staging both report success for that exact commit. [Production deployment status](https://vercel.com/orca-dental-labs-projects/orca/CcRuQjzfKDD4Xd4MB9TegCFk1ySw).
- Current public site: [orcalab.vercel.app](https://orcalab.vercel.app/). GET-only checks at 17:26 UTC confirm entry `/assets/index-B8KUTeid.js`, SHA-256 `d9b49c8c6facef46e374b1dc3043a6115fa1ca9d300e6732ad4899e5ef8cd35b`.
- Served code redirects retired registration to finance ledgers, contains both rolling date filters and numeric wheel protection, and does **not** contain `/design-qc`. Public client configuration still points to the existing production Supabase project.

Included behavior: retire external case registration entries/counts/route while preserving employee expense settlement, cash and audit; compact expense form with collapsed native category selector; last 7/30 days including today, excluding future dates, across expense/revenue/collection/payment logs; hide numeric spinners and prevent wheel changes only on the focused numeric input, preserving focus and other scrolling.

The 17-path release diff contains no `supabase/` changes, no Design QC implementation, no supplier accrual changes and no changes to `src/constants/financialObligations.ts`. Tracking remains true, reporting false and client mutation sync false in the published source. Repository deployment workflows were checked: this push does not apply database migrations. No deployment environment settings were edited.

## Verification and limits

| Check | Result |
|---|---|
| Isolated release unit suite | 59 files / 499 tests PASS |
| Release TypeScript/build and changed-source lint | PASS |
| Offline browser registration retirement: admin/accountant/coordinator | 3 PASS |
| Current public UI artifacts and deployment status | PASS, GET-only |
| Live Chrome numeric-input smoke on the login page | PASS: temporary DOM input has no spinners; trusted wheel preserves value/focus; ArrowUp works; other wheel events are not prevented. All non-GET/HEAD requests blocked; no login or database write |
| Production migration ledger after deployment | Read-only query: 272, latest `20261101000000`, `transaction_read_only=on`; unchanged from inventory |

No production transaction was created for testing. The owner had already accepted the manual local finance tests. GitHub/Vercel exact-commit provenance and public served-code checks are separate evidence; an exact byte comparison to the local build was **not established** (local and hosted entry hashes differ). Financial source flags were verified in the unchanged published source, not recovered as named objects from optimized hosted JavaScript. No claim of production Day 2 readiness is made.

Machine receipts: [live asset checks](2026-11-04-day1-reviewed-live-proof.json), [commit status](2026-11-04-day1-reviewed-deploy-status.json), [deployment metadata](2026-11-04-day1-reviewed-deployments.json).

Rollback reference is the previous frontend commit `daf0aa9d...`; any actual rollback is a separate production action. There is no database rollback in this release because no migration ran.
