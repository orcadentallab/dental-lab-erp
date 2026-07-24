# ERP Code Review — 2026-07-24

## Executive summary

The ERP has a solid functional foundation and is actively protected by TypeScript,
Supabase RLS, atomic workflow RPCs, financial reconciliation logic, unit tests, and
role-based routing. The production build succeeds and all current unit tests pass.

The main engineering risk is concentration: core business behavior is spread across
very large client modules, while order workflow, pricing, and finance are tightly
coupled. Future work should reduce that concentration without rewriting working
financial logic.

## Verification baseline

- `npm run typecheck`: passed.
- `npm run test:unit`: 6 files and 45 tests passed.
- `npm run lint`: passed with 50 warnings and no errors.
- `npm run build`: passed.
- Production bundle: the main entry is about 752 kB before gzip; PDF and spreadsheet
  dependencies are already split, but mixed static/dynamic imports limit further
  splitting.
- `.env` and `.env.production` are ignored; only `.env.example` is tracked.

## Findings

### P0 — server-side authorization for AI functions

The AI pages are guarded in React, but both AI edge functions accepted requests
without enforcing an authenticated administrator before using privileged server
credentials. This allowed direct callers to consume the external AI quota and, for
analysis, attempt privileged writes.

Remediation applied:

- Require a valid bearer token in `gemini-chat` and `gemini-analyze`.
- Resolve the authenticated user's profile and require the `admin` role.
- Return 401/403 before parsing or processing analytics data.
- Remove logging of raw model output and client-side business payloads.

Deployment note: edge functions must be redeployed for this protection to reach
production.

### P1 — financial state is still partly client-orchestrated

The existing tech-debt registry correctly identifies obligation creation and
voiding that can be bypassed by direct table writes. Order state and financial state
must become one database transaction, enforced by triggers/RPCs and constraints.

Recommendation: complete TD-001 before adding another workflow status or financial
feature. Add database tests for delivery, reversal, rejection, redo, archive, and
restore.

### P1 — modules are too large and mix responsibilities

Largest examples:

- `src/services/supabase/orders.ts`: 2,763 lines.
- `src/pages/Accounts.tsx`: 2,462 lines.
- `src/pages/DashboardNew.tsx`: 2,025 lines.
- `src/pages/EmployeeDetail.tsx`: 1,459 lines.
- `src/pages/Orders.tsx`: 1,429 lines.
- `src/services/pdfService.ts`: 1,409 lines.

Refactor by feature slice, not by generic technical layer. For example, split order
commands, order queries, workflow transitions, obligation side effects, mapping,
and audit events. Put pure calculations in tested modules and keep page components
focused on orchestration and rendering.

### P1 — reporting performs heavy client-side aggregation

Accounts, aging, statements, and snapshots can retrieve large datasets and aggregate
in the browser. This increases latency, memory use, data exposure, and the chance of
different pages calculating the same KPI differently.

Recommendation: define a canonical reporting layer in Postgres using versioned views
or RPCs. Every KPI should have an owner, formula, time basis, and reconciliation test.

### P1 — local financial snapshots are not durable business records

`BalanceSnapshot` stores snapshots in browser `localStorage`. They are device-specific,
easy to clear, not shared, and do not provide reliable audit history.

Recommendation: save snapshots in a protected database table with creator, timestamp,
period, source version, and immutable snapshot values. Keep local storage only for
temporary UI preferences.

### P2 — stale hook dependencies and lint suppressions

Lint reports 50 warnings, including missing dependencies in Accounts,
EmployeeDetail, MarketingAnalytics, and DoctorOrders. A missing dependency can create
stale calculations or skipped refreshes even when TypeScript passes.

Recommendation: fix hook warnings behavior-by-behavior, then make lint warnings fail
CI (`eslint --max-warnings 0`). Remove obsolete suppressions after the behavioral
warnings are resolved.

### P2 — obsolete mock backend creates operational ambiguity

The production app uses Supabase directly. `backend/` exposes unauthenticated,
in-memory sample CRUD routes with permissive CORS and arbitrary request spreading.
It should never be deployed as the ERP API.

Recommendation: archive/remove it if unused, or clearly mark it development-only and
exclude it from deployment. If a server is required later, build it around real auth,
validation, persistence, rate limits, and an explicit API contract.

### P2 — repository hygiene and migration governance

The repository contains many scratch, repair, reconciliation, and destructive scripts,
plus both active and temporary migration directories. These are valuable operational
tools but need guardrails.

Recommendation:

- Move one-off scripts into `scripts/archive/YYYY-MM/`.
- Require `--dry-run` by default and an explicit production confirmation flag.
- Add a script manifest describing owner, purpose, inputs, and whether it writes.
- Establish one authoritative migration path and test a clean database replay in CI.
- Keep generated test reports and local scratch artifacts out of source control.

### P2 — test coverage is narrow relative to financial risk

The 45 unit tests are useful, but the riskiest behavior lives in RPCs, RLS, triggers,
and cross-module workflow/finance transitions.

Recommendation: add Supabase integration tests against a disposable local database,
role-matrix RLS tests, and a small Playwright smoke suite for login, order creation,
delivery, payment allocation, reversal, and reports.

## Business-insight roadmap

### 1. Owner command center

Create one reconciled daily dashboard with:

- revenue, collections, gross profit, and operating cash flow;
- orders received, delivered on time, delayed, returned, rejected, and redone;
- receivables aging and expected collections for the next 7/30 days;
- capacity by production stage, designer, and external lab;
- alerts with an owner and due date, not only passive charts.

### 2. Doctor profitability and retention

Measure each doctor/center by revenue, gross margin, collection speed, remake/return
rate, on-time delivery, order frequency, and trend. Add churn-risk alerts based on
the doctor's normal ordering cadence rather than one fixed inactivity threshold.

### 3. True unit economics

Calculate contribution margin per service, material, workflow type, designer, and
external lab. Include redo/rejection costs, discounts, delivery costs, and collection
losses. Use this for price floors and customer-specific pricing recommendations.

### 4. Production capacity and delivery prediction

Track time spent in each production stage and identify bottlenecks. Forecast promised
delivery risk from service type, workload, urgency, supplier/designer history, and
current work in progress.

### 5. Cash-flow control

Build a 13-week cash forecast from expected doctor collections, supplier/designer
obligations, payroll, recurring expenses, and cashbox balances. Show best/base/worst
scenarios and flag upcoming shortfalls.

### 6. Data-quality scorecard

Before expanding AI features, surface missing prices, unlinked services, stale orders,
unassigned owners, inconsistent statuses, and unreconciled obligations. AI insights
are only as trustworthy as these inputs.

## Recommended delivery order

1. Deploy the AI authorization fixes and verify admin/non-admin behavior.
2. Make order-to-finance transitions database-atomic and add integration tests.
3. Create canonical reporting RPCs and durable balance snapshots.
4. Split the largest order/accounts modules behind characterization tests.
5. Add the owner command center and doctor profitability scorecard.
6. Add capacity forecasting and the 13-week cash forecast.

