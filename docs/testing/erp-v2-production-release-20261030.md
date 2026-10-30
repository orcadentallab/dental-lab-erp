# Non-portal ERP production release — 2026-10-30

Base: `d804357`. Includes V2 order mutations and display/financial consumers,
representative own-delivery approval, and monthly PDF reporting. Keeps the
existing designer workspace and form/deployment recovery fixes. Doctor Portal
pages, authentication, registration, uploads, destinations, and RPC wrappers are
excluded and retain the production baseline. Build targets production Supabase.

Build failure reproduced on the baseline: OrderForm referenced `intakeState`
which was missing from `Order`. Added the shared V2 intake contract and mapping.

RED: 29 intended regression assertions failed before transferring implementation.
GREEN: 53 unit files / 482 tests passed. `tsc -b` and Vite production build passed.
Source ESLint: zero errors, two existing DashboardNew effect-dependency warnings.
Preserved the designer legacy-write regression and updated its expected V2-only
payload. Verified portal service functions remain identical to the baseline.

Production SQL: only `20261030000000_rep_edit_uses_own_delivery` was applied.
Seven delivery predicate/RPC assertions passed in a rolled-back preflight and
again before committing the migration with its history entry. Portal migrations
were not applied. Existing V2 migrations were already applied and were not rerun.

No authenticated browser delivery or PDF visual acceptance was performed in this
release; the browser control channel was unavailable. Coverage was not measured.
Deployment completion and public asset responses must be verified after push.

Self-evaluation: accuracy 4/5 (build/unit/SQL proof; authenticated UI unverified),
completeness 4/5 (non-portal changes isolated; browser acceptance remains), clarity
4/5 (explicit scope and limits), actionability 4/5 (release and SQL tested; final
deployment check pending), conciseness 4/5 (short evidence record). Overall 4.0/5.
Priority follow-up: verify the deployed revision and representative delivery UI.
