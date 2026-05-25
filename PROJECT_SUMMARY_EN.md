# Project Summary - Dental Lab ERP

Last updated: 2026-05-24

## 1. Project Purpose

`Dental Lab ERP` is a web-based management system for dental laboratories. Its purpose is to manage the full daily workflow of a dental lab: case registration, design, production, external lab handling, delivery, finance, reporting, and follow-up.

The system has an Arabic RTL internal ERP interface, role-based employee access, a doctor portal, and a public marketing website at `/`.

## 2. Current Project Snapshot

The main application is a React frontend backed by Supabase for authentication, database access, row-level security, RPC functions, and workflow enforcement. There is also a small Express backend under `backend/`, but it is documented as standalone and is not the primary backend for the current app.

The project is already well developed in these areas:

- Order management and status workflow.
- Role-based access control.
- Financial tracking using `financial_obligations`, not only raw transactions.
- Audit trail for important order changes.
- Large Supabase migration history up to migration `086`.
- Playwright/TypeScript tests for workflow and finance logic.
- Operational and analysis documents under `docs/` and in the project root.

## 3. Technology Stack

- Frontend: React 19 + TypeScript.
- Build tool: Vite 7.
- Routing: React Router 7.
- Styling: Tailwind CSS.
- Backend/Data/Auth: Supabase.
- Icons: lucide-react.
- Animation: framer-motion.
- Validation: zod.
- Excel import/export: xlsx.
- PDF and printing: jspdf, jspdf-autotable, html2canvas-pro, react-to-print.
- Tests: Playwright.
- Deployment config: Vercel and Netlify.

Main scripts from `package.json`:

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm run preview
```

## 4. Repository Structure

- `src/App.tsx`: routes and route-level access rules.
- `src/pages/`: main ERP pages such as Dashboard, Orders, Finance, and Doctors.
- `src/pages/doctor/`: doctor portal pages.
- `src/components/`: reusable UI and feature-specific components.
- `src/services/`: application service layer.
- `src/services/supabase/`: Supabase query and RPC wrappers.
- `src/constants/`: workflow, lifecycle, billing, and event constants.
- `src/lib/`: permissions, validation, utilities, and Supabase client setup.
- `src/context/`: Auth, Theme, Language, and Toast contexts.
- `src/marketing/`: public marketing website.
- `supabase/migrations/`: database schema, RLS, triggers, and RPC migrations.
- `tests/`: Playwright/TypeScript tests.
- `testsprite_tests/`: TestSprite tests and generated assets.
- `docs/`: setup guides, product specs, reviews, and operational runbooks.
- `backend/`: standalone Express API, not the primary backend for the main app.

## 5. Roles and Permissions

The system defines these roles:

- `admin`: broad system access, including users, services, reports, sensitive operations, and configuration.
- `lab`: production and lab workflow handling, quality-related work, and selected order updates.
- `representative`: creates and follows up on doctor orders, manages doctors, and has restricted order-edit permissions.
- `accountant`: finance, accounts, suppliers, registration flags, and selected settings.
- `designer`: handles design-related work and design statuses.
- `doctor`: doctor portal access for submitting requests, viewing orders, and reviewing account information.

Route protection is implemented through `ProtectedRoute` in `src/App.tsx`. Important permissions are also enforced in Supabase through RLS, triggers, and RPC functions, so the frontend is not the only protection layer.

## 6. Main Routes

### Public Routes

- `/`: marketing website.
- `/login`: login page.

### Internal ERP Routes

- `/dashboard`: main dashboard.
- `/orders`: order management.
- `/doctors`: doctor management, mainly for admin and representatives.
- `/quality`: quality dashboard.
- `/accounts`: account statements and entity balances.
- `/settings`: system settings.
- `/staff`: staff affairs.
- `/finance`: finance management.
- `/suppliers`: external labs and suppliers.
- `/case-registration`: case registration.
- `/analytics`: analytics and reporting.
- `/ai-analytics`: AI-powered analytics.
- `/users`: user management.
- `/services`: service and price management.
- `/marketing-analytics`: marketing analytics.

### Doctor Portal Routes

- `/doctor/new-request`: create a new order request.
- `/doctor/my-orders`: doctor order list.
- `/doctor/account`: doctor account view.

## 7. Order Module

Orders are the core business object in the system. Important order fields include:

- `caseId`: generated case code.
- `doctorId`: linked doctor.
- `patientName`: patient name.
- `items`: services, teeth numbers, and prices.
- `totalPrice`, `discount`, `cost`, `manualCost`.
- `status`: legacy/main status still used by many parts of the system.
- `productionStatus`: newer shadow production status.
- `issueState`: newer shadow issue axis.
- `supplierId`, `designerId`, `representativeId`.
- File links: `stlUrl`, `imagesUrl`, `designUrl`.
- Planned and actual delivery dates.
- Comments, feedback, status history, and audit events.

Important legacy statuses include:

- Pending Review
- New Case
- Under Design
- Waiting Dr Approval
- Under Production
- Try In
- Try In Approved
- Ready
- Delivered
- Completed
- Returned for Adjustments
- Rejected
- Cancelled

The newer workflow model separates production progress from issue state.

Production statuses:

- `not_started`
- `designing`
- `in_production`
- `try_in_ready`
- `waiting_doctor`
- `finalization`
- `final_ready`
- `final_delivered`

Issue states:

- `none`
- `returned`
- `rejected`
- `cancelled`
- `on_hold`

The project is currently in a workflow transition phase. The legacy `orders.status` field still remains authoritative in many parts of the application, while `production_status` and `issue_state` exist as newer shadow columns used by the evolving workflow layer.

## 8. Workflow Overview

The typical order flow is:

1. An order is created by an admin/representative, or a request is submitted by a doctor.
2. The case is reviewed and assigned doctor, service, teeth, price, cost, priority, and delivery date details.
3. In split workflow cases, the order can be assigned to a designer and an external lab/supplier.
4. Design moves through statuses such as pending, accepted, in progress, waiting approval, completed, or returned.
5. Production moves from design into production, then into Try-In or Final Ready depending on delivery type.
6. Ready/Delivered states trigger financial rules.
7. Returns, rejections, cancellations, and holds are recorded through status and/or issue state.
8. Important events are recorded in `order_events` and/or `order_history`.

The most important workflow permissions document is:

- `docs/orders-field-permissions.md`

It explains which roles can edit which order fields, what state guards apply, and how the representative audited edit RPC works:

- `rep_update_order_fields_with_audit`

There is also a Postgres feature flag:

- `app.workflow_strict_rep`

When it is off, representatives can continue using the older update path. When it is on, direct representative updates are blocked unless they go through the audit-gated RPC.

## 9. Finance Module

Finance is not limited to simple transactions. The newer model uses `financial_obligations` to track receivables and payables more accurately.

Financial entity types:

- Doctor: receivable from the doctor.
- External lab/supplier: payable to the external lab.
- Designer: represented in types, but the current designer payable candidate returns `null`.

Obligation trigger types:

- `doctor_delivered`: when a case is delivered to the doctor.
- `external_lab_ready`: when a final-ready case creates an external lab payable.
- `external_lab_issue_settlement`: settlement for external lab issue cases.
- `designer_approved`: planned/reserved.
- `manual_adjustment`: manual financial adjustment.

Obligation statuses:

- unpaid
- partially_paid
- paid
- void
- written_off

The finance module supports:

- Entity-specific billing settings through `entity_billing_settings`.
- Due dates using per-order or monthly-cycle billing.
- FIFO allocation preview.
- Historical obligation preview and backfill.
- Financial reconciliation preview.
- Doctor and supplier account statements.
- Export, print, and PDF flows in parts of the UI.

Important files:

- `src/constants/financialObligations.ts`
- `src/services/supabase/financialObligations.ts`
- `src/services/supabase/allocationPreview.ts`
- `src/services/supabase/historicalObligationsPreview.ts`
- `src/services/supabase/historicalObligationsBackfill.ts`
- `src/services/supabase/financialReconciliationPreview.ts`
- `src/components/finance/*`

## 10. Supabase Database

Supabase is used for:

- Authentication.
- PostgreSQL database.
- Row-level security policies.
- RPC functions.
- Triggers.
- AI-related Edge Functions.

Important tables/concepts visible from the code and migrations:

- `users`
- `doctors`
- `suppliers`
- `services`
- `orders`
- `transactions`
- `order_history`
- `order_events`
- `financial_obligations`
- `entity_billing_settings`
- AI conversation and analytics-related tables/policies.

Migration history starts at:

- `001_initial_schema.sql`

and currently reaches:

- `086_add_production_status_and_issue_state_to_orders.sql`

There are also manual rollback and obsolete SQL files under `supabase/manual/`.

## 11. AI and Analytics

The project includes AI analytics and Gemini-related services:

- `src/pages/AIAnalytics.tsx`
- `src/services/gemini.ts`
- `supabase/functions/gemini-chat/index.ts`
- `supabase/functions/gemini-analyze/index.ts`

The apparent purpose is:

- Analyze system data.
- Display insights.
- Provide a chat-style analytics interface.

## 12. Marketing Website

The `/` route serves a public marketing website separate from the ERP dashboard. Related files:

- `src/marketing/MarketingPage.tsx`
- `src/marketing/layout/MarketingLayout.tsx`
- `src/marketing/components/*`
- `public/marketing/*`

The marketing site uses real case imagery and service categories such as Zirconia, Emax, Veneers, Full Arch, and other dental lab work.

## 13. Tests and Quality

Tests exist in:

- `tests/*.spec.ts`
- `testsprite_tests/*`

The current tests cover areas such as:

- App smoke checks.
- Order lifecycle.
- Order events.
- Order display helpers.
- Financial obligations.
- Billing settings.
- Allocation preview.
- Workflow helpers.

Generated test output folders include:

- `playwright-report/`
- `test-results/`

Recommended checks before a serious release:

```bash
npm run typecheck
npm run lint
npm run build
npx playwright test
```

## 14. Local Development

Basic local setup:

1. Install dependencies:

```bash
npm install
```

2. Configure `.env`:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

3. Start the app:

```bash
npm run dev
```

4. The app usually runs at:

```text
http://localhost:5173
```

Detailed Arabic setup guide:

- `docs/SETUP_GUIDE.md`

## 15. Deployment

Deployment configuration exists for:

- Vercel: `vercel.json`
- Netlify: `netlify.toml`

Helper scripts:

- `deploy.ps1`
- `run-deploy.ps1`
- `CLICK_TO_DEPLOY.bat`

Before deployment:

- Verify `.env.production`.
- Run typecheck and build.
- Confirm Supabase migrations are applied.
- Confirm RLS policies and permissions are correct.
- Do not commit secrets into the codebase.

## 16. Important Documentation

- `docs/PRODUCT_SPEC.md`: base product specification.
- `docs/SETUP_GUIDE.md`: Supabase setup guide.
- `docs/orders-field-permissions.md`: canonical order field permissions reference.
- `docs/SECURITY_IMPROVEMENTS.md`: security improvements.
- `docs/DEPLOY_CHECKLIST.md`: deployment checklist.
- `docs/PROJECT_REVIEW_AR.md`: older Arabic project review.
- `docs/IMPROVEMENTS_SUMMARY.md`: improvements summary.
- `docs/EXCEL_IMPORT_GUIDE_AR.md`: Excel import guide.
- `docs/wf-1.5-verification-runbook.md`: workflow verification runbook.
- `docs/wf-1.5-real-data-audit-runbook.md`: real-data workflow audit runbook.

Root-level operational/financial analysis files:

- `manual-review-resolution-plan.md`
- `allocation-manual-review-analysis.md`
- `delivery-obligation-trace.md`
- `root-cause-yellow-group.md`
- `status-change-path-audit.md`
- `historical-allocation-preview.md`
- `account-totals-current-vs-proposed.md`
- `targeted-cleanup-preview.md`

## 17. Current State Notes

- `PROJECT_SUMMARY.md` is the Arabic project summary.
- `PROJECT_SUMMARY_EN.md` is this English version.
- The Git working tree currently contains other uncommitted changes in workflow/order UI files, so future code changes should avoid overwriting existing work.
- `backend/` exists but is not the main backend for the application.
- The order workflow is in a transition phase: `production_status` and `issue_state` exist, while many areas still rely on legacy `status` with helper functions bridging both models.
- The finance module is advanced and includes backfill/reconciliation logic. Any change affecting workflow, delivery, rejection, or order status can affect balances and should be tested carefully.
- Some older review documents may not fully reflect the current state after newer migrations and security changes.

## 18. Executive Summary

This project is a specialized ERP for a dental lab. It has mature coverage for orders, doctors, suppliers, finance, accounts, permissions, audit trails, workflow, and AI analytics. The most important architectural point is that `orders` and `finance` are tightly connected: changing an order status can create, void, or affect financial obligations.

Recommended entry path for a new developer:

1. Read `src/App.tsx` to understand routes and role access.
2. Read `src/services/db.ts` to understand domain types and the service facade.
3. Read `docs/orders-field-permissions.md` before changing order behavior.
4. Read `src/constants/orderLifecycle.ts` and `src/constants/financialObligations.ts` before changing workflow or finance logic.
5. Run typecheck, build, and relevant tests after any workflow or finance change.
